#pragma once

#include <Arduino.h>
#include "sensors/sensor_status.h"

struct ClimateReading {
  float    temperature_c;
  float    humidity_pct;
  uint32_t timestamp_ms;
};

class IClimateSensor {
public:
  virtual ~IClimateSensor() {}

  virtual void        begin()                   = 0;
  virtual ReadStatus  read(ClimateReading &out) = 0;
  virtual const char *name() const              = 0;
  virtual uint8_t     failStreak() const        = 0;
};

float climateDewPointC(float temperature_c, float humidity_pct);
