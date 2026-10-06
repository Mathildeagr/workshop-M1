#pragma once

#include <U8g2lib.h>

// L'ecran ne connait aucun capteur : il recoit des valeurs deja pretes.
struct ScreenData {
  bool     climate_valid;
  float    temperature_c;
  float    humidity_pct;
  bool     wifi_up;
  uint8_t  hh, mm, ss;
  bool     wall_clock;
};

class StatusScreen {
public:
  explicit StatusScreen(uint8_t i2cAddress = 0x3C, uint32_t pageMs = 5000);

  bool begin();
  bool isPresent() const { return _present; }

  // Bornee a 2 s. Seul endroit bloquant du firmware, rien d'autre ne tourne
  // encore. tick() laisse le moteur sonore avancer pendant l'animation.
  void splash(void (*tick)() = nullptr);

  void update(const ScreenData &d);

private:
  enum Page : uint8_t { PAGE_CLIMATE = 0, PAGE_SYSTEM = 1, PAGE_COUNT = 2 };

  void drawPage(uint8_t page, int16_t x, const ScreenData &d);
  void drawClimate(int16_t x, const ScreenData &d);
  void drawSystem(int16_t x, const ScreenData &d);
  void drawHeader(int16_t x, const char *title);
  void drawThermometer(int16_t x, int16_t y);
  void drawDroplet(int16_t x, int16_t y);
  void drawGauge(int16_t x, int16_t y, int16_t w, int16_t h, float pct);
  void drawWifi(int16_t cx, int16_t cy, bool up);
  void drawCentered(int16_t xOff, int16_t y, const char *s);

  U8G2_SSD1306_128X64_NONAME_F_HW_I2C _u8g2;
  uint8_t  _addr;
  uint32_t _pageMs;
  bool     _present;

  uint8_t  _page;
  uint8_t  _nextPage;
  bool     _sliding;
  uint32_t _slideStart;
  uint32_t _lastSwitch;
  uint32_t _lastDraw;
};
