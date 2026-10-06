#include "network.h"
#include <ESP8266WiFi.h>

static const char *statusName(int s) {
  switch (s) {
    case WL_IDLE_STATUS:     return "inactif";
    case WL_NO_SSID_AVAIL:   return "SSID introuvable";
    case WL_SCAN_COMPLETED:  return "scan termine";
    case WL_CONNECTED:       return "connecte";
    case WL_CONNECT_FAILED:  return "echec, mot de passe probablement faux";
    case WL_CONNECTION_LOST: return "lien perdu";
    case WL_WRONG_PASSWORD:  return "mot de passe refuse";
    case WL_DISCONNECTED:    return "deconnecte";
    default:                 return "inconnu";
  }
}

WifiLink::WifiLink(const char *ssid, const char *password,
                   IPAddress ip, IPAddress gateway, IPAddress subnet, IPAddress dns)
  : _ssid(ssid),
    _password(password),
    _ip(ip),
    _gateway(gateway),
    _subnet(subnet),
    _dns(dns),
    _state(LinkState::Down),
    _attemptStart(0),
    _lastReport(0),
    _attempts(0),
    _scanned(false) {
  strncpy(_text, "hors ligne", sizeof(_text) - 1);
  _text[sizeof(_text) - 1] = '\0';
  strncpy(_ipText, "0.0.0.0", sizeof(_ipText) - 1);
  _ipText[sizeof(_ipText) - 1] = '\0';
}

void WifiLink::begin() {
  // Evite de reecrire les identifiants en flash a chaque demarrage.
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  // Les reprises sont gerees ici, pas par le coeur.
  WiFi.setAutoReconnect(false);

  Serial.print(F("reset : "));
  Serial.println(ESP.getResetReason());

  startAttempt();
}

void WifiLink::startAttempt() {
  WiFi.disconnect(false);
  // Avant begin(), sinon le DHCP du point d'acces reprend la main.
  WiFi.config(_ip, _gateway, _subnet, _dns);
  WiFi.begin(_ssid, _password);
  _state        = LinkState::Connecting;
  _attemptStart = millis();
  _attempts++;
  _lastReport = millis();
  refreshText();

  Serial.print(F("wifi tentative "));
  Serial.print(_attempts);
  Serial.print(F(" vers "));
  Serial.println(_ssid);
}

void WifiLink::scanOnce() {
  if (_scanned) return;
  _scanned = true;

  Serial.println(F("reseaux visibles :"));
  const int n = WiFi.scanNetworks();
  if (n <= 0) {
    Serial.println(F("  aucun. L'ESP8266 ne voit que le 2,4 GHz."));
    return;
  }
  for (int i = 0; i < n; i++) {
    Serial.print(F("  "));
    Serial.print(WiFi.SSID(i));
    Serial.print(F("  "));
    Serial.print(WiFi.RSSI(i));
    Serial.print(F(" dBm  canal "));
    Serial.print(WiFi.channel(i));
    Serial.println(WiFi.encryptionType(i) == ENC_TYPE_NONE ? F("  ouvert") : F(""));
  }
  WiFi.scanDelete();
}

void WifiLink::reportProgress() {
  const uint32_t now = millis();
  if (now - _lastReport < REPORT_PERIOD_MS) return;
  _lastReport = now;

  Serial.print(F("wifi "));
  Serial.print(statusName(WiFi.status()));
  Serial.print(F(" (tentative "));
  Serial.print(_attempts);
  Serial.println(')');
}

void WifiLink::update() {
  const bool up = (WiFi.status() == WL_CONNECTED);

  if (up) {
    if (_state != LinkState::Up) {
      _state = LinkState::Up;
      refreshText();
    }
    return;
  }

  if (_state == LinkState::Up) {
    startAttempt();
    return;
  }

  reportProgress();

  const uint32_t now = millis();
  if (_state == LinkState::Connecting && (now - _attemptStart) >= ATTEMPT_TIMEOUT_MS) {
    if (_attempts >= SCAN_AFTER_ATTEMPT) scanOnce();
    _state        = LinkState::Down;
    _attemptStart = now;
    refreshText();
    return;
  }
  if (_state == LinkState::Down && (now - _attemptStart) >= RETRY_DELAY_MS) {
    startAttempt();
  }
}

void WifiLink::refreshText() {
  const char *label;
  switch (_state) {
    case LinkState::Up:
      label = "connecte";
      WiFi.localIP().toString().toCharArray(_ipText, sizeof(_ipText));
      break;
    case LinkState::Connecting: label = "connexion..."; break;
    default:                    label = "hors ligne";  break;
  }
  strncpy(_text, label, sizeof(_text) - 1);
  _text[sizeof(_text) - 1] = '\0';
}

int32_t WifiLink::rssi() const {
  return (_state == LinkState::Up) ? WiFi.RSSI() : 0;
}
