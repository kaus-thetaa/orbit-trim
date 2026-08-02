# Orbit Trim

A live IMU-controlled balance game for the ThrustMIT booth. Tilt the breadboard,
keep the rocket vertical, climb as high as you can before the tolerance band gets
too tight to hold.

## Hardware

- Arduino MKR Zero
- ICM-20948 IMU (I2C)
- USB cable to the booth laptop

## Setup

### 1. Firmware

1. Open `firmware/orbit_trim_mkrzero/orbit_trim_mkrzero.ino` in the Arduino IDE.
2. Install the **SparkFun ICM-20948 Arduino Library** via Library Manager.
3. Select board: Arduino MKR Zero.
4. Upload, then open the Serial Monitor at 115200 baud. You should see lines like
   `2.14,-0.87` streaming continuously. Tilt the board and confirm the numbers move.
5. If pitch/roll feel reversed for your mount orientation, flip the sign on
   `gyroPitchRate` / `gyroRollRate` in the sketch (one line each, clearly commented).

### 2. Web app

No build step — it's plain HTML/CSS/JS.

1. Serve the `web/` folder over `http(s)` (Web Serial requires a secure context;
   `file://` won't work). Easiest option on the booth laptop:
   ```
   cd web
   python -m http.server 8000
   ```
2. Open `http://localhost:8000` in **Chrome or Edge** (Web Serial isn't supported
   in Firefox/Safari).
3. Click **CONNECT DEVICE**, pick the Arduino's serial port from the browser prompt.
4. Click **CALIBRATE** with the board resting flat — this zeroes the current
   reading as neutral.
5. Click **LAUNCH**.

## How the game works

- Score is altitude, climbing continuously while your tilt is inside the current
  tolerance band.
- Tolerance starts at 25° and tightens as altitude increases, down to a floor of 8°
  — the run gets harder the longer you survive.
- Going out of tolerance gives a 550ms grace window (with a flashing warning)
  before it's game over, so brief wobbles don't end a run instantly.
- The accent color shifts every 350m of altitude as a visual milestone reward.
- Top 10 runs are saved to a local leaderboard (`localStorage`, this laptop only).

## Booth day checklist

- [ ] Arduino flashed, IMU wired, USB cable long enough to reach the breadboard stand
- [ ] `web/` served locally, tab open in Chrome, zoomed to a comfortable size
- [ ] Recalibrate once the board is mounted in its final booth position
- [ ] Test a full run end to end, including a deliberate loss, before doors open

## Project structure

```
firmware/
  orbit_trim_mkrzero/
    orbit_trim_mkrzero.ino   # IMU read, complementary+EMA filter, serial output
web/
  index.html                 # home / game / game-over screens
  style.css                  # calm dusk palette, 3-accent color system
  bg.js                      # ambient planet/starfield/silhouette background
  sound.js                   # synthesized calm sfx, web audio, no audio files
  serial.js                  # web serial connection + line parsing
  game.js                    # game loop, scoring, leaderboard
  neko.js                    # cursor-follow cat easter egg (home screen)
```

## Sound

All sound effects are synthesized in the browser with the Web Audio API —
no audio files, so there's nothing to fail loading at the booth. There's a
mute toggle in the top-right corner on every screen. Audio only starts after
a click, per browser autoplay rules (handled automatically on connect/mute).

## Out of scope (by design)

Multiplayer, backend/server, Bluetooth, a physics engine, multiple game modes,
mobile support. One laptop, one browser tab, one USB cable.
