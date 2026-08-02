// orbit trim — sound
// small web audio synth, no external audio files so it never depends on
// internet access at the booth. everything is soft, low-volume, calm.
// audio context only starts after a user gesture (browser requirement),
// so call OrbitSound.unlock() from the first click handler.

const OrbitSound = (() => {
  let ctx = null;
  let master = null;
  let droneGain = null;
  let droneNodes = [];
  let muted = false;

  function unlock() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }

  function setMuted(next) {
    muted = next;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.15);
  }

  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  // soft two-oscillator pad, loops for the duration of a run
  function startDrone() {
    if (!ctx) return;
    stopDrone();
    const notes = [110, 164.81]; // low a, e — calm open fifth
    droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    droneGain.connect(master);
    droneGain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 1.2);

    droneNodes = notes.map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.08 + i * 0.03;
      lfoGain.gain.value = 1.5;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      osc.connect(droneGain);
      osc.start();
      lfo.start();
      return [osc, lfo];
    });
  }

  function stopDrone() {
    if (droneGain) {
      const g = droneGain;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(() => {
        droneNodes.forEach(([osc, lfo]) => { try { osc.stop(); lfo.stop(); } catch (e) {} });
        g.disconnect();
      }, 900);
      droneNodes = [];
      droneGain = null;
    }
  }

  // gentle rising tone, played on launch
  function playLaunch() {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 1.1);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.3);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 1.4);
  }

  // soft bell chime, played on each accent milestone
  function playChime() {
    if (!ctx) return;
    [660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.05);
      gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + i * 0.05 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.05 + 1.2);
      osc.connect(gain).connect(master);
      osc.start(ctx.currentTime + i * 0.05);
      osc.stop(ctx.currentTime + i * 0.05 + 1.3);
    });
  }

  // quiet descending tone, played when a run ends
  function playLanding() {
    if (!ctx) return;
    stopDrone();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(392, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(130, ctx.currentTime + 1.6);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 1.9);
  }

  // soft click, played on calibrate
  function playCalibrate() {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 520;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }

  return {
    unlock,
    toggleMute,
    isMuted: () => muted,
    startDrone,
    stopDrone,
    playLaunch,
    playChime,
    playLanding,
    playCalibrate,
  };
})();
