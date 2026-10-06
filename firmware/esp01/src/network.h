#pragma once

#include <Arduino.h>
#include <IPAddress.h>

enum class LinkState : uint8_t {
  Down,
  Connecting,
  Up
};

class WifiLink {
public:
  WifiLink(const char *ssid, const char *password,
           IPAddress ip, IPAddress gateway, IPAddress subnet, IPAddress dns);

  void begin();
  void update();

  LinkState   state() const { return _state; }
  bool        isConnected() const { return _state == LinkState::Up; }
  // Libelle d'etat, sans adresse : destine a l'affichage.
  const char *statusText() const { return _text; }
  // Adresse IP, reservee au journal serie.
  const char *ipText() const { return _ipText; }
  uint16_t    attempts() const { return _attempts; }
  int32_t     rssi() const;

private:
  void startAttempt();
  void refreshText();
  void reportProgress();
  void scanOnce();

  const char *_ssid;
  const char *_password;
  IPAddress   _ip;
  IPAddress   _gateway;
  IPAddress   _subnet;
  IPAddress   _dns;

  LinkState _state;
  uint32_t  _attemptStart;
  uint32_t  _lastReport;
  uint16_t  _attempts;
  bool      _scanned;
  char      _text[16];
  char      _ipText[16];

  static const uint32_t ATTEMPT_TIMEOUT_MS = 12000;
  static const uint32_t RETRY_DELAY_MS     = 3000;
  static const uint32_t REPORT_PERIOD_MS   = 2000;
  static const uint16_t SCAN_AFTER_ATTEMPT = 3;
};
