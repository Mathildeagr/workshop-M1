#pragma once

#include <PubSubClient.h>
#include <WiFiClient.h>
#include "command.h"
#include "network.h"
#include "telemetry.h"

// Publie evenements et mesures sur Mosquitto. Le backend est abonne : le noeud
// ne connait pas son adresse et n'a pas a la connaitre.
//
// Les evenements emis hors ligne sont gardes en attente et rejoues des que le
// broker revient : un evenement de sabotage ne doit pas disparaitre parce que
// le point d'acces a clignote.
class MqttClient : public ITelemetrySink {
public:
  MqttClient(const WifiLink &link, const char *host, uint16_t port,
             const char *deviceId, const char *user, const char *password);

  void setCommandSink(ICommandSink *sink) { _commands = sink; }

  void begin() override;
  void update() override;

  void publish(const TelemetryFrame &frame) override;
  void publishEvent(const char *event, const char *level,
                    const char *detail, float value) override;

  bool     isConnected() { return _mqtt.connected(); }
  uint16_t pending() const { return _count; }
  uint16_t dropped() const { return _dropped; }

  const char *topicEvents() const { return _topicEvents; }
  const char *topicTelemetry() const { return _topicTelemetry; }
  const char *topicStatus() const { return _topicStatus; }
  const char *topicCommand() const { return _topicCommand; }

private:
  struct Event {
    char     name[24];
    char     level[9];
    char     detail[24];
    float    value;
    uint32_t uptime_s;   // horodatage relatif : le noeud n'a pas d'heure
  };

  static void trampoline(char *topic, uint8_t *payload, unsigned int length);
  bool reconnect();
  bool sendEvent(const Event &e);
  void enqueue(const Event &e);

  const WifiLink &_link;
  const char     *_host;
  uint16_t        _port;
  const char     *_deviceId;
  const char     *_user;
  const char     *_password;

  WiFiClient   _net;
  PubSubClient _mqtt;

  char _topicEvents[48];
  char _topicTelemetry[48];
  char _topicStatus[48];
  char _topicCommand[48];

  ICommandSink *_commands;

  static const uint8_t QUEUE_SIZE = 8;
  Event    _queue[QUEUE_SIZE];
  uint8_t  _head;
  uint8_t  _count;
  uint16_t _dropped;
  uint32_t _lastRetry;
  uint32_t _lastFlush;

  static const uint32_t RETRY_PERIOD_MS = 3000;
  static const uint32_t FLUSH_PERIOD_MS = 200;
  static const uint16_t BUFFER_SIZE     = 512;
};
