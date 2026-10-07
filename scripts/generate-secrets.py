#!/usr/bin/env python3
"""Génère tous les secrets du projet et les écrit là où chaque brique les attend.

Une même valeur doit apparaître dans plusieurs fichiers — la clé « predictive »
est lue par le backend et par la brique d'analyse, le jeton vision par le backend
et par le service Python, chaque mot de passe MQTT par son client et par le
broker. Les recopier à la main, c'est se garantir une erreur introuvable un jeudi
matin. Ce script est la source unique.

    ./scripts/generate-secrets.py --host-ip 10.174.182.37

Il ne réécrit jamais un fichier existant sans --force, sauf ai-vision/.env dont
il ne remplace que les deux lignes de jetons pour préserver la configuration
caméra. Il conserve aussi le SSID et le mot de passe Wi-Fi déjà renseignés.

Aucune valeur générée n'est affichée : tout est dans les fichiers.
"""

from __future__ import annotations

import argparse
import ipaddress
import re
import secrets
import shutil
import string
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Comptes MQTT : un par client, pour qu'une fuite n'ouvre pas tout le bus.
MQTT_ACCOUNTS = ("backend", "esp01", "predictive")

# Le backend exige au moins 32 caractères par clé d'appareil et pour le JWT,
# et 12 pour le mot de passe admin (voir backend/src/config.js et server.js).
DEVICE_IDS = ("esp01", "vision", "predictive")

ALNUM = string.ascii_letters + string.digits


def alnum(length: int) -> str:
    """Lettres et chiffres seulement.

    Les mots de passe Postgres sont insérés tels quels dans une URL de connexion,
    et ceux de MQTT passent par mosquitto_passwd : tout caractère réservé y serait
    une source de panne silencieuse.
    """
    return "".join(secrets.choice(ALNUM) for _ in range(length))


def hexkey(length: int) -> str:
    return secrets.token_hex(length // 2)


def read_defines(path: Path) -> dict[str, str]:
    """Relit les #define d'un secrets.h pour conserver ce que seul l'humain sait."""
    if not path.exists():
        return {}
        
    found = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r'\s*#define\s+(\w+)\s+(.+?)\s*$', line)
        if match:
            found[match.group(1)] = match.group(2)
    return found


def quoted(value: str) -> str:
    return value.strip().strip('"')


def write(path: Path, content: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(mode)
    print(f"  écrit      {path.relative_to(ROOT)}")


def hash_mosquitto(passwords: dict[str, str]) -> None:
    """Écrit le fichier de comptes du broker, puis le fait hacher par mosquitto.

    Les mots de passe ne passent pas par la ligne de commande : mosquitto_passwd -U
    hache un fichier en place, donc rien n'apparaît dans la liste des processus.
    """
    target = ROOT / "mosquitto" / "config" / "passwd"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "".join(f"{user}:{password}\n" for user, password in passwords.items()),
        encoding="utf-8",
    )
    # 0644 et non 0600 : le fichier est monté dans le conteneur, où mosquitto
    # tourne sous son propre compte et doit pouvoir le lire. Il avertit qu'il est
    # lisible par tous, mais il ne contient que des empreintes bcrypt — un broker
    # qui refuse de démarrer coûte plus cher.
    target.chmod(0o644)

    if shutil.which("docker") is None:
        print(f"  écrit      {target.relative_to(ROOT)}  EN CLAIR : docker absent")
        print("             à hacher avec : mosquitto_passwd -U mosquitto/config/passwd")
        return

    result = subprocess.run(
        [
            "docker", "run", "--rm",
            "-v", f"{target.parent}:/mosquitto/config",
            "eclipse-mosquitto:2",
            "sh", "-c",
            "mosquitto_passwd -U /mosquitto/config/passwd"
            " ; chown mosquitto:mosquitto /mosquitto/config/passwd 2>/dev/null || true",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  ATTENTION  {target.relative_to(ROOT)} est EN CLAIR")
        print(f"             docker a échoué : {result.stderr.strip().splitlines()[-1:]}")
        return
    print(f"  écrit      {target.relative_to(ROOT)}  (haché par mosquitto)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--host-ip",
        required=True,
        help="adresse du PC serveur SUR LE SOUS-RÉSEAU DE TABLE (broker MQTT et NTP)",
    )
    parser.add_argument("--esp-ip", help="adresse fixe du nœud (défaut : celle déjà en place)")
    parser.add_argument("--wifi-ssid", help="défaut : celui déjà en place")
    parser.add_argument("--wifi-password", help="défaut : celui déjà en place")
    parser.add_argument("--force", action="store_true", help="remplace les fichiers existants")
    args = parser.parse_args()

    try:
        host_ip = ipaddress.IPv4Address(args.host_ip)
    except ipaddress.AddressValueError:
        parser.error(f"--host-ip invalide : {args.host_ip}")

    secrets_h = ROOT / "firmware" / "esp01" / "src" / "config" / "secrets.h"
    existing = read_defines(secrets_h)

    esp_ip = args.esp_ip or existing.get("NET_STATIC_IP", "").replace(" ", "").replace(",", ".")
    gateway = existing.get("NET_GATEWAY", "").replace(" ", "").replace(",", ".")
    subnet = existing.get("NET_SUBNET", "255,255,255,0").replace(" ", "").replace(",", ".")
    dns = existing.get("NET_DNS", gateway).replace(" ", "").replace(",", ".")

    if not esp_ip:
        parser.error("aucune adresse d'ESP connue : passer --esp-ip")
    if not gateway:
        gateway = dns = str(ipaddress.IPv4Network(f"{esp_ip}/{subnet}", strict=False)[1])

    # Le nœud et le broker doivent être sur le même sous-réseau, sinon
    # l'association Wi-Fi réussit et rien ne passe.
    network = ipaddress.IPv4Network(f"{esp_ip}/{subnet}", strict=False)
    if host_ip not in network:
        print(f"ATTENTION : {host_ip} est hors de {network}, où se trouve le nœud {esp_ip}.")
        print("            Le nœud s'associera au Wi-Fi mais ne joindra pas le broker.")
    if str(host_ip) == esp_ip:
        parser.error("le PC serveur et le nœud ne peuvent pas avoir la même adresse")

    # Le mot de passe MQTT du nœud et le fichier de comptes du broker viennent du
    # même tirage. Écrire l'un sans l'autre produirait un nœud que le broker
    # refuse, et une panne qui ressemble à tout sauf à sa cause.
    targets = [
        ROOT / ".env",
        ROOT / "backend" / ".env",
        secrets_h,
        ROOT / "mosquitto" / "config" / "passwd",
    ]
    present = [t for t in targets if t.exists()]
    if present and not args.force:
        print("Des secrets existent déjà :")
        for path in present:
            print(f"  {path.relative_to(ROOT)}")
        print("\nIls forment un jeu cohérent entre eux. En remplacer une partie")
        print("casserait les autres, donc c'est tout ou rien : relancer avec --force")
        print("pour tirer un jeu neuf, ce qui invalide l'ancien partout à la fois.")
        return 1

    ssid = args.wifi_ssid or quoted(existing.get("WIFI_SSID", ""))
    wifi_password = args.wifi_password or quoted(existing.get("WIFI_PASSWORD", ""))
    if not ssid:
        parser.error("aucun SSID connu : passer --wifi-ssid")

    # --- génération ---------------------------------------------------------

    postgres_password = alnum(32)
    jwt_secret = hexkey(64)
    admin_password = alnum(24)
    vision_token = hexkey(64)
    device_keys = {device: hexkey(48) for device in DEVICE_IDS}
    mqtt_passwords = {account: alnum(24) for account in MQTT_ACCOUNTS}

    postgres_user, postgres_db = "sentinel", "sentinelx"
    timezone = quoted(existing.get("NTP_TIMEZONE", "")) or "CET-1CEST,M3.5.0,M10.5.0/3"

    print(f"Secrets de production, PC serveur {host_ip}, nœud {esp_ip} sur {network}\n")

    # --- .env de la racine, lu par compose ----------------------------------

    write(ROOT / ".env", f"""# Généré par scripts/generate-secrets.py — ne pas committer, ne pas recopier à la main.
# Relancer le script plutôt que d'éditer : plusieurs fichiers partagent ces valeurs.

POSTGRES_USER={postgres_user}
POSTGRES_PASSWORD={postgres_password}
POSTGRES_DB={postgres_db}

# Port HTTP exposé par Traefik (443 par défaut, voir compose.yml)
# HTTP_PORT=8000

# Jeton partagé backend <-> service vision. Même valeur que SENTINEL_SERVICE_TOKEN
# dans ai-vision/.env quand le service tourne sur l'hôte.
VISION_SERVICE_TOKEN={vision_token}
# Profil "vision" uniquement : clé "vision" de DEVICE_API_KEYS
VISION_API_KEY={device_keys["vision"]}

# Brique predict-anomalie : compte MQTT et clé d'appareil
PREDICT_MQTT_USER=predictive
PREDICT_MQTT_PASSWORD={mqtt_passwords["predictive"]}
PREDICT_API_KEY={device_keys["predictive"]}
""")

    # --- backend ------------------------------------------------------------

    origins = ",".join(["https://sentinel.localhost", "https://localhost", f"https://{host_ip}"])
    write(ROOT / "backend" / ".env", f"""# Généré par scripts/generate-secrets.py — ne pas committer.
# Sous Docker, compose.yml impose DATABASE_URL, CORS_ORIGINS et TRUST_PROXY :
# les valeurs ci-dessous ne servent qu'à un lancement direct sur la machine.

PORT=3000
DATABASE_URL=postgres://{postgres_user}:{postgres_password}@localhost:5432/{postgres_db}

JWT_SECRET={jwt_secret}
JWT_EXPIRES_IN=8h

CORS_ORIGINS={origins}
TRUST_PROXY=0

# Une clé par appareil. L'id devient la "source" des alertes envoyées avec cette clé.
DEVICE_API_KEYS={",".join(f"{device}:{key}" for device, key in device_keys.items())}

# Premier compte admin, créé au démarrage s'il n'existe aucun admin.
ADMIN_USERNAME=admin
ADMIN_PASSWORD={admin_password}

# Compte MQTT du backend : le même que dans mosquitto/config/passwd
MQTT_USERNAME=backend
MQTT_PASSWORD={mqtt_passwords["backend"]}

# Service vision (ai-vision/server.py)
VISION_SERVICE_URL=http://127.0.0.1:5000
VISION_SERVICE_TOKEN={vision_token}
""")

    # --- ai-vision : on ne touche qu'aux jetons ------------------------------

    vision_env = ROOT / "ai-vision" / ".env"
    replacements = {
        "SENTINEL_API_TOKEN": device_keys["vision"],
        "SENTINEL_SERVICE_TOKEN": vision_token,
    }
    if vision_env.exists():
        lines = vision_env.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            for key, value in replacements.items():
                if line.startswith(f"{key}="):
                    lines[index] = f"{key}={value}"
        vision_env.write_text("\n".join(lines) + "\n", encoding="utf-8")
        vision_env.chmod(0o600)
        print(f"  jetons     {vision_env.relative_to(ROOT)}  (reste conservé)")
    elif (ROOT / "ai-vision" / ".env.example").exists():
        content = (ROOT / "ai-vision" / ".env.example").read_text(encoding="utf-8")
        for key, value in replacements.items():
            content = re.sub(rf"(?m)^{key}=.*$", f"{key}={value}", content)
        content = re.sub(
            r"(?m)^SENTINEL_API_URL=.*$",
            "SENTINEL_API_URL=http://127.0.0.1:3000/api/v1/alerts",
            content,
        )
        write(vision_env, content)

    # --- firmware -----------------------------------------------------------

    write(secrets_h, f"""// Généré par scripts/generate-secrets.py — ignoré par git.
// Relancer le script plutôt que d'éditer : le broker doit connaître le même
// mot de passe, et il est généré en même temps.

#pragma once

#define WIFI_SSID      "{ssid}"
#define WIFI_PASSWORD  "{wifi_password}"

// Adressage fixe imposé par l'équipe infra. Sous-réseau de table.
#define NET_STATIC_IP  {esp_ip.replace(".", ", ")}
#define NET_GATEWAY    {gateway.replace(".", ", ")}
#define NET_SUBNET     {subnet.replace(".", ", ")}
#define NET_DNS        {dns.replace(".", ", ")}

// Identité du nœud : sert de client-id MQTT et de préfixe de topic.
#define DEVICE_ID      "esp01"

// Broker Mosquitto, sur le PC serveur.
#define MQTT_HOST      "{host_ip}"
#define MQTT_PORT      1883
#define MQTT_USER      "esp01"
#define MQTT_PASSWORD  "{mqtt_passwords["esp01"]}"

// Serveur de temps. Le sous-réseau de table est étanche, donc pool.ntp.org est
// injoignable : c'est le conteneur ntp du PC serveur qui répond.
#define NTP_SERVER    "{host_ip}"
#define NTP_TIMEZONE  "{timezone}"
""")

    # --- broker -------------------------------------------------------------

    hash_mosquitto(mqtt_passwords)

    print(f"""
À faire ensuite
  1. docker compose up -d --build        puis  docker compose restart mosquitto
  2. cd firmware/esp01 && pio run -t upload

Qui a besoin de quoi
  backend     rien, backend/.env est généré. Identifiants admin dedans.
  vision      ai-vision/.env, si le service tourne sur l'hôte.
  infra       mosquitto/config/passwd contient les trois comptes du bus.

Aucun de ces fichiers n'est versionné. Pour en régénérer un seul jeu cohérent,
relancer ce script avec --force : les anciennes valeurs deviennent invalides
partout en même temps, ce qui est le but.""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
