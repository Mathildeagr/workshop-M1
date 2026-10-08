#pragma once

#include <Arduino.h>
#include "actuators/alarm.h"
#include "sensors/tamper.h"

// Etat complet du noeud a un instant donne. C'est ce qui partira en JSON sur
// sentinel/esp01/telemetry.
struct TelemetryFrame {
  uint32_t uptime_s;

  bool     climate_valid;
  float    temperature_c;
  float    humidity_pct;
  float    dew_point_c;
  uint32_t climate_age_ms;   // depuis la mesure, pas depuis l'envoi

  bool     gas_valid;
  uint16_t gas_raw;
  float    gas_ratio;
  bool     gas_warming;
  bool     gas_saturated;
  uint32_t gas_age_ms;

  bool     presence;
  bool     presence_settling;
  uint16_t presence_count;

  TamperLevel tilt;
  // Inclinaison mesuree, en degres par rapport a la position apprise au repos.
  // Affichee au moniteur pour pouvoir regler les seuils plutot que les deviner.
  float       tilt_angle_deg;
  TamperLevel optic;

  bool     wifi_up;
};

// Distingue ce que le noeud a constate de ce qu'on lui a demande de jouer.
// Sans ce marqueur, un ordre recu du backend lui revient a l'identique et rien
// ne l'empeche de le renvoyer en boucle.
enum class EventOrigin : uint8_t { Sensor, Command };

inline const char *eventOriginName(EventOrigin o) {
  return o == EventOrigin::Command ? "command" : "sensor";
}

struct EventRecord {
  const char *event;
  const char *level;
  const char *detail;   // nullptr si aucune
  float       value;    // NAN si aucune
  EventOrigin origin;
  const char *cmd_id;   // identifiant de la commande acquittee, nullptr sinon
};

class ITelemetrySink {
public:
  virtual ~ITelemetrySink() {}

  virtual void begin() {}
  virtual void update() {}

  virtual void publish(const TelemetryFrame &frame) = 0;
  virtual void publishEvent(const EventRecord &event) = 0;
};
