# Service vision Sentinel-X (Flask + OpenCV + YOLO)
# La webcam n'est accessible que sur un hôte Linux (devices: /dev/video0 dans compose.yml)
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

# Bibliothèques système nécessaires à OpenCV + curl pour télécharger les modèles
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

# PyTorch CPU d'abord : évite les roues CUDA (plusieurs Go) tirées par ultralytics
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Dépendances : la couche reste en cache tant que requirements.txt ne change pas
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Modèles téléchargés au build : le conteneur n'a pas besoin d'Internet au démarrage
COPY download_models.sh ./
RUN sh download_models.sh \
    && python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

COPY *.py ./

# Jamais en root dans le conteneur ; data/ (visages, snapshots) doit être inscriptible
RUN useradd --create-home --uid 1000 vision \
    && mkdir -p data \
    && chown -R vision:vision data
# Accès à /dev/video0
RUN usermod -aG video vision
USER vision

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/health', timeout=2)" || exit 1

# Les secrets (SENTINEL_SERVICE_TOKEN, SENTINEL_API_TOKEN...) sont fournis par compose, jamais copiés dans l'image
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "5000"]
