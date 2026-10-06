#pragma once

#include "alarm.h"
#include "led.h"
#include "presence.h"
#include "tamper.h"
#include "telemetry.h"

// Deux responsabilites distinctes :
//   report() transmet un evenement sans rien declencher localement,
//   raise()  declenche en plus le buzzer et la LED.
// Les capteurs se contentent de rapporter ; c'est le backend, qui voit les
// trois noeuds, qui decide d'alarmer.
class AlertPolicy {
public:
  AlertPolicy(StatusLed &led, ITelemetrySink &sink);

  void begin();
  void setLinkUp(bool up);
  void idle();

  void report(Family f, State s, const char *detail = nullptr, float value = NAN);
  void report(const char *event, const char *level,
              const char *detail = nullptr, float value = NAN);
  void raise(Family f, State s, const char *detail = nullptr, float value = NAN);

  // Le module n'emet aucun evenement de la famille intrusion : ceux-la
  // viennent de la vision. Presence et secousse relevent du sabotage.
  void onPresence(const PresenceReading &r);
  void onTamper(bool fromTilt, TamperLevel level, uint16_t episodes);

private:
  void applyLed(State s);

  bool            _linkUp;
  StatusLed      &_led;
  ITelemetrySink &_sink;
};
