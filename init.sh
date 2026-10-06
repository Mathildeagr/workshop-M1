#!/bin/bash
echo " Initialisation de l'environnement sécurisé Sentinel-X..."

# 1. Création des dossiers nécessaires
mkdir -p certs mosquitto/config

# 2. Génération du certificat TLS (uniquement s'il n'existe pas déjà)
if [ ! -f "./certs/sentinel.localhost.crt" ]; then
    echo "Génération des certificats TLS Traefik..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./certs/sentinel.localhost.key -out ./certs/sentinel.localhost.crt -subj "/C=FR/ST=Occitanie/L=Montpellier/O=AetherCorp/CN=sentinel.localhost"
fi

# 3. Génération du mot de passe chiffré pour le broker IoT
echo "Configuration des accès MQTT..."
MSYS_NO_PATHCONV=1 docker run --rm -v "${PWD}/mosquitto/config:/config" eclipse-mosquitto:2 mosquitto_passwd -c -b /config/passwd capteur_esp Sentinel2026

# 4. Correction des droits pour résoudre le bug Windows/Docker
echo "Correction des permissions de lecture..."
MSYS_NO_PATHCONV=1 docker run --rm -v "${PWD}/mosquitto/config:/config" alpine chmod 644 /config/passwd

# 5. Démarrage de l'infrastructure
echo "Lancement des conteneurs..."
docker compose up -d

echo "Infrastructure déployée avec succès ! Accès via https://localhost"