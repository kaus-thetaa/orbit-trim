// orbit trim — game logic
// screen flow: home -> game -> over -> home
// scoring: altitude climbs while tilt stays inside a tolerance band that
// tightens as you climb, so the run gets harder the longer it lasts

(() => {
  const LB_KEY = "orbitTrimLeaderboard";
  const LB_MAX = 10;

  const TOLERANCE_START = 25;   // degrees, tolerance at altitude 0
  const TOLERANCE_FLOOR = 8;    // degrees, hardest the game gets
  const TOLERANCE_DECAY = 45;   // meters per degree of tolerance lost
  const CLIMB_RATE = 22;        // meters per second while in tolerance
  const GRACE_MS = 550;         // how long you can be out of tolerance before losing control
  const ACCENT_STEP_M = 350;    // altitude gap between accent color swaps

  // ---- dom refs ----
  const screens = {
    home: document.getElementById("screen-home"),
    game: document.getElementById("screen-game"),
    over: document.getElementById("screen-over"),
  };
  const btnConnect = document.getElementById("btn-connect");
  const btnCalibrateHome = document.getElementById("btn-calibrate-home");
  const btnLaunch = document.getElementById("btn-launch");
  const btnCalibrateGame = document.getElementById("btn-calibrate-game");
  const btnRetry = document.getElementById("btn-retry");
  const btnHome = document.getElementById("btn-home");
  const btnSaveScore = document.getElementById("btn-save-score");

  const connDot = document.getElementById("conn-dot");
  const connLabel = document.getElementById("conn-label");
  const lbList = document.getElementById("lb-list");

  const statAltitude = document.getElementById("stat-altitude");
  const statTilt = document.getElementById("stat-tilt");
  const statTolerance = document.getElementById("stat-tolerance");
  const gaugeFill = document.getElementById("gauge-fill");
  const gaugeNeedle = document.getElementById("gauge-needle");
  const warningFlash = document.getElementById("warning-flash");

  const overScoreValue = document.getElementById("over-score-value");
  const overNewscore = document.getElementById("over-newscore");
  const nameInput = document.getElementById("name-input");

  const rocketCanvas = document.getElementById("rocket-canvas");
  const rocketCtx = rocketCanvas.getContext("2d");

  // ---- state ----
  let currentTilt = { pitch: 0, roll: 0 };
  let deviceConnected = false;
  let altitude = 0;
  let outOfToleranceSince = null;
  let running = false;
  let lastFrameTime = 0;
  let accentIndex = 1;
  let rafId = null;

  // ---- keyboard demo simulation, used whenever no imu is connected ----
  const SIM_ACCEL = 60;      // deg/s^2 while a key is held
  const SIM_SPRING = 1.8;    // return-to-center rate when no key held
  const SIM_MAX = 32;        // deg, simulated tilt clamp
  const keysDown = new Set();
  const simTilt = { pitch: 0, roll: 0 };

  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      keysDown.add(e.key);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => keysDown.delete(e.key));

  function updateSimTilt(dt) {
    if (keysDown.has("ArrowLeft")) simTilt.roll -= SIM_ACCEL * dt;
    if (keysDown.has("ArrowRight")) simTilt.roll += SIM_ACCEL * dt;
    if (keysDown.has("ArrowUp")) simTilt.pitch -= SIM_ACCEL * dt;
    if (keysDown.has("ArrowDown")) simTilt.pitch += SIM_ACCEL * dt;

    const anyHorizontal = keysDown.has("ArrowLeft") || keysDown.has("ArrowRight");
    const anyVertical = keysDown.has("ArrowUp") || keysDown.has("ArrowDown");
    if (!anyHorizontal) simTilt.roll -= simTilt.roll * Math.min(1, SIM_SPRING * dt);
    if (!anyVertical) simTilt.pitch -= simTilt.pitch * Math.min(1, SIM_SPRING * dt);

    simTilt.roll = Math.max(-SIM_MAX, Math.min(SIM_MAX, simTilt.roll));
    simTilt.pitch = Math.max(-SIM_MAX, Math.min(SIM_MAX, simTilt.pitch));
  }

  // ---- screen management ----
  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => el.classList.toggle("active", key === name));
    if (name === "home") Neko.start(); else Neko.stop();
  }

  function setAccent(index) {
    accentIndex = ((index - 1) % 3 + 3) % 3 + 1;
    document.documentElement.setAttribute("data-accent", String(accentIndex));
  }

  // ---- connection ----
  OrbitSerial.onConnectionChange = (connected) => {
    deviceConnected = connected;
    connDot.classList.toggle("ok", connected);
    connLabel.textContent = connected ? "device connected" : "no device connected";
    btnConnect.textContent = connected ? "DEVICE CONNECTED" : "CONNECT DEVICE";
    btnConnect.disabled = connected;
    btnCalibrateHome.disabled = !connected;
  };

  OrbitSerial.onData = (tilt) => {
    currentTilt = tilt;
  };

  btnConnect.addEventListener("click", async () => {
    OrbitSound.unlock();
    try {
      await OrbitSerial.connect();
    } catch (err) {
      connLabel.textContent = err.message;
    }
  });

  btnCalibrateHome.addEventListener("click", () => { OrbitSerial.calibrate(); OrbitSound.playCalibrate(); });
  btnCalibrateGame.addEventListener("click", () => { OrbitSerial.calibrate(); OrbitSound.playCalibrate(); });

  const btnMute = document.getElementById("btn-mute");
  btnMute.addEventListener("click", () => {
    OrbitSound.unlock();
    const muted = OrbitSound.toggleMute();
    btnMute.innerHTML = muted ? "&#9711;" : "&#9834;";
    btnMute.style.opacity = muted ? "0.5" : "1";
  });

  // ---- rocket rendering ----
  function resizeRocketCanvas() {
    const rect = rocketCanvas.getBoundingClientRect();
    rocketCanvas.width = rect.width * devicePixelRatio;
    rocketCanvas.height = rect.height * devicePixelRatio;
    rocketCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener("resize", resizeRocketCanvas);

  function accentColor() {
    return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  }

  function drawRocket(rollDeg, pitchDeg) {
    const rect = rocketCanvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    rocketCtx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 + pitchDeg * 0.6; // subtle vertical lean from pitch
    const angle = (rollDeg * Math.PI) / 180;
    const c = accentColor();

    // guide ring, marks true vertical
    rocketCtx.save();
    rocketCtx.translate(cx, h / 2);
    rocketCtx.strokeStyle = "rgba(255,255,255,0.08)";
    rocketCtx.lineWidth = 1;
    rocketCtx.beginPath();
    rocketCtx.arc(0, 0, Math.min(w, h) * 0.32, 0, Math.PI * 2);
    rocketCtx.stroke();
    rocketCtx.beginPath();
    rocketCtx.moveTo(0, -Math.min(w, h) * 0.4);
    rocketCtx.lineTo(0, Math.min(w, h) * 0.4);
    rocketCtx.strokeStyle = "rgba(255,255,255,0.05)";
    rocketCtx.stroke();
    rocketCtx.restore();

    // rocket body, vector line-art, rotates with roll
    rocketCtx.save();
    rocketCtx.translate(cx, cy);
    rocketCtx.rotate(angle);
    rocketCtx.strokeStyle = c;
    rocketCtx.fillStyle = c;
    rocketCtx.lineWidth = 2;
    rocketCtx.shadowColor = c;
    rocketCtx.shadowBlur = 14;

    const s = Math.min(w, h) * 0.16;

    rocketCtx.beginPath();
    rocketCtx.moveTo(0, -s * 2.4);          // nose tip
    rocketCtx.lineTo(s * 0.6, -s * 0.6);    // right shoulder
    rocketCtx.lineTo(s * 0.6, s * 1.2);     // right base
    rocketCtx.lineTo(s * 1.3, s * 2.1);     // right fin tip
    rocketCtx.lineTo(s * 0.5, s * 1.5);     // right fin root
    rocketCtx.lineTo(-s * 0.5, s * 1.5);    // left fin root
    rocketCtx.lineTo(-s * 1.3, s * 2.1);    // left fin tip
    rocketCtx.lineTo(-s * 0.6, s * 1.2);    // left base
    rocketCtx.lineTo(-s * 0.6, -s * 0.6);   // left shoulder
    rocketCtx.closePath();
    rocketCtx.globalAlpha = 0.1;
    rocketCtx.fill();
    rocketCtx.globalAlpha = 1;
    rocketCtx.stroke();

    // exhaust flicker, only while running
    if (running) {
      const flick = 0.6 + Math.random() * 0.5;
      rocketCtx.beginPath();
      rocketCtx.moveTo(-s * 0.3, s * 1.5);
      rocketCtx.lineTo(0, s * (1.5 + flick * 1.6));
      rocketCtx.lineTo(s * 0.3, s * 1.5);
      rocketCtx.globalAlpha = 0.6;
      rocketCtx.fill();
      rocketCtx.globalAlpha = 1;
    }

    rocketCtx.restore();
  }

  // ---- game loop ----
  function tolerance(alt) {
    return Math.max(TOLERANCE_FLOOR, TOLERANCE_START - alt / TOLERANCE_DECAY);
  }

  function startGame() {
    altitude = 0;
    outOfToleranceSince = null;
    running = true;
    lastFrameTime = performance.now();
    simTilt.pitch = 0;
    simTilt.roll = 0;
    document.getElementById("demo-tag").hidden = deviceConnected;
    document.getElementById("btn-calibrate-game").hidden = !deviceConnected;
    setAccent(1);
    showScreen("game");
    resizeRocketCanvas();
    OrbitSound.playLaunch();
    OrbitSound.startDrone();
    rafId = requestAnimationFrame(loop);
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    const { pitch, roll } = deviceConnected ? currentTilt : (updateSimTilt(dt), simTilt);
    const tiltMag = Math.sqrt(pitch * pitch + roll * roll);
    const tol = tolerance(altitude);
    const inTolerance = tiltMag <= tol;

    if (inTolerance) {
      altitude += CLIMB_RATE * dt;
      outOfToleranceSince = null;
      warningFlash.classList.remove("show");
    } else {
      if (outOfToleranceSince === null) outOfToleranceSince = now;
      warningFlash.classList.add("show");
      if (now - outOfToleranceSince > GRACE_MS) {
        endGame();
        return;
      }
    }

    const newAccent = Math.floor(altitude / ACCENT_STEP_M) + 1;
    if (newAccent !== accentIndex) { setAccent(newAccent); OrbitSound.playChime(); }

    // hud text
    statAltitude.innerHTML = `${Math.floor(altitude)}<span class="hud-unit">m</span>`;
    statTilt.innerHTML = `${tiltMag.toFixed(1)}<span class="hud-unit">&deg;</span>`;
    statTolerance.innerHTML = `${tol.toFixed(0)}<span class="hud-unit">&deg;</span>`;

    // gauge, shows tilt as fraction of current tolerance, centered
    const pct = Math.min(1, tiltMag / tol) * 50;
    gaugeFill.style.width = pct + "%";
    gaugeFill.style.background = inTolerance ? "var(--accent)" : "var(--danger)";
    gaugeNeedle.style.left = `calc(50% + ${Math.max(-50, Math.min(50, roll))}%)`;

    drawRocket(roll, pitch);

    rafId = requestAnimationFrame(loop);
  }

  function endGame() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    OrbitSound.playLanding();

    const finalAltitude = Math.floor(altitude);
    overScoreValue.innerHTML = `${finalAltitude}<span class="hud-unit">m</span>`;

    const board = loadLeaderboard();
    const qualifies = board.length < LB_MAX || finalAltitude > board[board.length - 1].altitude;
    overNewscore.hidden = !qualifies || finalAltitude <= 0;
    nameInput.value = "";
    overNewscore.dataset.pendingScore = String(finalAltitude);

    showScreen("over");
  }

  // ---- leaderboard ----
  function loadLeaderboard() {
    try {
      const raw = localStorage.getItem(LB_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveLeaderboard(list) {
    localStorage.setItem(LB_KEY, JSON.stringify(list));
  }

  function renderLeaderboard() {
    const board = loadLeaderboard();
    lbList.innerHTML = "";
    if (board.length === 0) {
      lbList.innerHTML = '<li class="lb-empty">no runs logged yet</li>';
      return;
    }
    board.forEach((entry) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(entry.name)}</span><span>${entry.altitude}m</span>`;
      lbList.appendChild(li);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  btnSaveScore.addEventListener("click", () => {
    const score = parseInt(overNewscore.dataset.pendingScore || "0", 10);
    const name = (nameInput.value || "PILOT").trim().slice(0, 10).toUpperCase() || "PILOT";

    const board = loadLeaderboard();
    board.push({ name, altitude: score });
    board.sort((a, b) => b.altitude - a.altitude);
    saveLeaderboard(board.slice(0, LB_MAX));

    renderLeaderboard();
    overNewscore.hidden = true;
  });

  // ---- nav buttons ----
  btnLaunch.addEventListener("click", () => { OrbitSound.unlock(); startGame(); });
  btnRetry.addEventListener("click", startGame);
  btnHome.addEventListener("click", () => {
    renderLeaderboard();
    showScreen("home");
  });

  // ---- boot ----
  OrbitBackground.start();
  setAccent(1);
  renderLeaderboard();
  showScreen("home");

  if (!OrbitSerial.isSupported()) {
    connLabel.textContent = "web serial unsupported — use chrome/edge, or launch in demo mode";
    btnConnect.disabled = true;
  }
})();
