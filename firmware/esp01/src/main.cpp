#include <Arduino.h>

#include "secrets.h"
#include "network.h"
#include "alarm.h"
#include "jingles.h"
#include "led.h"
#include "screen.h"
#include "timesource.h"
#include "telemetry.h"
#include "serial_sink.h"
#include "alert_policy.h"

#include "climate.h"
#include "dht22_sensor.h"
#include "gas.h"
#include "mq2_sensor.h"
#include "presence.h"
#include "pir_sensor.h"
#include "tamper.h"
#include "contact_sensor.h"

#define PIN_BUZZER    D8   // GPIO15 : tirage externe bas, donc muet au boot
#define PIN_DHT       D5
#define PIN_PIR       D6
#define PIN_MQ2       A0
#define PIN_TILT      D3   // GPIO0 : contact OUVERT au repos, sinon pas de boot
#define PIN_OPTIC     D0   // GPIO16 : tirage externe 10k vers 3V
#define PIN_LED_RED   D7
#define PIN_LED_GREEN D4

static const uint32_t TELEMETRY_PERIOD_MS   = 2000;
static const uint8_t  SENSOR_FAIL_THRESHOLD = 3;

// Point de montage : seul endroit qui connait les classes concretes.
static Dht22Sensor   dhtDevice(PIN_DHT);
static Mq2Sensor     mq2Device(PIN_MQ2);
static PirSensor     pirDevice(PIN_PIR);
static ContactSensor tiltDevice(PIN_TILT, "SW-520D", PinBias::PullUp, -1, 50, 300, 800, 400);
static ContactSensor opticDevice(PIN_OPTIC, "FC-51", PinBias::None, 1, 30, 120, 800, 0);

static WifiLink     link(WIFI_SSID, WIFI_PASSWORD,
                        IPAddress(NET_STATIC_IP), IPAddress(NET_GATEWAY),
                        IPAddress(NET_SUBNET),    IPAddress(NET_DNS));
static StatusLed    statusLed(PIN_LED_RED, PIN_LED_GREEN);
static StatusScreen screen(0x3C);
static UptimeClock  uptimeClock;
static SerialSink   serialSink;

static IClimateSensor  &climate   = dhtDevice;
static IGasSensor      &gas       = mq2Device;
static IPresenceSensor &presence  = pirDevice;
static ITamperSensor   &tilt      = tiltDevice;
static ITamperSensor   &optic     = opticDevice;
static ITimeSource     &wallClock = uptimeClock;
static ITelemetrySink  &telemetry = serialSink;

static AlertPolicy policy(statusLed, telemetry);

static TelemetryFrame frame;
static ScreenData     screenData;
static uint32_t       lastTelemetry = 0;
static LinkState      lastLinkState = LinkState::Down;
static bool           climateFaultReported = false;
static bool           gasFaultReported     = false;

static void readClimate() {
  ClimateReading r;
  switch (climate.read(r)) {
    case ReadStatus::Ok:
      frame.climate_valid        = true;
      frame.temperature_c        = r.temperature_c;
      frame.humidity_pct         = r.humidity_pct;
      frame.dew_point_c          = climateDewPointC(r.temperature_c, r.humidity_pct);
      screenData.climate_valid   = true;
      screenData.temperature_c   = r.temperature_c;
      screenData.humidity_pct    = r.humidity_pct;
      climateFaultReported       = false;
      break;
    case ReadStatus::Error:
      if (climate.failStreak() >= SENSOR_FAIL_THRESHOLD) {
        frame.climate_valid      = false;
        screenData.climate_valid = false;
        if (!climateFaultReported) {
          jinglePlay(JIN_ERROR);
          climateFaultReported = true;
        }
      }
      break;
    case ReadStatus::NotReady:
      break;
  }
}

static void readGas() {
  GasReading r;
  switch (gas.read(r)) {
    case ReadStatus::Ok:
      frame.gas_valid     = true;
      frame.gas_raw       = r.raw;
      frame.gas_ratio     = r.ratio;
      frame.gas_warming   = r.warming_up;
      frame.gas_saturated = r.saturated;
      gasFaultReported    = false;
      break;
    case ReadStatus::Error:
      if (gas.failStreak() >= SENSOR_FAIL_THRESHOLD) {
        frame.gas_valid = false;
        if (!gasFaultReported) {
          jinglePlay(JIN_ERROR);
          gasFaultReported = true;
        }
      }
      break;
    case ReadStatus::NotReady:
      break;
  }
}

static void readPresence() {
  PresenceReading r;
  if (presence.read(r) != ReadStatus::Ok) return;
  frame.presence           = r.present;
  frame.presence_settling  = r.settling;
  frame.presence_count     = r.motions_in_window;
  policy.onPresence(r);
}

static void readTamper() {
  TamperReading r;
  if (tilt.read(r) == ReadStatus::Ok) {
    frame.tilt = r.level;
    policy.onTamper(true, r.level);
  }
  if (optic.read(r) == ReadStatus::Ok) {
    frame.optic = r.level;
    policy.onTamper(false, r.level);
  }
}

static void followLink() {
  link.update();

  const LinkState now = link.state();
  if (now == lastLinkState) return;

  if (now == LinkState::Up) {
    jinglePlay(JIN_WIFI_OK);
    Serial.print(F("wifi connecte, adresse "));
    Serial.print(link.ipText());
    Serial.print(F(", rssi "));
    Serial.print(link.rssi());
    Serial.println(F(" dBm"));
  } else if (lastLinkState == LinkState::Up) {
    jinglePlay(JIN_WIFI_FAIL);
    Serial.println(F("wifi perdu, nouvelle tentative"));
  }

  policy.setLinkUp(now == LinkState::Up);
  lastLinkState = now;
}

static void publishTelemetry() {
  const uint32_t now = millis();
  if (now - lastTelemetry < TELEMETRY_PERIOD_MS) return;
  lastTelemetry = now;

  frame.uptime_s = wallClock.uptimeSeconds();
  frame.wifi_up  = link.isConnected();
  telemetry.publish(frame);
}

static void refreshScreen() {
  wallClock.hms(screenData.hh, screenData.mm, screenData.ss);
  screenData.wall_clock   = wallClock.hasWallClock();
  screenData.wifi_up      = link.isConnected();
  screenData.network_text = link.statusText();
  screen.update(screenData);
}

void setup() {
  Serial.begin(115200);

  alarmBegin(PIN_BUZZER);
  statusLed.begin();
  climate.begin();
  gas.begin();
  presence.begin();
  tilt.begin();
  optic.begin();
  telemetry.begin();
  policy.begin();
  link.begin();

  frame      = TelemetryFrame();
  screenData = ScreenData();

  delay(100);
  Serial.println();
  Serial.print(F("sentinel-x esp01 : "));
  Serial.print(climate.name());
  Serial.print(F(" + "));
  Serial.print(gas.name());
  Serial.print(F(" + "));
  Serial.print(presence.name());
  Serial.print(F(" + "));
  Serial.print(tilt.name());
  Serial.print(F(" + "));
  Serial.println(optic.name());

  if (!screen.begin()) {
    Serial.println(F("ecran OLED absent a l'adresse 0x3C"));
  }
  if (!tilt.restLevel()) {
    Serial.println(F("inclinaison fermee au repos : la carte ne redemarrera pas"));
  }
  Serial.println();

  Serial.print(F("wifi "));
  Serial.print(WIFI_SSID);
  Serial.print(F(", adresse fixe "));
  Serial.println(IPAddress(NET_STATIC_IP).toString());
  Serial.println();

  jinglePlay(JIN_BOOT);
  screen.splash(alarmUpdate);
}

void loop() {
  alarmUpdate();
  statusLed.update();
  followLink();

  readPresence();
  readTamper();
  readClimate();
  readGas();

  refreshScreen();
  publishTelemetry();
}
