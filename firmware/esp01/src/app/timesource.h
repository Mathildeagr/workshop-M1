#pragma once

#include <Arduino.h>

class ITimeSource {
public:
  virtual ~ITimeSource() {}

  virtual void begin() {}

  // false : la valeur rendue est une duree depuis le demarrage.
  virtual bool hasWallClock() const = 0;

  virtual void     hms(uint8_t &hh, uint8_t &mm, uint8_t &ss) const = 0;
  virtual uint32_t uptimeSeconds() const = 0;
};

class UptimeClock : public ITimeSource {
public:
  bool hasWallClock() const override { return false; }

  uint32_t uptimeSeconds() const override { return millis() / 1000UL; }

  void hms(uint8_t &hh, uint8_t &mm, uint8_t &ss) const override {
    const uint32_t t = uptimeSeconds();
    hh = (uint8_t)((t / 3600UL) % 100UL);
    mm = (uint8_t)((t / 60UL) % 60UL);
    ss = (uint8_t)(t % 60UL);
  }
};
