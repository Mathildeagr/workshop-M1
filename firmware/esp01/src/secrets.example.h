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

// Backend du projet. La cle doit figurer dans DEVICE_API_KEYS cote serveur,
// sous la forme esp01:<cle>.
#define BACKEND_HOST    "192.168.10.10"
#define BACKEND_PORT    3000
#define BACKEND_PATH    "/api/firmware/events"
#define DEVICE_API_KEY  "a-renseigner-32-caracteres-minimum"
