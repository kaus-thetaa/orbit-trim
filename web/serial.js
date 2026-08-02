// orbit trim — web serial layer
// owns the port connection and line parsing, exposes a small api to game.js
// does not touch the dom directly, game.js reacts to callbacks

const OrbitSerial = (() => {
  let port = null;
  let reader = null;
  let keepReading = false;

  // raw fused angles as streamed by the arduino, degrees
  let rawPitch = 0;
  let rawRoll = 0;

  // calibration offset, subtracted from raw to get "neutral" tilt
  let offsetPitch = 0;
  let offsetRoll = 0;

  let onData = () => {};
  let onConnectionChange = () => {};

  function isSupported() {
    return "serial" in navigator;
  }

  async function connect() {
    if (!isSupported()) {
      throw new Error("web serial not supported, use chrome or edge");
    }
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    keepReading = true;
    onConnectionChange(true);
    readLoop();
  }

  async function disconnect() {
    keepReading = false;
    if (reader) {
      try { await reader.cancel(); } catch (e) { /* already closed */ }
    }
    if (port) {
      try { await port.close(); } catch (e) { /* already closed */ }
    }
    port = null;
    onConnectionChange(false);
  }

  async function readLoop() {
    const textDecoder = new TextDecoderStream();
    const readableClosed = port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();

    let buffer = "";

    try {
      while (keepReading) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          handleLine(line);
        }
      }
    } catch (err) {
      console.error("serial read error", err);
    } finally {
      reader.releaseLock();
      await readableClosed.catch(() => {});
      if (keepReading) {
        // port dropped unexpectedly, eg usb unplugged
        keepReading = false;
        onConnectionChange(false);
      }
    }
  }

  function handleLine(line) {
    if (!line || line.startsWith("#")) return; // firmware debug lines
    const parts = line.split(",");
    if (parts.length !== 2) return;

    const p = parseFloat(parts[0]);
    const r = parseFloat(parts[1]);
    if (Number.isNaN(p) || Number.isNaN(r)) return;

    rawPitch = p;
    rawRoll = r;

    onData({
      pitch: rawPitch - offsetPitch,
      roll: rawRoll - offsetRoll,
    });
  }

  function calibrate() {
    offsetPitch = rawPitch;
    offsetRoll = rawRoll;
  }

  function getTilt() {
    return {
      pitch: rawPitch - offsetPitch,
      roll: rawRoll - offsetRoll,
    };
  }

  return {
    isSupported,
    connect,
    disconnect,
    calibrate,
    getTilt,
    isConnected: () => !!port,
    set onData(fn) { onData = fn; },
    set onConnectionChange(fn) { onConnectionChange = fn; },
  };
})();
