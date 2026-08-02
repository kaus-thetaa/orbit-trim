// orbit trim — ambient background
// full-viewport canvas behind everything: crescent planet glow, stars,
// two silhouette ridge layers with a distant station spire, and a few
// slow drifting satellites. purely decorative, runs continuously,
// independent of game state.

const OrbitBackground = (() => {
  const canvas = document.getElementById("bg-canvas");
  const ctx = canvas.getContext("2d");

  let w = 0, h = 0;
  let stars = [];
  let drifters = [];
  let t0 = performance.now();

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    buildStars();
  }

  function buildStars() {
    const count = Math.floor((w * h) / 9000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h * 0.75,
      r: Math.random() * 1.2 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.6,
    }));

    drifters = Array.from({ length: 3 }, (_, i) => ({
      y: h * (0.18 + i * 0.09),
      r: 3 + i * 1.4,
      speed: 6 + i * 4,
      offset: Math.random() * w,
      opacity: 0.35 - i * 0.07,
    }));
  }

  function ridgePath(baseY, amplitude, segments, seed) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const x = (w / segments) * i;
      const n = Math.sin(i * 0.9 + seed) * 0.5 + Math.sin(i * 2.3 + seed * 1.7) * 0.5;
      pts.push([x, baseY - Math.abs(n) * amplitude]);
    }
    return pts;
  }

  function drawRidge(points, baseline, color) {
    ctx.beginPath();
    ctx.moveTo(0, baseline);
    points.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(w, baseline);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawStationSpire(cx, baseY, scale, color) {
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(-3, -46);
    ctx.lineTo(-10, -46);
    ctx.lineTo(0, -70);
    ctx.lineTo(10, -46);
    ctx.lineTo(3, -46);
    ctx.lineTo(3, 0);
    ctx.closePath();
    ctx.fill();
    // antenna
    ctx.beginPath();
    ctx.moveTo(0, -70);
    ctx.lineTo(0, -86);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    // deck rings
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(-16 + i * 2, -6 - i * 12, 32 - i * 4, 4);
    }
    ctx.restore();
  }

  function draw(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);

    // sky gradient, sampled from the reference palette
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#1c0f2b");
    sky.addColorStop(0.55, "#3a2a52");
    sky.addColorStop(1, "#513869");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // planet glow
    const planetX = w * 0.5, planetY = h * 0.32, planetR = Math.min(w, h) * 0.16;
    const glow = ctx.createRadialGradient(planetX, planetY, 0, planetX, planetY, planetR * 4);
    glow.addColorStop(0, "rgba(255,164,185,0.35)");
    glow.addColorStop(1, "rgba(255,164,185,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // stars
    stars.forEach((s) => {
      const tw = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      ctx.globalAlpha = 0.25 + tw * 0.55;
      ctx.fillStyle = "#f5e8ef";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // crescent planet
    ctx.save();
    ctx.beginPath();
    ctx.arc(planetX, planetY, planetR, 0, Math.PI * 2);
    ctx.fillStyle = "#fce8ee";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(planetX + planetR * 0.42, planetY - planetR * 0.12, planetR * 0.98, 0, Math.PI * 2);
    ctx.fillStyle = "#271538";
    ctx.fill();
    ctx.restore();

    // drifting satellites, slow horizontal parallax
    drifters.forEach((d) => {
      const x = ((d.offset + t * d.speed) % (w + 40)) - 20;
      ctx.globalAlpha = d.opacity;
      ctx.fillStyle = "#271538";
      ctx.beginPath();
      ctx.arc(x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // far ridge, lighter, drifts very slowly
    const farOffset = (t * 2) % w;
    drawRidge(
      ridgePath(h * 0.78, h * 0.05, 10, 1 + Math.sin(farOffset * 0.001)),
      h,
      "#3a2a52"
    );

    // near ridge, darkest, holds the station spire
    drawRidge(ridgePath(h * 0.86, h * 0.045, 8, 4), h, "#150a1f");
    drawStationSpire(w * 0.5, h * 0.855, Math.min(w, h) / 700, "#150a1f");

    requestAnimationFrame(draw);
  }

  function start() {
    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame(draw);
  }

  return { start };
})();
