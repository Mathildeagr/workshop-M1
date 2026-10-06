#include "backend_client.h"
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <math.h>

BackendClient::BackendClient(const WifiLink &link, const char *host, uint16_t port,
                             const char *path, const char *apiKey)
  : _link(link),
    _host(host),
    _port(port),
    _path(path),
    _apiKey(apiKey),
    _head(0),
    _count(0),
    _dropped(0),
    _lastFlush(0) {}

uint16_t BackendClient::pending() const { return _count; }

void BackendClient::enqueue(const Event &e) {
  if (_count == QUEUE_SIZE) {
    // File pleine : on sacrifie le plus ancien, les evenements recents
    // decrivent mieux la situation courante.
    _head = (uint8_t)((_head + 1) % QUEUE_SIZE);
    _count--;
    _dropped++;
  }
  _queue[(_head + _count) % QUEUE_SIZE] = e;
  _count++;
}

bool BackendClient::send(const Event &e) {
  if (!_link.isConnected()) return false;

  char value[24] = "";
  if (!isnan(e.value)) snprintf(value, sizeof(value), ",\"value\":%.2f", (double)e.value);

  char detail[40] = "";
  if (e.detail[0] != '\0') snprintf(detail, sizeof(detail), ",\"detail\":\"%s\"", e.detail);

  char body[192];
  snprintf(body, sizeof(body),
           "{\"event\":\"%s\",\"level\":\"%s\"%s%s,\"uptime_s\":%lu}",
           e.name, e.level, value, detail, (unsigned long)e.uptime_s);

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, _host, _port, _path)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", _apiKey);
  const int code = http.POST((uint8_t *)body, strlen(body));
  http.end();

  // 4xx : le backend a refuse la trame, la rejouer ne changera rien.
  if (code >= 400 && code < 500) {
    Serial.print(F("backend refuse l'evenement, code "));
    Serial.println(code);
    return true;
  }
  return code == 201 || code == 200;
}

void BackendClient::publishEvent(const char *event, const char *level,
                                 const char *detail, float value) {
  Event e;
  strncpy(e.name, event, sizeof(e.name) - 1);
  e.name[sizeof(e.name) - 1] = '\0';
  strncpy(e.level, level, sizeof(e.level) - 1);
  e.level[sizeof(e.level) - 1] = '\0';
  if (detail != nullptr) strncpy(e.detail, detail, sizeof(e.detail) - 1);
  else                   e.detail[0] = '\0';
  e.detail[sizeof(e.detail) - 1] = '\0';
  e.value    = value;
  e.uptime_s = millis() / 1000UL;

  if (!send(e)) enqueue(e);
}

void BackendClient::update() {
  if (_count == 0) return;
  if (!_link.isConnected()) return;

  const uint32_t now = millis();
  if (now - _lastFlush < FLUSH_PERIOD_MS) return;
  _lastFlush = now;

  // Un envoi par passage : la requete est bloquante, inutile de figer la
  // boucle plus longtemps que necessaire.
  if (send(_queue[_head])) {
    _head = (uint8_t)((_head + 1) % QUEUE_SIZE);
    _count--;
  }
}
