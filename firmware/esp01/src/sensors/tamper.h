#pragma once

#include <Arduino.h>
#include "sensors/sensor_status.h"

enum class TamperLevel : uint8_t {
  Rest,
  Disturbed,   // le contact papillote : vibration, choc
  Triggered    // changement maintenu
};

struct TamperReading {
  TamperLevel level;
  uint32_t    timestamp_ms;
  uint32_t    ms_since_last_trigger;
  uint16_t    episodes_in_window;
};

class ITamperSensor {
public:
  virtual ~ITamperSensor() {}

  virtual void        begin()                  = 0;
  virtual ReadStatus  read(TamperReading &out) = 0;   // Ok uniquement sur changement
  virtual const char *name() const             = 0;

  virtual TamperLevel level() const              = 0;
  virtual bool        contactClosed() const      = 0;
  virtual uint32_t    msSinceLastTrigger() const = 0;
  virtual uint16_t    episodesInWindow() const   = 0;
  virtual bool        restLevel() const          = 0;
  virtual void        relearnRest()              = 0;
};

const char *tamperLevelName(TamperLevel l);
