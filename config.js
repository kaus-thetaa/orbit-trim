// central tuning config, edit values here for booth calibration
// nothing else in the codebase should hardcode a number this file already owns

const CONFIG = {

  palette: {
    skyTop: '#FFA6C1',
    sky2: '#A34A75',
    sky3: '#7B5286',
    sky4: '#4E3D6E',
    skyBottom: '#23133A',
    star: '#FFFFFF',
    shootingStar: '#FFE9F2',
    planetCore: '#E7B7D1',
    planetGlow: 'rgba(231, 183, 209, 0.38)',
    horizonNear: '#2B1B45',   // lit edge of near terrain, blends toward sky
    horizonFar: '#140A24',    // deep silhouette base of near terrain
    horizonFar2: '#4E3D6E',   // far ridge layer, lighter for depth
    horizonFar2Deep: '#2B1F45',
    hazeColor: 'rgba(255, 166, 193, 0.16)' // atmospheric bleed near ground
  },

  // daytime counterpart, blended against palette above on a slow cycle
  paletteDay: {
    skyTop: '#BEE7FF',
    sky2: '#8FCBEF',
    sky3: '#7CA6D8',
    sky4: '#5E7FBE',
    skyBottom: '#233A6E',
    planetCore: '#FFE9B0',
    horizonNear: '#3A4A7A',
    horizonFar: '#182347',
    horizonFar2: '#5E7FBE',
    horizonFar2Deep: '#3A4A7A'
  },

  dayNight: {
    cycleMs: 90000 // full night-day-night loop duration
  },

  world: {
    groundHeightRatio: 0.16, // horizon height as fraction of canvas height
    horizonTileWidth: 1400,  // period of the rolling terrain, must tile seamlessly
    horizonSeed: 1337,
    terrainKillMargin: 4     // px of overlap with ground/spike before it's fatal
  },

  speed: {
    base: 240,          // px/sec world scroll speed at start
    max: 520,           // scroll speed cap
    rampPerSecond: 2.2, // scroll speed increases this much per second survived
    foregroundMultiplier: 1.0,  // asteroid horizon scrolls at full game speed
    midMultiplier: 0.12,        // planet drifts slowly
    backMultiplier: 0.02        // starfield near-static
  },

  player: {
    startY: 0.5,          // fraction of playable height
    xPosition: 130,        // fixed horizontal screen position, px from left
    moveSpeed: 620,        // px/sec vertical response to input
    smoothing: 0.22,       // 0-1, higher = snappier
    hitboxPadding: 6,      // shrink hitbox vs sprite bounds for fairness
    width: 56,
    height: 34,
    flameFrameMs: 90,
    pixelSkinScore: 300    // score at which the rocket swaps to the pixel-art skin
  },

  crash: {
    gravity: 1400,       // px/sec^2 fall acceleration once dying
    spinSpeed: 9,         // rad/sec tumble rate while dying
    debrisCount: 14,
    durationMs: 1100      // time in the dying state before game-over shows
  },

  weapon: {
    fireIntervalMs: 220,   // ms between shots, auto-fires while playing
    bulletSpeed: 780,      // px/sec, screen-space rightward
    bulletRadius: 4,
    destroyScoreValue: 10
  },

  obstacles: {
    spawnIntervalStart: 1250, // ms between meteor spawns at start
    spawnIntervalMin: 620,    // fastest spawn interval reached at ramp
    rampMs: 45000,            // time to reach min spawn interval
    speedVariance: 0.35,      // +/- fraction random speed offset per meteor
    minGapPx: 210,            // minimum vertical gap between simultaneous meteors
    radius: 22
  },

  collectibles: {
    spawnIntervalStart: 1600,
    spawnIntervalMin: 900,
    rampMs: 45000,
    scoreValue: 25,
    width: 34,
    height: 20
  },

  score: {
    distancePerPoint: 12 // px traveled per 1 distance point
  },

  input: {
    tiltDeadzone: 1.5,      // degrees, ignore noise under this
    tiltRange: 30,          // degrees mapped to full up/down travel
    tiltSmoothing: 0.35,    // exponential smoothing on incoming serial samples
    serialBaudRate: 115200,
    keyboardHoldSpeed: 1.0, // multiplier on player.moveSpeed for keyboard
    dragSensitivity: 1.4
  }
};
