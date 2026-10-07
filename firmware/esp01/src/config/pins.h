#pragma once

#include <Arduino.h>

// Plan complet et contraintes de demarrage : docs/branchements-esp01.md
#define PIN_BUZZER    D8   // GPIO15 : tirage externe bas, donc muet au boot
#define PIN_DHT       D5
#define PIN_PIR       D6
#define PIN_MQ2       A0
#define PIN_TILT      D3   // GPIO0 : contact OUVERT au repos, sinon pas de boot
#define PIN_OPTIC     D0   // GPIO16 : tirage externe 10k vers 3V
#define PIN_LED_RED   D7
#define PIN_LED_GREEN D4
