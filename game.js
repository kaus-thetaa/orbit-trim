// ============================================================
// game.js - core loop, rendering, spawning, collision, state
// all tuning numbers live in CONFIG, all sprite grids live in SPRITES
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');

let W, H, groundY;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  groundY = H * (1 - CONFIG.world.groundHeightRatio);
}
window.addEventListener('resize', resize);
resize();

// ---------- state ----------
const STATE = { READY: 'ready', PLAYING: 'playing', DYING: 'dying', DEAD: 'dead' };
let state = STATE.READY;

let scroll = { back: 0, mid: 0, fore: 0 };
let speed = CONFIG.speed.base;
let elapsed = 0;
let score = 0;
let distance = 0;
let cycleClock = 0; // runs always, drives the day/night fade independent of runs

let player, obstacles, collectibles, particles, bullets;
let spawnTimers, stars, shootingStars, horizon, farHorizon, planetX;
let collectedScore = 0;
let deathTimer = 0;
let graceTimer = 0; // start-of-run invincibility window, counts down to 0

// ---------- serial monitor & connect UI ----------
let serialLogs = [];
const MAX_SERIAL_LOGS = 12;
let showSerialMonitor = false; // Start hidden, toggle with 'M'

// Create a visible connect button directly in the DOM
const connectBtn = document.createElement('button');
connectBtn.innerText = '🔗 Connect Hardware';
connectBtn.style.position = 'absolute';
connectBtn.style.top = '20px';
connectBtn.style.right = '20px';
connectBtn.style.padding = '10px 15px';
connectBtn.style.fontFamily = 'monospace';
connectBtn.style.fontSize = '14px';
connectBtn.style.background = 'rgba(0, 0, 0, 0.65)';
connectBtn.style.color = '#00FF00';
connectBtn.style.border = '1px solid #00FF00';
connectBtn.style.cursor = 'pointer';
connectBtn.style.zIndex = '1000';
connectBtn.style.display = 'none'; // Hidden by default
document.body.appendChild(connectBtn);

// Wire the button to the Input script's serial request function
connectBtn.addEventListener('click', () => {
  if (typeof Input !== 'undefined' && Input.requestSerialConnect) {
    Input.requestSerialConnect();
  }
});

// Expose globally so Input.js can push incoming webserial data here
window.logToSerialMonitor = function(text) {
  serialLogs.push(text);
  if (serialLogs.length > MAX_SERIAL_LOGS) {
    serialLogs.shift();
  }
};

function resetGame() {
  speed = CONFIG.speed.base;
  elapsed = 0;
  score = 0;
  distance = 0;
  collectedScore = 0;
  deathTimer = 0;
  scroll = { back: 0, mid: 0, fore: 0 };

  // rocket silhouette bounding box, faces right by construction (no rotation)
  player = {
    x: CONFIG.player.xPosition,
    y: H * CONFIG.player.startY,
    vy: 0,
    flameFrame: 0,
    flameTimer: 0,
    w: CONFIG.player.width,
    h: CONFIG.player.height,
    rotation: 0,
    spin: 0
  };
  graceTimer = CONFIG.spawnGrace.durationMs;

  obstacles = [];
  collectibles = [];
  particles = [];
  bullets = [];

  spawnTimers = {
    obstacle: CONFIG.obstacles.spawnIntervalStart,
    collectible: CONFIG.collectibles.spawnIntervalStart,
    weapon: CONFIG.weapon.fireIntervalMs
  };

  stars = buildStarfield();
  shootingStars = [];
  horizon = buildHorizon(CONFIG.world.horizonTileWidth, H * CONFIG.world.groundHeightRatio, CONFIG.world.horizonSeed);
  farHorizon = buildHorizon(CONFIG.world.horizonTileWidth * 0.75, H * CONFIG.world.groundHeightRatio * 1.15, CONFIG.world.horizonSeed + 91);
  planetX = W * 0.55;
}

function buildStarfield() {
  const list = [];
  const count = Math.floor((W * H) / 4500);
  for (let i = 0; i < count; i++) {
    list.push({
      x: Math.random() * W * 2,
      y: Math.random() * groundY * 0.9,
      r: Math.random() * 1.6 + 0.4,
      tw: Math.random() * Math.PI * 2
    });
  }
  return list;
}

resetGame();

// ---------- input wiring ----------
Input.init(canvas);

canvas.addEventListener('click', (e) => {
  if (serialGestureConsumed) { serialGestureConsumed = false; return; }
  handleTapRestart();
});
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') handleTapRestart();
  if (e.key.toLowerCase() === 'm') {
    showSerialMonitor = !showSerialMonitor;
    // Toggle the visible connect button along with the monitor
    connectBtn.style.display = showSerialMonitor ? 'block' : 'none';
  }
});

// hidden long-press gesture to open the browser's serial port picker.
// webserial requires a real user gesture for the permission prompt, and
// the spec calls for no visible connect button, so a long hold on the
// canvas is the discreet trigger for pairing the icm/mkr at the booth
let serialPressStart = 0;
let serialGestureConsumed = false;
const SERIAL_HOLD_MS = 700;

canvas.addEventListener('pointerdown', () => {
  serialPressStart = performance.now();
});
canvas.addEventListener('pointerup', () => {
  const held = performance.now() - serialPressStart;
  if (held >= SERIAL_HOLD_MS && Input.mode !== 'tilt') {
    serialGestureConsumed = true;
    Input.requestSerialConnect();
  }
});

function handleTapRestart() {
  if (state === STATE.READY) {
    state = STATE.PLAYING;
    setOverlay('');
  } else if (state === STATE.DEAD) {
    resetGame();
    state = STATE.PLAYING;
    setOverlay('');
  }
  // taps during the dying crash animation are ignored on purpose
}

// ---------- overlay / hud text (lowercase, max 2-3 words) ----------
function setOverlay(text, sub) {
  if (!text) {
    overlay.classList.remove('visible');
    overlay.innerHTML = '';
    return;
  }
  overlay.innerHTML = `<div>${text}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  overlay.classList.add('visible');
}

setOverlay('tap start');

// highest the terrain silhouette can possibly rise to, so spawned obstacles
// and collectibles never clip into a tall ridge or spire
function terrainSafeBottom() {
  const maxRise = H * CONFIG.world.groundHeightRatio * 1.15; // heightAt's own max multiplier
  const maxSpire = H * CONFIG.world.groundHeightRatio * 2.0; // spire height upper bound
  return groundY - Math.max(maxRise, maxSpire) - 24;
}

// ---------- spawning ----------
function spawnObstacle() {
  const r = CONFIG.obstacles.radius;
  const bottom = terrainSafeBottom() - r * 2;
  const y = Math.random() * Math.max(20, bottom - 10) + 10;

  const variance = CONFIG.obstacles.speedVariance;
  const speedMult = 1 + (Math.random() * 2 - 1) * variance;

  obstacles.push({
    x: W + r,
    y,
    w: r * 2,
    h: r * 2,
    r,
    speedMult,
    trailPhase: Math.random() * Math.PI * 2
  });
}

function spawnCollectible() {
  const w = CONFIG.collectibles.width;
  const h = CONFIG.collectibles.height;
  const bottom = terrainSafeBottom() - h;
  const y = Math.random() * Math.max(20, bottom - 10) + 10;

  collectibles.push({
    x: W + 40,
    y,
    w,
    h,
    bob: Math.random() * Math.PI * 2,
    taken: false
  });
}

function currentSpawnInterval(cfgBlock) {
  const t = clamp01(elapsed / cfgBlock.rampMs);
  return lerp(cfgBlock.spawnIntervalStart, cfgBlock.spawnIntervalMin, t);
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---------- update ----------
let lastTime = performance.now();

function update(dt) {
  Input.update();
  cycleClock += dt * 1000; // day/night cycle always runs, even on menus

  if (state === STATE.DYING) {
    updateStars(dt);
    updateDying(dt);
    updateParticles(dt);
    return;
  }

  if (state !== STATE.PLAYING) {
    // still drift background gently on the ready/dead screens
    scroll.back -= dt * speed * CONFIG.speed.backMultiplier;
    scroll.mid -= dt * speed * CONFIG.speed.midMultiplier;
    updateStars(dt);
    return;
  }

  elapsed += dt * 1000;
  speed = Math.min(CONFIG.speed.max, CONFIG.speed.base + elapsed * 0.001 * CONFIG.speed.rampPerSecond);

  scroll.back -= dt * speed * CONFIG.speed.backMultiplier;
  scroll.mid -= dt * speed * CONFIG.speed.midMultiplier;
  scroll.fore -= dt * speed * CONFIG.speed.foregroundMultiplier;

  distance += dt * speed;
  score = Math.floor(distance / CONFIG.score.distancePerPoint) + collectedScore;

  if (graceTimer > 0) graceTimer = Math.max(0, graceTimer - dt * 1000);

  updateStars(dt);
  updatePlayer(dt);
  updateObstacles(dt);
  updateCollectibles(dt);
  updateBullets(dt);
  updateParticles(dt);
  handleSpawning(dt);

  // start-of-run grace window: rocket blinks and can't be hit, so a hazard
  // that happens to sit right at the fixed spawn point can't insta-kill
  if (graceTimer <= 0) {
    checkCollisions();
    checkTerrainCollision();
  }
}

// gravity-driven tumble once the rocket has been hit, ends in a full stop
// so the game-over overlay appears against a settled crash instead of a cut
function updateDying(dt) {
  const cfg = CONFIG.crash;
  player.vy += cfg.gravity * dt;
  player.y += player.vy * dt;
  player.rotation += player.spin * dt;

  const floor = groundY - player.h * 0.3;
  deathTimer += dt * 1000;

  if (player.y > floor || deathTimer > cfg.durationMs) {
    player.y = Math.min(player.y, floor);
    state = STATE.DEAD;
    setOverlay('game over', 'tap restart');
  }
}

function updateStars(dt) {
  if (Math.random() < 0.004) {
    shootingStars.push({
      x: Math.random() * W,
      y: Math.random() * groundY * 0.5,
      len: 60 + Math.random() * 60,
      speed: 700 + Math.random() * 300,
      life: 1
    });
  }
  for (const s of shootingStars) {
    s.x -= s.speed * dt;
    s.y += s.speed * dt * 0.4;
    s.life -= dt * 1.2;
  }
  shootingStars = shootingStars.filter(s => s.life > 0);
}

function updatePlayer(dt) {
  const cfg = CONFIG.player;
  const targetVy = Input.axis * cfg.moveSpeed;
  player.vy += (targetVy - player.vy) * cfg.smoothing;
  player.y += player.vy * dt;

  const topLimit = 10;
  const bottomLimit = groundY - player.h - 6;
  if (player.y < topLimit) { player.y = topLimit; player.vy = 0; }
  if (player.y > bottomLimit) { player.y = bottomLimit; player.vy = 0; }

  player.flameTimer += dt * 1000;
  if (player.flameTimer > cfg.flameFrameMs) {
    player.flameTimer = 0;
    player.flameFrame = (player.flameFrame + 1) % SPRITES.rocket.flame.length;
  }
}

function updateObstacles(dt) {
  for (const o of obstacles) {
    o.x -= speed * o.speedMult * dt;
    o.trailPhase += dt * 12;
  }
  obstacles = obstacles.filter(o => o.x > -80);
}

function updateCollectibles(dt) {
  for (const c of collectibles) {
    c.x -= speed * dt;
    c.bob += dt * 4;
  }
  collectibles = collectibles.filter(c => c.x > -60 && !c.taken);
}

function updateParticles(dt) {
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt * 2;
  }
  particles = particles.filter(p => p.life > 0);
}

function handleSpawning(dt) {
  spawnTimers.obstacle -= dt * 1000;
  if (spawnTimers.obstacle <= 0) {
    spawnObstacle();
    spawnTimers.obstacle = currentSpawnInterval(CONFIG.obstacles);
  }

  spawnTimers.collectible -= dt * 1000;
  if (spawnTimers.collectible <= 0) {
    spawnCollectible();
    spawnTimers.collectible = currentSpawnInterval(CONFIG.collectibles);
  }

  spawnTimers.weapon -= dt * 1000;
  if (spawnTimers.weapon <= 0) {
    fireBullet();
    spawnTimers.weapon = CONFIG.weapon.fireIntervalMs;
  }
}

// ---------- air defence gun ----------
function fireBullet() {
  bullets.push({
    x: player.x + player.w * 0.85,
    y: player.y + player.h / 2
  });
}

function updateBullets(dt) {
  for (const b of bullets) {
    b.x += CONFIG.weapon.bulletSpeed * dt;
  }
  bullets = bullets.filter(b => b.x < W + 20);

  const r = CONFIG.weapon.bulletRadius;
  for (const b of bullets) {
    for (const o of obstacles) {
      const dx = (o.x + o.r) - b.x;
      const dy = (o.y + o.r) - b.y;
      if (Math.hypot(dx, dy) < o.r + r) {
        b.hit = true;
        o.hit = true;
        collectedScore += CONFIG.weapon.destroyScoreValue;
        spawnSparkle(b.x, b.y);
      }
    }
  }
  bullets = bullets.filter(b => !b.hit);
  obstacles = obstacles.filter(o => !o.hit);
}

function checkCollisions() {
  const pad = CONFIG.player.hitboxPadding;
  const pl = { x: player.x + pad, y: player.y + pad, w: player.w - pad * 2, h: player.h - pad * 2 };

  for (const o of obstacles) {
    const ob = { x: o.x + 4, y: o.y + 4, w: o.w - 8, h: o.h - 8 };
    if (rectsOverlap(pl, ob)) {
      triggerCrash();
      return;
    }
  }

  for (const c of collectibles) {
    if (c.taken) continue;
    const cb = { x: c.x, y: c.y, w: c.w, h: c.h };
    if (rectsOverlap(pl, cb)) {
      c.taken = true;
      collectedScore += CONFIG.collectibles.scoreValue;
      spawnSparkle(c.x + c.w / 2, c.y + c.h / 2);
    }
  }
}

// ground and spike (spire) collision, sampled against the near horizon
// layer using the same offset math the renderer uses so hitboxes always
// match exactly what's drawn on screen
function checkTerrainCollision() {
  const margin = CONFIG.world.terrainKillMargin;
  const tw = horizon.tileWidth;
  const offset = wrap(scroll.fore, tw);
  const footX = player.x + player.w / 2;

  const groundSurfaceY = groundY - horizon.heightAt(wrap(footX - offset, tw));
  if (player.y + player.h >= groundSurfaceY + margin) {
    triggerCrash();
    return;
  }

  const firstPeriod = Math.floor((-100 - offset) / tw) - 1;
  const lastPeriod = Math.ceil((W + 100 - offset) / tw) + 1;

  for (let k = firstPeriod; k <= lastPeriod; k++) {
    for (const sp of horizon.spires) {
      const screenX = sp.x + offset + k * tw;
      if (screenX < player.x - sp.width || screenX > player.x + player.w + sp.width) continue;
      const baseY = groundY - horizon.heightAt(sp.x);
      const topY = baseY - sp.height;
      const spikeBox = { x: screenX - sp.width / 2, y: topY, w: sp.width, h: baseY - topY };
      const pad = CONFIG.player.hitboxPadding;
      const pl = { x: player.x + pad, y: player.y + pad, w: player.w - pad * 2, h: player.h - pad * 2 };
      if (rectsOverlap(pl, spikeBox)) {
        triggerCrash();
        return;
      }
    }
  }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function spawnSparkle(x, y) {
  for (let i = 0; i < 8; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 80;
    particles.push({
      x, y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: 1,
      color: '#FFC94B'
    });
  }
}

// begins the fall/tumble sequence instead of cutting straight to game over
function triggerCrash() {
  if (state !== STATE.PLAYING) return;
  state = STATE.DYING;
  deathTimer = 0;
  player.vy = -80;
  player.spin = CONFIG.crash.spinSpeed * (Math.random() < 0.5 ? -1 : 1);

  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  for (let i = 0; i < CONFIG.crash.debrisCount; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 90 + Math.random() * 220;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 60,
      life: 1 + Math.random() * 0.6,
      color: Math.random() < 0.5 ? SPRITES.rocket.ink : SPRITES.rocket.flame[0]
    });
  }
}

// ---------- render ----------
function render() {
  const p = getPalette();
  drawSky(p);
  drawStars(p);
  drawCrescentMoon(p);
  const planetPos = drawPlanet(p);
  drawShootingStars(p);
  drawHorizon(p);

  if (state === STATE.READY) {
    drawTitleRocket();
  } else {
    drawCollectibles();
    drawObstacles();
    drawBullets();
    drawParticles();
    drawPlayer();
  }

  drawHud();
  drawSerialMonitor();
}

function drawSerialMonitor() {
  if (!showSerialMonitor) return;
  
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  // Always draw the background box so you know the monitor is active, even if logs are empty
  const boxHeight = Math.max(20 + (serialLogs.length * 16), 40); 
  ctx.fillRect(10, 50, 320, boxHeight);

  ctx.fillStyle = '#00FF00'; // Classic terminal green
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  
  if (serialLogs.length === 0) {
    ctx.fillText("Waiting for incoming serial data...", 20, 60);
  } else {
    for (let i = 0; i < serialLogs.length; i++) {
      ctx.fillText(serialLogs[i], 20, 60 + i * 16);
    }
  }
  ctx.restore();
}

// launch-screen hero rocket, bigger than gameplay scale, same shared shape
// so the title screen reads as rocket first, text second
function drawTitleRocket() {
  const frame = Math.floor(performance.now() / CONFIG.player.flameFrameMs) % SPRITES.rocket.flame.length;
  drawRocketShape(W / 2, H * 0.34, CONFIG.player.width * 2.6, CONFIG.player.height * 2.6, frame);
}

function drawSky(p) {
  const g = ctx.createLinearGradient(0, 0, 0, groundY);
  g.addColorStop(0, p.skyTop);
  g.addColorStop(0.35, p.sky2);
  g.addColorStop(0.6, p.sky3);
  g.addColorStop(0.82, p.sky4);
  g.addColorStop(1, p.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, groundY);
  ctx.fillStyle = p.skyBottom;
  ctx.fillRect(0, groundY, W, H - groundY);
}

function drawStars(p) {
  const offset = wrap(scroll.back, W * 2);
  for (const s of stars) {
    const x = wrap(s.x + offset, W * 2);
    if (x > W) continue;
    const twinkle = 0.5 + Math.sin(performance.now() * 0.002 + s.tw) * 0.5;
    ctx.globalAlpha = 0.4 + twinkle * 0.6;
    ctx.fillStyle = p.star;
    ctx.beginPath();
    ctx.arc(x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawShootingStars(p) {
  ctx.strokeStyle = p.shootingStar;
  ctx.lineWidth = 2;
  for (const s of shootingStars) {
    ctx.globalAlpha = clamp01(s.life);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + s.len, s.y - s.len * 0.4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPlanet(p) {
  // loop width kept close to screen width so the planet is on-screen most
  // of the time (alto's odyssey keeps its moon/sun almost always visible)
  const loopWidth = W * 1.05;
  const baseX = wrap(planetX + scroll.mid, loopWidth) - loopWidth * 0.08;
  const y = groundY * 0.3;
  const r = Math.min(W, H) * 0.2;

  const glow = ctx.createRadialGradient(baseX, y, r * 0.15, baseX, y, r * 3.4);
  glow.addColorStop(0, 'rgba(255, 214, 230, 0.55)');
  glow.addColorStop(0.35, p.planetGlow);
  glow.addColorStop(1, 'rgba(231,183,209,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(baseX, y, r * 3.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = p.planetCore;
  ctx.beginPath();
  ctx.arc(baseX, y, r, 0, Math.PI * 2);
  ctx.fill();

  // soft craters for a touch of surface texture, not flat clip-art
  ctx.fillStyle = 'rgba(163, 74, 117, 0.18)';
  ctx.beginPath(); ctx.arc(baseX - r * 0.35, y - r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(baseX + r * 0.28, y + r * 0.32, r * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(baseX + r * 0.1, y - r * 0.38, r * 0.1, 0, Math.PI * 2); ctx.fill();

  return { x: baseX, y, r };
}

function drawHorizon(p) {
  // atmospheric haze bleeding up from the terrain, ties foreground to sky
  const haze = ctx.createLinearGradient(0, groundY - H * 0.34, 0, groundY);
  haze.addColorStop(0, 'rgba(255,166,193,0)');
  haze.addColorStop(1, p.hazeColor);
  ctx.fillStyle = haze;
  ctx.fillRect(0, groundY - H * 0.34, W, H * 0.34);

  drawHorizonLayer(farHorizon, p.horizonFar2, p.horizonFar2Deep, scroll.mid * 0.6, 0.72, false);
  drawHorizonLayer(horizon, p.horizonNear, p.horizonFar, scroll.fore, 1, true);
}

// draws one silhouette band; heightMul lets the far layer sit shorter/back
function drawHorizonLayer(layer, colorNear, colorFar, scrollOffset, heightMul, withSpires) {
  const fill = ctx.createLinearGradient(0, groundY - H * CONFIG.world.groundHeightRatio, 0, H);
  fill.addColorStop(0, colorNear);
  fill.addColorStop(1, colorFar);

  const tw = layer.tileWidth;
  const offset = wrap(scrollOffset, tw);
  const step = 8;

  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(-step, H);

  for (let x = -step; x <= W + step; x += step) {
    const sampleX = wrap(x - offset, tw);
    const y = groundY - layer.heightAt(sampleX) * heightMul;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W + step, H);
  ctx.closePath();
  ctx.fill();

  if (withSpires) drawSpires(layer, offset, colorFar);
}

// thin needle-like silhouettes rising off the ridge line, drawn once per
// visible tile period so they scroll seamlessly with the terrain under them
function drawSpires(layer, offset, color) {
  const tw = layer.tileWidth;
  const firstPeriod = Math.floor((-100 - offset) / tw) - 1;
  const lastPeriod = Math.ceil((W + 100 - offset) / tw) + 1;

  ctx.fillStyle = color;
  for (let k = firstPeriod; k <= lastPeriod; k++) {
    for (const sp of layer.spires) {
      const screenX = sp.x + offset + k * tw;
      if (screenX < -60 || screenX > W + 60) continue;
      const baseY = groundY - layer.heightAt(sp.x);
      const topY = baseY - sp.height;
      ctx.beginPath();
      ctx.moveTo(screenX - sp.width / 2, baseY + 2);
      ctx.lineTo(screenX, topY);
      ctx.lineTo(screenX + sp.width / 2, baseY + 2);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// small decorative crescent, sits high and near-static like a distant moon
// built from two solid circles (no composite ops) so it can't silently
// break rendering on browsers that special-case destination-out oddly
function drawCrescentMoon(p) {
  const x = wrap(W * 0.82 + scroll.back * 0.4, W * 1.3) - W * 0.15;
  const y = H * 0.12;
  const r = Math.min(W, H) * 0.026;

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // shadow circle painted in the local sky color instead of cut via
  // composite mode, avoids any cross-browser compositing edge cases
  ctx.fillStyle = p.sky2;
  ctx.beginPath();
  ctx.arc(x + r * 0.55, y - r * 0.3, r * 0.92, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer() {
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const usePixelSkin = score >= CONFIG.player.pixelSkinScore;

  if (state === STATE.DYING) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(player.rotation);
    if (usePixelSkin) {
      drawPixelRocketShape(0, 0, player.w, player.h, player.flameFrame);
    } else {
      drawRocketShape(0, 0, player.w, player.h, player.flameFrame);
    }
    ctx.restore();
    return;
  }

  // blink during the start-of-run grace window so invincibility is visible
  if (state === STATE.PLAYING && graceTimer > 0) {
    const on = Math.floor(performance.now() / CONFIG.spawnGrace.blinkMs) % 2 === 0;
    if (!on) return;
  }

  if (usePixelSkin) {
    drawPixelRocketShape(cx, cy, player.w, player.h, player.flameFrame);
  } else {
    drawRocketShape(cx, cy, player.w, player.h, player.flameFrame);
  }
}

// pixel-art reward skin, unlocked at CONFIG.player.pixelSkinScore, drawn
// already facing right so it needs no rotation transform outside the
// dying-state tumble handled by the caller
function drawPixelRocketShape(cx, cy, w, h, flameFrame) {
  const sprite = SPRITES.rocketPixel;
  const cellW = w / sprite.grid[0].length;
  const cellH = h / sprite.grid.length;
  const originX = cx - w / 2;
  const originY = cy - h / 2;

  for (let row = 0; row < sprite.grid.length; row++) {
    const line = sprite.grid[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '.') continue;
      ctx.fillStyle = sprite.colors[ch];
      ctx.fillRect(
        Math.round(originX + col * cellW),
        Math.round(originY + row * cellH),
        Math.ceil(cellW),
        Math.ceil(cellH)
      );
    }
  }

  const flameLen = w * (0.32 + Math.sin(performance.now() * 0.02) * 0.06);
  ctx.fillStyle = sprite.flameColors[flameFrame % sprite.flameColors.length];
  ctx.beginPath();
  ctx.moveTo(originX, cy - h * 0.12);
  ctx.lineTo(originX - flameLen, cy);
  ctx.lineTo(originX, cy + h * 0.12);
  ctx.closePath();
  ctx.fill();
}

// shared silhouette drawer used by both the gameplay rocket and the title
// screen hero rocket, so they always stay visually identical
function drawRocketShape(cx, cy, w, h, flameFrame) {
  const sprite = SPRITES.rocket;

  ctx.fillStyle = sprite.ink;
  drawPoly(cx, cy, sprite.body(w, h));
  drawPoly(cx, cy, sprite.finTop(w, h));
  drawPoly(cx, cy, sprite.finBottom(w, h));

  // flicker flame trailing behind (screen-left), cycles through 3 warm tones
  const flameLen = w * (0.5 + Math.sin(performance.now() * 0.02) * 0.08);
  ctx.fillStyle = sprite.flame[flameFrame % sprite.flame.length];
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.46, cy - h * 0.16);
  ctx.lineTo(cx - w * 0.46 - flameLen, cy);
  ctx.lineTo(cx - w * 0.46, cy + h * 0.16);
  ctx.closePath();
  ctx.fill();
}

function drawPoly(cx, cy, points) {
  ctx.beginPath();
  ctx.moveTo(cx + points[0][0], cy + points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(cx + points[i][0], cy + points[i][1]);
  }
  ctx.closePath();
  ctx.fill();
}

function drawObstacles() {
  const sprite = SPRITES.meteor;
  for (const o of obstacles) {
    const cx = o.x + o.r;
    const cy = o.y + o.r;

    // warm trail streaking behind (screen-right, since meteors move left)
    const wobble = Math.sin(o.trailPhase) * 3;
    ctx.fillStyle = sprite.trailColor;
    ctx.beginPath();
    ctx.moveTo(cx + o.r * 0.5, cy - o.r * 0.35);
    ctx.lineTo(cx + o.r * 1.6 + wobble, cy);
    ctx.lineTo(cx + o.r * 0.5, cy + o.r * 0.35);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = sprite.ink;
    drawPoly(cx, cy, sprite.outline(o.r));
  }
}

function drawCollectibles() {
  const sprite = SPRITES.satellite;
  for (const c of collectibles) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2 + Math.sin(c.bob) * 4;
    const w = c.w, h = c.h;

    ctx.fillStyle = sprite.ink;
    ctx.fillRect(cx - w * 0.15, cy - h * 0.22, w * 0.3, h * 0.44);           // body
    ctx.fillRect(cx - w * 0.5, cy - h * 0.12, w * 0.3, h * 0.24);            // left panel
    ctx.fillRect(cx + w * 0.2, cy - h * 0.12, w * 0.3, h * 0.24);            // right panel

    ctx.fillStyle = sprite.glint;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBullets() {
  ctx.fillStyle = '#8AF0FF';
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, CONFIG.weapon.bulletRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp01(p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  if (state === STATE.PLAYING) {
    hud.textContent = `score ${score}`;
  } else if (state === STATE.READY) {
    hud.textContent = '';
  } else {
    hud.textContent = `score ${score}`;
  }
}

function wrap(v, m) {
  const r = v % m;
  return r < 0 ? r + m : r;
}

// ---------- day/night blend ----------
// smoothly crossfades the whole palette between night and day on a slow
// repeating cycle that runs independent of gameplay state
function getPalette() {
  const t = (cycleClock % CONFIG.dayNight.cycleMs) / CONFIG.dayNight.cycleMs;
  const mix = (1 - Math.cos(Math.PI * 2 * t)) / 2; // 0 = night, 1 = day

  const night = CONFIG.palette;
  const day = CONFIG.paletteDay;
  const blended = { ...night };
  for (const key of Object.keys(day)) {
    blended[key] = lerpColor(night[key], day[key], mix);
  }
  return blended;
}

function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16)
  };
}

// ---------- main loop ----------
// wrapped in try/catch so a single bad frame logs to console instead of
// silently freezing the entire animation loop (requestAnimationFrame never
// reschedules itself if the callback throws uncaught). also draws a small
// red marker so a broken frame is visible even without devtools open
let frameErrorFlag = false;

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  try {
    update(dt);
    render();
    frameErrorFlag = false;
  } catch (err) {
    if (!frameErrorFlag) {
      console.error('frame error', err);
      frameErrorFlag = true;
    }
    ctx.fillStyle = '#FF3B3B';
    ctx.fillRect(10, 10, 14, 14);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
