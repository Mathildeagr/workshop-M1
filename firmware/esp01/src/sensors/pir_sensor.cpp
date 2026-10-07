#include "sensors/pir_sensor.h"

PirSensor::PirSensor(uint8_t pin, uint32_t settleMs, uint32_t windowMs, uint16_t debounceMs)
  : _pin(pin),
    _settleMs(settleMs),
    _windowMs(windowMs),
    _debounceMs(debounceMs),
    _startedAt(0),
    _started(false),
    _stable(false),
    _candidate(false),
    _candidateAt(0),
    _pendingEvent(false),
    _pendingRising(false),
    _lastMotionAt(0),
    _everMoved(false),
    _logCount(0),
    _logHead(0) {
  for (uint8_t i = 0; i < LOG_SIZE; i++) _motionLog[i] = 0;
}

void PirSensor::begin() {
  pinMode(_pin, INPUT);
  _startedAt    = millis();
  _started      = true;
  _stable       = false;
  _candidate    = false;
  _candidateAt  = _startedAt;
  _pendingEvent = false;
  _everMoved    = false;
  _logCount     = 0;
  _logHead      = 0;
}

bool PirSensor::isSettled() const {
  if (!_started) return false;
  return (millis() - _startedAt) >= _settleMs;
}

uint32_t PirSensor::settleRemainingMs() const {
  if (!_started) return _settleMs;
  const uint32_t elapsed = millis() - _startedAt;
  return elapsed >= _settleMs ? 0 : (_settleMs - elapsed);
}

uint32_t PirSensor::msSinceLastMotion() const {
  if (!_everMoved) return 0;
  return millis() - _lastMotionAt;
}

// Un bit de presence ne sert a rien a un detecteur d'anomalies : on expose
// aussi une frequence, qui est continue.
uint16_t PirSensor::motionsInWindow() const {
  const uint32_t now = millis();
  uint16_t n = 0;
  for (uint8_t i = 0; i < _logCount; i++) {
    if (now - _motionLog[i] <= _windowMs) n++;
  }
  return n;
}

void PirSensor::logMotion(uint32_t at) {
  _motionLog[_logHead] = at;
  _logHead = (uint8_t)((_logHead + 1) % LOG_SIZE);
  if (_logCount < LOG_SIZE) _logCount++;
  _lastMotionAt = at;
  _everMoved    = true;
}

ReadStatus PirSensor::read(PresenceReading &out) {
  if (!_started) return ReadStatus::Error;

  const uint32_t now = millis();
  const bool level = (digitalRead(_pin) == HIGH);

  if (level != _candidate) {
    _candidate   = level;
    _candidateAt = now;
  } else if (level != _stable && (now - _candidateAt) >= _debounceMs) {
    _stable = level;
    if (_stable) logMotion(now);
    _pendingEvent  = true;
    _pendingRising = _stable;
  }

  if (!_pendingEvent) return ReadStatus::NotReady;
  _pendingEvent = false;

  out.present              = _stable;
  out.rising               = _pendingRising;
  out.falling              = !_pendingRising;
  out.timestamp_ms         = now;
  out.ms_since_last_motion = msSinceLastMotion();
  out.motions_in_window    = motionsInWindow();
  // Le capteur declenche au hasard pendant sa premiere minute : on remonte
  // quand meme, c'est a l'appelant d'en tenir compte.
  out.settling             = (now - _startedAt) < _settleMs;
  return ReadStatus::Ok;
}
