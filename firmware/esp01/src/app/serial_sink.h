#pragma once

#include "app/telemetry.h"

// Sortie de secours tant que MQTT n'est pas en place. Remplacable par un
// MqttSink sans toucher au reste du firmware.
class SerialSink : public ITelemetrySink {
public:
  void publish(const TelemetryFrame &frame) override;
  void publishEvent(const EventRecord &event) override;

private:
  void stamp(uint32_t uptime_s);
};
