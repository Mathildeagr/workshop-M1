#include "alert_policy.h"

AlertPolicy::AlertPolicy(StatusLed &led, ITelemetrySink &sink)
  : _linkUp(false), _led(led), _sink(sink) {}

void AlertPolicy::begin() {
  idle();
}

void AlertPolicy::setLinkUp(bool up) {
  if (up == _linkUp) return;
  _linkUp = up;
  idle();
}

// Au repos : respiration verte quand le lien est etabli, eclat bref sinon.
// Le vert dit qu'aucune alerte n'est en cours, le rythme dit l'etat du reseau.
// Une respiration se voit de loin sans accrocher l'oeil comme un clignotement.
void AlertPolicy::idle() {
  if (_linkUp) _led.set(LedColor::Green, LedMode::Breath, 4000);
  else         _led.set(LedColor::Green, LedMode::Flash, 2000);
}

void AlertPolicy::applyLed(State s) {
  switch (s) {
    case ST_SUSPECTED: _led.set(LedColor::Amber, LedMode::Blink, 2000); break;
    case ST_CONFIRMED: _led.set(LedColor::Red,   LedMode::Blink,  500); break;
    case ST_ESCALATED: _led.set(LedColor::Red,   LedMode::Solid);       break;
    case ST_CLEARED:   _led.set(LedColor::Green, LedMode::Solid);       break;
    default: break;
  }
}

void AlertPolicy::raise(Family f, State s, const char *detail) {
  alarmPlay(f, s);
  applyLed(s);
  _sink.publishAlert(f, s, detail);
}

// Le PIR seul ne prouve rien, c'est la vision qui confirmera : "a verifier" et
// non "confirme". Rien n'est leve tant que le capteur n'est pas stabilise.
void AlertPolicy::onPresence(const PresenceReading &r) {
  if (r.settling) return;
  if (r.rising) raise(FAM_INTRUSION, ST_SUSPECTED, "pir");
  else          raise(FAM_INTRUSION, ST_CLEARED,   "zone vide");
}

// Une secousse peut etre un coup sur la table, un deplacement maintenu non.
// Masquer l'objectif n'arrive jamais par accident : confirme d'emblee.
void AlertPolicy::onTamper(bool fromTilt, TamperLevel level) {
  if (level == TamperLevel::Rest) {
    raise(FAM_TAMPER, ST_CLEARED, fromTilt ? "inclinaison" : "objectif");
    return;
  }
  if (!fromTilt) {
    raise(FAM_TAMPER, ST_CONFIRMED, "objectif masque");
    return;
  }
  if (level == TamperLevel::Triggered) raise(FAM_TAMPER, ST_ESCALATED, "module deplace");
  else                                 raise(FAM_TAMPER, ST_SUSPECTED, "secousse");
}
