#include "actuators/led.h"
#include <math.h>

StatusLed::StatusLed(uint8_t pinRed, uint8_t pinGreen)
  : _pinRed(pinRed),
    _pinGreen(pinGreen),
    _color(LedColor::Off),
    _mode(LedMode::Solid),
    _period(1000),
    _since(0),
    _amberRedPct(100),
    _amberGreenPct(45) {}

void StatusLed::begin() {
  pinMode(_pinRed, OUTPUT);
  pinMode(_pinGreen, OUTPUT);
  analogWriteRange(DUTY_MAX);
  analogWriteFreq(500);
  _since = millis();
  off();
}

void StatusLed::off() {
  _color = LedColor::Off;
  _mode  = LedMode::Solid;
  write(0, 0);
}

void StatusLed::set(LedColor c, LedMode m, uint16_t periodMs) {
  if (c != _color || m != _mode || periodMs != _period) {
    _since = millis();
  }
  _color  = c;
  _mode   = m;
  _period = periodMs < 50 ? 50 : periodMs;
}

void StatusLed::setAmberMix(uint8_t redPct, uint8_t greenPct) {
  _amberRedPct   = redPct > 100 ? 100 : redPct;
  _amberGreenPct = greenPct > 100 ? 100 : greenPct;
}

void StatusLed::write(uint16_t redDuty, uint16_t greenDuty) {
  // Aux extremes on coupe la broche : un generateur qui tourne pour un rapport
  // cyclique de 0 ou 100 % ne sert a rien et produit des interruptions.
  if (redDuty == 0)             digitalWrite(_pinRed, LOW);
  else if (redDuty >= DUTY_MAX) digitalWrite(_pinRed, HIGH);
  else                          analogWrite(_pinRed, redDuty);

  if (greenDuty == 0)             digitalWrite(_pinGreen, LOW);
  else if (greenDuty >= DUTY_MAX) digitalWrite(_pinGreen, HIGH);
  else                            analogWrite(_pinGreen, greenDuty);
}

void StatusLed::update() {
  if (_color == LedColor::Off) { write(0, 0); return; }

  const uint32_t e = millis() - _since;
  const float phase = (float)(e % _period) / (float)_period;

  float k = 1.0f;
  switch (_mode) {
    case LedMode::Solid:  k = 1.0f; break;
    case LedMode::Blink:  k = (phase < 0.5f) ? 1.0f : 0.0f; break;
    case LedMode::Flash:  k = ((e % _period) < FLASH_MS) ? 1.0f : 0.0f; break;
    case LedMode::Breath: k = (1.0f - cosf(phase * 2.0f * (float)M_PI)) * 0.5f; break;
  }

  const uint16_t full = (uint16_t)(k * DUTY_MAX);
  switch (_color) {
    case LedColor::Red:   write(full, 0); break;
    case LedColor::Green: write(0, full); break;
    case LedColor::Amber: write((uint16_t)(full * _amberRedPct / 100),
                                (uint16_t)(full * _amberGreenPct / 100)); break;
    default:              write(0, 0); break;
  }
}
