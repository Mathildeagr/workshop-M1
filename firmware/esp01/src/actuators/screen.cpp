#include "actuators/screen.h"
#include <Wire.h>
#include <stdio.h>
#include <math.h>

#define FONT_SMALL u8g2_font_6x10_tf
#define FONT_TINY  u8g2_font_4x6_tf
#define FONT_BIG   u8g2_font_logisoso20_tn
#define FONT_MED   u8g2_font_logisoso16_tn

static const int16_t  W         = 128;
static const int16_t  H         = 64;
static const int16_t  HEADER_H  = 13;
static const uint32_t SLIDE_MS  = 420;
static const uint32_t DRAW_MS   = 200;
static const uint32_t SPLASH_MS = 2100;

StatusScreen::StatusScreen(uint8_t i2cAddress, uint32_t pageMs)
  : _u8g2(U8G2_R0, U8X8_PIN_NONE),
    _addr(i2cAddress),
    _pageMs(pageMs),
    _present(false),
    _page(PAGE_CLIMATE),
    _nextPage(PAGE_SYSTEM),
    _sliding(false),
    _slideStart(0),
    _lastSwitch(0),
    _lastDraw(0) {}

bool StatusScreen::begin() {
  // Sonder l'adresse avant d'initialiser : sans ca un ecran mal cable donne un
  // ecran noir sans message.
  Wire.begin();
  Wire.beginTransmission(_addr);
  _present = (Wire.endTransmission() == 0);
  if (!_present) return false;

  _u8g2.setI2CAddress(_addr << 1);
  _u8g2.begin();
  _u8g2.setBusClock(400000);
  _u8g2.setPowerSave(0);
  _u8g2.clearBuffer();
  _u8g2.sendBuffer();

  _lastSwitch = millis();
  _lastDraw   = 0;
  return true;
}

void StatusScreen::drawCentered(int16_t xOff, int16_t y, const char *s) {
  const int16_t w = (int16_t)_u8g2.getStrWidth(s);
  _u8g2.drawStr(xOff + (W - w) / 2, y, s);
}

void StatusScreen::drawHeader(int16_t x, const char *title) {
  _u8g2.drawBox(x, 0, W, HEADER_H);
  _u8g2.setDrawColor(0);
  _u8g2.setFont(FONT_SMALL);
  _u8g2.drawStr(x + 4, 10, title);
  _u8g2.setDrawColor(1);
}

void StatusScreen::drawThermometer(int16_t x, int16_t y) {
  _u8g2.drawRFrame(x, y, 6, 15, 3);
  _u8g2.drawDisc(x + 3, y + 18, 4);
  _u8g2.drawBox(x + 2, y + 7, 3, 9);
}

void StatusScreen::drawDroplet(int16_t x, int16_t y) {
  _u8g2.drawDisc(x + 4, y + 8, 4);
  _u8g2.drawTriangle(x + 4, y, x, y + 8, x + 8, y + 8);
}

void StatusScreen::drawGauge(int16_t x, int16_t y, int16_t w, int16_t h, float pct) {
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;
  _u8g2.drawFrame(x, y, w, h);
  const int16_t inner = w - 4;
  const int16_t fill  = (int16_t)((inner * pct) / 100.0f + 0.5f);
  if (fill > 0) _u8g2.drawBox(x + 2, y + 2, fill, h - 4);
}

void StatusScreen::drawWifi(int16_t cx, int16_t cy, bool up) {
  _u8g2.drawDisc(cx, cy, 1);
  for (uint8_t i = 1; i <= 3; i++) {
    _u8g2.drawCircle(cx, cy, (uint8_t)(i * 3 + 1),
                     U8G2_DRAW_UPPER_LEFT | U8G2_DRAW_UPPER_RIGHT);
  }
  if (!up) _u8g2.drawLine(cx - 8, cy - 9, cx + 8, cy + 1);
}

void StatusScreen::drawClimate(int16_t x, const ScreenData &d) {
  drawHeader(x, "CLIMAT");

  char buf[12];
  drawThermometer(x + 5, HEADER_H + 5);

  _u8g2.setFont(FONT_BIG);
  if (d.climate_valid) snprintf(buf, sizeof(buf), "%.1f", (double)d.temperature_c);
  else                 snprintf(buf, sizeof(buf), "--.-");
  _u8g2.drawStr(x + 22, HEADER_H + 23, buf);

  const int16_t tw = (int16_t)_u8g2.getStrWidth(buf);
  _u8g2.drawCircle(x + 22 + tw + 5, HEADER_H + 7, 2);
  _u8g2.setFont(FONT_SMALL);
  _u8g2.drawStr(x + 22 + tw + 9, HEADER_H + 12, "C");

  drawDroplet(x + 4, HEADER_H + 30);

  _u8g2.setFont(FONT_SMALL);
  if (d.climate_valid) snprintf(buf, sizeof(buf), "%.1f%%", (double)d.humidity_pct);
  else                 snprintf(buf, sizeof(buf), "--.-%%");
  _u8g2.drawStr(x + 18, HEADER_H + 42, buf);

  drawGauge(x + 60, HEADER_H + 34, 64, 9, d.climate_valid ? d.humidity_pct : 0.0f);
}

void StatusScreen::drawSystem(int16_t x, const ScreenData &d) {
  drawHeader(x, "SENTINEL-X");

  char buf[12];
  snprintf(buf, sizeof(buf), "%02u:%02u:%02u",
           (unsigned)d.hh, (unsigned)d.mm, (unsigned)d.ss);

  _u8g2.setFont(FONT_MED);
  drawCentered(x, HEADER_H + 19, buf);

  _u8g2.setFont(FONT_TINY);
  drawCentered(x, HEADER_H + 28, d.wall_clock ? "HEURE LOCALE" : "DEPUIS LE BOOT");

  _u8g2.drawHLine(x + 14, HEADER_H + 33, 100);

  drawWifi(x + 12, H - 4, d.wifi_up);
  _u8g2.setFont(FONT_SMALL);
  _u8g2.drawStr(x + 26, H - 3,
                d.network_text != nullptr ? d.network_text : "hors ligne");
}

void StatusScreen::drawPage(uint8_t page, int16_t x, const ScreenData &d) {
  if (page == PAGE_CLIMATE) drawClimate(x, d);
  else                      drawSystem(x, d);
}

void StatusScreen::splash(void (*tick)()) {
  if (!_present) return;

  const uint32_t t0  = millis();
  const int16_t  cx  = W / 2;
  const int16_t  cy  = 24;
  const float    LEN = 20.0f;

  for (;;) {
    const uint32_t e = millis() - t0;
    if (e >= SPLASH_MS) break;
    const float p = (float)e / (float)SPLASH_MS;

    _u8g2.clearBuffer();

    // Quatre branches en croix droite, puis rotation d'un quart de droit : la
    // figure se construit en X.
    const float gp  = p < 0.5f ? (p / 0.5f) : 1.0f;
    const float ge  = gp * gp * (3.0f - 2.0f * gp);
    const float rot = ge * (float)M_PI_4;

    float len = LEN * ge;
    if (p > 0.5f) len = LEN * (1.0f + 0.06f * sinf((p - 0.5f) * 14.0f));

    for (uint8_t i = 0; i < 4; i++) {
      const float a  = rot + i * (float)M_PI_2;
      const float ca = cosf(a), sa = sinf(a);
      const int16_t x2 = cx + (int16_t)(ca * len);
      const int16_t y2 = cy + (int16_t)(sa * len);
      for (int8_t o = -1; o <= 1; o++) {
        const int16_t ox = (int16_t)(-sa * o);
        const int16_t oy = (int16_t)(ca * o);
        _u8g2.drawLine(cx + ox, cy + oy, x2 + ox, y2 + oy);
      }
    }
    _u8g2.drawDisc(cx, cy, 3);

    if (p > 0.50f && p < 0.80f) {
      const float g = ((p - 0.50f) / 0.30f) * len;
      for (uint8_t i = 0; i < 4; i++) {
        const float a = rot + i * (float)M_PI_2;
        _u8g2.drawDisc(cx + (int16_t)(cosf(a) * g),
                       cy + (int16_t)(sinf(a) * g), 2);
      }
    }

    if (p > 0.55f) {
      const float k = (p - 0.55f) / 0.45f;
      const int16_t half = (int16_t)(k * 64.0f);
      _u8g2.setClipWindow(cx - half, 46, cx + half, H - 1);
      _u8g2.setFont(FONT_SMALL);
      drawCentered(0, 56, "SENTINEL-X");
      _u8g2.setFont(FONT_TINY);
      drawCentered(0, 63, "EDGE NODE  esp01");
      _u8g2.setMaxClipWindow();
    }

    _u8g2.sendBuffer();
    if (tick) tick();
    yield();
  }

  _lastSwitch = millis();
  _lastDraw   = 0;
  _sliding    = false;
  _page       = PAGE_CLIMATE;
  _nextPage   = PAGE_SYSTEM;
}

void StatusScreen::update(const ScreenData &d) {
  if (!_present) return;

  const uint32_t now = millis();

  if (!_sliding && (now - _lastSwitch >= _pageMs)) {
    _sliding    = true;
    _slideStart = now;
    _nextPage   = (uint8_t)((_page + 1) % PAGE_COUNT);
  }

  if (_sliding) {
    float p = (float)(now - _slideStart) / (float)SLIDE_MS;
    if (p >= 1.0f) {
      _page       = _nextPage;
      _sliding    = false;
      _lastSwitch = now;
      p           = 1.0f;
    }
    const float e = p * p * (3.0f - 2.0f * p);
    const int16_t k = (int16_t)(e * W);

    _u8g2.clearBuffer();
    drawPage(_page, -k, d);
    drawPage(_nextPage, W - k, d);
    _u8g2.sendBuffer();
    _lastDraw = now;
    return;
  }

  if (now - _lastDraw >= DRAW_MS) {
    _u8g2.clearBuffer();
    drawPage(_page, 0, d);
    _u8g2.sendBuffer();
    _lastDraw = now;
  }
}
