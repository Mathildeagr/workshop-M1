#pragma once

#include <MQTT.h>
#include <WiFiClient.h>
#include "app/telemetry.h"
#include "net/command.h"
#include "net/network.h"

// Publie evenements et mesures sur Mosquitto. Le backend est abonne : le noeud
// ne connait pas son adresse et n'a pas a la connaitre.
//
// Evenements en QoS 1 : le broker accuse chaque trame, la bibliotheque
// retransmet jusqu'a l'accuse. Mesures en QoS 0 : la suivante arrive dans deux
// secondes, une perte ne justifie pas de bloquer la boucle.
class MqttClient : public ITelemetrySink {
public:
  MqttClient(const WifiLink &link, const char *host, uint16_t port,
             const char *deviceId, const char *user, const char *password);

  void setCommandSink(ICommandSink *sink) { _commands = sink; }

  void begin() override;
  void update() override;

  void publish(const TelemetryFrame &frame) override;
  void publishEvent(const EventRecord &event) override;

  bool     isConnected() { return _mqtt.connected(); }
  uint16_t pending() const { return _count; }
  uint16_t dropped() const { return _dropped; }

  const char *topicEvents() const { return _topicEvents; }
  const char *topicTelemetry() const { return _topicTelemetry; }
  const char *topicStatus() const { return _topicStatus; }
  const char *topicCommand() const { return _topicCommand; }

private:
  struct Event {
    char        name[24];
    char        level[9];
    char        detail[24];
    float       value;
    EventOrigin origin;
    char        cmd_id[24];
    uint32_t    seq;
    uint32_t    uptime_s;   // horodatage relatif : le noeud n'a pas d'heure
  };

  static void onMessage(MQTTClient *client, char topic[], char bytes[], int length);

  bool reconnect();
  bool sendEvent(const Event &e);
  void enqueue(const Event &e);
  void scheduleRetry(bool sent);

  const WifiLink &_link;
  const char     *_host;
  uint16_t        _port;
  const char     *_deviceId;
  const char     *_user;
  const char     *_password;

  WiFiClient _net;
  MQTTClient _mqtt;

  ICommandSink *_commands;

  char _topicEvents[48];
  char _topicTelemetry[48];
  char _topicStatus[48];
  char _topicCommand[48];

  static const uint8_t QUEUE_SIZE = 8;
  Event    _queue[QUEUE_SIZE];
  uint8_t  _head;
  uint8_t  _count;
  uint16_t _dropped;
  uint32_t _seq;

  uint32_t _nextFlush;
  uint32_t _flushDelay;
  uint32_t _nextRetry;
  uint32_t _connectDelay;

  static const uint16_t BUFFER_SIZE    = 512;
  static const uint16_t ACK_TIMEOUT_MS = 1000;
  static const uint32_t FLUSH_MIN_MS   = 200;
  static const uint32_t FLUSH_MAX_MS   = 5000;
  static const uint32_t CONNECT_MIN_MS = 1000;
  static const uint32_t CONNECT_MAX_MS = 30000;
};
