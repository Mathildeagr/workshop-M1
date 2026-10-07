#pragma once

#include <Arduino.h>

enum Jingle : uint8_t {
  JIN_BOOT      = 0,
  JIN_WIFI_OK   = 1,
  JIN_WIFI_FAIL = 2,
  JIN_MQTT_OK   = 3,
  JIN_ACK       = 4,
  JIN_ERROR     = 5,
  JIN_COUNT     = 6
};

uint8_t     jingleCount();
const char *jingleName(uint8_t i);
void        jinglePlay(uint8_t i);
