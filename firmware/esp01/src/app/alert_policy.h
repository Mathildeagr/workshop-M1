#pragma once

#include "actuators/alarm.h"
#include "actuators/led.h"
#include "sensors/presence.h"
#include "sensors/tamper.h"
#include "app/telemetry.h"

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

  // family = FAM_COUNT pour agir sur toutes les familles.
  void setEnabled(uint8_t family, bool sound, bool light, bool enabled);

  // report : le noeud a constate quelque chose.
  // raise   : le backend a demande de jouer un signal.
  void report(Family f, State s, const char *detail = nullptr, float value = NAN);
  void report(const char *event, const char *level,
              const char *detail = nullptr, float value = NAN);
  void raise(Family f, State s, const char *detail = nullptr, float value = NAN,
             const char *cmdId = nullptr);

  // Accuse une commande qui ne joue aucun signal (reglage des sorties).
  // Sans cet echo, le backend la rejoue puis l'abandonne alors qu'elle a bien
  // ete executee : il ne peut constater l'execution que par le retour du cmd_id.
  void acknowledge(const char *event, const char *cmdId);

  // Le module n'emet aucun evenement de la famille intrusion : ceux-la
  // viennent de la vision. Presence et secousse relevent du sabotage.
  void onPresence(const PresenceReading &r);
  void onTamper(bool fromTilt, TamperLevel level, uint16_t episodes);

private:
  void applyLed(State s);

  bool            _linkUp;
  bool            _sound[FAM_COUNT];
  bool            _light[FAM_COUNT];
  StatusLed      &_led;
  ITelemetrySink &_sink;
};
