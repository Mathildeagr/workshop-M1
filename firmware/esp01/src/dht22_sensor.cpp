#include "dht22_sensor.h"
#include <math.h>

Dht22Sensor::Dht22Sensor(uint8_t pin, uint32_t minIntervalMs, uint32_t retryMs)
  : _dht(pin, DHT22),
    _minInterval(minIntervalMs),
    _retryMs(retryMs),
    _lastAttempt(0),
    _failStreak(0),
    _started(false),
    _retrying(false) {}

void Dht22Sensor::begin() {
  _dht.begin();
  _lastAttempt = millis();
  _failStreak  = 0;
  _retrying    = false;
  _started     = true;
}

ReadStatus Dht22Sensor::read(ClimateReading &out) {
  if (!_started) return ReadStatus::Error;

  const uint32_t wait = _retrying ? _retryMs : _minInterval;
  const uint32_t now  = millis();
  if (now - _lastAttempt < wait) return ReadStatus::NotReady;
  _lastAttempt = now;

  // Une seule transaction : la temperature vient du cache de la meme trame.
  // La forcer declencherait un second echange que le capteur refuse.
  const float h = _dht.readHumidity(_retrying);
  const float t = _dht.readTemperature(false, false);

  const bool bad = isnan(h) || isnan(t) ||
                   t < -40.0f || t > 80.0f ||
                   h < 0.0f   || h > 100.0f;

  if (bad) {
    if (_failStreak < 255) _failStreak++;
    _retrying = !_retrying;
    return ReadStatus::Error;
  }

  _failStreak       = 0;
  _retrying         = false;
  out.temperature_c = t;
  out.humidity_pct  = h;
  out.timestamp_ms  = now;
  return ReadStatus::Ok;
}
