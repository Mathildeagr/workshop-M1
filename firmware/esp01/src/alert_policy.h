#pragma once

#include "alarm.h"
#include "led.h"
#include "presence.h"
#include "tamper.h"
#include "telemetry.h"

// Traduit les evenements capteurs en alertes, et applique l'alerte au buzzer,
// a la LED et au puits de telemetrie. Point d'entree unique : raise() sera
// aussi appele par les commandes recues du backend.
class AlertPolicy {
public:
  AlertPolicy(StatusLed &led, ITelemetrySink &sink);

  void begin();
  void setLinkUp(bool up);
  void raise(Family f, State s, const char *detail = nullptr);
  void idle();

  void onPresence(const PresenceReading &r);
  void onTamper(bool fromTilt, TamperLevel level);

private:
  void applyLed(State s);

  bool            _linkUp;
  StatusLed      &_led;
  ITelemetrySink &_sink;
};
