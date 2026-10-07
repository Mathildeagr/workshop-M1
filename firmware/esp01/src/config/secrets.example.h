// Ne pas remplir ce fichier a la main : scripts/generate-secrets.py ecrit
// secrets.h, et genere en meme temps le compte correspondant dans le fichier de
// mots de passe du broker. Les deux doivent venir du meme tirage.
//
//   ./scripts/generate-secrets.py --host-ip <IP du PC serveur>
//
// secrets.h est ignore par git : aucun identifiant ne doit se retrouver dans le
// depot. Ce fichier-ci ne sert qu'a documenter la liste des reglages attendus.

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

// Serveur de temps. Sur un reseau de table isole, pool.ntp.org est injoignable :
// viser le PC serveur ou la passerelle, qui doivent alors servir le NTP.
#define NTP_SERVER    "192.168.10.10"
#define NTP_TIMEZONE  "CET-1CEST,M3.5.0,M10.5.0/3"
