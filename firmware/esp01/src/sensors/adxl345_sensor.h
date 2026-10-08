#pragma once

#include <Adafruit_ADXL345_U.h>
#include "sensors/tamper.h"

// Accelerometre trois axes a la place du contact a bille.
//
// Le contact disait seulement « ferme » ou « ouvert », et il fallait le monter
// sur GPIO0, critique au demarrage. Celui-ci est en I2C, donc il partage le bus
// de l'ecran et ne coute aucune broche numerique.
//
// Il mesure deux choses sans rapport, qui alimentent les deux niveaux deja
// definis :
//
//   - l'ecart instantane a la pesanteur au repos : un choc, une vibration,
//     quelqu'un qui bouscule le boitier          -> Disturbed
//   - l'angle entre la pesanteur filtree et celle apprise au repos : le
//     boitier a ete deplace, et il y reste       -> Triggered
//
// Un choc passe et revient ; une inclinaison maintenue ne revient pas. C'est
// cette difference que le contact a bille ne savait pas faire.
class Adxl345Sensor : public ITamperSensor {
public:
  Adxl345Sensor(uint8_t  address     = 0x53,
                float    shockG      = 0.35f,   // ecart a la pesanteur, en g
                float    tiltDegrees = 12.0f,   // au-dela, le boitier a bouge
                uint16_t intervalMs  = 20,
                uint16_t holdMs      = 300,     // inclinaison a confirmer
                uint16_t releaseMs   = 800,     // retour au repos, hysteresis
                uint16_t disturbMs   = 400,     // duree pendant laquelle un choc compte
                uint32_t windowMs    = 5UL * 60UL * 1000UL);

  void        begin() override;
  ReadStatus  read(TamperReading &out) override;
  const char *name() const override { return "ADXL345"; }

  TamperLevel level() const override { return _level; }
  uint32_t    msSinceLastTrigger() const override;
  uint16_t    episodesInWindow() const override;
  void        relearnRest() override;

  bool  present() const { return _present; }
  float tiltDegrees() const { return _angle; }   // inclinaison courante, pour le journal

private:
  void logEpisode(uint32_t at);
  bool sample(float &x, float &y, float &z);

  Adafruit_ADXL345_Unified _dev;
  uint8_t  _address;
  float    _shockThreshold;   // en m/s2, converti depuis les g a la construction
  float    _tiltDegrees;
  uint16_t _intervalMs;
  uint16_t _holdMs;
  uint16_t _releaseMs;
  uint16_t _disturbMs;
  uint32_t _windowMs;

  bool     _present;
  bool     _learned;
  uint8_t  _restCount;
  float    _restX, _restY, _restZ, _restMag;

  // Pesanteur filtree : un choc ne doit pas se lire comme un deplacement.
  float    _fx, _fy, _fz;
  float    _angle;

  uint32_t _lastSample;
  uint32_t _tiltSince;      // 0 : pas d'inclinaison en cours
  uint32_t _restSince;
  uint32_t _shockUntil;

  TamperLevel _level;
  TamperLevel _reported;

  uint32_t _lastTriggerAt;
  bool     _everTriggered;

  static const uint8_t LOG_SIZE = 16;
  uint32_t _log[LOG_SIZE];
  uint8_t  _logCount;
  uint8_t  _logHead;
};
