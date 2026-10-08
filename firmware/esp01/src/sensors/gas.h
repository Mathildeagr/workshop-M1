#pragma once

#include <Arduino.h>
#include "sensors/sensor_status.h"

struct GasReading {
  uint16_t raw;
  float    voltage;
  float    ratio;        // NAN tant que la ligne de base n'est pas relevee
  uint32_t timestamp_ms;
  bool     warming_up;
  bool     saturated;
};

class IGasSensor {
public:
  virtual ~IGasSensor() {}

  virtual void        begin()               = 0;
  virtual ReadStatus  read(GasReading &out) = 0;
  virtual const char *name() const          = 0;

  virtual bool     isWarm() const            = 0;
  virtual uint32_t warmupRemainingMs() const = 0;
  virtual bool     isCalibrated() const      = 0;
  virtual float    baseline() const          = 0;
  virtual uint8_t  failStreak() const        = 0;
  // Nombre de lectures consecutives en butee une fois le capteur chaud.
  virtual uint8_t  saturatedStreak() const   = 0;
};
