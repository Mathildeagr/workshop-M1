#pragma once

#include "presence.h"

class PirSensor : public IPresenceSensor {
public:
  explicit PirSensor(uint8_t pin,
                     uint32_t settleMs   = 60UL * 1000UL,
                     uint32_t windowMs   = 5UL * 60UL * 1000UL,
                     uint16_t debounceMs = 50);

  void        begin() override;
  ReadStatus  read(PresenceReading &out) override;
  const char *name() const override { return "HC-SR501"; }

  bool     isPresent() const override { return _stable; }
  uint32_t msSinceLastMotion() const override;
  uint16_t motionsInWindow() const override;
  bool     isSettled() const override;
  uint32_t settleRemainingMs() const override;

private:
  void logMotion(uint32_t at);

  uint8_t  _pin;
  uint32_t _settleMs;
  uint32_t _windowMs;
  uint16_t _debounceMs;

  uint32_t _startedAt;
  bool     _started;

  bool     _stable;
  bool     _candidate;
  uint32_t _candidateAt;
  bool     _pendingEvent;
  bool     _pendingRising;

  uint32_t _lastMotionAt;
  bool     _everMoved;

  static const uint8_t LOG_SIZE = 16;
  uint32_t _motionLog[LOG_SIZE];
  uint8_t  _logCount;
  uint8_t  _logHead;
};
