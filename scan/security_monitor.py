"""Surveillance des logs Mosquitto : chaque échec d'authentification MQTT devient une alerte Sentinel-X.

Les alertes passent par POST /api/v1/alerts avec la clé d'appareil "scan" : le backend les enregistre
et les pousse au dashboard en temps réel (Socket.io).

Lancement depuis n'importe quel dossier (la stack Docker doit tourner) :
    python scan/security_monitor.py
"""

import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent   # dossier de compose.yml


def _load_dotenv():
    """Charge scan/.env s'il existe (les variables déjà définies sont prioritaires)."""
    dotenv_path = BASE_DIR / ".env"
    if not dotenv_path.exists():
        return
    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = [part.strip() for part in line.split("=", 1)]
        if key and key not in os.environ:
            os.environ[key] = value.strip('"').strip("'")


_load_dotenv()

API_URL = os.getenv("SENTINEL_SCAN_API_URL", "https://localhost/api/v1/alerts")
API_KEY = os.getenv("SENTINEL_SCAN_API_KEY", "").strip()
CA_CERT = os.getenv("SENTINEL_CA_CERT", "").strip()
# Local uniquement : Traefik sert un certificat auto-signé
INSECURE_TLS = os.getenv("SENTINEL_SCAN_INSECURE_TLS", "0") == "1"

ALERT_COOLDOWN_S = 30      # une alerte "warning" max par IP sur cette durée
BRUTEFORCE_WINDOW_S = 60   # fenêtre de comptage des échecs
BRUTEFORCE_THRESHOLD = 5   # échecs dans la fenêtre -> alerte "critical"
RESTART_DELAY_S = 5        # si "docker compose logs" s'arrête (conteneur redémarré...)

# Client auto-8DB0888F-... [::1:49198] disconnected: not authorised.
AUTH_FAILURE = re.compile(r"Client (?P<client>\S+) \[(?P<ip>.+):\d+\] disconnected: not authorised")

if not API_KEY:
    sys.exit("SENTINEL_SCAN_API_KEY manquante (voir scan/.env.example)")


def _ssl_context():
    if INSECURE_TLS:
        print("Attention : certificat TLS non vérifié (SENTINEL_SCAN_INSECURE_TLS=1)")
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context
    return ssl.create_default_context(cafile=CA_CERT or None)


SSL_CONTEXT = _ssl_context()


def send_alert(alert_type, level, value):
    """POST vers l'API. Le schéma est strict : type, level, value (objet plat, chaînes <= 100 car.)."""
    payload = {"type": alert_type, "level": level, "value": value}
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5, context=SSL_CONTEXT):
            print(f"Alerte envoyée : {alert_type} ({level}) {value}")
    except urllib.error.HTTPError as e:
        print(f"Alerte refusée par l'API ({e.code}) : {e.read().decode('utf-8', 'replace')[:200]}")
    except Exception as e:
        print(f"Impossible de joindre l'API (la stack est-elle lancée ?) : {e}")


class AuthFailureTracker:
    """Regroupe les échecs par IP pour ne pas inonder le dashboard pendant une attaque."""

    def __init__(self):
        self.failures = defaultdict(deque)        # ip -> dates des échecs récents
        self.last_alert = defaultdict(lambda: 0.0)  # (ip, type) -> date de la dernière alerte

    def record(self, ip, client):
        now = time.monotonic()
        failures = self.failures[ip]
        failures.append(now)
        while failures and now - failures[0] > BRUTEFORCE_WINDOW_S:
            failures.popleft()

        value = {"ip": ip[:100], "client": client[:100], "failures": len(failures)}
        if len(failures) >= BRUTEFORCE_THRESHOLD:
            self._alert(ip, "mqtt_bruteforce", "critical", value, now)
        else:
            self._alert(ip, "mqtt_auth_failure", "warning", value, now)

    def _alert(self, ip, alert_type, level, value, now):
        if now - self.last_alert[(ip, alert_type)] < ALERT_COOLDOWN_S:
            return
        self.last_alert[(ip, alert_type)] = now
        send_alert(alert_type, level, value)


def follow_logs(tracker):
    # --tail 0 : seulement les nouvelles lignes (pas de renvoi de l'historique au démarrage)
    process = subprocess.Popen(
        ["docker", "compose", "logs", "-f", "--tail", "0", "--no-log-prefix", "mosquitto"],
        cwd=ROOT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        for line in process.stdout:
            match = AUTH_FAILURE.search(line)
            if match:
                tracker.record(match["ip"], match["client"])
    finally:
        process.terminate()


def main():
    print(f"Surveillance cyber Sentinel-X activée (alertes vers {API_URL})")
    tracker = AuthFailureTracker()
    while True:
        follow_logs(tracker)
        print(f"Flux de logs Mosquitto interrompu, reprise dans {RESTART_DELAY_S} s...")
        time.sleep(RESTART_DELAY_S)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Surveillance arrêtée")
