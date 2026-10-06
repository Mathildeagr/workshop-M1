#pragma once

#include "telemetry.h"

// Sortie de secours tant que MQTT n'est pas en place. Remplacable par un
// MqttSink sans toucher au reste du firmware.
class SerialSink : public ITelemetrySink {
public:
  void publish(const TelemetryFrame &frame) override;
  void publishAlert(Family f, State s, const char *detail) override;

private:
  void stamp(uint32_t uptime_s);
};
