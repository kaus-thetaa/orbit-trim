const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');

// Load the pixelated rocket image
const rocketImg = new Image();
rocketImg.src = 'Screenshot_20260805_194729_Chrome.jpg';

let W, H, groundY;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  groundY = H * (1 - CONFIG.world.groundHeightRatio);
}
window.addEventListener('resize', resize);
resize();

// ---------- state ----------
const STATE = { READY: 'ready', PLAYING: 'playing', CRASHING: 'crashing', DEAD: 'dead' };
let state = STATE.READY;

let scroll = { back: 0, mid: 0, fore: 0 };
let speed = CONFIG.speed.base;
let elapsed = 0;
let score = 0;
let distance = 0;
let collectedScore = 0;

let player, obstacles, collectibles, particles, canModels, dots;
let spawnTimers, stars, shootingStars, horizon, farHorizon, planetX;

function resetGame() {
  speed = CONFIG.speed.base;
  elapsed = 0;
  score = 0;
  distance = 0;
  collectedScore = 0;
  scroll = { back: 0, mid: 0, fore: 0 };

  player = {
    x: CONFIG.player.xPosition,
    y: H * CONFIG.player.startY,
    vy: 0,
    flameFrame: 0,
    flameTimer: 0,
    w: CONFIG.player.width,
    h: CONFIG.player.height,
    crashAngle: 0 // Track falling degree
  };

  obstacles = [];
  collectibles = [];
  particles = [];
  canModels = []; // Aluminum can defense models
  dots = []; // Machine gun dots

  spawnTimers = {
    obstacle: CONFIG.obstacles.spawnIntervalStart,
    collectible: CONFIG.collectibles.spawnIntervalStart,
    canModel: CONFIG.obstacles.canSpawnInterval
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
  const r = CONFIG.obstacles.radius;
  // Clamp to ensure it never spawns underground
  const y = Math.min(Math.random() * (groundY - r * 2 - 40) + 10, groundY - r * 2);
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
  // Clamp to ensure it never spawns underground
  const y = Math.min(Math.random() * (groundY - h - 40) + 10, groundY - h);

  collectibles.push({
    x: W + 40,
    y,
    w,
    h,
    bob: Math.random() * Math.PI * 2,
    taken: false
  });
}

function spawnCanModel() {
  const w = 24;
  const h = 36;
  canModels.push({
    x: W + 40,
    y: groundY - h,
    w,
    h,
    reload: 0.5
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

  if (state === STATE.READY || state === STATE.DEAD) {
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

  // Keep adding score if crashing, but player is out of control
  if (state === STATE.PLAYING) {
    distance += dt * speed;
    score = Math.floor(distance / CONFIG.score.distancePerPoint) + collectedScore;
  }

  updateStars(dt);
  updatePlayer(dt);
  updateObstacles(dt);
  updateCollectibles(dt);
  updateCanModelsAndDots(dt);
  updateParticles(dt);
  
  if (state === STATE.PLAYING) {
    handleSpawning(dt);
    checkCollisions();
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

  if (state === STATE.CRASHING) {
    // Crashing physics: apply gravity and tumble
    player.vy += 1200 * dt; 
    player.y += player.vy * dt;
    player.x += speed * 0.2 * dt; // Drift forward slightly
    player.crashAngle += dt * 4; // Tumble/fall degree
    spawnSparkle(player.x + player.w / 2, player.y + player.h / 2, '#FF3B3B'); // Fire debris

    // Hit the ground -> Dead
    if (player.y + player.h >= groundY) {
      player.y = groundY - player.h;
      triggerGameOver();
    }
    return;
  }

  const targetVy = Input.axis * cfg.moveSpeed;
  player.vy += (targetVy - player.vy) * cfg.smoothing;
  player.y += player.vy * dt;

  const topLimit = 10;
  // Removed bottom limit clamping to allow ground collisions
  if (player.y < topLimit) { player.y = topLimit; player.vy = 0; }

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
    // Hard clamp to ensure they stay above ground on window resize
    o.y = Math.min(o.y, groundY - o.h);
  }
  obstacles = obstacles.filter(o => o.x > -80);
}

function updateCollectibles(dt) {
  for (const c of collectibles) {
    c.x -= speed * dt;
    c.bob += dt * 4;
    // Hard clamp
    c.y = Math.min(c.y, groundY - c.h);
  }
  collectibles = collectibles.filter(c => c.x > -60 && !c.taken);
}

function updateCanModelsAndDots(dt) {
  for (const m of canModels) {
    m.x -= speed * CONFIG.speed.foregroundMultiplier * dt;
    m.y = groundY - m.h; // Ensure it sticks to ground
    m.reload -= dt;
    
    // Fire dot at player
    if (m.reload <= 0 && m.x > 0 && m.x < W && state === STATE.PLAYING) {
      const dx = (player.x + player.w/2) - (m.x + m.w/2);
      const dy = (player.y + player.h/2) - m.y;
      const mag = Math.sqrt(dx*dx + dy*dy);
      
      dots.push({
        x: m.x + m.w/2,
        y: m.y,
        vx: (dx/mag) * 450,
        vy: (dy/mag) * 450,
        life: 2
      });
      m.reload = 0.8; // Time between dots
    }
  }
  canModels = canModels.filter(m => m.x > -60);

  for (const d of dots) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.life -= dt;
  }
  dots = dots.filter(d => d.life > 0);
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

  spawnTimers.canModel -= dt * 1000;
  if (spawnTimers.canModel <= 0) {
    spawnCanModel();
    spawnTimers.canModel = CONFIG.obstacles.canSpawnInterval + Math.random() * 2000;
  }
}

function checkCollisions() {
  const pad = CONFIG.player.hitboxPadding;
  const pl = { x: player.x + pad, y: player.y + pad, w: player.w - pad * 2, h: player.h - pad * 2 };

  // 1. Ground Collision
  if (pl.y + pl.h >= groundY) {
    triggerCrash();
    return;
  }

  // 2. Obstacles
  for (const o of obstacles) {
    const ob = { x: o.x + 4, y: o.y + 4, w: o.w - 8, h: o.h - 8 };
    if (rectsOverlap(pl, ob)) {
      triggerCrash();
      return;
    }
  }

  // 3. Spikes (Spires from horizon)
  const tw = horizon.tileWidth;
  const offset = wrap(scroll.fore, tw);
  const firstPeriod = Math.floor((-100 - offset) / tw) - 1;
  const lastPeriod = Math.ceil((W + 100 - offset) / tw) + 1;
  
  for (let k = firstPeriod; k <= lastPeriod; k++) {
    for (const sp of horizon.spires) {
      const screenX = sp.x + offset + k * tw;
      const baseY = groundY - horizon.heightAt(sp.x);
      const topY = baseY - sp.height;
      // Simple rect for the spire
      const spireRect = { x: screenX - sp.width/2, y: topY, w: sp.width, h: sp.height };
      
      if (rectsOverlap(pl, spireRect)) {
        triggerCrash();
        return;
      }
    }
  }

  // 4. Defense Machine Gun Dots
  for (const d of dots) {
    const dotRect = { x: d.x - 4, y: d.y - 4, w: 8, h: 8 };
    if (rectsOverlap(pl, dotRect)) {
      triggerCrash();
      return;
    }
  }

  // 5. Collectibles
  for (const c of collectibles) {
    if (c.taken) continue;
    const cb = { x: c.x, y: c.y, w: c.w, h: c.h };
    if (rectsOverlap(pl, cb)) {
      c.taken = true;
      collectedScore += CONFIG.collectibles.scoreValue;
      spawnSparkle(c.x + c.w / 2, c.y + c.h / 2, '#FFC94B');
    }
  }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function spawnSparkle(x, y, color = '#FFC94B') {
  for (let i = 0; i < 8; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 80;
    particles.push({
      x, y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: 1,
      color: color
    });
  }
}

function triggerCrash() {
  if (state === STATE.CRASHING) return;
  state = STATE.CRASHING;
  player.vy = -300; // Small bounce upwards when hit
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
    drawCanModels();
    drawDots();
    drawObstacles();
    drawParticles();
    drawPlayer();
  }

  drawHud();
}

function drawTitleRocket() {
  const frame = Math.floor(performance.now() / CONFIG.player.flameFrameMs) % SPRITES.rocket.flame.length;
  drawRocketShape(W / 2, H * 0.34, CONFIG.player.width * 2.6, CONFIG.player.height * 2.6, frame);
}

function drawSky() {
  const p = CONFIG.palette;
  
  // Base Night Sky
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

  // Fade in Day Sky based on score
  // Transition between score 100 to 500
  const dayFadeAlpha = clamp01((score - 100) / 400); 
  
  if (dayFadeAlpha > 0) {
    ctx.globalAlpha = dayFadeAlpha;
    const dayGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    dayGrad.addColorStop(0, p.daySkyTop);
    dayGrad.addColorStop(1, p.daySkyBottom);
    ctx.fillStyle = dayGrad;
    ctx.fillRect(0, 0, W, H); // Cover everything up to horizon
    ctx.globalAlpha = 1;
  }
}

function drawStars() {
  // Fade stars out as day comes in
  const dayFadeAlpha = clamp01((score - 100) / 400); 
  const p = CONFIG.palette;
  const offset = wrap(scroll.back, W * 2);
  for (const s of stars) {
    const x = wrap(s.x + offset, W * 2);
    if (x > W) continue;
    const twinkle = 0.5 + Math.sin(performance.now() * 0.002 + s.tw) * 0.5;
    ctx.globalAlpha = Math.max(0, (0.4 + twinkle * 0.6) - dayFadeAlpha);
    ctx.fillStyle = p.star;
    ctx.beginPath();
    ctx.arc(x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawShootingStars() {
  const dayFadeAlpha = clamp01((score - 100) / 400); 
  ctx.strokeStyle = CONFIG.palette.shootingStar;
  ctx.lineWidth = 2;
  for (const s of shootingStars) {
    ctx.globalAlpha = Math.max(0, clamp01(s.life) - dayFadeAlpha);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + s.len, s.y - s.len * 0.4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPlanet() {
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

  ctx.fillStyle = 'rgba(163, 74, 117, 0.18)';
  ctx.beginPath(); ctx.arc(baseX - r * 0.35, y - r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(baseX + r * 0.28, y + r * 0.32, r * 0.16, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(baseX + r * 0.1, y - r * 0.38, r * 0.1, 0, Math.PI * 2); ctx.fill();

  return { x: baseX, y, r };
}

function drawHorizon(planet) {
  const p = CONFIG.palette;

  const haze = ctx.createLinearGradient(0, groundY - H * 0.34, 0, groundY);
  haze.addColorStop(0, 'rgba(255,166,193,0)');
  haze.addColorStop(1, p.hazeColor);
  ctx.fillStyle = haze;
  ctx.fillRect(0, groundY - H * 0.34, W, H * 0.34);

  drawHorizonLayer(farHorizon, p.horizonFar2, p.horizonFar2Deep, scroll.mid * 0.6, 0.72, false);
  drawHorizonLayer(horizon, p.horizonNear, p.horizonFar, scroll.fore, 1, true);
}

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

function drawCrescentMoon() {
  const x = wrap(W * 0.82 + scroll.back * 0.4, W * 1.3) - W * 0.15;
  const y = H * 0.12;
  const r = Math.min(W, H) * 0.026;

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CONFIG.palette.sky2;
  ctx.beginPath();
  ctx.arc(x + r * 0.55, y - r * 0.3, r * 0.92, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer() {
  ctx.save();
  // Translate to center of player to handle crashing rotation
  ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
  
  if (state === STATE.CRASHING) {
    ctx.rotate(player.crashAngle);
  }

  // Image toggle: Switch to pixelated JPG if score threshold met
  if (score >= CONFIG.world.pixelRocketScoreThreshold && rocketImg.complete) {
    // Draw the image instead (shifted back by half w/h because of translation)
    ctx.drawImage(rocketImg, -player.w / 2, -player.h / 2, player.w, player.h);
  } else {
    // Standard drawing
    drawRocketShape(0, 0, player.w, player.h, player.flameFrame);
  }
  
  ctx.restore();
}

function drawRocketShape(cx, cy, w, h, flameFrame) {
  const sprite = SPRITES.rocket;

  ctx.fillStyle = sprite.ink;
  drawPoly(cx, cy, sprite.body(w, h));
  drawPoly(cx, cy, sprite.finTop(w, h));
  drawPoly(cx, cy, sprite.finBottom(w, h));

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
    ctx.fillRect(cx - w * 0.15, cy - h * 0.22, w * 0.3, h * 0.44);
    ctx.fillRect(cx - w * 0.5, cy - h * 0.12, w * 0.3, h * 0.24);
    ctx.fillRect(cx + w * 0.2, cy - h * 0.12, w * 0.3, h * 0.24);

    ctx.fillStyle = sprite.glint;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCanModels() {
  // Ground defense rendered to look like a safe model reused from aluminum cans
  for (const m of canModels) {
    ctx.fillStyle = '#C0C0C0'; // Aluminum silver
    ctx.fillRect(m.x, m.y, m.w, m.h);
    // Can detailing
    ctx.fillStyle = '#A0A0A0';
    ctx.fillRect(m.x, m.y, m.w, 4); // Top rim
    ctx.fillRect(m.x, m.y + m.h - 4, m.w, 4); // Bottom rim
    ctx.fillStyle = '#FF4500'; // Red label accent
    ctx.fillRect(m.x, m.y + 10, m.w, 8);
    // Gun barrel pointing up
    ctx.fillStyle = '#333';
    ctx.fillRect(m.x + m.w/2 - 2, m.y - 8, 4, 8);
  }
}

function drawDots() {
  ctx.fillStyle = '#FFC94B';
  for (const d of dots) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp01(p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 4, 4);
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  if (state === STATE.PLAYING || state === STATE.CRASHING) {
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
