#pragma once

#include <DHT.h>
#include "climate.h"

class Dht22Sensor : public IClimateSensor {
public:
  // 2500 ms et non les 2000 ms de la datasheet : a 2000 une transaction sur
  // deux echoue.
  explicit Dht22Sensor(uint8_t pin,
                       uint32_t minIntervalMs = 2500,
                       uint32_t retryMs       = 400);

  void        begin() override;
  ReadStatus  read(ClimateReading &out) override;
  const char *name() const override { return "DHT22"; }
  uint8_t     failStreak() const override { return _failStreak; }

private:
  DHT      _dht;
  uint32_t _minInterval;
  uint32_t _retryMs;
  uint32_t _lastAttempt;
  uint8_t  _failStreak;
  bool     _started;
  bool     _retrying;
};
