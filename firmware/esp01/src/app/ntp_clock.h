#pragma once

#include "app/timesource.h"

class NtpClock : public ITimeSource {
public:
  NtpClock(const char *server, const char *timezone);

  void begin() override;

  bool     hasWallClock() const override;
  void     hms(uint8_t &hh, uint8_t &mm, uint8_t &ss) const override;
  uint32_t uptimeSeconds() const override;

  // Secondes depuis l'epoque Unix, 0 tant que la synchronisation n'a pas abouti.
  uint32_t epoch() const override;

private:
  const char *_server;
  const char *_timezone;
};
