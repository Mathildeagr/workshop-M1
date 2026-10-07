#!/usr/bin/env bash
# Contrôle la stack, et permet de regarder arriver les mesures du nœud.
#
#   ./scripts/check-stack.sh            contrôles : services, broker, base, brique
#   ./scripts/check-stack.sh --watch    panneau rafraîchi, pour regarder le flux
#   ./scripts/check-stack.sh --bus      tout ce qui circule sur le broker, brut
#   ./scripts/check-stack.sh --seed 30  sème un historique de synthèse et réentraîne
#
# N'a besoin d'aucune dépendance sur la machine : tout passe par les conteneurs.

set -uo pipefail
cd "$(dirname "$0")/.."

MODE=check
SEED_DAYS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch) MODE=watch; shift ;;
    --bus)   MODE=bus; shift ;;
    --seed)  SEED_DAYS="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "option inconnue : $1"; exit 2 ;;
  esac
done

PASSED=0; FAILED=0
ok()    { printf '  \033[32mOK\033[0m     %s\n' "$1"; PASSED=$((PASSED + 1)); }
ko()    { printf '  \033[31mÉCHEC\033[0m  %s\n' "$1"; FAILED=$((FAILED + 1)); }
note()  { printf '         %s\n' "$1"; }
title() { printf '\n\033[1m%s\033[0m\n' "$1"; }

for file in .env backend/.env firmware/esp01/src/config/secrets.h; do
  [[ -f "$file" ]] || { echo "Fichier manquant : $file — lancer ./scripts/generate-secrets.py"; exit 1; }
done

PG_PASSWORD=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2)
PG_USER=$(grep '^POSTGRES_USER=' .env | cut -d= -f2)
PG_DB=$(grep '^POSTGRES_DB=' .env | cut -d= -f2)
MQTT_BACKEND=$(grep '^MQTT_PASSWORD=' backend/.env | cut -d= -f2)
MQTT_PREDICT=$(grep '^PREDICT_MQTT_PASSWORD=' .env | cut -d= -f2)
MQTT_ESP=$(sed -n 's/.*MQTT_PASSWORD  *"\(.*\)".*/\1/p' firmware/esp01/src/config/secrets.h)

# Les mots de passe passent par l'environnement du conteneur, pas par la ligne de
# commande : ils n'apparaissent donc dans la liste des processus de personne.
bus() {  # bus <outil> <utilisateur> <mot de passe> <arguments...>
  local tool="$1" user="$2" password="$3"; shift 3
  local args; args=$(printf '%q ' "$@")
  docker run --rm --network sentinel-internal -e PW="$password" eclipse-mosquitto:2 \
    sh -c "$tool -h mosquitto -u $(printf '%q' "$user") -P \"\$PW\" $args" 2>/dev/null
}

sql() { docker compose exec -T -e PGPASSWORD="$PG_PASSWORD" database \
          psql -h 127.0.0.1 -U "$PG_USER" -d "$PG_DB" -tAc "$1" 2>/dev/null \
          | tr -d '\r' | sed 's/^ *//; s/ *$//'; }

api() { docker compose exec -T predict-anomalie python -c "
import json, sys, urllib.request
try:
    print(urllib.request.urlopen('http://127.0.0.1:8000/$1', timeout=4).read().decode())
except Exception as error:
    print(json.dumps({'erreur': str(error)})); sys.exit(1)
" 2>/dev/null; }

jget() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }

# ------------------------------------------------------------------ bus brut

if [[ "$MODE" == bus ]]; then
  echo "Tout ce qui circule sur le broker. Ctrl+C pour arrêter."
  echo
  docker run --rm -it --network sentinel-internal -e PW="$MQTT_BACKEND" eclipse-mosquitto:2 \
    sh -c 'mosquitto_sub -h mosquitto -u backend -P "$PW" -t "sentinel/#" -v' 
  exit 0
fi

# -------------------------------------------------------------------- veille

if [[ "$MODE" == watch ]]; then
  previous_rows=0; previous_time=0
  printf '\033[2J'
  while true; do
    now=$(date +%s)
    rows=$(sql 'select count(*) from sensor_readings'); rows=${rows:-0}
    minutes=$(sql 'select count(*) from sensor_minutes'); minutes=${minutes:-0}
    alerts=$(sql 'select count(*) from alerts'); alerts=${alerts:-0}
    last=$(sql "select round(temperature::numeric,1)||' C   '||round(humidity::numeric,1)||' %   '
                     ||coalesce(round(gas_ratio::numeric,2)::text,'gaz absent')
                     ||'   il y a '||round(extract(epoch from now()-measured_at))||' s'
                from sensor_readings order by measured_at desc limit 1")

    rate=""
    if [[ "$previous_time" -gt 0 && "$now" -gt "$previous_time" ]]; then
      rate=$(awk -v d=$((rows - previous_rows)) -v s=$((now - previous_time)) \
             'BEGIN{printf "%+.1f/min", d*60/s}')
    fi
    previous_rows=$rows; previous_time=$now

    state=$(api state); model=$(api model)

    printf '\033[H\033[2J\033[1mFlux capteurs — %s\033[0m\n\n' "$(date +%H:%M:%S)"
    printf '  base       %s mesures brutes  %s\n' "$rows" "$rate"
    printf '             %s minutes repliées, %s alertes\n' "$minutes" "$alerts"
    printf '  dernière   %s\n' "${last:-aucune mesure}"

    if [[ "$(jget ready <<<"$model")" == "True" ]]; then
      printf '  modèle     prêt — %s minutes, %s jours couverts\n' \
        "$(jget rows <<<"$model")" "$(jget effective_days <<<"$model")"
    else
      available=$(jget minutes_available <<<"$model")
      required=$(jget minutes_required <<<"$model")
      printf '  modèle     \033[33mpas encore\033[0m — %s minutes sur %s nécessaires\n' \
        "${available:-?}" "${required:-?}"
      printf '             dernière tentative %s, nouvelle dans 2 min\n' \
        "$(jget attempted_at <<<"$model" | cut -dT -f2 | cut -d. -f1)"
    fi

    python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print('  brique     injoignable'); raise SystemExit
sources = data.get('sources', [])
if not sources:
    print('  nœuds      \033[33maucune mesure reçue pour l\'instant\033[0m')
for source in sources:
    silence = source.get('silent_for_s')
    couleur = '\033[31m' if source.get('silent') else '\033[32m'
    print(f\"  {source['source']:<10} {couleur}{silence} s depuis la dernière mesure\033[0m\"
          f\"  ·  {source['samples']} reçues\")
    print(f\"             état {source['stage']}  score {source.get('score')}\"
          f\"  ampleur {source.get('magnitude')}  vitesse {source.get('velocity')}\")
    if source.get('last_event'):
        print(f\"             dernier événement : {source['last_event']}\")
queued = data.get('queued_events', 0)
if queued:
    print(f\"  file       \033[33m{queued} événements en attente d'envoi\033[0m\")
# Une file d'écriture qui monte sans jamais redescendre veut dire que la base
# refuse les mesures. Sans ce compteur, le panneau afficherait des mesures reçues
# et une base vide, sans dire pourquoi.
pending = data.get('pending_writes', 0)
if pending:
    print(f\"  écriture   \033[33m{pending} mesures en attente d'insertion\033[0m\")
dropped = data.get('dropped_writes', 0)
if dropped:
    print(f\"             \033[31m{dropped} mesures perdues, file pleine\033[0m\")
" <<<"$state"
    printf '\n  Ctrl+C pour arrêter\n'
    sleep 3
  done
fi

# ----------------------------------------------------------------- contrôles

title "Services"
for service in database mosquitto backend predict-anomalie; do
  status=$(docker compose ps --format '{{.Service}} {{.Status}}' 2>/dev/null \
           | awk -v s="$service" '$1 == s {$1=""; print}')
  [[ "$status" == *Up* ]] && ok "$service$status" || ko "$service :${status:- absent}"
done

title "Mosquitto"
for pair in "backend:$MQTT_BACKEND" "esp01:$MQTT_ESP" "predictive:$MQTT_PREDICT"; do
  user="${pair%%:*}"; password="${pair#*:}"
  if bus mosquitto_pub "$user" "$password" -t "sentinel/selftest/$user" -m ok >/dev/null; then
    ok "compte $user authentifié"
  else
    ko "compte $user refusé par le broker"
  fi
done

retained=$(bus mosquitto_sub backend "$MQTT_BACKEND" -t 'sentinel/predictive/#' -v -W 3)
grep -q 'predictive/status online' <<<"$retained" \
  && ok "la brique s'annonce en ligne (topic retenu)" \
  || ko "topic status absent ou à offline"
grep -q 'predictive/config' <<<"$retained" \
  && ok "configuration effective publiée en retenu" \
  || ko "topic config absent : le backend ne peut pas lire le réglage courant"

title "Base de données"
if [[ "$(sql 'select 1')" == "1" ]]; then
  ok "authentification par le réseau"
else
  ko "connexion refusée — mot de passe désaligné avec le volume db-data ?"
  note "Postgres n'applique POSTGRES_PASSWORD qu'à l'initialisation d'un volume vierge."
  note "Réaligner : printf \"ALTER USER $PG_USER PASSWORD '<mdp du .env>';\" \\"
  note "            | docker compose exec -T database psql -U $PG_USER -d postgres"
fi
for table in sensor_readings sensor_minutes alerts devices; do
  if [[ "$(sql "select to_regclass('$table') is not null")" == "t" ]]; then
    ok "table $table : $(sql "select count(*) from $table") lignes"
  else
    ko "table $table absente"
  fi
done

if [[ "$SEED_DAYS" != "0" ]]; then
  title "Historique de synthèse"
  if docker compose exec -T predict-anomalie seed-history --days "$SEED_DAYS" >/dev/null 2>&1; then
    ok "$SEED_DAYS jours semés — données FABRIQUÉES, à annoncer comme telles"
    bus mosquitto_pub backend "$MQTT_BACKEND" -q 1 -t sentinel/predictive/command \
        -m '{"event":"retrain"}' >/dev/null
    note "réapprentissage demandé, il prend quelques secondes"
    sleep 12
  else
    ko "le semis a échoué"
  fi
fi

title "Brique predict-anomalie"
health=$(api health)
[[ "$(jget status <<<"$health")" == "ok" ]] \
  && ok "en bonne santé : bus et base joignables" \
  || ko "état dégradé : $health"

state=$(api state)
sources=$(python3 -c "
import json, sys
for s in json.load(sys.stdin).get('sources', []):
    print(f\"{s['source']} : {s['samples']} mesures reçues, état {s['stage']},\"
          f\" dernière il y a {s.get('silent_for_s')} s\")
" <<<"$state" 2>/dev/null)
if [[ -n "$sources" ]]; then
  ok "le flux du nœud est reçu"
  while IFS= read -r line; do note "$line"; done <<<"$sources"
else
  note "aucune mesure reçue pour l'instant — normal si le nœud n'est pas encore allumé"
fi

model=$(api model)
if [[ "$(jget ready <<<"$model")" == "True" ]]; then
  ok "modèle entraîné : $(jget rows <<<"$model") minutes, $(jget effective_days <<<"$model") jours"
  [[ "$(jget jump_calibrated <<<"$model")" == "True" ]] \
    && ok "calibration des sauts en place" \
    || note "calibration des sauts absente : quelques minutes de brut suffisent, elle se rattrape au repli"
else
  available=$(jget minutes_available <<<"$model")
  required=$(jget minutes_required <<<"$model")
  ko "pas encore de modèle : ${available:-?} minutes en base sur ${required:-?} nécessaires"
  note "dernière tentative : $(jget attempted_at <<<"$model"), nouvelle dans 2 min"
  note "pour ne pas attendre deux heures de mesures : ./scripts/check-stack.sh --seed 30"
fi

title "Bilan"
printf '  %d contrôles passés, %d en échec\n' "$PASSED" "$FAILED"
printf '  Pour regarder arriver les mesures : ./scripts/check-stack.sh --watch\n\n'
[[ "$FAILED" -eq 0 ]]
