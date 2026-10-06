#include "network.h"
#include <ESP8266WiFi.h>

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
    _attempts(0) {
  strncpy(_text, "hors ligne", sizeof(_text) - 1);
  _text[sizeof(_text) - 1] = '\0';
}

void WifiLink::begin() {
  // persistent(false) : sans ca le coeur reecrit les identifiants en flash a
  // chaque demarrage, pour rien.
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  startAttempt();
}

void WifiLink::startAttempt() {
  WiFi.disconnect();
  // config() avant begin(), sinon le DHCP du point d'acces reprend la main.
  WiFi.config(_ip, _gateway, _subnet, _dns);
  WiFi.begin(_ssid, _password);
  _state        = LinkState::Connecting;
  _attemptStart = millis();
  _attempts++;
  refreshText();
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
    // Lien perdu : on repart immediatement en tentative.
    startAttempt();
    return;
  }

  const uint32_t now = millis();
  if (_state == LinkState::Connecting && (now - _attemptStart) >= ATTEMPT_TIMEOUT_MS) {
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
  switch (_state) {
    case LinkState::Up:
      WiFi.localIP().toString().toCharArray(_text, sizeof(_text));
      break;
    case LinkState::Connecting:
      strncpy(_text, "connexion...", sizeof(_text) - 1);
      _text[sizeof(_text) - 1] = '\0';
      break;
    default:
      strncpy(_text, "hors ligne", sizeof(_text) - 1);
      _text[sizeof(_text) - 1] = '\0';
      break;
  }
}

int32_t WifiLink::rssi() const {
  return (_state == LinkState::Up) ? WiFi.RSSI() : 0;
}
