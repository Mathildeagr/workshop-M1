#pragma once

#include <Arduino.h>

struct Step { uint16_t freq_hz; uint16_t dur_ms; };

enum Family : uint8_t {
  FAM_INTRUSION = 0,
  FAM_TAMPER    = 1,
  FAM_ENV       = 2,
  FAM_COUNT     = 3
};

enum State : uint8_t {
  ST_SUSPECTED = 0,
  ST_CONFIRMED = 1,
  ST_ESCALATED = 2,
  ST_CLEARED   = 3,
  ST_COUNT     = 4
};

void alarmBegin(uint8_t pin);

// Respecte la file de priorite. Une levee ne coupe que sa propre famille.
void alarmPlay(Family f, State s);
void alarmForce(Family f, State s);

// priority 255 : interruptible par n'importe quelle alerte.
void alarmPlayTable(const Step *steps, uint8_t len, bool loop,
                    const char *label, uint8_t priority = 255);

void alarmStop();
void alarmUpdate();

bool        alarmIsPlaying();
const char *alarmCurrentLabel();
const char *alarmEventName(Family f, State s);

// Retrouve la famille et l'etat a partir du nom recu du backend.
bool alarmLookup(const char *name, Family &f, State &s);
uint8_t     alarmPriority(Family f, State s);
