// ============================================================
// input module
// single source of truth for player movement: Input.axis
// axis is always in range -1 (full up) .. 1 (full down)
// every input path (serial tilt, keyboard, touch/mouse drag)
// writes into the same axis, so game.js only ever reads one value
// on-site calibration knobs live in CONFIG.input
// ============================================================

const Input = (() => {

  let axis = 0;            // unified output, -1 up .. 1 down
  let mode = 'none';        // 'tilt' | 'keyboard' | 'touch'
  let smoothedTilt = 0;

  // ---------- serial (ICM-20948 tilt) ----------
  let serialPort = null;
  let serialReader = null;
  let serialConnected = false;

  async function trySerialConnect() {
    if (!('serial' in navigator)) return false;
    try {
      // reuse a previously granted port if the browser already has one
      const ports = await navigator.serial.getPorts();
      if (ports.length === 0) return false;
      serialPort = ports[0];
      await serialPort.open({ baudRate: CONFIG.input.serialBaudRate });
      serialConnected = true;
      mode = 'tilt';
      readSerialLoop();
      return true;
    } catch (err) {
      serialConnected = false;
      return false;
    }
  }

  // call this from a user gesture (button/tap) to request port access
  async function requestSerialConnect() {
    if (!('serial' in navigator)) return false;
    try {
      serialPort = await navigator.serial.requestPort();
      await serialPort.open({ baudRate: CONFIG.input.serialBaudRate });
      serialConnected = true;
      mode = 'tilt';
      readSerialLoop();
      return true;
    } catch (err) {
      serialConnected = false;
      return false;
    }
  }

  async function readSerialLoop() {
    const textDecoder = new TextDecoderStream();
    const readableClosed = serialPort.readable.pipeTo(textDecoder.writable);
    serialReader = textDecoder.readable.getReader();
    let buffer = '';

    try {
      while (serialConnected) {
        const { value, done } = await serialReader.read();
        if (done) break;
        buffer += value;
        let lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          handleSerialLine(line.trim());
        }
      }
    } catch (err) {
      // device unplugged or read error, fall back silently
    } finally {
      serialConnected = false;
      try { serialReader.releaseLock(); } catch (e) {}
      pickFallbackMode();
    }
  }

  // expects a single float per line: roll or pitch angle in degrees
  // e.g. "  -12.4\n" streamed at ~50hz after the imu's onboard dlpf
  function handleSerialLine(line) {
    if (!line) return;
    const angle = parseFloat(line);
    if (Number.isNaN(angle)) return;

    const cfg = CONFIG.input;
    const clean = Math.abs(angle) < cfg.tiltDeadzone ? 0 : angle;
    smoothedTilt += (clean - smoothedTilt) * cfg.tiltSmoothing;

    axis = clamp(smoothedTilt / cfg.tiltRange, -1, 1);
  }

  // ---------- keyboard fallback ----------
  let keyUp = false;
  let keyDown = false;

  function initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keyUp = true;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keyDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keyUp = false;
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keyDown = false;
    });
  }

  function updateKeyboard() {
    let target = 0;
    if (keyUp) target -= 1;
    if (keyDown) target += 1;
    axis += (target - axis) * 0.3;
  }

  // ---------- touch / mouse drag fallback ----------
  let dragActive = false;
  let dragStartY = 0;
  let dragAxisTarget = 0;

  function initPointer(canvas) {
    const onDown = (clientY) => {
      dragActive = true;
      dragStartY = clientY;
    };
    const onMove = (clientY) => {
      if (!dragActive) return;
      const deltaPx = clientY - dragStartY;
      const range = 120 / CONFIG.input.dragSensitivity;
      dragAxisTarget = clamp(deltaPx / range, -1, 1);
    };
    const onUp = () => {
      dragActive = false;
      dragAxisTarget = 0;
    };

    canvas.addEventListener('mousedown', (e) => onDown(e.clientY));
    canvas.addEventListener('mousemove', (e) => onMove(e.clientY));
    window.addEventListener('mouseup', onUp);

    canvas.addEventListener('touchstart', (e) => onDown(e.touches[0].clientY), { passive: true });
    canvas.addEventListener('touchmove', (e) => onMove(e.touches[0].clientY), { passive: true });
    canvas.addEventListener('touchend', onUp);
  }

  function updatePointer() {
    axis += (dragAxisTarget - axis) * 0.3;
  }

  // ---------- mode selection ----------
  function pickFallbackMode() {
    mode = 'keyboard'; // keyboard listeners are always active alongside touch
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- public update, called once per frame ----------
  function update() {
    if (mode === 'tilt' && serialConnected) return; // axis already set by serial handler
    updateKeyboard();
    updatePointer();
    // whichever produced the larger deviation this frame wins the axis
    // (both write toward the same variable, keyboard/pointer helpers above
    // already blend into axis directly except pointer which blends separately)
  }

  function init(canvas) {
    initKeyboard();
    initPointer(canvas);
    pickFallbackMode();
    trySerialConnect(); // silent, only succeeds if a port was already granted
  }

  return {
    init,
    update,
    requestSerialConnect,
    get axis() { return axis; },
    get mode() { return serialConnected ? 'tilt' : mode; }
  };
})();
