#!/usr/bin/env bash
#
# Sentinel-X — publication du flux caméra d'un poste vers le récepteur RTSP.
#
# La caméra reste branchée en USB sur l'hôte (macOS/Linux) : on encode en H.264
# et on pousse vers un serveur RTSP (mediamtx) qui, lui, peut tourner dans Docker.
#
#   ./scripts/publish-camera.sh --list      # lister les caméras disponibles
#   ./scripts/publish-camera.sh --check     # vérifier la config sans publier
#   ./scripts/publish-camera.sh             # publier (reconnexion automatique)
#
# Configuration : scripts/publish-camera.env (cf. publish-camera.env.example)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/publish-camera.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

# --- Configuration ------------------------------------------------------------
CAMERA_INDEX="${CAMERA_INDEX:-0}"
VIDEO_SIZE="${VIDEO_SIZE:-1280x720}"
FRAMERATE="${FRAMERATE:-25}"
BITRATE="${BITRATE:-2M}"

TARGET_HOST="${TARGET_HOST:-127.0.0.1}"
TARGET_PORT="${TARGET_PORT:-8554}"
STREAM_PATH="${STREAM_PATH:-sentinel}"
RTSP_USER="${RTSP_USER:-}"
RTSP_PASS="${RTSP_PASS:-}"

# Tunnel SSH : le flux sort chiffré et aucun port RTSP n'est exposé sur le LAN.
SSH_TUNNEL="${SSH_TUNNEL:-0}"
SSH_TARGET="${SSH_TARGET:-}"

RETRY_DELAY="${RETRY_DELAY:-3}"

# --- Détection de la plateforme ------------------------------------------------
case "$(uname -s)" in
  Darwin) INPUT_FORMAT="avfoundation"; INPUT_DEVICE="$CAMERA_INDEX" ;;
  Linux)  INPUT_FORMAT="v4l2";         INPUT_DEVICE="/dev/video${CAMERA_INDEX}" ;;
  *)      echo "Plateforme non supportée : $(uname -s)" >&2; exit 1 ;;
esac

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf 'Erreur : %s\n' "$*" >&2; exit 1; }

command -v ffmpeg >/dev/null || die "ffmpeg absent (brew install ffmpeg)"

# --- Listage des caméras -------------------------------------------------------
if [[ "${1:-}" == "--list" ]]; then
  if [[ "$INPUT_FORMAT" == "avfoundation" ]]; then
    ffmpeg -hide_banner -f avfoundation -list_devices true -i "" 2>&1 | grep -A20 'video devices' || true
  else
    ls /dev/video* 2>/dev/null || echo "Aucun /dev/video*"
  fi
  exit 0
fi

# --- Construction de l'URL de destination --------------------------------------
# Le tunnel SSH redirige 127.0.0.1:$TARGET_PORT vers le port du récepteur :
# ffmpeg publie alors en local et l'authentification RTSP devient superflue.
if [[ "$SSH_TUNNEL" == "1" ]]; then
  [[ -n "$SSH_TARGET" ]] || die "SSH_TUNNEL=1 exige SSH_TARGET (ex. user@192.168.1.20)"
  PUBLISH_HOST="127.0.0.1"
  CREDENTIALS=""
else
  PUBLISH_HOST="$TARGET_HOST"
  if [[ -n "$RTSP_USER" ]]; then
    [[ -n "$RTSP_PASS" ]] || die "RTSP_USER défini sans RTSP_PASS"
    CREDENTIALS="${RTSP_USER}:${RTSP_PASS}@"
  else
    CREDENTIALS=""
    [[ "$PUBLISH_HOST" == "127.0.0.1" || "$PUBLISH_HOST" == "localhost" ]] ||
      log "ATTENTION : publication vers $PUBLISH_HOST sans authentification."
  fi
fi

TARGET_URL="rtsp://${CREDENTIALS}${PUBLISH_HOST}:${TARGET_PORT}/${STREAM_PATH}"

# URL sans secret, pour les logs
if [[ -n "$CREDENTIALS" ]]; then
  SAFE_URL="rtsp://***@${PUBLISH_HOST}:${TARGET_PORT}/${STREAM_PATH}"
else
  SAFE_URL="rtsp://${PUBLISH_HOST}:${TARGET_PORT}/${STREAM_PATH}"
fi

if [[ "${1:-}" == "--check" ]]; then
  log "Entrée    : $INPUT_FORMAT $INPUT_DEVICE à ${VIDEO_SIZE}@${FRAMERATE}"
  log "Sortie    : $SAFE_URL"
  if [[ "$SSH_TUNNEL" == "1" ]]; then
    log "Tunnel SSH: oui ($SSH_TARGET)"
  else
    log "Tunnel SSH: non"
  fi
  exit 0
fi

# --- Tunnel SSH ----------------------------------------------------------------
TUNNEL_PID=""
cleanup() {
  [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
  log "Arrêt."
}
trap cleanup EXIT INT TERM

if [[ "$SSH_TUNNEL" == "1" ]]; then
  log "Ouverture du tunnel SSH vers $SSH_TARGET"
  ssh -N -o ExitOnForwardFailure=yes \
      -L "127.0.0.1:${TARGET_PORT}:127.0.0.1:${TARGET_PORT}" "$SSH_TARGET" &
  TUNNEL_PID=$!
  sleep 2
  kill -0 "$TUNNEL_PID" 2>/dev/null || die "le tunnel SSH n'a pas démarré"
fi

# --- Boucle de publication -----------------------------------------------------
log "Publication de $INPUT_DEVICE vers $SAFE_URL (Ctrl+C pour arrêter)"

while true; do
  ffmpeg -hide_banner -loglevel warning \
    -f "$INPUT_FORMAT" -framerate "$FRAMERATE" -video_size "$VIDEO_SIZE" \
    -i "$INPUT_DEVICE" \
    -an \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize "$BITRATE" \
    -g "$FRAMERATE" \
    -f rtsp -rtsp_transport tcp "$TARGET_URL" || true

  log "Flux interrompu, nouvelle tentative dans ${RETRY_DELAY}s"
  sleep "$RETRY_DELAY"
done
