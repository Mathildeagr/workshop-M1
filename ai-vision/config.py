"""Config globale du projet. Les réglages spécifiques à la machine ou au serveur sont lus depuis le fichier .env
Le reste reste ici, avec des valeurs sûres par défaut
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv():
    """Charge les variables locales depuis .env si le fichier existe."""
    dotenv_path = BASE_DIR / ".env"
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = [part.strip() for part in line.split("=", 1)]
        if not key or key in os.environ:
            continue

        value = value.strip().strip('"').strip("'")
        os.environ[key] = value


_load_dotenv()

# Modèles OpenCV chargés localement
MODELS_DIR = BASE_DIR / "models"
DETECTOR_MODEL = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
RECOGNIZER_MODEL = MODELS_DIR / "face_recognition_sface_2021dec.onnx"

# Base des visages: on garde surtout les embeddings, pas les photos
FACES_DB = Path(os.getenv("SENTINEL_FACES_DB", BASE_DIR / "data" / "faces.json"))
SNAPSHOTS_DIR = Path(os.getenv("SENTINEL_SNAPSHOTS_DIR", BASE_DIR / "data" / "snapshots"))

# Webcam (Mac : cam interne 0, webcam USB 1 ?)
CAMERA_INDEX = int(os.getenv("SENTINEL_CAMERA", "0"))
CAMERA_BACKEND = os.getenv("SENTINEL_CAMERA_BACKEND", "auto")
CAMERA_MJPG = os.getenv("SENTINEL_CAMERA_MJPG", "0") == "1"
FRAME_WIDTH = 640
FRAME_HEIGHT = 480

# Détection / reconnaissance
DETECTION_SCORE = 0.8      # score minimum pour considérer qu'un visage est correct
MATCH_THRESHOLD = 0.363    # seuil cosinus recommandé pour SFace
MIN_FACE_SIZE = 60         # on ignore les visages trop petits, trop loin

# YOLO
USE_YOLO = os.getenv("SENTINEL_USE_YOLO", "1") == "1"
YOLO_MODEL = os.getenv("SENTINEL_YOLO_MODEL", "yolov8n.pt")   # version légère, plus simple
YOLO_CONF = 0.5            # confiance minimum pour compter une personne
YOLO_IMGSZ = 416           # taille du réseau pour le traitement
YOLO_DEVICE = os.getenv("SENTINEL_YOLO_DEVICE", "auto")      # auto | cpu | mps | cuda

# Alertes
ALERT_ON_UNKNOWN = True    # un visage inconnu peut déclencher une alerte
CONFIRM_FRAMES = 5         # on attend quelques images pour éviter les faux positifs
NO_FACE_ALERT_S = 3.0      # si on voit une personne sans visage pendant ce temps, on alerte
LOST_TOLERANCE_S = 1.0     # une détection manquée moins de X s ne remet pas tout à zéro
ALERT_COOLDOWN_S = 10      # pas trop d'alertes trop proches pour la même personne

# Enrôlement
ENROLL_SAMPLES = 10
ENROLL_TIMEOUT_S = 30

# API ; on ne met pas d'URL par défaut dans le dépôt
API_URL = os.getenv("SENTINEL_API_URL", "").strip()
API_TOKEN = os.getenv("SENTINEL_API_TOKEN", "").strip()
API_CA_CERT = os.getenv("SENTINEL_CA_CERT", "").strip()
API_ENABLED = os.getenv("SENTINEL_API_ENABLED", "0") == "1" and bool(API_URL)
