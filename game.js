const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const connectBtn = document.getElementById('connectBtn'); // Serial connect button

// Load the pixelated rocket image
const rocketImg = new Image();
rocketImg.src = 'Screenshot_20260805_194729_Chrome.jpg';

let W, H, groundY;
let highScore = parseInt(localStorage.getItem('rocketHigh')) || 0;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  groundY = H * (1 - CONFIG.world.groundHeightRatio);
}
window.addEventListener('resize', resize);
resize();

// ---------- serial input setup ----------
let serialPort, serialReader;
if (connectBtn) {
  connectBtn.addEventListener('click', async () => {
    try {
      serialPort = await navigator.serial.requestPort();
      await serialPort.open({ baudRate: 115200 });
      const decoder = new TextDecoderStream();
      serialPort.readable.pipeTo(decoder.writable);
      serialReader = decoder.readable.getReader();
      connectBtn.style.display = 'none'; // Hide button once connected
      readSerialLoop();
    } catch (err) {
      console.error("Serial connection failed", err);
    }
  });
}

async function readSerialLoop() {
  let buffer = "";
  while (true) {
    const { value, done } = await serialReader.read();
    if (value) {
      buffer += value;
      let lines = buffer.split('\n');
      buffer = lines.pop(); 
      if (lines.length > 0) {
        let latestAccel = parseFloat(lines[lines.length - 1]);
        if (!isNaN(latestAccel)) {
          // Map tilt acceleration (roughly -5 to +5 m/s^2) to Input.axis (-1 to 1)
          Input.axis = Math.max(-1, Math.min(1, latestAccel / -5.0));
        }
      }
    }
    if (done) break;
  }
}

// ---------- state ----------
const STATE = { READY: 'ready', PLAYING: 'playing', CRASHING: 'crashing', DEAD: 'dead' };
let state = STATE.READY;

let scroll = { back: 0, mid: 0, fore: 0 };
let speed = CONFIG.speed.base;
let elapsed = 0, score = 0, distance = 0, collectedScore = 0, graceTimer = 0;
let shakeTime = 0, shakeIntensity = 0; // Screen shake vars

let player, obstacles, collectibles, particles, turrets, dots;
let spawnTimers, stars, shootingStars, horizon, farHorizon, planetX;

function resetGame() {
  speed = CONFIG.speed.base;
  elapsed = 0; score = 0; distance = 0; collectedScore = 0;
  graceTimer = 1.5; 
  scroll = { back: 0, mid: 0, fore: 0 };

  player = {
    x: CONFIG.player.xPosition,
    y: H * CONFIG.player.startY,
    vy: 0, flameFrame: 0, flameTimer: 0,
    w: CONFIG.player.width, h: CONFIG.player.height,
    crashAngle: 0
  };

  obstacles = []; collectibles = []; particles = []; turrets = []; dots = [];
  spawnTimers = {
    obstacle: CONFIG.obstacles.spawnIntervalStart,
    collectible: CONFIG.collectibles.spawnIntervalStart,
    turret: CONFIG.obstacles.canSpawnInterval || 4500
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
      x: Math.random() * W * 2, y: Math.random() * groundY * 0.9,
      r: Math.random() * 1.6 + 0.4, tw: Math.random() * Math.PI * 2
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
  if (state === STATE.READY || state === STATE.DEAD) {
    resetGame();
    state = STATE.PLAYING;
    setOverlay('');
  }
}

function setOverlay(text, sub) {
  if (!text) { overlay.classList.remove('visible'); overlay.innerHTML = ''; return; }
  overlay.innerHTML = `<div>${text}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  overlay.classList.add('visible');
}
setOverlay('tap start');

function currentSpawnInterval(cfgBlock) {
  return lerp(cfgBlock.spawnIntervalStart, cfgBlock.spawnIntervalMin, clamp01(elapsed / cfgBlock.rampMs));
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function wrap(v, m) { const r = v % m; return r < 0 ? r + m : r; }

// ---------- spawners ----------
function spawnObstacle() {
  const r = CONFIG.obstacles.radius;
  obstacles.push({
    x: W + r,
    y: Math.min(Math.random() * (groundY - r * 2 - 50) + 20, groundY - r * 2 - 10),
    w: r * 2, h: r * 2, r,
    speedMult: 1 + (Math.random() * 2 - 1) * CONFIG.obstacles.speedVariance,
    trailPhase: Math.random() * Math.PI * 2
  });
}

function spawnCollectible() {
  const w = CONFIG.collectibles.width, h = CONFIG.collectibles.height;
  collectibles.push({
    x: W + 40,
    y: Math.min(Math.random() * (groundY - h - 50) + 20, groundY - h - 10),
    w, h, bob: Math.random() * Math.PI * 2, taken: false
  });
}

function spawnTurret() {
  turrets.push({ x: W + 40, y: groundY - 26, w: 22, h: 26, reload: 0.6 });
}

// ---------- update ----------
let lastTime = performance.now();

function update(dt) {
  Input.update();

  if (shakeTime > 0) shakeTime -= dt;

  if (state === STATE.READY || state === STATE.DEAD) {
    scroll.back -= dt * speed * CONFIG.speed.backMultiplier;
    scroll.mid -= dt * speed * CONFIG.speed.midMultiplier;
    updateStars(dt);
    return;
  }

  if (graceTimer > 0) graceTimer -= dt;
  elapsed += dt * 1000;
  speed = Math.min(CONFIG.speed.max, CONFIG.speed.base + elapsed * 0.001 * CONFIG.speed.rampPerSecond);

  scroll.back -= dt * speed * CONFIG.speed.backMultiplier;
  scroll.mid -= dt * speed * CONFIG.speed.midMultiplier;
  scroll.fore -= dt * speed * CONFIG.speed.foregroundMultiplier;

  if (state === STATE.PLAYING) {
    distance += dt * speed;
    score = Math.floor(distance / CONFIG.score.distancePerPoint) + collectedScore;
    if (score > highScore) highScore = score;
  }

  updateStars(dt);
  updatePlayer(dt);
  updateObstacles(dt);
  updateCollectibles(dt);
  updateTurretsAndDots(dt);
  updateParticles(dt);
  
  if (state === STATE.PLAYING) {
    handleSpawning(dt);
    if (graceTimer <= 0) checkCollisions();
  }
}

function updateStars(dt) {
  if (Math.random() < 0.004) {
    shootingStars.push({
      x: Math.random() * W, y: Math.random() * groundY * 0.5,
      len: 60 + Math.random() * 60, speed: 700 + Math.random() * 300, life: 1
    });
  }
  for (const s of shootingStars) {
    s.x -= s.speed * dt; s.y += s.speed * dt * 0.4; s.life -= dt * 1.2;
  }
  shootingStars = shootingStars.filter(s => s.life > 0);
}

function updatePlayer(dt) {
  if (state === STATE.CRASHING) {
    player.vy += 1100 * dt; 
    player.y += player.vy * dt;
    player.x += speed * 0.15 * dt;
    player.crashAngle += dt * 5;
    spawnDebris(player.x + player.w / 2, player.y + player.h / 2);
    if (player.y + player.h >= groundY) {
      player.y = groundY - player.h;
      triggerGameOver();
    }
    return;
  }

  const targetVy = Input.axis * CONFIG.player.moveSpeed;
  player.vy += (targetVy - player.vy) * CONFIG.player.smoothing;
  player.y += player.vy * dt;

  // Thruster engine tail particles
  if (Math.abs(player.vy) > 20 || Math.random() < 0.3) {
    particles.push({
      x: player.x,
      y: player.y + player.h/2 + (Math.random() * 4 - 2),
      vx: -150 - Math.random() * 100,
      vy: player.vy * -0.2 + (Math.random() * 20 - 10),
      life: 0.4 + Math.random() * 0.3,
      color: Math.random() > 0.5 ? '#FFC94B' : '#FF8A3D'
    });
  }

  const topLimit = 10;
  if (player.y < topLimit) { player.y = topLimit; player.vy = 0; }

  player.flameTimer += dt * 1000;
  if (player.flameTimer > CONFIG.player.flameFrameMs) {
    player.flameTimer = 0;
    player.flameFrame = (player.flameFrame + 1) % SPRITES.rocket.flame.length;
  }
}

function updateObstacles(dt) {
  for (const o of obstacles) {
    o.x -= speed * o.speedMult * dt;
    o.trailPhase += dt * 12;
    o.y = Math.min(o.y, groundY - o.h - 10);
  }
  obstacles = obstacles.filter(o => o.x > -80);
}
function updateCollectibles(dt) {
  for (const c of collectibles) {
    c.x -= speed * dt; c.bob += dt * 4; c.y = Math.min(c.y, groundY - c.h - 10);
  }
  collectibles = collectibles.filter(c => c.x > -60 && !c.taken);
}

function updateTurretsAndDots(dt) {
  for (const t of turrets) {
    t.x -= speed * CONFIG.speed.foregroundMultiplier * dt;
    t.y = groundY - t.h;
    t.reload -= dt;
    
    if (t.reload <= 0 && t.x > 0 && t.x < W && state === STATE.PLAYING) {
      const dx = (player.x + player.w/2) - (t.x + t.w/2);
      const dy = (player.y + player.h/2) - (t.y);
      const mag = Math.sqrt(dx*dx + dy*dy);
      
      dots.push({
        x: t.x + t.w/2, y: t.y + 4,
        vx: (dx/mag) * 420, vy: (dy/mag) * 420,
        life: 2.2
      });
      t.reload = 0.85;
    }
  }
  turrets = turrets.filter(t => t.x > -60);
  for (const d of dots) {
    d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
  }
  dots = dots.filter(d => d.life > 0);
}

function updateParticles(dt) {
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 2.2;
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
  spawnTimers.turret -= dt * 1000;
  if (spawnTimers.turret <= 0) {
    spawnTurret();
    spawnTimers.turret = (CONFIG.obstacles.canSpawnInterval || 4500) + Math.random() * 2000;
  }
}

function checkCollisions() {
  const pad = CONFIG.player.hitboxPadding;
  const pl = { x: player.x + pad, y: player.y + pad, w: player.w - pad * 2, h: player.h - pad * 2 };

  if (pl.y + pl.h >= groundY - 2) return triggerCrash();

  for (const o of obstacles) {
    if (rectsOverlap(pl, { x: o.x + 6, y: o.y + 6, w: o.w - 12, h: o.h - 12 })) return triggerCrash();
  }

  const tw = horizon.tileWidth;
  const offset = wrap(scroll.fore, tw);
  const firstPeriod = Math.floor((-100 - offset) / tw) - 1;
  const lastPeriod = Math.ceil((W + 100 - offset) / tw) + 1;
  
  for (let k = firstPeriod; k <= lastPeriod; k++) {
    for (const sp of horizon.spires) {
      const screenX = sp.x + offset + k * tw;
      const baseY = groundY - horizon.heightAt(sp.x);
      if (rectsOverlap(pl, { x: screenX - (sp.width * 0.25), y: baseY - sp.height, w: sp.width * 0.5, h: sp.height * 0.35 })) {
        return triggerCrash();
      }
    }
  }

  for (const d of dots) {
    if (rectsOverlap(pl, { x: d.x - 3, y: d.y - 3, w: 6, h: 6 })) return triggerCrash();
  }

  for (const c of collectibles) {
    if (!c.taken && rectsOverlap(pl, { x: c.x, y: c.y, w: c.w, h: c.h })) {
      c.taken = true; collectedScore += CONFIG.collectibles.scoreValue;
      spawnSparkle(c.x + c.w / 2, c.y + c.h / 2);
    }
  }
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function spawnSparkle(x, y) {
  for (let i = 0; i < 6; i++) {
    const ang = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 60;
    particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, color: '#FFC94B' });
  }
}

function spawnDebris(x, y) {
  const c = ['#FFC94B', '#FF8A3D', '#7B5286', '#FFE08A'];
  for (let i = 0; i < 2; i++) {
    const ang = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 70;
    particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.8, color: c[Math.floor(Math.random() * c.length)] });
  }
}

function triggerCrash() {
  if (state === STATE.CRASHING) return;
  state = STATE.CRASHING;
  player.vy = -260;
  shakeTime = 0.3; // Trigger screen shake
  shakeIntensity = 8;
  localStorage.setItem('rocketHigh', highScore);
}

function triggerGameOver() {
  state = STATE.DEAD;
  setOverlay('game over', 'tap restart');
}

// ---------- render ----------
function render() {
  ctx.save();
  
  // Apply Screen Shake
  if (shakeTime > 0) {
    const dx = (Math.random() - 0.5) * shakeIntensity;
    const dy = (Math.random() - 0.5) * shakeIntensity;
    ctx.translate(dx, dy);
  }

  drawSky(); drawStars(); drawCrescentMoon();
  drawShootingStars(); drawHorizon(drawPlanet());

  if (state === STATE.READY) {
    drawRocketShape(W / 2, H * 0.34, CONFIG.player.width * 2.6, CONFIG.player.height * 2.6, Math.floor(performance.now() / CONFIG.player.flameFrameMs) % SPRITES.rocket.flame.length);
  } else {
    drawCollectibles(); drawTurrets(); drawDots();
    drawObstacles(); drawParticles(); drawPlayer();
  }

  ctx.restore();
  drawHud();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, groundY);
  g.addColorStop(0, CONFIG.palette.skyTop); g.addColorStop(0.35, CONFIG.palette.sky2);
  g.addColorStop(0.6, CONFIG.palette.sky3); g.addColorStop(0.82, CONFIG.palette.sky4);
  g.addColorStop(1, CONFIG.palette.skyBottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, groundY);
  ctx.fillStyle = CONFIG.palette.skyBottom; ctx.fillRect(0, groundY, W, H - groundY);

  const dayFade = clamp01((score - 100) / 400); 
  if (dayFade > 0) {
    ctx.globalAlpha = dayFade;
    const dayGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    dayGrad.addColorStop(0, '#71B2EA'); dayGrad.addColorStop(1, '#CBE5FF');
    ctx.fillStyle = dayGrad; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

function drawStars() {
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

function drawCrescentMoon() {
  const x = wrap(W * 0.82 + scroll.back * 0.4, W * 1.3) - W * 0.15;
  const y = H * 0.12;
  const r = Math.min(W, H) * 0.026;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = CONFIG.palette.sky2;
  ctx.beginPath(); ctx.arc(x + r * 0.55, y - r * 0.3, r * 0.92, 0, Math.PI * 2); ctx.fill();
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
  ctx.beginPath(); ctx.arc(baseX, y, r * 3.4, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = CONFIG.palette.planetCore;
  ctx.beginPath(); ctx.arc(baseX, y, r, 0, Math.PI * 2); ctx.fill();

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

  if (withSpires) {
    const firstPeriod = Math.floor((-100 - offset) / tw) - 1;
    const lastPeriod = Math.ceil((W + 100 - offset) / tw) + 1;
    ctx.fillStyle = colorFar;
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
}

function drawPlayer() {
  ctx.save();
  ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
  if (state === STATE.CRASHING) ctx.rotate(player.crashAngle);
  if (graceTimer > 0 && Math.floor(performance.now() / 100) % 2 === 0) ctx.globalAlpha = 0.5;

  if (score >= CONFIG.world.pixelRocketScoreThreshold && rocketImg.complete) {
    ctx.drawImage(rocketImg, -player.w / 2, -player.h / 2, player.w, player.h);
  } else {
    drawRocketShape(0, 0, player.w, player.h, player.flameFrame);
  }
  ctx.restore();
}

function drawRocketShape(cx, cy, w, h, flameFrame) {
  const s = SPRITES.rocket;
  ctx.fillStyle = s.ink;
  drawPoly(cx, cy, s.body(w, h)); drawPoly(cx, cy, s.finTop(w, h)); drawPoly(cx, cy, s.finBottom(w, h));
  const flameLen = w * (0.5 + Math.sin(performance.now() * 0.02) * 0.08);
  ctx.fillStyle = s.flame[flameFrame % s.flame.length];
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.46, cy - h * 0.16); ctx.lineTo(cx - w * 0.46 - flameLen, cy);
  ctx.lineTo(cx - w * 0.46, cy + h * 0.16); ctx.closePath(); ctx.fill();
}
function drawPoly(cx, cy, points) {
  ctx.beginPath(); ctx.moveTo(cx + points[0][0], cy + points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(cx + points[i][0], cy + points[i][1]);
  ctx.closePath(); ctx.fill();
}

function drawTurrets() {
  for (const t of turrets) {
    // Telegraphed Laser Sight
    if (t.reload < 0.25 && state === STATE.PLAYING) {
      ctx.beginPath();
      ctx.moveTo(t.x + t.w/2, groundY - 11);
      ctx.lineTo(player.x + player.w/2, player.y + player.h/2);
      ctx.strokeStyle = `rgba(255, 59, 59, ${t.reload * 4})`; 
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = SPRITES.rocket.ink || '#1C1030';
    ctx.beginPath(); ctx.moveTo(t.x, groundY); ctx.lineTo(t.x + 4, groundY - 10);
    ctx.lineTo(t.x + t.w - 4, groundY - 10); ctx.lineTo(t.x + t.w, groundY);
    ctx.closePath(); ctx.fill();

    ctx.beginPath(); ctx.arc(t.x + t.w / 2, groundY - 10, 7, Math.PI, 0); ctx.fill();
    ctx.fillRect(t.x + t.w / 2 - 1.5, groundY - 20, 3, 10);
    
    ctx.fillStyle = t.reload < 0.25 ? '#FF3B3B' : '#FFC94B';
    ctx.beginPath(); ctx.arc(t.x + t.w / 2, groundY - 11, 2, 0, Math.PI * 2); ctx.fill();
  }
}

function drawHud() {
  if (state === STATE.READY) { hud.innerHTML = `HI ${highScore}`; } 
  else { hud.innerHTML = `HI ${highScore} &nbsp;&nbsp; SCORE ${score}`; }
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

function drawDots() {
  ctx.fillStyle = '#FFE08A';
  for (const d of dots) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
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

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp01(p.life);
    ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.globalAlpha = 1;
}

let frameErrorFlag = false;
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  try {
    update(dt); render(); frameErrorFlag = false;
  } catch (err) {
    if (!frameErrorFlag) { console.error('frame error', err); frameErrorFlag = true; }
    ctx.fillStyle = '#FF3B3B'; ctx.fillRect(10, 10, 14, 14);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
