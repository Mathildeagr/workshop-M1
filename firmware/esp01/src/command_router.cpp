#include "command_router.h"
#include <ArduinoJson.h>

static bool familyFromTarget(const char *target, Family &f, bool &all) {
  all = false;
  if (strcmp(target, "tout") == 0)          { all = true; return true; }
  if (strcmp(target, "intrusion") == 0)     { f = FAM_INTRUSION; return true; }
  if (strcmp(target, "sabotage") == 0)      { f = FAM_TAMPER;    return true; }
  if (strcmp(target, "environnement") == 0) { f = FAM_ENV;       return true; }
  return false;
}

void CommandRouter::onCommand(const char *payload, size_t length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.println(F("commande illisible"));
    return;
  }

  const char *event = doc["event"];
  if (event == nullptr) return;

  if (strcmp(event, "activate") == 0 || strcmp(event, "deactivate") == 0) {
    const char *target = doc["target"] | "tout";
    const char *signal = doc["signal"] | "tous";

    Family f = FAM_INTRUSION;
    bool all = false;
    if (!familyFromTarget(target, f, all)) {
      Serial.print(F("cible inconnue : "));
      Serial.println(target);
      return;
    }

    const bool enabled = (strcmp(event, "activate") == 0);
    const bool sound   = (strcmp(signal, "sonore") == 0)   || (strcmp(signal, "tous") == 0);
    const bool light   = (strcmp(signal, "lumineux") == 0) || (strcmp(signal, "tous") == 0);
    if (!sound && !light) {
      Serial.print(F("signal inconnu : "));
      Serial.println(signal);
      return;
    }

    _policy.setEnabled(all ? FAM_COUNT : f, sound, light, enabled);
    Serial.print(enabled ? F("active ") : F("coupe "));
    Serial.print(signal);
    Serial.print(' ');
    Serial.println(target);
    return;
  }

  Family f;
  State  s;
  if (alarmLookup(event, f, s)) {
    _policy.raise(f, s, doc["detail"] | (const char *)nullptr, doc["value"] | NAN);
  }
}
