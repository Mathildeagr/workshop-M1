#include "mq2_sensor.h"
#include <math.h>

Mq2Sensor::Mq2Sensor(uint8_t pin, uint32_t warmupMs, uint32_t intervalMs)
  : _pin(pin),
    _warmupMs(warmupMs),
    _interval(intervalMs),
    _startedAt(0),
    _lastAttempt(0),
    _failStreak(0),
    _started(false),
    _calibrated(false),
    _baseline(NAN),
    _baselineSum(0),
    _baselineCount(0) {}

void Mq2Sensor::begin() {
  _startedAt   = millis();
  _lastAttempt = _startedAt - _interval;
  _failStreak  = 0;
  _started     = true;
}

bool Mq2Sensor::isWarm() const {
  if (!_started) return false;
  return (millis() - _startedAt) >= _warmupMs;
}

uint32_t Mq2Sensor::warmupRemainingMs() const {
  if (!_started) return _warmupMs;
  const uint32_t elapsed = millis() - _startedAt;
  return elapsed >= _warmupMs ? 0 : (_warmupMs - elapsed);
}

// Le convertisseur de l'ESP8266 saute de plusieurs unites d'un appel a l'autre.
uint16_t Mq2Sensor::sampleAveraged() const {
  uint32_t acc = 0;
  for (uint8_t i = 0; i < SAMPLES_PER_READ; i++) {
    acc += (uint32_t)analogRead(_pin);
  }
  return (uint16_t)(acc / SAMPLES_PER_READ);
}

ReadStatus Mq2Sensor::read(GasReading &out) {
  if (!_started) return ReadStatus::Error;

  const uint32_t now = millis();
  if (now - _lastAttempt < _interval) return ReadStatus::NotReady;
  _lastAttempt = now;

  const uint16_t raw = sampleAveraged();

  // Une entree analogique en l'air est tiree vers le bas : un zero franc et
  // persistant signale une ligne non cablee.
  if (raw == 0) {
    if (_failStreak < 255) _failStreak++;
    return ReadStatus::Error;
  }
  _failStreak = 0;

  const bool warm      = (now - _startedAt) >= _warmupMs;
  const bool saturated = (raw >= RAW_MAX - 3);

  // La ligne de base suppose un air sain, et une mesure en butee ne vaut rien.
  if (warm && !_calibrated && !saturated) {
    _baselineSum += raw;
    _baselineCount++;
    if (_baselineCount >= BASELINE_SAMPLES) {
      _baseline   = (float)_baselineSum / (float)_baselineCount;
      _calibrated = true;
    }
  }

  out.raw          = raw;
  out.voltage      = (float)raw * 3.3f / (float)RAW_MAX;
  out.ratio        = (_calibrated && _baseline > 0.0f) ? ((float)raw / _baseline) : NAN;
  out.timestamp_ms = now;
  out.warming_up   = !warm;
  out.saturated    = saturated;
  return ReadStatus::Ok;
}
