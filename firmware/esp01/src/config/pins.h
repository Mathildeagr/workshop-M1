#pragma once

#include <Arduino.h>

// Plan complet et contraintes de demarrage : docs/branchements-esp01.md
#define PIN_BUZZER    D8   // GPIO15 : tirage externe bas, donc muet au boot
#define PIN_DHT       D5
#define PIN_PIR       D6
#define PIN_MQ2       A0
// D3 (GPIO0) est libre depuis que l'inclinaison passe par l'ADXL345, en I2C sur
// le bus de l'ecran. C'etait la broche critique au demarrage : plus de risque.
#define PIN_OPTIC     D0   // GPIO16 : tirage externe 10k vers 3V
#define PIN_LED_RED   D7
#define PIN_LED_GREEN D4
