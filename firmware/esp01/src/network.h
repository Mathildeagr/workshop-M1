#pragma once

#include <Arduino.h>
#include <IPAddress.h>

enum class LinkState : uint8_t {
  Down,
  Connecting,
  Up
};

// Association Wi-Fi en adressage fixe, sans jamais bloquer la boucle
// principale et sans jamais abandonner : le noeud doit se raccrocher seul
// apres une coupure du point d'acces.
class WifiLink {
public:
  WifiLink(const char *ssid, const char *password,
           IPAddress ip, IPAddress gateway, IPAddress subnet, IPAddress dns);

  void begin();
  void update();

  LinkState   state() const { return _state; }
  bool        isConnected() const { return _state == LinkState::Up; }
  const char *statusText() const { return _text; }   // IP, ou l'etat en cours
  uint16_t    attempts() const { return _attempts; }
  int32_t     rssi() const;

private:
  void startAttempt();
  void refreshText();

  const char *_ssid;
  const char *_password;
  IPAddress   _ip;
  IPAddress   _gateway;
  IPAddress   _subnet;
  IPAddress   _dns;

  LinkState _state;
  uint32_t  _attemptStart;
  uint16_t  _attempts;
  char      _text[20];

  static const uint32_t ATTEMPT_TIMEOUT_MS = 12000;
  static const uint32_t RETRY_DELAY_MS     = 3000;
};
