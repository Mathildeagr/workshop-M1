#pragma once

#include "sensors/tamper.h"

enum class PinBias : uint8_t {
  None,         // tirage externe
  PullUp,
  PullDown16    // GPIO16 uniquement
};

class ContactSensor : public ITamperSensor {
public:
  // restLevel : -1 pour apprendre le niveau de repos au demarrage.
  // releaseMs : toujours superieur a holdMs, sinon un contact qui vibre fait
  //             clignoter l'alarme.
  // disturbMs : 0 pour supprimer le niveau intermediaire.
  ContactSensor(uint8_t pin,
                const char *name,
                PinBias  bias,
                int8_t   restLevel  = -1,
                uint16_t debounceMs = 50,
                uint16_t holdMs     = 300,
                uint16_t releaseMs  = 800,
                uint16_t disturbMs  = 400,
                uint32_t windowMs   = 5UL * 60UL * 1000UL);

  void        begin() override;
  ReadStatus  read(TamperReading &out) override;
  const char *name() const override { return _name; }

  TamperLevel level() const override { return _level; }
  bool        contactClosed() const override { return _raw; }
  uint32_t    msSinceLastTrigger() const override;
  uint16_t    episodesInWindow() const override;
  bool        restLevel() const override { return _restLevel; }
  void        relearnRest() override;

private:
  void logEpisode(uint32_t at);

  uint8_t     _pin;
  const char *_name;
  PinBias     _bias;
  int8_t      _restCfg;
  uint16_t    _debounceMs;
  uint16_t    _holdMs;
  uint16_t    _releaseMs;
  uint16_t    _disturbMs;
  uint32_t    _windowMs;

  bool     _started;
  bool     _restLevel;

  bool     _raw;
  uint32_t _lastEdgeAt;
  bool     _stable;
  uint32_t _stableAt;

  TamperLevel _level;
  TamperLevel _reported;

  uint32_t _lastTriggerAt;
  bool     _everTriggered;

  static const uint8_t LOG_SIZE = 16;
  uint32_t _log[LOG_SIZE];
  uint8_t  _logCount;
  uint8_t  _logHead;
};
