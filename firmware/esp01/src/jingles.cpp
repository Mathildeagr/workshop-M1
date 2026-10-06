#include "jingles.h"
#include "alarm.h"

// Tout reste entre 450 Hz et 2 kHz : la bande ou une pastille piezo rend.

#define N_D5  587
#define N_E5  659
#define N_F5  698
#define N_G5  784
#define N_A5  880
#define N_B5  988
#define N_C5  523
#define N_C6 1047
#define N_E6 1319

static const Step J_BOOT[]      = {{N_C5,110},{0,20},{N_G5,110},{0,20},{N_C6,200}};
static const Step J_WIFI_OK[]   = {{N_E5,80},{0,30},{N_B5,170}};
static const Step J_WIFI_FAIL[] = {{N_B5,110},{0,30},{N_E5,300}};
static const Step J_MQTT_OK[]   = {{N_G5,70},{0,20},{N_C6,70},{0,20},{N_E6,160}};
static const Step J_ACK[]       = {{N_A5,60}};
static const Step J_ERROR[]     = {{N_G5,110},{0,25},{N_F5,110},{0,25},{N_D5,320}};

#define JIN(tbl, label) { tbl, (uint8_t)(sizeof(tbl) / sizeof(Step)), label }

struct JingleDef {
  const Step *steps;
  uint8_t     len;
  const char *name;
};

static const JingleDef JINGLES[JIN_COUNT] = {
  JIN(J_BOOT,      "demarrage"),
  JIN(J_WIFI_OK,   "wifi connecte"),
  JIN(J_WIFI_FAIL, "wifi perdu"),
  JIN(J_MQTT_OK,   "broker joint"),
  JIN(J_ACK,       "acquittement"),
  JIN(J_ERROR,     "erreur")
};

uint8_t jingleCount() { return JIN_COUNT; }

const char *jingleName(uint8_t i) {
  if (i >= JIN_COUNT) return "?";
  return JINGLES[i].name;
}

void jinglePlay(uint8_t i) {
  if (i >= JIN_COUNT) return;
  const JingleDef &j = JINGLES[i];
  alarmPlayTable(j.steps, j.len, false, j.name, 255);
}
