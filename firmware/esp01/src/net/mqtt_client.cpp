#include "net/mqtt_client.h"
#include <math.h>

static MqttClient *s_instance = nullptr;

// Repli exponentiel avec gigue. La gigue evite que plusieurs noeuds retentent
// en phase apres une coupure commune et achevent le broker au retour.
static uint32_t backoff(uint32_t current, uint32_t maximum) {
  const uint32_t doubled = current * 2 > maximum ? maximum : current * 2;
  return doubled;
}

static uint32_t jitter(uint32_t delay) {
  return (delay * 3) / 4 + (uint32_t)random(delay / 2);
}

MqttClient::MqttClient(const WifiLink &link, const char *host, uint16_t port,
                       const char *deviceId, const char *user, const char *password)
  : _link(link),
    _host(host),
    _port(port),
    _deviceId(deviceId),
    _user(user),
    _password(password),
    _mqtt(BUFFER_SIZE),
    _commands(nullptr),
    _head(0),
    _count(0),
    _dropped(0),
    _seq(0),
    _nextFlush(0),
    _flushDelay(FLUSH_MIN_MS),
    _nextRetry(0),
    _connectDelay(CONNECT_MIN_MS) {
  _topicEvents[0] = _topicTelemetry[0] = _topicStatus[0] = _topicCommand[0] = '\0';
  s_instance = this;
}

void MqttClient::onMessage(MQTTClient *client, char topic[], char bytes[], int length) {
  (void)client;
  (void)topic;
  if (s_instance == nullptr || s_instance->_commands == nullptr) return;
  s_instance->_commands->onCommand(bytes, (size_t)length);
}

void MqttClient::begin() {
  snprintf(_topicEvents,    sizeof(_topicEvents),    "sentinel/%s/events",    _deviceId);
  snprintf(_topicTelemetry, sizeof(_topicTelemetry), "sentinel/%s/telemetry", _deviceId);
  snprintf(_topicStatus,    sizeof(_topicStatus),    "sentinel/%s/status",    _deviceId);
  snprintf(_topicCommand,   sizeof(_topicCommand),   "sentinel/%s/command",   _deviceId);

  _mqtt.begin(_host, _port, _net);
  _mqtt.onMessageAdvanced(onMessage);

  _mqtt.setOptions(15, true, ACK_TIMEOUT_MS);

  // Si le noeud disparait sans prevenir, le broker publie "offline" a sa place.
  _mqtt.setWill(_topicStatus, "offline", true, 1);
}

bool MqttClient::reconnect() {
  if (!_link.isConnected()) return false;

  const uint32_t now = millis();
  if ((int32_t)(now - _nextRetry) < 0) return false;

  const bool anonymous = (_user == nullptr || _user[0] == '\0');
  const bool ok = anonymous ? _mqtt.connect(_deviceId)
                            : _mqtt.connect(_deviceId, _user, _password);

  if (ok) {
    _connectDelay = CONNECT_MIN_MS;
    _mqtt.publish(_topicStatus, "online", true, 1);
    _mqtt.subscribe(_topicCommand, 1);
    Serial.print(F("broker joint, topic "));
    Serial.println(_topicEvents);
  } else {
    _connectDelay = backoff(_connectDelay, CONNECT_MAX_MS);
    _nextRetry = now + jitter(_connectDelay);
  }
  return ok;
}

bool MqttClient::sendEvent(const Event &e) {
  if (!_mqtt.connected()) return false;

  char value[24] = "";
  if (!isnan(e.value)) snprintf(value, sizeof(value), ",\"value\":%.2f", (double)e.value);

  char detail[40] = "";
  if (e.detail[0] != '\0') snprintf(detail, sizeof(detail), ",\"detail\":\"%s\"", e.detail);

  char body[256];
  snprintf(body, sizeof(body),
           "{\"event\":\"%s\",\"level\":\"%s\"%s%s,"
           "\"origin\":\"%s\",\"seq\":%lu,\"uptime_s\":%lu}",
           e.name, e.level, value, detail, eventOriginName(e.origin),
           (unsigned long)e.seq, (unsigned long)e.uptime_s);

  // QoS 1 : bloque jusqu'a l'accuse du broker, au plus ACK_TIMEOUT_MS.
  return _mqtt.publish(_topicEvents, body, false, 1);
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

void MqttClient::scheduleRetry(bool sent) {
  _flushDelay = sent ? FLUSH_MIN_MS : backoff(_flushDelay, FLUSH_MAX_MS);
  _nextFlush  = millis() + jitter(_flushDelay);
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
  e.seq      = ++_seq;   // un trou dans la suite signale une perte au backend
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

  if (n > 0 && (size_t)n < sizeof(body)) _mqtt.publish(_topicTelemetry, body, false, 0);
}

void MqttClient::update() {
  if (!_mqtt.connected()) {
    reconnect();
    return;
  }
  _mqtt.loop();

  if (_count == 0) return;
  if ((int32_t)(millis() - _nextFlush) < 0) return;

  // Un envoi par passage : la publication en QoS 1 attend l'accuse du broker,
  // inutile de retenir la boucle plus longtemps.
  const bool sent = sendEvent(_queue[_head]);
  if (sent) {
    _head = (uint8_t)((_head + 1) % QUEUE_SIZE);
    _count--;
  }
  scheduleRetry(sent);
}
