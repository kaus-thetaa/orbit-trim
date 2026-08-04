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
let spawnTimers, stars, shootingStars, asteroidChunk, planetX;

function resetGame() {
  speed = CONFIG.speed.base;
  elapsed = 0;
  score = 0;
  distance = 0;
  scroll = { back: 0, mid: 0, fore: 0 };

  player = {
    x: CONFIG.player.xPosition,
    y: H * CONFIG.player.startY,
    vy: 0,
    flameFrame: 0,
    flameTimer: 0,
    w: 8 * CONFIG.world.pixelScale,
    h: 11 * CONFIG.world.pixelScale
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
  asteroidChunk = buildAsteroidHorizon(W * 3, H * CONFIG.world.groundHeightRatio, 1337);
  planetX = W * 0.7;
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
  const isHard = Math.random() < CONFIG.obstacles.hardVariantChance;
  const sprite = isHard ? SPRITES.meteorHard : SPRITES.meteor;
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
  drawPlanet();
  drawShootingStars();
  drawAsteroidHorizon();
  drawCollectibles();
  drawObstacles();
  drawParticles();
  drawPlayer();
  drawHud();
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
  const loopWidth = W * 1.6;
  const baseX = wrap(planetX + scroll.mid, loopWidth) - loopWidth * 0.3;
  const y = groundY * 0.32;
  const r = Math.min(W, H) * 0.14;

  const glow = ctx.createRadialGradient(baseX, y, r * 0.2, baseX, y, r * 2.4);
  glow.addColorStop(0, CONFIG.palette.planetGlow);
  glow.addColorStop(1, 'rgba(231,183,209,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(baseX, y, r * 2.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CONFIG.palette.planetCore;
  ctx.beginPath();
  ctx.arc(baseX, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawAsteroidHorizon() {
  const p = CONFIG.palette;
  const totalWidth = asteroidChunk[asteroidChunk.length - 1].x;
  const offset = wrap(scroll.fore, totalWidth);

  ctx.fillStyle = p.asteroidFill;
  ctx.strokeStyle = p.asteroidEdge;
  ctx.lineWidth = 2;

  for (let pass = -1; pass <= 1; pass++) {
    ctx.beginPath();
    ctx.moveTo(offset + pass * totalWidth, H);
    for (const pt of asteroidChunk) {
      ctx.lineTo(offset + pass * totalWidth + pt.x, groundY - pt.h + groundY * 0.06 * Math.sin(pt.x));
    }
    ctx.lineTo(offset + pass * totalWidth + totalWidth, H);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawPlayer() {
  const scale = CONFIG.world.pixelScale;
  const sprite = SPRITES.rocket;
  const flameGrid = sprite.flames[player.flameFrame];
  const flameColors = sprite.flameColors[player.flameFrame];

  drawPixelGrid(ctx, flameGrid, flameColors, player.x + scale, player.y + player.h - scale, scale);
  drawPixelGrid(ctx, sprite.body, sprite.colors, player.x, player.y, scale);
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
