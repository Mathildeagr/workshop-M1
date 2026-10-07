# workshop-M1

## Lancer la stack (Docker Compose)

Services : Traefik (entrée HTTPS + MQTTS), Mosquitto, serveur de temps NTP,
PostgreSQL, API backend, dashboard, détection d'anomalies d'environnement,
et vision par caméra (profil `vision`).

### 1. Secrets (une seule fois)

Un seul script génère tout : mots de passe Postgres, secret JWT, clés d'appareil,
compte admin, jeton du service vision, comptes MQTT du broker, et les
identifiants embarqués dans le firmware de l'ESP8266.

```bash
./scripts/generate-secrets.py --host-ip <IP du PC serveur sur le réseau de table>
```

Il écrit `.env`, `backend/.env`, `ai-vision/.env`, `mosquitto/config/passwd` et
`firmware/esp01/src/config/secrets.h`. Aucun de ces fichiers n'est versionné.

**Pourquoi un script plutôt que des `cp .env.example .env`** : une même valeur
apparaît dans plusieurs fichiers. La clé `predictive` est lue par le backend et
par la brique d'analyse, le jeton vision par le backend et par le service Python,
et chaque mot de passe MQTT par son client *et* par le broker. Les recopier à la
main, c'est se garantir une erreur introuvable le jour de la démonstration.

C'est tout ou rien : le script refuse de remplacer un jeu existant sans
`--force`, parce qu'en régénérer une partie casserait le reste.

Le SSID et le mot de passe Wi-Fi sont les seules valeurs que le script ne peut
pas inventer. Il conserve celles déjà présentes, sinon :

```bash
./scripts/generate-secrets.py --host-ip 10.174.182.37 \
  --wifi-ssid sentinel-x --wifi-password <mot de passe>
```

L'adresse passée en `--host-ip` devient celle du broker MQTT **et** du serveur de
temps vus par le nœud. Elle doit être l'adresse de la machine **sur le
sous-réseau de table**, pas celle de sa connexion Internet : le script avertit si
elle n'est pas dans le même sous-réseau que l'adresse fixe du nœud.

### 2. Identifiants admin

Le compte admin du dashboard est créé au premier démarrage du backend. Son mot de
passe est dans `backend/.env`, ligne `ADMIN_PASSWORD`.

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
