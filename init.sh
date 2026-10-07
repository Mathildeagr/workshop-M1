#!/bin/bash
echo " Initialisation de l'environnement sécurisé Sentinel-X..."

# 1. Création des dossiers nécessaires
mkdir -p certs mosquitto/config

# 2. Adresse du serveur sur le réseau de table
#
# C'est elle que le nœud vise pour le broker et pour l'heure, et c'est elle que
# le certificat doit couvrir. Sur un partage de connexion elle change à chaque
# fois, d'où le réalignement automatique plus bas.
SERVER_IP="${SERVER_IP:-$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')}"
if [ -z "$SERVER_IP" ]; then
    echo "Adresse du serveur introuvable. Relancer avec SERVER_IP=<adresse> ./init.sh"
    exit 1
fi
echo "Serveur sur $SERVER_IP"

# 3. Certificat TLS de Traefik
#
# Les noms doivent correspondre à traefik/dynamic/tls.yml, et le certificat doit
# couvrir l'adresse du serveur : sans ça Traefik sert son certificat de
# remplacement et le nœud refuse la connexion.
#
# On teste la clé autant que le certificat — la clé est ignorée par git, pas le
# certificat, donc sur un clone frais l'un existait sans l'autre — et on
# régénère aussi quand l'adresse a changé.
besoin_certificat=0
if [ ! -f "./certs/sentinel.crt" ] || [ ! -f "./certs/sentinel.key" ]; then
    besoin_certificat=1
elif ! openssl x509 -in ./certs/sentinel.crt -noout -ext subjectAltName 2>/dev/null \
     | grep -q "IP Address:$SERVER_IP"; then
    echo "Le certificat ne couvre pas $SERVER_IP, régénération..."
    besoin_certificat=1
fi

if [ "$besoin_certificat" = "1" ]; then
    echo "Génération du certificat TLS (SAN : sentinel.localhost, localhost, $SERVER_IP)..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ./certs/sentinel.key -out ./certs/sentinel.crt \
        -subj "/C=FR/ST=Occitanie/L=Montpellier/O=AetherCorp/CN=sentinel.localhost" \
        -addext "subjectAltName=DNS:sentinel.localhost,DNS:localhost,IP:127.0.0.1,IP:$SERVER_IP"
    chmod 600 ./certs/sentinel.key
fi

# 4. Secrets du projet
#
# Un seul script les génère tous, parce qu'une même valeur apparaît dans
# plusieurs fichiers : chaque mot de passe MQTT est lu par son client et par le
# broker, la clé predictive par le backend et par la brique d'analyse.
#
# Aucun mot de passe ne figure donc ici : le sujet interdit les secrets en clair
# dans le dépôt.
#
# Et surtout : une adresse n'est pas un secret. Quand seule l'adresse change, on
# réaligne la configuration du nœud sans faire tourner les mots de passe — les
# régénérer casserait la base, qui garde l'ancien, et le broker, qui devrait
# relire ses comptes.
reflasher=0
if [ -f ./.env ] && [ -f ./mosquitto/config/passwd ]; then
    ./scripts/generate-secrets.py --host-ip "$SERVER_IP" --retarget
    [ "$?" = "10" ] && reflasher=1
else
    echo "Génération des secrets et des comptes MQTT..."
    ./scripts/generate-secrets.py --host-ip "$SERVER_IP" || exit 1
    reflasher=1
fi

# Le fichier de comptes du broker est monté dans le conteneur, où mosquitto
# tourne sous son propre compte et doit pouvoir le lire.
chmod 644 ./mosquitto/config/passwd 2>/dev/null

# 5. Démarrage de l'infrastructure
echo "Lancement des conteneurs..."
docker compose up -d --build

# Mosquitto ne relit son fichier de comptes qu'au démarrage, et un conteneur déjà
# en place garde les anciens.
docker compose restart mosquitto >/dev/null 2>&1

# PostgreSQL n'applique son mot de passe qu'à l'initialisation d'un volume
# vierge : une base déjà créée garde l'ancien, et plus rien ne s'y connecte. On
# ne réaligne que si l'authentification échoue vraiment.
PG_USER=$(grep '^POSTGRES_USER=' .env | cut -d= -f2)
PG_PASSWORD=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2)
PG_DB=$(grep '^POSTGRES_DB=' .env | cut -d= -f2)
for _ in $(seq 1 20); do
    docker compose exec -T database pg_isready -q 2>/dev/null && break
    sleep 1
done
if ! docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" database \
     psql -h 127.0.0.1 -U "$PG_USER" -d "$PG_DB" -tAc "select 1" >/dev/null 2>&1; then
    echo "Réalignement du mot de passe de la base..."
    printf "ALTER USER %s PASSWORD '%s';\n" "$PG_USER" "$PG_PASSWORD" \
      | docker compose exec -T database psql -U "$PG_USER" -d postgres -q
    docker compose restart backend predict-anomalie >/dev/null 2>&1
fi

# 6. Service vision (ai-vision/server.py) sur l'hôte
#
# Docker Desktop ne transmet pas la webcam aux conteneurs, le service tourne donc
# sur la machine et le backend l'appelle par host.docker.internal.
#
# On verifie que c'est bien NOTRE service qui repond, et pas n'importe quoi sur
# le port : le recepteur AirPlay de macOS occupe le 5000 et repond 403 a tout,
# ce qui faisait passer un port squatte pour un service en marche.
#
# A lancer depuis un vrai terminal : sur macOS l'autorisation camera appartient a
# l'application qui demarre le processus, pas au script. Lance depuis un autre
# programme, le service tourne mais ne peut pas ouvrir la camera.
VISION_PORT=$(grep '^SENTINEL_SERVICE_PORT=' ai-vision/.env 2>/dev/null | cut -d= -f2)
VISION_PORT="${VISION_PORT:-5001}"

if curl -s --max-time 2 "http://127.0.0.1:$VISION_PORT/health" 2>/dev/null | grep -q '"status"'; then
    echo "Service vision déjà lancé sur le port $VISION_PORT"
elif lsof -nP -iTCP:"$VISION_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $VISION_PORT déjà occupé par autre chose que le service vision."
    echo "   Changer SENTINEL_SERVICE_PORT dans ai-vision/.env, et VISION_SERVICE_URL"
    echo "   dans backend/.env et le .env racine."
elif [ -x ./ai-vision/.venv/Scripts/python.exe ]; then
    echo "Lancement du service vision (fenêtre séparée)..."
    (cd ai-vision && powershell.exe -NoProfile -Command \
        "Start-Process -FilePath '.venv\Scripts\python.exe' -ArgumentList 'server.py' -WindowStyle Minimized")
elif [ -x ./ai-vision/.venv/bin/python ]; then
    echo "Lancement du service vision sur le port $VISION_PORT (logs : ai-vision/server.log)..."
    (cd ai-vision && nohup .venv/bin/python server.py > server.log 2>&1 &)
    for _ in $(seq 1 15); do
        curl -s --max-time 1 "http://127.0.0.1:$VISION_PORT/health" 2>/dev/null | grep -q '"status"' && break
        sleep 1
    done
    curl -s --max-time 2 "http://127.0.0.1:$VISION_PORT/health" 2>/dev/null | grep -q '"status"' \
        && echo "   Service vision en ligne" \
        || echo "   Le service vision n'a pas démarré, voir ai-vision/server.log"
else
    echo "Service vision non lancé : venv ai-vision/.venv introuvable (voir ai-vision/README.md)"
fi

# 7. Le nœud IoT
#
# Son firmware embarque l'adresse du broker, du serveur de temps, et une copie du
# certificat : quand l'un des trois change, il faut le reflasher. Le flashage
# touche à du matériel, donc il ne part pas tout seul — sauf si on le demande.
if [ "$reflasher" = "1" ]; then
    echo
    if [ "${FLASH:-0}" = "1" ] && command -v pio >/dev/null; then
        echo "Flashage du nœud..."
        (cd firmware/esp01 && pio run -t upload)
    else
        echo "La configuration du nœud a changé : il doit être reflashé."
        echo "  cd firmware/esp01 && pio run -t upload"
        echo "  (ou FLASH=1 ./init.sh pour que ce script s'en charge)"
    fi
fi

echo
echo "Infrastructure déployée. Accès via https://localhost"
echo "Contrôle complet : ./scripts/check-stack.sh"