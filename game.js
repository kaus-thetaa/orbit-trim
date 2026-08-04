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
const STATE = { READY: 'ready', PLAYING: 'playing', DEAD: 'dead' };
let state = STATE.READY;

let scroll = { back: 0, mid: 0, fore: 0 };
let speed = CONFIG.speed.base;
let elapsed = 0;
let score = 0;
let distance = 0;

let player, obstacles, collectibles, particles;
let spawnTimers, stars, shootingStars, horizon, farHorizon, planetX;

function resetGame() {
  speed = CONFIG.speed.base;
  elapsed = 0;
  score = 0;
  distance = 0;
  scroll = { back: 0, mid: 0, fore: 0 };

  // rocket sprite is drawn nose-up then rotated 90deg to face right (see
  // drawPlayer), so its on-screen bounding box has width/height swapped
  // relative to the raw grid dimensions
  const rawW = gridWidth(SPRITES.rocket.body) * CONFIG.world.pixelScale;
  const rawH = gridHeight(SPRITES.rocket.body) * CONFIG.world.pixelScale;

  player = {
    x: CONFIG.player.xPosition,
    y: H * CONFIG.player.startY,
    vy: 0,
    flameFrame: 0,
    flameTimer: 0,
    w: rawH,
    h: rawW
  };

  obstacles = [];
  collectibles = [];
  particles = [];

  spawnTimers = {
    obstacle: CONFIG.obstacles.spawnIntervalStart,
    collectible: CONFIG.collectibles.spawnIntervalStart
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

canvas.addEventListener('click', handleTapRestart);
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') handleTapRestart();
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

// ---------- spawning ----------
function spawnObstacle() {
  const sprite = SPRITES.meteor;
  const scale = CONFIG.world.pixelScale;
  const h = gridHeight(sprite.body) * scale;
  const y = Math.random() * (groundY - h - 40) + 10;

  const variance = CONFIG.obstacles.speedVariance;
  const speedMult = 1 + (Math.random() * 2 - 1) * variance;

  obstacles.push({
    x: W + 40,
    y,
    w: gridWidth(sprite.body) * scale,
    h,
    sprite,
    speedMult,
    trailPhase: Math.random() * Math.PI * 2
  });
}

function spawnCollectible() {
  const scale = CONFIG.world.pixelScale;
  const sprite = SPRITES.satellite;
  const h = gridHeight(sprite.body) * scale;
  const y = Math.random() * (groundY - h - 40) + 10;

  collectibles.push({
    x: W + 40,
    y,
    w: gridWidth(sprite.body) * scale,
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

  updateStars(dt);
  updatePlayer(dt);
  updateObstacles(dt);
  updateCollectibles(dt);
  updateParticles(dt);
  handleSpawning(dt);
  checkCollisions();
}

let collectedScore = 0;

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
    player.flameFrame = (player.flameFrame + 1) % cfg.flameFrames;
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
}

function checkCollisions() {
  const pad = CONFIG.player.hitboxPadding;
  const pl = { x: player.x + pad, y: player.y + pad, w: player.w - pad * 2, h: player.h - pad * 2 };

  for (const o of obstacles) {
    const ob = { x: o.x + 4, y: o.y + 4, w: o.w - 8, h: o.h - 8 };
    if (rectsOverlap(pl, ob)) {
      triggerGameOver();
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

function triggerGameOver() {
  state = STATE.DEAD;
  setOverlay('game over', 'tap restart');
}

// ---------- render ----------
function render() {
  drawSky();
  drawStars();
  drawCrescentMoon();
  const planetPos = drawPlanet();
  drawShootingStars();
  drawHorizon(planetPos);

  if (state === STATE.READY) {
    drawTitleRocket();
  } else {
    drawCollectibles();
    drawObstacles();
    drawParticles();
    drawPlayer();
  }

  drawHud();
}

// launch-screen hero rocket, bigger than gameplay scale with its own idle
// flame animation so the title screen reads as rocket first, text second
function drawTitleRocket() {
  const scale = CONFIG.world.pixelScale * 2.6;
  const sprite = SPRITES.rocket;
  const frame = Math.floor(performance.now() / CONFIG.player.flameFrameMs) % CONFIG.player.flameFrames;
  const flameGrid = sprite.flames[frame];
  const flameColors = sprite.flameColors[frame];

  const bodyW = gridWidth(sprite.body) * scale;
  const bodyH = gridHeight(sprite.body) * scale;
  const cx = W / 2;
  const cy = H * 0.34;
  const originX = -bodyW / 2;
  const originY = -bodyH / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 2);
  drawPixelGrid(ctx, flameGrid, flameColors, originX + scale, originY + bodyH - scale, scale);
  drawPixelGrid(ctx, sprite.body, sprite.colors, originX, originY, scale);
  ctx.restore();
}

function drawSky() {
  const p = CONFIG.palette;
  const g = ctx.createLinearGradient(0, 0, 0, groundY);
  g.addColorStop(0, p.skyTop);
  g.addColorStop(0.35, p.sky2);
  g.addColorStop(0.6, p.sky3);
  g.addColorStop(0.82, p.sky4);
  g.addColorStop(1, p.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, groundY);
  ctx.fillStyle = CONFIG.palette.skyBottom;
  ctx.fillRect(0, groundY, W, H - groundY);
}

function drawStars() {
  const p = CONFIG.palette;
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

function drawShootingStars() {
  ctx.strokeStyle = CONFIG.palette.shootingStar;
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

function drawPlanet() {
  // loop width kept close to screen width so the planet is on-screen most
  // of the time (alto's odyssey keeps its moon/sun almost always visible)
  const loopWidth = W * 1.05;
  const baseX = wrap(planetX + scroll.mid, loopWidth) - loopWidth * 0.08;
  const y = groundY * 0.3;
  const r = Math.min(W, H) * 0.2;

  const glow = ctx.createRadialGradient(baseX, y, r * 0.15, baseX, y, r * 3.4);
  glow.addColorStop(0, 'rgba(255, 214, 230, 0.55)');
  glow.addColorStop(0.35, CONFIG.palette.planetGlow);
  glow.addColorStop(1, 'rgba(231,183,209,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(baseX, y, r * 3.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CONFIG.palette.planetCore;
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

function drawHorizon(planet) {
  const p = CONFIG.palette;

  // strong atmospheric haze bleeding up from the terrain, brighter where
  // the planet glow overlaps so the whole scene reads as one lit source
  const haze = ctx.createLinearGradient(0, groundY - H * 0.34, 0, groundY);
  haze.addColorStop(0, 'rgba(255,166,193,0)');
  haze.addColorStop(1, p.hazeColor);
  ctx.fillStyle = haze;
  ctx.fillRect(0, groundY - H * 0.34, W, H * 0.34);

  if (planet) {
    const bleed = ctx.createRadialGradient(planet.x, groundY, 0, planet.x, groundY, planet.r * 3.2);
    bleed.addColorStop(0, 'rgba(255, 200, 220, 0.28)');
    bleed.addColorStop(1, 'rgba(255, 200, 220, 0)');
    ctx.fillStyle = bleed;
    ctx.fillRect(planet.x - planet.r * 3.2, groundY - H * 0.3, planet.r * 6.4, H * 0.3);
  }

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
function drawCrescentMoon() {
  const x = wrap(W * 0.82 + scroll.back * 0.4, W * 1.3) - W * 0.15;
  const y = H * 0.12;
  const r = Math.min(W, H) * 0.026;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(x + r * 0.55, y - r * 0.3, r * 0.92, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const scale = CONFIG.world.pixelScale;
  const sprite = SPRITES.rocket;
  const flameGrid = sprite.flames[player.flameFrame];
  const flameColors = sprite.flameColors[player.flameFrame];

  const bodyW = gridWidth(sprite.body) * scale;
  const bodyH = gridHeight(sprite.body) * scale;
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  const originX = -bodyW / 2;
  const originY = -bodyH / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 2); // nose faces screen-right, flame trails left behind it
  drawPixelGrid(ctx, flameGrid, flameColors, originX + scale, originY + bodyH - scale, scale);
  drawPixelGrid(ctx, sprite.body, sprite.colors, originX, originY, scale);
  ctx.restore();
}

function drawObstacles() {
  const scale = CONFIG.world.pixelScale;
  for (const o of obstacles) {
    const trailGrid = o.sprite.trail;
    const trailX = o.x + o.w - scale * 2 + Math.sin(o.trailPhase) * 2;
    drawPixelGrid(ctx, trailGrid, o.sprite.colors, trailX, o.y + o.h / 2 - scale * 1.5, scale);
    drawPixelGrid(ctx, o.sprite.body, o.sprite.colors, o.x, o.y, scale);
  }
}

function drawCollectibles() {
  const scale = CONFIG.world.pixelScale;
  const sprite = SPRITES.satellite;
  for (const c of collectibles) {
    const bobY = Math.sin(c.bob) * 4;
    drawPixelGrid(ctx, sprite.body, sprite.colors, c.x, c.y + bobY, scale);
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

// ---------- main loop ----------
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
