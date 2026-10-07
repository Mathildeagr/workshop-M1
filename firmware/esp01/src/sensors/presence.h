#pragma once

#include <Arduino.h>
#include "sensors/sensor_status.h"

struct PresenceReading {
  bool     present;
  bool     rising;
  bool     falling;
  uint32_t timestamp_ms;
  uint32_t ms_since_last_motion;
  uint16_t motions_in_window;
  bool     settling;
};

class IPresenceSensor {
public:
  virtual ~IPresenceSensor() {}

  virtual void        begin()                    = 0;
  virtual ReadStatus  read(PresenceReading &out) = 0;   // Ok uniquement sur changement
  virtual const char *name() const               = 0;

  virtual bool     isPresent() const         = 0;
  virtual uint32_t msSinceLastMotion() const = 0;
  virtual uint16_t motionsInWindow() const   = 0;
  virtual bool     isSettled() const         = 0;
  virtual uint32_t settleRemainingMs() const = 0;
};
