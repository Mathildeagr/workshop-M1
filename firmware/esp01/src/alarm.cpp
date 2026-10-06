#include "alarm.h"

// Tables issues de la console de reglage. freq 0 = silence. Le dernier silence
// d'une table est l'ecart entre deux cycles, joue par le rebouclage.

static const Step INTRUSION_SUSPECTED[] = {{400,400},{400,100},{400,200},{0,200}};
static const Step INTRUSION_CONFIRMED[] = {{900,400},{900,100},{900,200}};
static const Step INTRUSION_ESCALATED[] = {{1000,300},{1000,75},{1000,100}};
static const Step INTRUSION_CLEARED[]   = {{900,180},{0,40},{450,360}};

static const Step TAMPER_SUSPECTED[] = {{2000,80},{0,2000},{1200,80},{0,2000},{2000,80},{0,2000},{1200,80},{0,2000}};
static const Step TAMPER_CONFIRMED[] = {{2000,80},{0,80},{1200,80},{0,80},{2000,80},{0,80},{1200,80},{0,80}};
static const Step TAMPER_ESCALATED[] = {{2000,80},{0,50},{1200,80},{0,50},{2000,80},{0,50},{1200,80},{0,50}};
static const Step TAMPER_CLEARED[]   = {{2000,80},{0,40},{1200,80},{0,40},{200,240}};

static const Step ENV_SUSPECTED[] = {{650,300},{0,1500},{650,300},{0,3000}};
static const Step ENV_CONFIRMED[] = {{650,1000},{0,500},{650,1000},{0,2000}};
static const Step ENV_ESCALATED[] = {{650,1000},{0,500},{650,1000},{0,500}};
static const Step ENV_CLEARED[]   = {{650,300},{0,100},{455,600}};

struct Pattern {
  const Step *steps;
  uint8_t     len;
  bool        loop;
};

#define PAT(tbl, lp) { tbl, (uint8_t)(sizeof(tbl) / sizeof(Step)), lp }

static const Pattern PATTERNS[FAM_COUNT][ST_COUNT] = {
  { PAT(INTRUSION_SUSPECTED,true), PAT(INTRUSION_CONFIRMED,true), PAT(INTRUSION_ESCALATED,true), PAT(INTRUSION_CLEARED,false) },
  { PAT(TAMPER_SUSPECTED,   true), PAT(TAMPER_CONFIRMED,   true), PAT(TAMPER_ESCALATED,   true), PAT(TAMPER_CLEARED,   false) },
  { PAT(ENV_SUSPECTED,      true), PAT(ENV_CONFIRMED,      true), PAT(ENV_ESCALATED,      true), PAT(ENV_CLEARED,      false) }
};

static const char *const NAMES[FAM_COUNT][ST_COUNT] = {
  { "intrusion_suspected", "intrusion_unknown", "intrusion_prohibited", "intrusion_cleared" },
  { "tamper_suspected",    "tamper_opened",     "tamper_removed",       "tamper_cleared"    },
  { "env_drift",           "env_anomaly",       "env_critical",         "env_cleared"       }
};

// Plus petit = passe devant. La fuite de gaz gagne toujours.
static const uint8_t PRIORITY[FAM_COUNT][ST_COUNT] = {
  { 60, 40, 20, 200 },
  { 55, 30, 25, 200 },
  { 50, 35, 10, 200 }
};

static uint8_t     s_pin       = 255;
static bool        s_active    = false;
static const Step *s_steps     = nullptr;
static uint8_t     s_len       = 0;
static bool        s_loop      = false;
static uint8_t     s_idx       = 0;
static uint32_t    s_stepStart = 0;
static const char *s_label     = nullptr;
static uint8_t     s_priority  = 255;
static uint8_t     s_family    = FAM_COUNT;

static void applyStep() {
  const uint16_t f = s_steps[s_idx].freq_hz;
  if (f > 0) tone(s_pin, f);
  else       noTone(s_pin);
}

void alarmPlayTable(const Step *steps, uint8_t len, bool loop,
                    const char *label, uint8_t priority) {
  if (steps == nullptr || len == 0) return;
  s_steps     = steps;
  s_len       = len;
  s_loop      = loop;
  s_label     = label;
  s_priority  = priority;
  s_idx       = 0;
  s_stepStart = millis();
  s_active    = true;
  applyStep();
}

static void startAlert(Family f, State s) {
  const Pattern &p = PATTERNS[f][s];
  s_family = f;
  alarmPlayTable(p.steps, p.len, p.loop, NAMES[f][s], PRIORITY[f][s]);
}

void alarmBegin(uint8_t pin) {
  s_pin = pin;
  pinMode(s_pin, OUTPUT);
  noTone(s_pin);
  digitalWrite(s_pin, LOW);
  s_active = false;
  s_label  = nullptr;
  s_family = FAM_COUNT;
}

void alarmStop() {
  s_active   = false;
  s_label    = nullptr;
  s_family   = FAM_COUNT;
  s_priority = 255;
  if (s_pin != 255) {
    noTone(s_pin);
    digitalWrite(s_pin, LOW);
  }
}

void alarmForce(Family f, State s) {
  startAlert(f, s);
}

void alarmPlay(Family f, State s) {
  if (s_active) {
    if (s == ST_CLEARED) {
      if (s_family != FAM_COUNT && f != (Family)s_family) return;
    } else if (PRIORITY[f][s] > s_priority) {
      return;
    }
  }
  startAlert(f, s);
}

void alarmUpdate() {
  if (!s_active) return;

  const uint32_t now = millis();
  if (now - s_stepStart < s_steps[s_idx].dur_ms) return;

  // On avance du pas exact pour ne pas accumuler le retard de la boucle, mais
  // on se resynchronise si elle a vraiment decroche.
  s_stepStart += s_steps[s_idx].dur_ms;
  if (now - s_stepStart > 500) s_stepStart = now;

  s_idx++;
  if (s_idx >= s_len) {
    if (!s_loop) { alarmStop(); return; }
    s_idx = 0;
  }
  applyStep();
}

bool        alarmIsPlaying() { return s_active; }
const char *alarmCurrentLabel() { return s_active ? s_label : nullptr; }
const char *alarmEventName(Family f, State s) { return NAMES[f][s]; }
uint8_t     alarmPriority(Family f, State s) { return PRIORITY[f][s]; }
