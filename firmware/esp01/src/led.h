#pragma once

#include <Arduino.h>

enum class LedColor : uint8_t { Off, Red, Green, Amber };

enum class LedMode : uint8_t {
  Solid,
  Blink,    // creneau
  Flash,    // eclat bref et espace
  Breath    // fondu sinusoidal
};

// LED a cathode commune : cathode au GND, chaque anode sur une sortie a travers
// sa resistance.
class StatusLed {
public:
  StatusLed(uint8_t pinRed, uint8_t pinGreen);

  void begin();
  void set(LedColor c, LedMode m, uint16_t periodMs = 1000);
  void off();

  // Un vert parait plus lumineux qu'un rouge a courant egal : sans correction
  // l'orange tire vers le vert.
  void setAmberMix(uint8_t redPct, uint8_t greenPct);

  void update();

  LedColor color() const { return _color; }
  LedMode  mode() const  { return _mode; }

private:
  void write(uint16_t redDuty, uint16_t greenDuty);

  uint8_t  _pinRed;
  uint8_t  _pinGreen;
  LedColor _color;
  LedMode  _mode;
  uint16_t _period;
  uint32_t _since;
  uint8_t  _amberRedPct;
  uint8_t  _amberGreenPct;

  static const uint16_t DUTY_MAX = 1023;
  static const uint16_t FLASH_MS = 90;
};
