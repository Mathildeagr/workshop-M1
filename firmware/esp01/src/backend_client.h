#pragma once

#include "network.h"
#include "telemetry.h"

// Transmet les evenements au backend en HTTP. Les evenements emis hors ligne
// sont gardes en attente et rejoues des que le lien revient : un evenement de
// sabotage ne doit pas disparaitre parce que le point d'acces a clignote.
class BackendClient : public ITelemetrySink {
public:
  BackendClient(const WifiLink &link, const char *host, uint16_t port,
                const char *path, const char *apiKey);

  void update() override;

  // Pas d'endpoint de mesures cote backend pour l'instant.
  void publish(const TelemetryFrame &frame) override { (void)frame; }

  void publishEvent(const char *event, const char *level,
                    const char *detail, float value) override;

  uint16_t pending() const;
  uint16_t dropped() const { return _dropped; }

private:
  struct Event {
    char     name[24];
    char     level[9];
    char     detail[24];
    float    value;
    uint32_t uptime_s;   // horodatage relatif : le noeud n'a pas d'heure
  };

  bool send(const Event &e);
  void enqueue(const Event &e);

  const WifiLink &_link;
  const char     *_host;
  uint16_t        _port;
  const char     *_path;
  const char     *_apiKey;

  static const uint8_t QUEUE_SIZE = 8;
  Event    _queue[QUEUE_SIZE];
  uint8_t  _head;
  uint8_t  _count;
  uint16_t _dropped;
  uint32_t _lastFlush;

  static const uint32_t FLUSH_PERIOD_MS = 500;
  static const uint16_t HTTP_TIMEOUT_MS = 1500;
};
