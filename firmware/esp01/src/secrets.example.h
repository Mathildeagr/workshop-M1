// Copier en secrets.h et renseigner. secrets.h est ignore par git : aucun
// identifiant ne doit se retrouver dans le depot.

#pragma once

#define WIFI_SSID      "sentinel-x"
#define WIFI_PASSWORD  "a-renseigner"

// Adressage fixe impose par l'equipe infra. Sous-reseau de table etanche.
#define NET_STATIC_IP  192, 168, 10, 50
#define NET_GATEWAY    192, 168, 10, 1
#define NET_SUBNET     255, 255, 255, 0
#define NET_DNS        192, 168, 10, 1

// Identite du noeud : sert de client-id MQTT et de prefixe de topic.
#define DEVICE_ID      "esp01"

// Broker Mosquitto. Laisser MQTT_USER a nullptr si le broker est ouvert.
#define MQTT_HOST      "192.168.10.10"
#define MQTT_PORT      1883
#define MQTT_USER      "esp01"
#define MQTT_PASSWORD  "a-renseigner"
