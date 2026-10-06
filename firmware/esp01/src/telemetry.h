#pragma once

#include <Arduino.h>
#include "alarm.h"
#include "tamper.h"

// Etat complet du noeud a un instant donne. C'est ce qui partira en JSON sur
// sentinel/esp01/telemetry.
struct TelemetryFrame {
  uint32_t uptime_s;

  bool     climate_valid;
  float    temperature_c;
  float    humidity_pct;
  float    dew_point_c;

  bool     gas_valid;
  uint16_t gas_raw;
  float    gas_ratio;
  bool     gas_warming;
  bool     gas_saturated;

  bool     presence;
  bool     presence_settling;
  uint16_t presence_count;

  TamperLevel tilt;
  TamperLevel optic;

  bool     wifi_up;
};

class ITelemetrySink {
public:
  virtual ~ITelemetrySink() {}

  virtual void begin() {}
  virtual void update() {}

  virtual void publish(const TelemetryFrame &frame) = 0;

  // level : info, warning ou critical.
  // detail : precision facultative, nullptr si aucune.
  // value : NAN pour ne rien transmettre.
  virtual void publishEvent(const char *event, const char *level,
                            const char *detail, float value) = 0;
};
