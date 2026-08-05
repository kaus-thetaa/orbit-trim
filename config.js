const CONFIG = {
  palette: {
    skyTop: '#FFA6C1',
    sky2: '#A34A75',
    sky3: '#7B5286',
    sky4: '#4E3D6E',
    skyBottom: '#23133A',
    daySkyTop: '#71B2EA',      // new day colors
    daySkyBottom: '#CBE5FF',   // new day colors
    star: '#FFFFFF',
    shootingStar: '#FFE9F2',
    planetCore: '#E7B7D1',
    planetGlow: 'rgba(231, 183, 209, 0.38)',
    horizonNear: '#2B1B45',
    horizonFar: '#140A24',
    horizonFar2: '#4E3D6E',
    horizonFar2Deep: '#2B1F45',
    hazeColor: 'rgba(255, 166, 193, 0.16)'
  },
  world: {
    groundHeightRatio: 0.16,
    horizonTileWidth: 1400,
    horizonSeed: 1337,
    pixelRocketScoreThreshold: 200 // Swap to pixel image after this score
  },
  speed: {
    base: 240,
    max: 520,
    rampPerSecond: 2.2,
    foregroundMultiplier: 1.0,
    midMultiplier: 0.12,
    backMultiplier: 0.02
  },
  player: {
    startY: 0.5,
    xPosition: 130,
    moveSpeed: 620,
    smoothing: 0.22,
    hitboxPadding: 6,
    width: 56,
    height: 34,
    flameFrameMs: 90
  },
  obstacles: {
    spawnIntervalStart: 1250,
    spawnIntervalMin: 620,
    rampMs: 45000,
    speedVariance: 0.35,
    minGapPx: 210,
    radius: 22,
    canSpawnInterval: 4000 // Interval for aluminum can defenses
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
    distancePerPoint: 12
  },
  input: {
    tiltDeadzone: 1.5,
    tiltRange: 30,
    tiltSmoothing: 0.35,
    serialBaudRate: 115200,
    keyboardHoldSpeed: 1.0,
    dragSensitivity: 1.4
  }
};
