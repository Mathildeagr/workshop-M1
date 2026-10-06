#include "app/ntp_clock.h"
#include <time.h>

// Une date anterieure a 2023 signifie que rien n'a encore ete synchronise :
// l'horloge demarre a l'epoque Unix.
static const time_t SYNCED_AFTER = 1672531200;

NtpClock::NtpClock(const char *server, const char *timezone)
  : _server(server), _timezone(timezone) {}

void NtpClock::begin() {
  // La resolution echoue tant que le Wi-Fi n'est pas la ; le client SNTP du
  // coeur reessaie de lui-meme.
  configTime(_timezone, _server);
}

bool NtpClock::hasWallClock() const {
  return time(nullptr) > SYNCED_AFTER;
}

uint32_t NtpClock::epoch() const {
  const time_t now = time(nullptr);
  return now > SYNCED_AFTER ? (uint32_t)now : 0;
}

uint32_t NtpClock::uptimeSeconds() const {
  return millis() / 1000UL;
}

void NtpClock::hms(uint8_t &hh, uint8_t &mm, uint8_t &ss) const {
  const time_t now = time(nullptr);
  if (now <= SYNCED_AFTER) {
    const uint32_t t = uptimeSeconds();
    hh = (uint8_t)((t / 3600UL) % 100UL);
    mm = (uint8_t)((t / 60UL) % 60UL);
    ss = (uint8_t)(t % 60UL);
    return;
  }
  struct tm local;
  localtime_r(&now, &local);
  hh = (uint8_t)local.tm_hour;
  mm = (uint8_t)local.tm_min;
  ss = (uint8_t)local.tm_sec;
}
