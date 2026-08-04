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
    planetGlow: 'rgba(231, 183, 209, 0.35)',
    asteroidFill: '#160C29',
    asteroidEdge: '#0B0616'
  },

  world: {
    pixelScale: 4,          // sprite pixel-art scale factor
    groundHeightRatio: 0.16 // asteroid horizon height as fraction of canvas height
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
    flameFrames: 3,
    flameFrameMs: 90
  },

  obstacles: {
    spawnIntervalStart: 1250, // ms between meteor spawns at start
    spawnIntervalMin: 620,    // fastest spawn interval reached at ramp
    rampMs: 45000,            // time to reach min spawn interval
    speedVariance: 0.35,      // +/- fraction random speed offset per meteor
    hardVariantChance: 0.35,  // chance to spawn the cracked gold variant
    minGapPx: 210             // minimum vertical gap between simultaneous meteors
  },

  collectibles: {
    spawnIntervalStart: 1600,
    spawnIntervalMin: 900,
    rampMs: 45000,
    scoreValue: 25
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
