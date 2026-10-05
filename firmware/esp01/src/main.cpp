#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    pinMode(LED_BUILTIN, OUTPUT);
    delay(100);
    Serial.println();
    Serial.println("Sentinel-X / esp01 : demarrage");
}

void loop() {
    // digitalWrite(LED_BUILTIN, LOW);
    // Serial.println("LED allumee"); // LOW = allumee, HIGH = eteinte (????)
    // delay(500);

    digitalWrite(LED_BUILTIN, HIGH);
    // Serial.println("LED eteinte");
    // delay(500);
}