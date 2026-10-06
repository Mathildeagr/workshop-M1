# workshop-M1

## Lancer la stack (Docker Compose)

Services : Traefik (entrée HTTP + MQTT), Mosquitto, PostgreSQL, API backend, dashboard.

### 1. Configuration (une seule fois)

```bash
cp .env.example .env                    # identifiants Postgres (+ HTTP_PORT si le port 80 est pris)
cp backend/.env.example backend/.env    # secrets de l'API : JWT, clés des appareils, admin, MQTT
```

Remplacer toutes les valeurs `CHANGE_ME`. Pour générer un secret :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Comptes MQTT (une seule fois)

Mosquitto refuse les connexions anonymes. Créer le compte du backend (même mot de passe que `MQTT_PASSWORD` dans `backend/.env`) :

```bash
docker run --rm -v "$(pwd)/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 sh -c \
  "mosquitto_passwd -c -b /mosquitto/config/passwd backend <MQTT_PASSWORD> && chown mosquitto:mosquitto /mosquitto/config/passwd"
```

Pour ajouter un autre compte (ex : l'ESP8266), même commande **sans `-c`** (sinon le fichier est écrasé), puis `docker compose restart mosquitto`.

Sous Git Bash (Windows), préfixer la commande par `MSYS_NO_PATHCONV=1` et remplacer `$(pwd)` par `$(pwd -W)`.

### 3. Démarrer

```bash
docker compose up -d --build
docker compose ps        # tous les services doivent être "Up" (healthy pour database, backend, frontend)
```

| Accès | URL |
|---|---|
| Dashboard | `http://localhost` (ou `http://localhost:<HTTP_PORT>`) |
| API | `http://localhost/api/v1/health` |
| MQTT | `localhost:1883` (authentification obligatoire) |

Depuis une autre machine de la table (ESP8266, PC), remplacer `localhost` par l'IP du PC Serveur Local.

### Commandes utiles

```bash
docker compose logs -f backend      # logs d'un service
docker compose down                 # arrêter (les données sont conservées)
docker compose down -v              # arrêter ET supprimer la base (repartir de zéro)
```
