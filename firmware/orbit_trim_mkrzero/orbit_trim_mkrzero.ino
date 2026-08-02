// orbit trim firmware
// arduino mkr zero + icm-20948 over spi/i2c
// reads accel+gyro, fuses with a complementary filter, smooths with ema
// streams "pitch,roll\n" over usb serial at SERIAL_HZ

#include <ICM_20948.h>

// ---- config ----
#define WIRE_PORT Wire
#define AD0_VAL   1        // icm-20948 breakout default address jumper state

const uint32_t SERIAL_BAUD   = 115200;
const uint16_t SAMPLE_HZ     = 100;     // imu read + fuse rate
const uint16_t SERIAL_HZ     = 50;      // output rate to browser
const float    COMP_ALPHA    = 0.98f;   // weight on gyro-integrated angle
const float    EMA_ALPHA     = 0.25f;   // output smoothing, higher = snappier

ICM_20948_I2C imu;

float pitch = 0.0f;
float roll  = 0.0f;
float pitchSmooth = 0.0f;
float rollSmooth  = 0.0f;

uint32_t lastSampleMicros = 0;
uint32_t lastSerialMillis = 0;
const uint32_t serialIntervalMs = 1000UL / SERIAL_HZ;

void setup() {
  Serial.begin(SERIAL_BAUD);
  uint32_t startWait = millis();
  while (!Serial && millis() - startWait < 3000) {
    // give the host a few seconds to open the port, don't hang forever
  }

  WIRE_PORT.begin();
  WIRE_PORT.setClock(400000);

  bool initialized = false;
  while (!initialized) {
    imu.begin(WIRE_PORT, AD0_VAL);
    if (imu.status != ICM_20948_Stat_Ok) {
      Serial.println("# icm20948 init failed, retrying");
      delay(500);
    } else {
      initialized = true;
    }
  }

  imu.setSampleMode(ICM_20948_Internal_Acc | ICM_20948_Internal_Gyr, ICM_20948_Sample_Mode_Continuous);

  // seed the filter from a first accel-only reading so we don't start at zero
  if (imu.dataReady()) {
    imu.getAGMT();
    pitch = accelPitch(imu.accX(), imu.accY(), imu.accZ());
    roll  = accelRoll(imu.accY(), imu.accZ());
    pitchSmooth = pitch;
    rollSmooth = roll;
  }

  lastSampleMicros = micros();
  Serial.println("# orbit trim ready");
}

void loop() {
  if (!imu.dataReady()) return;

  imu.getAGMT();

  uint32_t now = micros();
  float dt = (now - lastSampleMicros) / 1000000.0f;
  lastSampleMicros = now;
  if (dt <= 0.0f || dt > 0.2f) dt = 1.0f / SAMPLE_HZ; // guard against startup/jitter spikes

  // accel-derived absolute angle, degrees
  float accPitch = accelPitch(imu.accX(), imu.accY(), imu.accZ());
  float accRoll  = accelRoll(imu.accY(), imu.accZ());

  // gyro rates, dps -> integrate
  float gyroPitchRate = imu.gyrY(); // axis mapping tuned for breadboard mount, flip sign if inverted
  float gyroRollRate  = imu.gyrX();

  float gyroPitch = pitch + gyroPitchRate * dt;
  float gyroRoll  = roll + gyroRollRate * dt;

  // complementary fusion
  pitch = COMP_ALPHA * gyroPitch + (1.0f - COMP_ALPHA) * accPitch;
  roll  = COMP_ALPHA * gyroRoll  + (1.0f - COMP_ALPHA) * accRoll;

  // ema smoothing on top, this is the existing filter ported from the imu noise-mapping work
  pitchSmooth = EMA_ALPHA * pitch + (1.0f - EMA_ALPHA) * pitchSmooth;
  rollSmooth  = EMA_ALPHA * roll  + (1.0f - EMA_ALPHA) * rollSmooth;

  uint32_t nowMs = millis();
  if (nowMs - lastSerialMillis >= serialIntervalMs) {
    lastSerialMillis = nowMs;
    Serial.print(pitchSmooth, 2);
    Serial.print(",");
    Serial.println(rollSmooth, 2);
  }
}

float accelPitch(float ax, float ay, float az) {
  return atan2(-ax, sqrt(ay * ay + az * az)) * 180.0f / PI;
}

float accelRoll(float ay, float az) {
  return atan2(ay, az) * 180.0f / PI;
}
