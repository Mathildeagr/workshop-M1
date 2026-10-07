#include "net/mqtt_client.h"
#include <time.h>
#include <math.h>

static MqttClient *s_instance = nullptr;

// Repli exponentiel avec gigue. La gigue evite que plusieurs noeuds retentent
// en phase apres une coupure commune et achevent le broker au retour.
static uint32_t backoff(uint32_t current, uint32_t maximum) {
  const uint32_t doubled = current * 2 > maximum ? maximum : current * 2;
  return doubled;
}

// Rappel du blocage toutes les trente secondes, pas a chaque passage de boucle.
static const uint32_t CLOCK_NOTICE_MS = 30000;

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

#if MQTT_TLS
  // Le certificat est en flash : BearSSL veut une chaine en memoire vive pour
  // l'analyser, mais ne garde ensuite que sa forme interne.
  const size_t pemLength = strlen_P(MQTT_CA_CERT);
  char *pem = (char *)malloc(pemLength + 1);
  if (pem != nullptr) {
    strcpy_P(pem, MQTT_CA_CERT);
    _trust = new BearSSL::X509List(pem);
    free(pem);
    _net.setTrustAnchors(_trust);
  } else {
    Serial.println(F("TLS : memoire insuffisante pour l'autorite"));
  }
  // Les tampons restent a leur taille par defaut, 16 Ko en reception. Les
  // reduire n'est sur que si le serveur accepte de limiter la taille de ses
  // enregistrements, ce que la pile TLS de Go ne sait pas faire : il en envoie
  // alors de plus gros que le tampon, et la session se corrompt en silence.
  // C'est ce qui donnait un "bad record MAC" cote Traefik.
#endif

  _mqtt.begin(_host, _port, _net);
  _mqtt.onMessageAdvanced(onMessage);

  // Session persistante : le broker garde notre abonnement et met de cote les
  // commandes en QoS 1 emises pendant une coupure, puis les delivre au retour.
  _mqtt.setOptions(15, false, ACK_TIMEOUT_MS);

  // Si le noeud disparait sans prevenir, le broker publie "offline" a sa place.
  _mqtt.setWill(_topicStatus, "offline", true, 1);
}

bool MqttClient::reconnect() {
  if (!_link.isConnected()) return false;

#if MQTT_TLS
  // TLS verifie les dates de validite du certificat, et l'horloge du nœud part
  // a 1970. Tenter la poignee de main avant la synchronisation la ferait
  // echouer sans rien dire d'utile : on attend l'heure.
  if (_clock == nullptr || !_clock->hasWallClock()) {
    // Repete, et pas une seule fois : qui branche le moniteur apres coup doit
    // comprendre pourquoi le nœud se tait. C'est la panne la plus deroutante
    // qu'on puisse avoir ici, parce que tout le reste a l'air normal.
    const uint32_t now = millis();
    if (_clockNotice == 0 || (int32_t)(now - _clockNotice) >= 0) {
      Serial.print(F("en attente de l'heure (NTP "));
      Serial.print(NTP_SERVER);
      Serial.println(F(") avant de joindre le broker en TLS"));
      _clockNotice = now + CLOCK_NOTICE_MS;
    }
    return false;
  }
#endif

  const uint32_t now = millis();
  if ((int32_t)(now - _nextRetry) < 0) return false;

  const bool anonymous = (_user == nullptr || _user[0] == '\0');
  const bool ok = anonymous ? _mqtt.connect(_deviceId)
                            : _mqtt.connect(_deviceId, _user, _password);

  if (ok) {
    _connectDelay = CONNECT_MIN_MS;
    _mqtt.publish(_topicStatus, "online", true, 1);
    _mqtt.subscribe(_topicCommand, 1);
#if MQTT_TLS
    Serial.print(F("broker joint en TLS, topic "));
#else
    Serial.print(F("broker joint, topic "));
#endif
    Serial.print(_topicEvents);
    // Le cout du TLS est a l'execution, pas a la compilation : la poignee de
    // main vient de passer, c'est le moment ou le tas est le plus sollicite.
    Serial.print(F("  (tas libre "));
    Serial.print(ESP.getFreeHeap());
    Serial.println(F(" o)"));
  } else {
#if MQTT_TLS
    // Un echec TLS est muet par nature : sans ce code, on chercherait longtemps.
    char reason[80];
    const int err = _net.getLastSSLError(reason, sizeof(reason));
    Serial.print(F("broker refuse, tas libre "));
    Serial.print(ESP.getFreeHeap());
    if (err != 0) {
      Serial.print(F(", TLS ("));
      Serial.print(err);
      Serial.print(F(") "));
      Serial.print(reason);
    }
    Serial.println();
#endif
    _connectDelay = backoff(_connectDelay, CONNECT_MAX_MS);
    _nextRetry = now + jitter(_connectDelay);
  }
  return ok;
}

// Une date absente vaut mieux qu'une date fausse : tant que le NTP n'a pas
// repondu, le champ ne figure pas et le backend horodate a la reception.
size_t MqttClient::isoTimestamp(char *buffer, size_t len) const {
  if (_clock == nullptr || !_clock->hasWallClock()) return 0;
  const time_t now = (time_t)_clock->epoch();
  if (now == 0) return 0;

  struct tm utc;
  gmtime_r(&now, &utc);
  return strftime(buffer, len, "%Y-%m-%dT%H:%M:%SZ", &utc);
}

bool MqttClient::sendEvent(const Event &e) {
  if (!_mqtt.connected()) return false;

  char value[24] = "";
  if (!isnan(e.value)) snprintf(value, sizeof(value), ",\"value\":%.2f", (double)e.value);

  char detail[40] = "";
  if (e.detail[0] != '\0') snprintf(detail, sizeof(detail), ",\"detail\":\"%s\"", e.detail);

  char ack[40] = "";
  if (e.cmd_id[0] != '\0') snprintf(ack, sizeof(ack), ",\"cmd_id\":\"%s\"", e.cmd_id);

  char stamp[40] = "";
  char iso[24];
  if (isoTimestamp(iso, sizeof(iso))) snprintf(stamp, sizeof(stamp), ",\"ts\":\"%s\"", iso);

  char body[352];
  snprintf(body, sizeof(body),
           "{\"event\":\"%s\",\"level\":\"%s\"%s%s%s%s,"
           "\"origin\":\"%s\",\"seq\":%lu,\"uptime_s\":%lu}",
           e.name, e.level, value, detail, ack, stamp, eventOriginName(e.origin),
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
  if (src.cmd_id != nullptr) strncpy(e.cmd_id, src.cmd_id, sizeof(e.cmd_id) - 1);
  else                       e.cmd_id[0] = '\0';
  e.cmd_id[sizeof(e.cmd_id) - 1] = '\0';
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

  char iso[24];
  if (isoTimestamp(iso, sizeof(iso))) {
    n += snprintf(body + n, sizeof(body) - n, ",\"ts\":\"%s\"", iso);
  }

  if (f.climate_valid) {
    n += snprintf(body + n, sizeof(body) - n,
                  ",\"temperature_c\":%.1f,\"humidity_pct\":%.1f,\"dew_point_c\":%.1f"
                  ",\"climate_age_ms\":%lu",
                  (double)f.temperature_c, (double)f.humidity_pct, (double)f.dew_point_c,
                  (unsigned long)f.climate_age_ms);
  }
  if (f.gas_valid) {
    n += snprintf(body + n, sizeof(body) - n,
                  ",\"gas_raw\":%u,\"gas_warming\":%s,\"gas_age_ms\":%lu",
                  (unsigned)f.gas_raw, f.gas_warming ? "true" : "false",
                  (unsigned long)f.gas_age_ms);
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
