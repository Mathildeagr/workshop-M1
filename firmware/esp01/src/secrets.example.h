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
