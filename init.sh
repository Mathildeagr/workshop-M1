#!/bin/bash
echo " Initialisation de l'environnement sécurisé Sentinel-X..."

# 1. Création des dossiers nécessaires
mkdir -p certs mosquitto/config

# 2. Certificat TLS de Traefik
#
# Le nom des fichiers doit correspondre à traefik/dynamic/tls.yml, et le
# certificat doit porter un subjectAltName : les nœuds IoT se connectent par
# adresse IP, et une validation par IP échoue sans SAN correspondant. Sans ces
# deux points, Traefik sert son certificat de remplacement intégré.
#
# On teste la clé autant que le certificat : la clé est ignorée par git et le
# certificat ne l'est pas, donc sur un clone frais le certificat existe sans sa
# clé et l'ancienne condition sautait la génération.
SERVER_IP="${SERVER_IP:-$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')}"

if [ ! -f "./certs/sentinel.crt" ] || [ ! -f "./certs/sentinel.key" ]; then
    echo "Génération du certificat TLS (SAN : sentinel.localhost, localhost, ${SERVER_IP:-aucune IP})..."
    SAN="DNS:sentinel.localhost,DNS:localhost,IP:127.0.0.1"
    [ -n "$SERVER_IP" ] && SAN="$SAN,IP:$SERVER_IP"

    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ./certs/sentinel.key -out ./certs/sentinel.crt \
        -subj "/C=FR/ST=Occitanie/L=Montpellier/O=AetherCorp/CN=sentinel.localhost" \
        -addext "subjectAltName=$SAN"
    echo "   Pour un autre réseau : SERVER_IP=<adresse> ./init.sh après avoir supprimé certs/sentinel.*"
fi

# 3. Secrets du projet
#
# Un seul script les génère tous, parce qu'une même valeur apparaît dans
# plusieurs fichiers : chaque mot de passe MQTT est lu par son client et par le
# broker, la clé predictive par le backend et par la brique d'analyse. En écrire
# un seul à la main désaligne les autres.
#
# Aucun mot de passe ne figure donc ici : le sujet interdit les secrets en clair
# dans le dépôt.
if [ -f ./.env ] && [ -f ./mosquitto/config/passwd ]; then
    echo "Secrets déjà en place (./scripts/generate-secrets.py --force pour en tirer de nouveaux)"
elif [ -n "$SERVER_IP" ]; then
    echo "Génération des secrets et des comptes MQTT..."
    ./scripts/generate-secrets.py --host-ip "$SERVER_IP"
else
    echo "Adresse du serveur inconnue : lancer ./scripts/generate-secrets.py --host-ip <adresse>"
fi

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