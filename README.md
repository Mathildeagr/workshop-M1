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

### Vérifier que tout va bien

```bash
./scripts/check-stack.sh            # services, comptes du broker, base, brique
./scripts/check-stack.sh --watch    # panneau rafraîchi : les mesures qui arrivent
./scripts/check-stack.sh --bus      # tout ce qui circule sur le broker, brut
```

Le panneau de veille montre le nombre de mesures en base et leur cadence, la
dernière relevée, le silence depuis la précédente, l'état du modèle et celui de
chaque nœud. C'est ce qu'il faut ouvrir en allumant le boîtier.

### Sur le réseau de table, sans accès à Internet

Le sous-réseau est étanche. Docker ne peut alors ni vérifier ni télécharger
d'image, et une construction échoue avant même de commencer. `init.sh` le
détecte et démarre sur les images déjà construites.

**Il faut donc construire tant qu'il y a du réseau :**

```bash
docker compose build        # avant de rejoindre le réseau de table
```

Sans cette étape, une brique dont le code a changé démarrera dans sa version
précédente, sans que rien ne le signale.

Le serveur de temps, lui, fonctionne hors ligne : sa configuration ajoute
`local stratum 10`, donc il sert sa propre horloge faute de source amont. Sans
ça il se déclarerait non synchronisé et **refuserait de répondre** — et le nœud,
qui exige une horloge juste avant toute poignée de main TLS, resterait muet.

### Dépannage

**`password authentication failed for user "sentinel"`** après avoir régénéré les
secrets. PostgreSQL n'applique `POSTGRES_PASSWORD` qu'à l'initialisation d'un
volume vierge : une base déjà créée garde son ancien mot de passe. Le réaligner
sans rien perdre :

```bash
printf "ALTER USER sentinel PASSWORD '$(grep ^POSTGRES_PASSWORD= .env | cut -d= -f2)';" \
  | docker compose exec -T database psql -U sentinel -d postgres
```

Puis `docker compose restart backend predict-anomalie`. L'alternative,
`docker compose down -v`, repart d'une base vierge et **supprime les données**.

**`pas de modèle : 0 minutes exploitables`**. La brique d'analyse a besoin de deux
heures de mesures avant de pouvoir apprendre. Pour ne pas attendre :

```bash
./scripts/check-stack.sh --seed 30
```

Ces données sont **fabriquées** et doivent être annoncées comme telles.

### Commandes utiles

```bash
docker compose logs -f backend      # logs d'un service
docker compose down                 # arrêter (les données sont conservées)
docker compose down -v              # arrêter ET supprimer la base (repartir de zéro)
```
