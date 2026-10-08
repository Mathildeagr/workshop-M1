#include "sensors/adxl345_sensor.h"
#include <math.h>

static const float GRAVITY = 9.80665f;

// Nombre de mesures moyennees pour apprendre la position de repos.
static const uint8_t REST_SAMPLES = 32;

// Poids de la nouvelle mesure dans la pesanteur filtree. Assez bas pour qu'un
// choc n'y laisse presque rien, assez haut pour qu'un deplacement reel soit vu
// en moins d'une seconde.
static const float SMOOTHING = 0.15f;

Adxl345Sensor::Adxl345Sensor(uint8_t address, float shockG, float tiltDegrees,
                             uint16_t intervalMs, uint16_t holdMs, uint16_t releaseMs,
                             uint16_t disturbMs, uint32_t windowMs)
  : _dev(12345),
    _address(address),
    _shockThreshold(shockG * GRAVITY),
    _tiltDegrees(tiltDegrees),
    _intervalMs(intervalMs),
    _holdMs(holdMs),
    _releaseMs(releaseMs),
    _disturbMs(disturbMs),
    _windowMs(windowMs),
    _present(false),
    _learned(false),
    _restCount(0),
    _restX(0), _restY(0), _restZ(0), _restMag(GRAVITY),
    _fx(0), _fy(0), _fz(0),
    _angle(0),
    _lastSample(0),
    _tiltSince(0),
    _restSince(0),
    _shockUntil(0),
    _level(TamperLevel::Rest),
    _reported(TamperLevel::Rest),
    _lastTriggerAt(0),
    _everTriggered(false),
    _logCount(0),
    _logHead(0) {}

void Adxl345Sensor::begin() {
  _present = _dev.begin(_address);
  if (!_present) return;

  // La plage la plus fine : on mesure une inclinaison, pas un impact de voiture.
  _dev.setRange(ADXL345_RANGE_2_G);
  _dev.setDataRate(ADXL345_DATARATE_100_HZ);

  _lastSample = millis();
  relearnRest();
}

void Adxl345Sensor::relearnRest() {
  _learned   = false;
  _restCount = 0;
  _restX = _restY = _restZ = 0.0f;
  _tiltSince = _restSince = _shockUntil = 0;
  _level = _reported = TamperLevel::Rest;
}

bool Adxl345Sensor::sample(float &x, float &y, float &z) {
  sensors_event_t e;
  if (!_dev.getEvent(&e)) return false;
  x = e.acceleration.x;
  y = e.acceleration.y;
  z = e.acceleration.z;
  return true;
}

uint32_t Adxl345Sensor::msSinceLastTrigger() const {
  if (!_everTriggered) return 0;
  return millis() - _lastTriggerAt;
}

uint16_t Adxl345Sensor::episodesInWindow() const {
  const uint32_t now = millis();
  uint16_t n = 0;
  for (uint8_t i = 0; i < _logCount; i++) {
    if (now - _log[i] <= _windowMs) n++;
  }
  return n;
}

void Adxl345Sensor::logEpisode(uint32_t at) {
  _log[_logHead] = at;
  _logHead = (uint8_t)((_logHead + 1) % LOG_SIZE);
  if (_logCount < LOG_SIZE) _logCount++;
}

ReadStatus Adxl345Sensor::read(TamperReading &out) {
  if (!_present) return ReadStatus::Error;

  const uint32_t now = millis();
  if (now - _lastSample < _intervalMs) return ReadStatus::NotReady;
  _lastSample = now;

  float x, y, z;
  if (!sample(x, y, z)) return ReadStatus::Error;

  // Apprentissage de la position de repos : le boitier doit etre pose.
  if (!_learned) {
    _restX += x; _restY += y; _restZ += z;
    if (++_restCount < REST_SAMPLES) return ReadStatus::NotReady;

    _restX /= REST_SAMPLES; _restY /= REST_SAMPLES; _restZ /= REST_SAMPLES;
    _restMag = sqrtf(_restX * _restX + _restY * _restY + _restZ * _restZ);
    _fx = _restX; _fy = _restY; _fz = _restZ;
    _learned = true;
    return ReadStatus::NotReady;
  }

  // Le choc se lit sur la mesure brute, le deplacement sur la mesure filtree :
  // l'un est un transitoire, l'autre un etat.
  const float mag = sqrtf(x * x + y * y + z * z);
  if (fabsf(mag - _restMag) > _shockThreshold) _shockUntil = now + _disturbMs;

  _fx += (x - _fx) * SMOOTHING;
  _fy += (y - _fy) * SMOOTHING;
  _fz += (z - _fz) * SMOOTHING;

  const float fmag = sqrtf(_fx * _fx + _fy * _fy + _fz * _fz);
  if (fmag > 0.01f && _restMag > 0.01f) {
    float cosine = (_fx * _restX + _fy * _restY + _fz * _restZ) / (fmag * _restMag);
    if (cosine > 1.0f)  cosine = 1.0f;
    if (cosine < -1.0f) cosine = -1.0f;
    _angle = acosf(cosine) * 57.29578f;
  }

  const bool tilted = _angle > _tiltDegrees;
  const bool shaken = (int32_t)(now - _shockUntil) < 0;

  if (tilted) {
    if (_tiltSince == 0) _tiltSince = now;
  } else {
    _tiltSince = 0;
  }

  // Une inclinaison maintenue est un deplacement ; une secousse qui passe n'est
  // qu'une secousse. L'hysteresis evite le papillotement que le contact a bille
  // produisait a chaque vibration.
  TamperLevel next = _level;
  if (_tiltSince != 0 && now - _tiltSince >= _holdMs) {
    next = TamperLevel::Triggered;
  } else if (shaken) {
    if (_level != TamperLevel::Triggered) next = TamperLevel::Disturbed;
  } else if (_level != TamperLevel::Rest && !tilted) {
    if (_restSince == 0) _restSince = now;
    if (now - _restSince >= _releaseMs) next = TamperLevel::Rest;
  }
  if (next != TamperLevel::Rest || tilted || shaken) _restSince = 0;

  if (next == _level) return ReadStatus::NotReady;
  _level = next;

  if (_level != TamperLevel::Rest) {
    logEpisode(now);
    if (_level == TamperLevel::Triggered) {
      _lastTriggerAt = now;
      _everTriggered = true;
    }
  }

  if (_level == _reported) return ReadStatus::NotReady;
  _reported = _level;

  out.level                 = _level;
  out.timestamp_ms          = now;
  out.ms_since_last_trigger = msSinceLastTrigger();
  out.episodes_in_window    = episodesInWindow();
  return ReadStatus::Ok;
}
