#include "actuators/alarm.h"

// Tables issues de la console de reglage. freq 0 = silence. Le dernier silence
// d'une table est l'ecart entre deux cycles, joue par le rebouclage.

// Sirene : une note tenue dont le volume monte puis redescend. L'urgence se lit
// dans la vitesse du cycle, jamais dans la hauteur — sept secondes et demie pour
// le doute, deux secondes pour l'interdit. Les hauteurs sont celles reglees a la
// console ; pour une sirene plus grave, il n'y a que ces trois nombres a changer.
static const Step INTRUSION_SUSPECTED[]  = {{400,3000,10,100},{400,3000,100,10},{0,1500}};
static const Step INTRUSION_CONFIRMED[]  = {{900,2000,20,100},{900,2000,100,20},{0,800}};
static const Step INTRUSION_ESCALATED[]  = {{1000,1000,40,100},{1000,1000,100,40}};
static const Step INTRUSION_CLEARED[]    = {{900,180},{0,40},{450,360,100,0}};

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
  { "intrusion_unknown", "intrusion_unidentified", "intrusion_prohibited", "intrusion_cleared" },
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
static uint8_t     s_volume    = 0;

// Resolution du rapport cyclique. 255 suffit largement pour cent niveaux.
static const uint16_t PWM_RANGE = 255;

// tone() sort un carre a rapport cyclique fixe : aucun volume possible. En
// pilotant la broche en modulation de largeur, l'energie envoyee au piezo suit
// le rapport cyclique, et un carre donne son maximum a cinquante pour cent.
static void emit(uint16_t freq, uint8_t volume) {
  if (freq == 0 || volume == 0) {
    analogWrite(s_pin, 0);
    digitalWrite(s_pin, LOW);
    s_volume = 0;
    return;
  }
  analogWriteFreq(freq);
  analogWrite(s_pin, (uint32_t)PWM_RANGE * volume / 200u);
  s_volume = volume;
}

// Volume du pas courant a cet instant, interpole quand il varie.
static uint8_t stepVolume(const Step &st, uint32_t elapsed) {
  if (st.vol_from == st.vol_to) return st.vol_from;
  const uint32_t d = st.dur_ms ? st.dur_ms : 1;
  const uint32_t t = elapsed > d ? d : elapsed;
  return (uint8_t)((int32_t)st.vol_from
                   + ((int32_t)st.vol_to - (int32_t)st.vol_from) * (int32_t)t / (int32_t)d);
}

static void applyStep() {
  const Step &st = s_steps[s_idx];
  emit(st.freq_hz, stepVolume(st, 0));
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
  analogWriteRange(PWM_RANGE);
  analogWrite(s_pin, 0);
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
    emit(0, 0);
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
  const Step &st = s_steps[s_idx];

  if (now - s_stepStart < st.dur_ms) {
    // Enveloppe en cours : on ne reecrit la sortie que lorsque le volume change
    // vraiment, soit cent fois par rampe au maximum.
    if (st.vol_from != st.vol_to && st.freq_hz > 0) {
      const uint8_t v = stepVolume(st, now - s_stepStart);
      if (v != s_volume) emit(st.freq_hz, v);
    }
    return;
  }

  // On avance du pas exact pour ne pas accumuler le retard de la boucle, mais
  // on se resynchronise si elle a vraiment decroche.
  s_stepStart += st.dur_ms;
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

bool alarmLookup(const char *name, Family &f, State &s) {
  if (name == nullptr) return false;
  for (uint8_t fi = 0; fi < FAM_COUNT; fi++) {
    for (uint8_t si = 0; si < ST_COUNT; si++) {
      if (strcmp(name, NAMES[fi][si]) == 0) {
        f = (Family)fi;
        s = (State)si;
        return true;
      }
    }
  }
  return false;
}
uint8_t     alarmPriority(Family f, State s) { return PRIORITY[f][s]; }
