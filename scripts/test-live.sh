#!/bin/bash
# Démonstration en direct des phases 1 à 4 du backend (intégration esp01 + predict-anomalie).
# Simule le nœud esp01, predict-anomalie et la vision, puis affiche ce que le backend en a fait.
#
#   ./scripts/test-live.sh            pause entre chaque étape (Entrée pour continuer)
#   ./scripts/test-live.sh --no-pause enchaîne tout
#   ./scripts/test-live.sh 3          seulement la phase 3 (1, 2, 3 ou 4)
#
# Prérequis : stack lancée (docker compose up -d), backend/.env rempli. Aucun secret n'est affiché.
# À regarder en parallèle : le dashboard (https://localhost) et ./scripts/watch-live.sh
set -u
cd "$(dirname "$0")/.."

PAUSE=1; ONLY=""
for arg in "$@"; do
    case "$arg" in
        --no-pause) PAUSE=0 ;;
        [1-4]) ONLY="$arg" ;;
    esac
done

API=https://localhost/api/v1
ENV=backend/.env
val() { grep "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
key() { val DEVICE_API_KEYS | tr ',' '\n' | grep "^$1:" | cut -d: -f2; }
MQTT_USER=$(val MQTT_USERNAME); MQTT_PASS=$(val MQTT_PASSWORD)
export MSYS_NO_PATHCONV=1

title() { printf '\n\033[1;34m══ %s ══\033[0m\n' "$1"; }
step()  { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
note()  { printf '  \033[2m%s\033[0m\n' "$1"; }
wait_user() { [ "$PAUSE" = 1 ] && read -rp $'\n  [Entrée pour continuer] ' _; }
run_phase() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }

# --- outils -------------------------------------------------------------------------------------
pub() {   # pub <topic> <message> [options mosquitto_pub...]
    local topic=$1 msg=$2; shift 2
    docker run --rm --network sentinel-internal eclipse-mosquitto:2 \
        mosquitto_pub -h mosquitto -u "$MQTT_USER" -P "$MQTT_PASS" -q 1 -t "$topic" -m "$msg" "$@"
}
clear_retained() { docker run --rm --network sentinel-internal eclipse-mosquitto:2 \
    mosquitto_pub -h mosquitto -u "$MQTT_USER" -P "$MQTT_PASS" -q 1 -r -t "$1" -n; }
post_alert() {   # post_alert <appareil> <json>
    curl -sk -X POST "$API/alerts" -H 'Content-Type: application/json' -H "X-API-Key: $(key "$1")" \
        -d "$2" -w '\n  → HTTP %{http_code}\n'
}
api() {   # api <GET|POST> <chemin> [json]
    curl -sk -X "$1" "$API$2" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
        ${3:+-d "$3"} -w '\n  → HTTP %{http_code}\n'
}
sql() { docker compose exec -T database sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"$1\""; }
last_alerts() { sql "select id, device_id as source, emitter, type, level, detail from alerts order by id desc limit ${1:-5}"; }
last_commands() {
    api GET "/commands?limit=${1:-5}" | node -e '
        let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
            const json = s.slice(0, s.lastIndexOf("\n  →"));
            for (const c of JSON.parse(json)) console.log(`  ${c.id}  ${c.event.padEnd(20)} ${c.trigger.padEnd(7)} ${c.status.padEnd(8)} tentatives=${c.attempts} ${c.reason ?? ""}`);
        });'
}

# --- prérequis ----------------------------------------------------------------------------------
title "Vérifications"
HEALTH=$(curl -sk "$API/health")
echo "  $HEALTH"
echo "$HEALTH" | grep -q '"db":"up"' || { echo "  ✗ Base indisponible : lancer 'docker compose up -d'"; exit 1; }
echo "$HEALTH" | grep -q '"mqtt":"up"' || { echo "  ✗ Backend non connecté à MQTT (MQTT_USERNAME / MQTT_PASSWORD)"; exit 1; }
LOGIN=$(node -e 'console.log(JSON.stringify({username:process.argv[1],password:process.argv[2]}))' "$(val ADMIN_USERNAME)" "$(val ADMIN_PASSWORD)")
TOKEN=$(curl -sk -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "$LOGIN" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).token||"")}catch{console.log("")}})')
[ -n "$TOKEN" ] || { echo "  ✗ Connexion admin impossible (ADMIN_USERNAME / ADMIN_PASSWORD de backend/.env)"; exit 1; }
echo "  ✓ base, MQTT et connexion admin OK"
pub sentinel/esp01/status online   # point de départ : nœud en ligne
SEQ=$(( (RANDOM % 500) + 1000 ))   # suite de seq propre à ce lancement (évite les doublons d'un lancement à l'autre)
UP=$(( (RANDOM % 1000) + 5000 ))

# ================================================================================================
if run_phase 1; then
title "PHASE 1 — Le schéma accepte les briques, l'émetteur est distinct de la source"

step "Événement du nœud esp01 (format du §3.1) par la route HTTP"
post_alert esp01 "{\"type\":\"tamper_opened\",\"level\":\"warning\",\"value\":3,\"detail\":\"objectif\",\"origin\":\"sensor\",\"seq\":$SEQ,\"uptime_s\":$UP}"
note "Attendu : 201, detail/origin enregistrés, seq et uptime_s rangés dans meta"
wait_user

step "Alerte de predict-anomalie (format du §9.3) : émise par predictive, concerne esp01"
post_alert predictive "{\"type\":\"env_drift\",\"level\":\"info\",\"detail\":\"humidity +8%/h\",\"value\":0.91,\"origin\":\"model\",\"source\":\"esp01\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\",\"score\":0.91,\"contributions\":{\"humidity_resid\":0.48,\"humidity_slope\":0.3}}"
note "Attendu : 201, source = esp01, emitter = predictive (§10.6)"
wait_user

step "Usurpation : esp01 prétend parler pour esp02"
post_alert esp01 '{"type":"tamper_opened","source":"esp02"}'
note "Attendu : 403"
step "Champ hors contrat"
post_alert esp01 '{"type":"tamper_opened","pirate":true}'
note "Attendu : 400 (schéma strict)"
last_alerts 2
wait_user
fi

# ================================================================================================
if run_phase 2; then
title "PHASE 2 — Le bus MQTT déclenche les alarmes du boîtier"
note "Garder ./scripts/watch-live.sh ouvert : on y voit la commande partir vers sentinel/esp01/command"
SEQ=$((SEQ + 10)); UP=$((UP + 60))

step "Le nœud publie tamper_removed sur sentinel/esp01/events"
pub sentinel/esp01/events "{\"event\":\"tamper_removed\",\"level\":\"critical\",\"detail\":\"inclinaison\",\"value\":1,\"origin\":\"sensor\",\"seq\":$SEQ,\"uptime_s\":$UP}"
sleep 1
note "Attendu : alerte critique sur le dashboard + commande tamper_removed vers le nœud"
last_commands 1
CMD_ID=$(api GET "/commands?limit=1" | grep -o 'cmd-[0-9a-f]\{8\}' | head -1)
wait_user

step "Le nœud renvoie l'écho (origin: command, cmd_id) : accusé d'exécution"
pub sentinel/esp01/events "{\"event\":\"tamper_removed\",\"level\":\"critical\",\"origin\":\"command\",\"cmd_id\":\"$CMD_ID\",\"seq\":$((SEQ + 1)),\"uptime_s\":$((UP + 1))}"
sleep 1
note "Attendu : commande 'acked', AUCUNE nouvelle alerte ni commande (pas de boucle)"
last_commands 1
wait_user

step "Le même événement rejoué (même seq) : doublon"
pub sentinel/esp01/events "{\"event\":\"tamper_removed\",\"level\":\"critical\",\"detail\":\"inclinaison\",\"value\":1,\"origin\":\"sensor\",\"seq\":$SEQ,\"uptime_s\":$UP}"
sleep 1
note "Attendu : rien de nouveau"
last_alerts 2
wait_user

step "predict-anomalie publie env_critical sur le bus"
pub sentinel/predictive/events "{\"event\":\"env_critical\",\"level\":\"critical\",\"detail\":\"temperature +49.3/h\",\"value\":0.999,\"origin\":\"model\",\"source\":\"esp01\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\",\"score\":0.999,\"contributions\":{\"temperature_slope\":0.52}}"
sleep 1
note "Attendu : alerte sur esp01 (émetteur predictive) + commande env_critical vers esp01"
step "La vision essaie d'émettre une alerte d'environnement"
pub sentinel/vision/events '{"event":"env_critical","level":"critical"}'
note "Attendu : refusée (voir 'docker compose logs backend' : « vision ne peut pas émettre env_critical »)"
wait_user

step "Le module est arraché : le broker publie offline (testament)"
pub sentinel/esp01/status offline; sleep 1
note "Attendu : alerte critique node_offline"
pub sentinel/esp01/status online; sleep 1
note "Retour en ligne : alerte node_online"
last_alerts 3
wait_user
fi

# ================================================================================================
if run_phase 3; then
title "PHASE 3 — Le système insiste, trace et se souvient"
SEQ=$((SEQ + 100)); UP=$((UP + 300))
pub sentinel/esp01/status online

step "tamper_opened SANS écho du nœud : 3 tentatives puis abandon (≈ 6 s)"
pub sentinel/esp01/events "{\"event\":\"tamper_opened\",\"level\":\"warning\",\"detail\":\"objectif\",\"origin\":\"sensor\",\"seq\":$SEQ,\"uptime_s\":$UP}"
note "Pendant l'attente, watch-live.sh montre la même commande publiée 3 fois avec le même id"
sleep 7
last_commands 1
note "Attendu : failed, tentatives=3, et une alerte command_failed sur le dashboard"
wait_user

step "Trou de séquence : seq saute de $SEQ à $((SEQ + 3))"
pub sentinel/esp01/events "{\"event\":\"tamper_suspected\",\"level\":\"info\",\"detail\":\"pir\",\"value\":1,\"origin\":\"sensor\",\"seq\":$((SEQ + 3)),\"uptime_s\":$((UP + 20))}"
sleep 1
note "Attendu : alerte seq_gap « événements seq … perdus »"
last_alerts 2
wait_user

step "Le superviseur coupe le son des alarmes de sabotage (contrôle réactif)"
api POST /commands '{"node":"esp01","event":"deactivate","target":"sabotage","signal":"sonore"}'
note "Attendu : 202"
step "Commande invalide"
api POST /commands '{"node":"esp01","event":"reboot"}'
note "Attendu : 400 avec la liste des noms acceptés"
wait_user

step "Le nœud redémarre (node_boot) : il a oublié la coupure, le backend la lui renvoie"
pub sentinel/esp01/events '{"event":"node_boot","level":"info","origin":"sensor","seq":0,"uptime_s":2}'
sleep 1
last_commands 2
note "Attendu : une commande deactivate avec trigger=replay"
wait_user

step "Nœud hors ligne puis alarme manuelle : échec immédiat"
pub sentinel/esp01/status offline; sleep 1
api POST /commands '{"node":"esp01","event":"intrusion_prohibited"}'
note "Attendu : 503, failure = node_offline, rien n'est publié"
pub sentinel/esp01/status online
api POST /commands '{"node":"esp01","event":"activate"}' >/dev/null   # remet les signaux à leur état normal
wait_user
fi

# ================================================================================================
if run_phase 4; then
title "PHASE 4 — predict-anomalie : configuration, score, mesures"

step "La brique publie sa configuration (retenue) et un score"
pub sentinel/predictive/config '{"sensitivity":"high","window_days":30.0,"effective_days":0.25,"drift_quantile":0.9,"magnitude_ratio":1.2,"velocity_ratio":3.0,"persistence":2,"device_id":"predictive"}' -r
pub sentinel/predictive/score "{\"source\":\"esp01\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%S+00:00)\",\"stage\":\"anomaly\",\"score\":0.97,\"magnitude\":3.1,\"velocity\":1.2,\"sensitivity\":\"high\",\"window_days\":30.0}"
sleep 1
api GET /predictive/config
note "Attendu : window_days = 30 (demandé) ET effective_days = 0.25 (réellement couvert), §10.4"
api GET /predictive/scores
wait_user

step "Le superviseur règle la sensibilité et la fenêtre"
api POST /predictive/config '{"sensitivity":"medium","window_days":14}'
note "Attendu : 202, deux messages publiés en retenu sur sentinel/predictive/command"
note "⚠ Limite connue : le broker ne retient que le DERNIER (modify_window) — sensibilité perdue au redémarrage de la brique"
wait_user

step "Événement rejoué après coupure : télémétrie à uptime 900, puis événement daté de uptime 700"
pub sentinel/esp01/telemetry '{"uptime_s":900,"temperature_c":22.4,"humidity_pct":54.1,"presence":false,"presence_count":0,"tilt":"repos","optic":"repos"}'
sleep 1
pub sentinel/esp01/events "{\"event\":\"tamper_suspected\",\"level\":\"info\",\"detail\":\"inclinaison\",\"value\":1,\"origin\":\"sensor\",\"seq\":$(( (RANDOM % 500) + 3000 )),\"uptime_s\":700}"
sleep 2
sql "select type, created_at as recu, occurred_at as survenu, round(extract(epoch from created_at - occurred_at)) as ecart_s from alerts where type='tamper_suspected' order by id desc limit 1"
note "Attendu : survenu ≈ 200 s avant la réception"
wait_user

step "Mesures et routes de lecture de la brique"
api GET "/metrics?limit=3"
note "[] tant que predict-anomalie n'a rien écrit dans sensor_readings"
api GET /readings
note "503 tant que predict-anomalie n'a pas créé sensor_minutes"
api GET /predictive/state
note "503 si le conteneur predict-anomalie ne tourne pas"

step "Nettoyage des messages retenus de test"
clear_retained sentinel/predictive/command
clear_retained sentinel/predictive/config
note "Pour ne pas les appliquer au vrai démarrage de la brique"
fi

title "Terminé"
note "Historique complet : GET $API/commands et le dashboard. Les données de test restent en base (docker compose down -v pour repartir de zéro)."
