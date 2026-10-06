#include "serial_sink.h"
#include <math.h>

void SerialSink::stamp(uint32_t uptime_s) {
  Serial.print('[');
  if (uptime_s < 1000) Serial.print(' ');
  if (uptime_s < 100)  Serial.print(' ');
  Serial.print(uptime_s);
  Serial.print(F(" s] "));
}

void SerialSink::publish(const TelemetryFrame &f) {
  stamp(f.uptime_s);

  Serial.print(F("climat "));
  if (f.climate_valid) {
    Serial.print(f.temperature_c, 1);
    Serial.print(F(" C / "));
    Serial.print(f.humidity_pct, 1);
    Serial.print(F(" % / rosee "));
    Serial.print(f.dew_point_c, 1);
    Serial.print(F(" C"));
  } else {
    Serial.print(F("indisponible"));
  }

  Serial.print(F("  |  gaz "));
  if (!f.gas_valid) {
    Serial.print(F("indisponible"));
  } else if (f.gas_warming) {
    Serial.print(f.gas_raw);
    Serial.print(F(" (chauffe)"));
  } else if (isnan(f.gas_ratio)) {
    Serial.print(f.gas_raw);
    Serial.print(F(" (calibration)"));
  } else {
    Serial.print(f.gas_raw);
    Serial.print(F(" x"));
    Serial.print(f.gas_ratio, 2);
  }
  if (f.gas_saturated) Serial.print(F(" SATURE"));

  Serial.print(F("  |  presence "));
  Serial.print(f.presence ? F("oui") : F("non"));
  if (f.presence_settling) Serial.print(F(" (stabilisation)"));
  Serial.print(F(" x"));
  Serial.print(f.presence_count);

  Serial.print(F("  |  inclinaison "));
  Serial.print(tamperLevelName(f.tilt));
  Serial.print(F("  |  objectif "));
  Serial.print(tamperLevelName(f.optic));

  Serial.print(F("  |  wifi "));
  Serial.println(f.wifi_up ? F("ok") : F("down"));
}

void SerialSink::publishAlert(Family f, State s, const char *detail) {
  stamp(millis() / 1000UL);
  Serial.print(F("ALERTE "));
  Serial.print(alarmEventName(f, s));
  if (detail != nullptr && detail[0] != '\0') {
    Serial.print(F("  "));
    Serial.print(detail);
  }
  Serial.println();
}
