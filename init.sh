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

# 6. Service vision (ai-vision/server.py) sur l'hôte : Docker Desktop ne transmet pas la webcam aux conteneurs
# Hôte, port et jeton lus depuis ai-vision/.env (SENTINEL_SERVICE_*)
if curl -s -o /dev/null --max-time 2 http://127.0.0.1:5000/health; then
    echo "Service vision déjà lancé sur le port 5000"
elif [ -x ./ai-vision/.venv/Scripts/python.exe ]; then
    echo "Lancement du service vision (fenêtre séparée)..."
    (cd ai-vision && powershell.exe -NoProfile -Command \
        "Start-Process -FilePath '.venv\Scripts\python.exe' -ArgumentList 'server.py' -WindowStyle Minimized")
elif [ -x ./ai-vision/.venv/bin/python ]; then
    echo "Lancement du service vision (logs : ai-vision/server.log)..."
    (cd ai-vision && nohup .venv/bin/python server.py > server.log 2>&1 &)
else
    echo "Service vision non lancé : venv ai-vision/.venv introuvable (voir ai-vision/README.md)"
fi

echo "Infrastructure déployée avec succès ! Accès via https://localhost"