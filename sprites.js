// pixel-art sprite definitions live below; the horizon/spire generator at
// the bottom of this file also lives here

const SPRITES = {};

// ---------- rocket (player), drawn as a flat ink silhouette facing right ----------
// coordinates are in local units centered on (0,0), scaled by the caller.
// nose points +x (right, into oncoming meteors), flame trails -x (left, behind)
SPRITES.rocket = {
  ink: '#1C1030',
  flame: ['#FFC24B', '#FF8A3D', '#FFE08A'], // cycled for a flicker animation
  body: (w, h) => [
    [w * 0.5, 0],
    [w * 0.08, -h * 0.42],
    [-w * 0.32, -h * 0.34],
    [-w * 0.46, -h * 0.12],
    [-w * 0.46, h * 0.12],
    [-w * 0.32, h * 0.34],
    [w * 0.08, h * 0.42]
  ],
  finTop: (w, h) => [
    [-w * 0.22, -h * 0.3],
    [-w * 0.42, -h * 0.62],
    [-w * 0.06, -h * 0.24]
  ],
  finBottom: (w, h) => [
    [-w * 0.22, h * 0.3],
    [-w * 0.42, h * 0.62],
    [-w * 0.06, h * 0.24]
  ]
};

// ---------- meteor (obstacle), irregular ink silhouette with a warm trail ----------
SPRITES.meteor = {
  ink: '#1C1030',
  trailColor: '#FF8A4D',
  // irregular polygon so it doesn't read as a perfect circle
  outline: (r) => [
    [r * 0.9, -r * 0.15], [r * 0.55, -r * 0.75], [r * 0.05, -r],
    [-r * 0.55, -r * 0.72], [-r * 0.95, -r * 0.1], [-r * 0.62, r * 0.68],
    [0, r], [r * 0.6, r * 0.6]
  ]
};

// ---------- satellite (collectible), simple ink silhouette with a bright glint ----------
SPRITES.satellite = {
  ink: '#1C1030',
  glint: '#FFD37A'
};

// ---------- rolling terrain horizon (foreground layer, alto-style) ----------
// smooth silhouette built from a few stacked sine waves instead of jagged
// random spikes, tuned with integer frequencies so it repeats perfectly
// across tileWidth with zero seam when the render loop wraps x % tileWidth
function buildHorizon(tileWidth, baseHeight, seed) {
  const rand = mulberry32(seed);
  const waves = [
    { freq: 1, amp: 0.55, phase: rand() * Math.PI * 2 },
    { freq: 2, amp: 0.30, phase: rand() * Math.PI * 2 },
    { freq: 3, amp: 0.16, phase: rand() * Math.PI * 2 },
    { freq: 5, amp: 0.09, phase: rand() * Math.PI * 2 }
  ];

  function heightAt(x) {
    let h = 0;
    for (const w of waves) {
      h += Math.sin((x / tileWidth) * Math.PI * 2 * w.freq + w.phase) * w.amp;
    }
    // normalize roughly into 0..1 then scale, keep terrain mostly low
    // with occasional taller rises rather than symmetric random noise
    const norm = (h + 1) / 2.2;
    return baseHeight * (0.32 + norm * 0.85);
  }

  // sparse tall thin spires (launch towers / rock needles) breaking the
  // ridge line, like the small structures poking above alto's mountains
  const spires = [];
  const spireCount = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < spireCount; i++) {
    const x = rand() * tileWidth;
    spires.push({
      x,
      height: baseHeight * (0.9 + rand() * 1.1),
      width: baseHeight * (0.1 + rand() * 0.08)
    });
  }

  return { tileWidth, heightAt, spires };
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
