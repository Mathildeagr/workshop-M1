#pragma once

#include "sensors/gas.h"

class Mq2Sensor : public IGasSensor {
public:
  explicit Mq2Sensor(uint8_t pin,
                     uint32_t warmupMs   = 20UL * 60UL * 1000UL,
                     uint32_t intervalMs = 2000);

  void        begin() override;
  ReadStatus  read(GasReading &out) override;
  const char *name() const override { return "MQ-2"; }

  bool     isWarm() const override;
  uint32_t warmupRemainingMs() const override;
  bool     isCalibrated() const override { return _calibrated; }
  float    baseline() const override { return _baseline; }
  uint8_t  failStreak() const override { return _failStreak; }

private:
  uint16_t sampleAveraged() const;

  uint8_t  _pin;
  uint32_t _warmupMs;
  uint32_t _interval;
  uint32_t _startedAt;
  uint32_t _lastAttempt;
  uint8_t  _failStreak;
  bool     _started;

  bool     _calibrated;
  float    _baseline;
  uint32_t _baselineSum;
  uint16_t _baselineCount;

  static const uint8_t  SAMPLES_PER_READ = 8;
  static const uint16_t BASELINE_SAMPLES = 30;
  static const uint16_t RAW_MAX          = 1023;
};
