#include "sensors/contact_sensor.h"

const char *tamperLevelName(TamperLevel l) {
  switch (l) {
    case TamperLevel::Rest:      return "repos";
    case TamperLevel::Disturbed: return "secousse";
    case TamperLevel::Triggered: return "sabotage";
  }
  return "?";
}

ContactSensor::ContactSensor(uint8_t pin, const char *name, PinBias bias,
                             int8_t restLevel, uint16_t debounceMs,
                             uint16_t holdMs, uint16_t releaseMs,
                             uint16_t disturbMs, uint32_t windowMs)
  : _pin(pin),
    _name(name),
    _bias(bias),
    _restCfg(restLevel),
    _debounceMs(debounceMs),
    _holdMs(holdMs),
    _releaseMs(releaseMs),
    _disturbMs(disturbMs),
    _windowMs(windowMs),
    _started(false),
    _restLevel(false),
    _raw(false),
    _lastEdgeAt(0),
    _stable(false),
    _stableAt(0),
    _level(TamperLevel::Rest),
    _reported(TamperLevel::Rest),
    _lastTriggerAt(0),
    _everTriggered(false),
    _logCount(0),
    _logHead(0) {
  for (uint8_t i = 0; i < LOG_SIZE; i++) _log[i] = 0;
}

void ContactSensor::begin() {
  switch (_bias) {
    case PinBias::PullDown16: pinMode(_pin, INPUT_PULLDOWN_16); break;
    case PinBias::PullUp:     pinMode(_pin, INPUT_PULLUP);      break;
    default:                  pinMode(_pin, INPUT);             break;
  }
  _started = true;
  relearnRest();
}

void ContactSensor::relearnRest() {
  if (!_started) return;
  const uint32_t now = millis();
  _restLevel     = (_restCfg < 0) ? (digitalRead(_pin) == HIGH) : (_restCfg != 0);
  _raw           = (digitalRead(_pin) == HIGH);
  _stable        = _raw;
  _stableAt      = now;
  _lastEdgeAt    = now;
  _level         = TamperLevel::Rest;
  _reported      = TamperLevel::Rest;
  _everTriggered = false;
  _logCount      = 0;
  _logHead       = 0;
}

uint32_t ContactSensor::msSinceLastTrigger() const {
  if (!_everTriggered) return 0;
  return millis() - _lastTriggerAt;
}

uint16_t ContactSensor::episodesInWindow() const {
  const uint32_t now = millis();
  uint16_t n = 0;
  for (uint8_t i = 0; i < _logCount; i++) {
    if (now - _log[i] <= _windowMs) n++;
  }
  return n;
}

void ContactSensor::logEpisode(uint32_t at) {
  _log[_logHead] = at;
  _logHead = (uint8_t)((_logHead + 1) % LOG_SIZE);
  if (_logCount < LOG_SIZE) _logCount++;
}

ReadStatus ContactSensor::read(TamperReading &out) {
  if (!_started) return ReadStatus::Error;

  const uint32_t now = millis();
  const bool raw = (digitalRead(_pin) == HIGH);

  // Toute transition brute date l'agitation : un choc fait papilloter le
  // contact sans jamais changer son niveau stable, l'anti-rebond seul l'efface.
  if (raw != _raw) {
    _raw        = raw;
    _lastEdgeAt = now;
  }

  if (_raw != _stable && (now - _lastEdgeAt) >= _debounceMs) {
    _stable   = _raw;
    _stableAt = now;
  }

  TamperLevel lvl;
  if (_level == TamperLevel::Triggered) {
    lvl = (_stable == _restLevel && (now - _stableAt) >= _releaseMs)
            ? TamperLevel::Rest
            : TamperLevel::Triggered;
  } else if (_stable != _restLevel && (now - _stableAt) >= _holdMs) {
    lvl = TamperLevel::Triggered;
  } else if (_disturbMs > 0 && (now - _lastEdgeAt) < _disturbMs) {
    lvl = TamperLevel::Disturbed;
  } else {
    lvl = TamperLevel::Rest;
  }

  if (lvl != _level) {
    if (_level == TamperLevel::Rest) logEpisode(now);
    if (lvl == TamperLevel::Triggered) {
      _lastTriggerAt = now;
      _everTriggered = true;
    }
    _level = lvl;
  }

  if (_level == _reported) return ReadStatus::NotReady;
  _reported = _level;

  out.level                 = _level;
  out.timestamp_ms          = now;
  out.ms_since_last_trigger = msSinceLastTrigger();
  out.episodes_in_window    = episodesInWindow();
  return ReadStatus::Ok;
}
