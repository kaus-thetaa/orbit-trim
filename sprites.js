// pixel-art sprite definitions, each sprite is a grid of chars mapped to colors
// '.' always means transparent, everything else is looked up in the palette map

const SPRITES = {};

// draws one pixel-grid sprite at x,y (top-left) scaled up into chunky pixels
function drawPixelGrid(ctx, grid, colors, x, y, scale) {
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '.') continue;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(
        Math.round(x + col * scale),
        Math.round(y + row * scale),
        scale,
        scale
      );
    }
  }
}

function gridWidth(grid) { return grid[0].length; }
function gridHeight(grid) { return grid.length; }

// ---------- rocket (player) ----------
SPRITES.rocket = {
  colors: {
    R: '#E8483C',  // nose cone red
    r: '#B23327',  // nose shade
    B: '#7D8BA6',  // body blue-grey
    b: '#5A6784',  // body shade
    W: '#DCEBF7',  // window
    G: '#3C4560'   // fin dark
  },
  body: [
    '...RR...',
    '..RRRR..',
    '.RRRRRR.',
    '.rRRRRr.',
    'BBBBBBBB',
    'BBBWWBBB',
    'BBBWWBBB',
    'bBBBBBBb',
    'bBBBBBBb',
    'G.BBBB.G',
    'G.bbbb.G'
  ],
  flames: [
    ['..FF..', '.FFFF.', 'FFFFFF'],
    ['.FFFF.', 'FFFFFF', '.FFFF.'],
    ['..FF..', '.FFFF.', '.FFFF.']
  ],
  flameColors: [
    { F: '#FFC24B' },
    { F: '#FF8A3D' },
    { F: '#FFE08A' }
  ]
};

// ---------- meteor (standard, blue-grey rock + orange-red trail) ----------
SPRITES.meteor = {
  colors: {
    M: '#5C6478',  // rock core
    m: '#3E4356',  // rock shade
    C: '#232637',  // crater
    T: '#FF6A3D',  // trail outer
    t: '#FFB25A'   // trail inner
  },
  body: [
    '..MMMM..',
    '.MMMMMM.',
    'MMmCMMMM',
    'MMMMCmMM',
    'MMMmMMMM',
    '.MMMMMM.',
    '..MMMM..'
  ],
  trail: [
    '.tT.',
    'TtTT',
    '.tT.'
  ]
};

// ---------- meteor hard variant (cracked, gold flame) ----------
SPRITES.meteorHard = {
  colors: {
    M: '#6B5A56',  // cracked rock core
    m: '#453733',  // rock shade
    C: '#1E1815',  // crack lines
    T: '#FFD34D',  // gold trail outer
    t: '#FFF0A8'   // gold trail inner
  },
  body: [
    '..MMMM..',
    '.MCMMMM.',
    'MMMCMMMM',
    'MMMMCmMM',
    'MMCmMMCM',
    '.MMMCMM.',
    '..MMMM..'
  ],
  trail: [
    '.tT.',
    'TtTT',
    '.tT.'
  ]
};

// ---------- satellite (collectible) ----------
SPRITES.satellite = {
  colors: {
    W: '#F2ECDD',  // white/tan body
    w: '#C9C0A6',  // body shade
    P: '#3FBFB0',  // teal solar panel
    p: '#2B8F84',  // panel shade
    S: '#FFC94B'   // spark/glint
  },
  body: [
    'PP.WW.PP',
    'Pp.WW.pP',
    'PP.ww.PP',
    '...S....'
  ]
};

// ---------- asteroid horizon silhouette chunk (foreground layer) ----------
// generates a jagged silhouette path segment procedurally, not a fixed grid
function buildAsteroidHorizon(width, baseHeight, seed) {
  const points = [];
  let rand = mulberry32(seed);
  const segments = Math.ceil(width / 40) + 2;
  let x = 0;
  for (let i = 0; i <= segments; i++) {
    const h = baseHeight * (0.55 + rand() * 0.9);
    points.push({ x, h });
    x += 30 + rand() * 30;
  }
  return points;
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
