#include "net/mqtt_client.h"
#include <math.h>

static MqttClient *s_self = nullptr;

MqttClient::MqttClient(const WifiLink &link, const char *host, uint16_t port,
                       const char *deviceId, const char *user, const char *password)
  : _link(link),
    _host(host),
    _port(port),
    _deviceId(deviceId),
    _user(user),
    _password(password),
    _mqtt(_net),
    _head(0),
    _count(0),
    _dropped(0),
    _commands(nullptr),
    _lastRetry(0),
    _lastFlush(0) {
  _topicEvents[0] = _topicTelemetry[0] = _topicStatus[0] = _topicCommand[0] = '\0';
  s_self = this;
}

// PubSubClient ne rappelle qu'une fonction libre : on passe par l'instance.
void MqttClient::trampoline(char *topic, uint8_t *payload, unsigned int length) {
  (void)topic;
  if (s_self == nullptr || s_self->_commands == nullptr) return;
  s_self->_commands->onCommand((const char *)payload, length);
}

void MqttClient::begin() {
  snprintf(_topicEvents,    sizeof(_topicEvents),    "sentinel/%s/events",    _deviceId);
  snprintf(_topicTelemetry, sizeof(_topicTelemetry), "sentinel/%s/telemetry", _deviceId);
  snprintf(_topicStatus,    sizeof(_topicStatus),    "sentinel/%s/status",    _deviceId);
  snprintf(_topicCommand,   sizeof(_topicCommand),   "sentinel/%s/command",   _deviceId);

  _mqtt.setServer(_host, _port);
  // La trame de mesures depasse les 256 octets par defaut.
  _mqtt.setBufferSize(BUFFER_SIZE);
  _mqtt.setKeepAlive(15);
  _mqtt.setCallback(trampoline);
}

bool MqttClient::reconnect() {
  if (!_link.isConnected()) return false;

  const uint32_t now = millis();
  if (now - _lastRetry < RETRY_PERIOD_MS) return false;
  _lastRetry = now;

  // Testament : si le noeud disparait sans prevenir, le broker publie
  // "offline" a sa place. C'est ce qui permet au dashboard de signaler un
  // module arrache, que le module lui-meme ne peut evidemment pas annoncer.
  const bool ok = _mqtt.connect(_deviceId, _user, _password,
                                _topicStatus, 1, true, "offline");
  if (ok) {
    _mqtt.publish(_topicStatus, "online", true);
    _mqtt.subscribe(_topicCommand, 1);
    Serial.print(F("broker joint, topic "));
    Serial.println(_topicEvents);
  }
  return ok;
}

bool MqttClient::sendEvent(const Event &e) {
  if (!_mqtt.connected()) return false;

  char value[24] = "";
  if (!isnan(e.value)) snprintf(value, sizeof(value), ",\"value\":%.2f", (double)e.value);

  char detail[40] = "";
  if (e.detail[0] != '\0') snprintf(detail, sizeof(detail), ",\"detail\":\"%s\"", e.detail);

  char body[224];
  snprintf(body, sizeof(body),
           "{\"event\":\"%s\",\"level\":\"%s\"%s%s,"
           "\"origin\":\"%s\",\"uptime_s\":%lu}",
           e.name, e.level, value, detail,
           eventOriginName(e.origin), (unsigned long)e.uptime_s);

  return _mqtt.publish(_topicEvents, body);
}

void MqttClient::enqueue(const Event &e) {
  if (_count == QUEUE_SIZE) {
    _head = (uint8_t)((_head + 1) % QUEUE_SIZE);
    _count--;
    _dropped++;
  }
  _queue[(_head + _count) % QUEUE_SIZE] = e;
  _count++;
}

void MqttClient::publishEvent(const EventRecord &src) {
  Event e;
  strncpy(e.name, src.event, sizeof(e.name) - 1);
  e.name[sizeof(e.name) - 1] = '\0';
  strncpy(e.level, src.level, sizeof(e.level) - 1);
  e.level[sizeof(e.level) - 1] = '\0';
  if (src.detail != nullptr) strncpy(e.detail, src.detail, sizeof(e.detail) - 1);
  else                       e.detail[0] = '\0';
  e.detail[sizeof(e.detail) - 1] = '\0';
  e.value    = src.value;
  e.origin   = src.origin;
  e.uptime_s = millis() / 1000UL;

  if (!sendEvent(e)) enqueue(e);
}

// Les mesures ne sont pas mises en file : une valeur climatique vieille de dix
// minutes n'interesse personne, la suivante arrive dans deux secondes.
void MqttClient::publish(const TelemetryFrame &f) {
  if (!_mqtt.connected()) return;

  char body[BUFFER_SIZE];
  int n = snprintf(body, sizeof(body), "{\"uptime_s\":%lu", (unsigned long)f.uptime_s);

  if (f.climate_valid) {
    n += snprintf(body + n, sizeof(body) - n,
                  ",\"temperature_c\":%.1f,\"humidity_pct\":%.1f,\"dew_point_c\":%.1f",
                  (double)f.temperature_c, (double)f.humidity_pct, (double)f.dew_point_c);
  }
  if (f.gas_valid) {
    n += snprintf(body + n, sizeof(body) - n,
                  ",\"gas_raw\":%u,\"gas_warming\":%s",
                  (unsigned)f.gas_raw, f.gas_warming ? "true" : "false");
    if (!isnan(f.gas_ratio)) {
      n += snprintf(body + n, sizeof(body) - n, ",\"gas_ratio\":%.3f", (double)f.gas_ratio);
    }
  }
  n += snprintf(body + n, sizeof(body) - n,
                ",\"presence\":%s,\"presence_count\":%u,\"tilt\":\"%s\",\"optic\":\"%s\"}",
                f.presence ? "true" : "false", (unsigned)f.presence_count,
                tamperLevelName(f.tilt), tamperLevelName(f.optic));

  if (n > 0 && (size_t)n < sizeof(body)) _mqtt.publish(_topicTelemetry, body);
}

void MqttClient::update() {
  if (!_mqtt.connected()) {
    reconnect();
    return;
  }
  _mqtt.loop();

  if (_count == 0) return;
  const uint32_t now = millis();
  if (now - _lastFlush < FLUSH_PERIOD_MS) return;
  _lastFlush = now;

  if (sendEvent(_queue[_head])) {
    _head = (uint8_t)((_head + 1) % QUEUE_SIZE);
    _count--;
  }
}
