#!/bin/bash
# Affiche en direct tout ce qui circule sur le bus Sentinel-X (événements, commandes, statuts...).
# À lancer dans un second terminal pendant ./scripts/test-live.sh ou une démo réelle. Ctrl+C pour quitter.
#
#   ./scripts/watch-live.sh             tout sauf la télémétrie (1 message / 2 s, trop bavard)
#   ./scripts/watch-live.sh --all       tout, télémétrie comprise
#   ./scripts/watch-live.sh --logs      logs du backend à la place du bus
set -u
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--logs" ]; then
    exec docker compose logs -f --tail 20 backend
fi

val() { grep "^$1=" backend/.env | head -1 | cut -d= -f2-; }
export MSYS_NO_PATHCONV=1
FILTER='/telemetry '
[ "${1:-}" = "--all" ] && FILTER='^$'

echo "Écoute de sentinel/# (Ctrl+C pour quitter)"
docker run --rm -i --network sentinel-internal eclipse-mosquitto:2 \
    mosquitto_sub -h mosquitto -u "$(val MQTT_USERNAME)" -P "$(val MQTT_PASSWORD)" -t 'sentinel/#' -v |
while IFS= read -r line; do
    [[ "$line" =~ $FILTER ]] && continue
    case "$line" in
        */command*) color='33' ;;   # jaune : ordres du backend
        */status*)  color='35' ;;   # violet : en ligne / hors ligne
        */events*)  color='36' ;;   # cyan : événements des briques
        *)          color='0'  ;;
    esac
    printf '%s \033[%sm%s\033[0m\n' "$(date +%T)" "$color" "$line"
done
