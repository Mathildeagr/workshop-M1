#include "alert_policy.h"
#include <math.h>

static const char *levelName(State s) {
  switch (s) {
    case ST_ESCALATED: return "critical";
    case ST_CONFIRMED: return "warning";
    default:           return "info";
  }
}

AlertPolicy::AlertPolicy(StatusLed &led, ITelemetrySink &sink)
  : _linkUp(false), _led(led), _sink(sink) {
  for (uint8_t i = 0; i < FAM_COUNT; i++) {
    _sound[i] = true;
    _light[i] = true;
  }
}

void AlertPolicy::setEnabled(uint8_t family, bool sound, bool light, bool enabled) {
  for (uint8_t i = 0; i < FAM_COUNT; i++) {
    if (family != FAM_COUNT && i != family) continue;
    if (sound) _sound[i] = enabled;
    if (light) _light[i] = enabled;
  }
  if (!enabled && sound) alarmStop();
  if (!enabled && light) idle();
}

void AlertPolicy::begin() {
  idle();
}

void AlertPolicy::setLinkUp(bool up) {
  if (up == _linkUp) return;
  _linkUp = up;
  idle();
}

// Vert dans les deux cas : aucune alerte. Le rythme porte l'etat du reseau.
void AlertPolicy::idle() {
  if (_linkUp) _led.set(LedColor::Green, LedMode::Breath, 4000);
  else         _led.set(LedColor::Green, LedMode::Flash, 2000);
}

void AlertPolicy::applyLed(State s) {
  switch (s) {
    case ST_SUSPECTED: _led.set(LedColor::Amber, LedMode::Blink, 2000); break;
    case ST_CONFIRMED: _led.set(LedColor::Red,   LedMode::Blink,  500); break;
    case ST_ESCALATED: _led.set(LedColor::Red,   LedMode::Solid);       break;
    case ST_CLEARED:   idle();                                          break;
    default: break;
  }
}

void AlertPolicy::report(Family f, State s, const char *detail, float value) {
  _sink.publishEvent(alarmEventName(f, s), levelName(s), detail, value);
}

void AlertPolicy::report(const char *event, const char *level,
                         const char *detail, float value) {
  _sink.publishEvent(event, level, detail, value);
}

void AlertPolicy::raise(Family f, State s, const char *detail, float value) {
  if (_sound[f]) alarmPlay(f, s);
  if (_light[f]) applyLed(s);
  report(f, s, detail, value);
}

// Une presence detectee par le PIR seul ne prouve rien : elle signale une
// activite autour du boitier, pas une intrusion. Elle ne sort donc jamais de
// "a verifier". Rien n'est remonte tant que le capteur n'est pas stabilise.
void AlertPolicy::onPresence(const PresenceReading &r) {
  if (r.settling) return;
  if (r.rising) report(FAM_TAMPER, ST_SUSPECTED, "pir", (float)r.motions_in_window);
  else          report(FAM_TAMPER, ST_CLEARED, "pir");
}

// Une secousse peut etre un coup sur la table, un deplacement maintenu non.
// Masquer l'objectif n'arrive jamais par accident : confirme d'emblee.
void AlertPolicy::onTamper(bool fromTilt, TamperLevel level, uint16_t episodes) {
  const float v = (float)episodes;
  const char *src = fromTilt ? "inclinaison" : "objectif";
  if (level == TamperLevel::Rest) {
    report(FAM_TAMPER, ST_CLEARED, src, v);
  } else if (!fromTilt) {
    report(FAM_TAMPER, ST_CONFIRMED, src, v);
  } else if (level == TamperLevel::Triggered) {
    report(FAM_TAMPER, ST_ESCALATED, src, v);
  } else {
    report(FAM_TAMPER, ST_SUSPECTED, src, v);
  }
}
