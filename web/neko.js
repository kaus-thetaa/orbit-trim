// orbit trim — neko easter egg
// a small cat that idles on the home screen and chases the cursor, homage to
// the classic oneko/neko toy. drawn as vector shapes (no sprite sheet) so it
// has zero external asset dependency, matches the hud line-art style, and
// tints itself with the current accent color.
// only active while the home screen is showing, game.js calls start/stop

const Neko = (() => {
  const canvas = document.getElementById("neko-canvas");
  const ctx = canvas.getContext("2d");

  let x = 80, y = 80;
  let targetX = 80, targetY = 80;
  let frame = 0;
  let running = false;
  let rafId = null;

  const SPEED = 3.2;
  const IDLE_RADIUS = 14; // if pointer is closer than this, cat sits and grooms

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function onPointerMove(e) {
    targetX = e.clientX;
    targetY = e.clientY;
  }

  function accentColor() {
    return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#00e5ff";
  }

  function drawCat(facing, sitting, tick) {
    const c = accentColor();
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = c;
    ctx.shadowBlur = 6;

    const bob = sitting ? Math.sin(tick / 14) * 1.2 : Math.sin(tick / 5) * 1.5;
    ctx.translate(0, bob);
    if (facing < 0) ctx.scale(-1, 1);

    // body
    ctx.beginPath();
    ctx.ellipse(0, 6, 9, 6, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.12;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();

    // head
    ctx.beginPath();
    ctx.arc(9, -2, 6, 0, Math.PI * 2);
    ctx.globalAlpha = 0.12;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();

    // ears
    ctx.beginPath();
    ctx.moveTo(5, -6); ctx.lineTo(6, -12); ctx.lineTo(9, -6);
    ctx.moveTo(11, -6); ctx.lineTo(14, -11); ctx.lineTo(15, -5);
    ctx.stroke();

    // tail, flicks over time
    const tailCurl = Math.sin(tick / 10) * 6;
    ctx.beginPath();
    ctx.moveTo(-8, 6);
    ctx.quadraticCurveTo(-16, 2 + tailCurl, -14, -6 + tailCurl * 0.5);
    ctx.stroke();

    // legs, simple ticks, alternate when walking
    if (!sitting) {
      const legPhase = Math.sin(tick / 3) * 3;
      ctx.beginPath();
      ctx.moveTo(-4, 11); ctx.lineTo(-4 + legPhase, 15);
      ctx.moveTo(3, 11); ctx.lineTo(3 - legPhase, 15);
      ctx.stroke();
    }

    ctx.restore();
  }

  function step() {
    frame++;
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.hypot(dx, dy);
    const sitting = dist < IDLE_RADIUS;

    if (!sitting) {
      x += (dx / dist) * Math.min(SPEED, dist);
      y += (dy / dist) * Math.min(SPEED, dist);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCat(dx < 0 ? -1 : 1, sitting, frame);

    if (running) rafId = requestAnimationFrame(step);
  }

  function start() {
    if (running) return;
    running = true;
    resize();
    x = window.innerWidth * 0.15;
    y = window.innerHeight * 0.8;
    targetX = x; targetY = y;
    canvas.style.display = "block";
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    rafId = requestAnimationFrame(step);
  }

  function stop() {
    running = false;
    canvas.style.display = "none";
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onPointerMove);
    if (rafId) cancelAnimationFrame(rafId);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { start, stop };
})();
