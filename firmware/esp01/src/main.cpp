#include <Arduino.h>

#include "config/pins.h"
#include "config/secrets.h"
#include "net/network.h"
#include "actuators/alarm.h"
#include "actuators/jingles.h"
#include "actuators/led.h"
#include "actuators/screen.h"
#include "app/timesource.h"
#include "app/ntp_clock.h"
#include "app/telemetry.h"
#include "app/serial_sink.h"
#include "net/mqtt_client.h"
#include "app/tee_sink.h"
#include "app/command_router.h"
#include "app/alert_policy.h"

#include "sensors/climate.h"
#include "sensors/dht22_sensor.h"
#include "sensors/gas.h"
#include "sensors/mq2_sensor.h"
#include "sensors/presence.h"
#include "sensors/pir_sensor.h"
#include "sensors/tamper.h"
#include "sensors/contact_sensor.h"


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
static NtpClock     wallClockDevice(NTP_SERVER, NTP_TIMEZONE);
static SerialSink    serialSink;
static MqttClient    mqtt(link, MQTT_HOST, MQTT_PORT, DEVICE_ID,
                          MQTT_USER, MQTT_PASSWORD);
static TeeSink       sinks(serialSink, mqtt);

static IClimateSensor  &climate   = dhtDevice;
static IGasSensor      &gas       = mq2Device;
static IPresenceSensor &presence  = pirDevice;
static ITamperSensor   &tilt      = tiltDevice;
static ITamperSensor   &optic     = opticDevice;
static ITimeSource     &wallClock = wallClockDevice;
static ITelemetrySink  &telemetry = sinks;

static AlertPolicy   policy(statusLed, telemetry);
static CommandRouter commands(policy);

static TelemetryFrame frame;
static ScreenData     screenData;
static uint32_t       lastTelemetry = 0;
static LinkState      lastLinkState = LinkState::Down;
static bool           bootReported  = false;
static bool           clockReported = false;
static uint32_t       lastClimateAt = 0;
static uint32_t       lastGasAt     = 0;
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
      lastClimateAt              = r.timestamp_ms;
      if (climateFaultReported) policy.report("sensor_recovered", "info", "dht22");
      climateFaultReported       = false;
      break;
    case ReadStatus::Error:
      if (climate.failStreak() >= SENSOR_FAIL_THRESHOLD) {
        frame.climate_valid      = false;
        screenData.climate_valid = false;
        if (!climateFaultReported) {
          jinglePlay(JIN_ERROR);
          policy.report("sensor_fault", "warning", "dht22");
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
      lastGasAt           = r.timestamp_ms;
      if (gasFaultReported) policy.report("sensor_recovered", "info", "mq2");
      gasFaultReported    = false;
      break;
    case ReadStatus::Error:
      if (gas.failStreak() >= SENSOR_FAIL_THRESHOLD) {
        frame.gas_valid = false;
        if (!gasFaultReported) {
          jinglePlay(JIN_ERROR);
          policy.report("sensor_fault", "warning", "mq2");
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
    policy.onTamper(true, r.level, r.episodes_in_window);
  }
  if (optic.read(r) == ReadStatus::Ok) {
    frame.optic = r.level;
    policy.onTamper(false, r.level, r.episodes_in_window);
  }
}

static void followLink() {
  link.update();

  const LinkState now = link.state();
  if (now == lastLinkState) return;

  if (now == LinkState::Up) {
    jinglePlay(JIN_WIFI_OK);
    // Le demarrage ne peut etre annonce qu'une fois le lien disponible.
    if (!bootReported) {
      policy.report("node_boot", "info");
      bootReported = true;
    }
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
  // La trame part plus souvent que certains capteurs ne sont lus : sans cet
  // age, rien ne distingue une mesure fraiche d'une valeur repetee.
  frame.climate_age_ms = now - lastClimateAt;
  frame.gas_age_ms     = now - lastGasAt;
  telemetry.publish(frame);
}

static void announceClock() {
  if (clockReported || !wallClock.hasWallClock()) return;
  clockReported = true;

  uint8_t hh, mm, ss;
  wallClock.hms(hh, mm, ss);
  Serial.printf("heure synchronisee : %02u:%02u:%02u\n", hh, mm, ss);
}

static void refreshScreen() {
  wallClock.hms(screenData.hh, screenData.mm, screenData.ss);
  screenData.wall_clock   = wallClock.hasWallClock();
  screenData.wifi_up      = link.isConnected();
  screenData.network_text = link.statusText();
  screenData.alert_event  = alarmCurrentLabel();
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
  mqtt.setCommandSink(&commands);
  mqtt.setClock(&wallClock);
  wallClock.begin();
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

  Serial.print(F("broker "));
  Serial.print(MQTT_HOST);
  Serial.print(':');
  Serial.println(MQTT_PORT);
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

  announceClock();
  refreshScreen();
  publishTelemetry();
  telemetry.update();
}
