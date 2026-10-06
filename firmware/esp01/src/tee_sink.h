#pragma once

#include "telemetry.h"

// Diffuse vers deux puits : le journal serie reste disponible quand le backend
// est injoignable.
class TeeSink : public ITelemetrySink {
public:
  TeeSink(ITelemetrySink &first, ITelemetrySink &second)
    : _first(first), _second(second) {}

  void begin() override  { _first.begin();  _second.begin(); }
  void update() override { _first.update(); _second.update(); }

  void publish(const TelemetryFrame &frame) override {
    _first.publish(frame);
    _second.publish(frame);
  }

  void publishEvent(const EventRecord &event) override {
    _first.publishEvent(event);
    _second.publishEvent(event);
  }

private:
  ITelemetrySink &_first;
  ITelemetrySink &_second;
};
