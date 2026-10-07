"""Service HTTP de la vision Sentinel-X, appelé uniquement par le backend Node (jamais directement par le dashboard).

Il tourne sur la machine hôte (accès à la webcam USB) et expose :
  GET    /health                 état du service (sans authentification)
  GET    /status                 vision démarrée ou non, enrôlement en cours, dernières détections
  POST   /start  /stop           activer / désactiver l'analyse permanente de la webcam
  GET    /stream                 flux MJPEG annoté (vision, ou aperçu pendant un enrôlement)
  GET    /faces                  personnes enregistrées
  POST   /faces                  enrôlement depuis une ou plusieurs photos (multipart : image, name, status)
  POST   /faces/capture          enrôlement par la webcam ({"name", "status", "samples"}) : la vision est
                                 mise en pause pendant la capture puis relancée automatiquement
  PATCH  /faces/<name>           changer le statut  ({"status": "autorise" | "interdit"})
  DELETE /faces/<name>           supprimer une personne

La vision tourne en permanence (relancée si elle s'arrête, ex : caméra débranchée), sauf après /stop
et pendant un enrôlement webcam : la caméra ne peut être ouverte que par un seul traitement à la fois.

Toutes les routes sauf /health exigent l'en-tête X-Service-Token (SENTINEL_SERVICE_TOKEN dans le .env).
"""
import argparse
import hmac
import os
import re
import threading
import time
from contextlib import contextmanager

import cv2
import numpy as np
from flask import Flask, Response, abort, jsonify, request

import config
import enroll
import vision
from face_db import STATUSES, FaceDB
from face_engine import FaceEngine

SERVICE_TOKEN = os.getenv("SENTINEL_SERVICE_TOKEN", "").strip()
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,50}$")
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMAGES = 10
MAX_SAMPLES = 30
STREAM_FPS = 15
WATCHDOG_S = 5          # délai entre deux tentatives de relance de la vision

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES


# --- Boucle de vision en arrière-plan ---------------------------------------------------------
class VisionRunner:
    """Même traitement que vision.py, mais dans un thread contrôlé par HTTP."""

    def __init__(self, use_yolo, send_alerts, source):
        self.use_yolo = use_yolo
        self.send_alerts = send_alerts
        self.source = source
        self.enabled = False               # état voulu : True = la vision doit tourner en permanence
        self.enrolling = False             # enrôlement webcam en cours : caméra réservée
        self._thread = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._jpeg = None                  # dernière image annotée, encodée en JPEG
        self._frame_id = 0
        self.error = None
        self.last = {"persons": 0, "detections": [], "ms": 0.0, "at": None}
        threading.Thread(target=self._watchdog, daemon=True).start()

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    def start(self):
        """Active la vision permanente. Renvoie False si elle tournait déjà ou si un enrôlement est en cours."""
        self.enabled = True
        return self._launch()

    def stop(self):
        """Désactive la vision : le watchdog ne la relance plus."""
        self.enabled = False
        self._halt()

    def _launch(self):
        with self._lock:
            if self.running or self.enrolling or not self.enabled:
                return False
            self._stop.clear()
            self.error = None
            self._thread = threading.Thread(target=self._loop, args=(self.source,), daemon=True)
            self._thread.start()
            return True

    def _halt(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        self._jpeg = None

    def _watchdog(self):
        """Relance la vision si elle s'est arrêtée (erreur, caméra débranchée) alors qu'elle devrait tourner."""
        while True:
            time.sleep(WATCHDOG_S)
            if self.enabled and not self.running and not self.enrolling and self._launch():
                print("[vision] relancée par le watchdog")

    @contextmanager
    def paused(self):
        """Libère la caméra le temps d'un enrôlement, puis relance la vision si elle était active."""
        with self._lock:
            if self.enrolling:
                raise RuntimeError("Un enrôlement est déjà en cours")
            self.enrolling = True
        try:
            self._halt()
            yield
        finally:
            self.enrolling = False
            self._jpeg = None
            self._launch()

    def publish(self, frame):
        """Image affichée par /stream (utilisé aussi pour l'aperçu pendant l'enrôlement)."""
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ok:
            self._jpeg, self._frame_id = buf.tobytes(), self._frame_id + 1

    def latest_frame(self):
        return self._frame_id, self._jpeg

    def _loop(self, source):
        try:
            engine, db = FaceEngine(), FaceDB()
            detector = None
            if self.use_yolo:
                from person_detector import PersonDetector
                detector = PersonDetector()
            sender = BackendAlertSender(enabled=self.send_alerts, stats=DELIVERY)
            sender.start()
            cap = vision.open_camera(source)
        except Exception as e:  # modèle manquant, caméra introuvable...
            self.error = str(e)
            print(f"[vision] démarrage impossible : {e}")
            return

        policy, last_reload = vision.AlertPolicy(), time.time()
        print("[vision] démarrée")
        try:
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.05)
                    continue
                if frame.shape[1] != config.FRAME_WIDTH:
                    frame = cv2.resize(frame, (config.FRAME_WIDTH, config.FRAME_HEIGHT))

                t0 = time.perf_counter()
                persons, detections = vision.analyse(frame, engine, db, detector)
                ms = (time.perf_counter() - t0) * 1000

                for d in policy.update(detections):
                    sender.send(vision.build_payload(d, frame))

                if time.time() - last_reload > 2:
                    db.reload()     # visages ajoutés via /faces pris en compte sans redémarrer
                    last_reload = time.time()

                self.publish(vision.draw(frame, persons, detections, ms))
                self.last = {
                    "persons": len(persons),
                    "detections": [{"name": d["name"], "status": d["status"], "kind": d["kind"],
                                    "score": round(float(d["score"]), 3)} for d in detections],
                    "ms": round(ms, 1),
                    "at": time.time(),
                }
        finally:
            cap.release()
            print("[vision] arrêtée")


class BackendAlertSender(vision.AlertSender):
    """Envoie les alertes au format attendu par POST /api/v1/alerts du backend (clé dans X-API-Key)."""

    def __init__(self, enabled, stats=None):
        super().__init__(enabled=enabled and bool(config.API_URL), stats=stats)
        if self.enabled:
            self.session.headers.pop("Authorization", None)
            self.session.headers["X-API-Key"] = config.API_TOKEN

    def send(self, payload):
        print(f"[ALERTE] {payload['label']} ({payload['status']}, score {payload['confidence']})")
        if not self.enabled:
            return
        body = {
            "type": payload["type"],
            "level": payload["level"],
            "value": {k: payload[k] for k in ("label", "status", "detector", "confidence", "snapshot")},
        }
        try:
            self.queue.put_nowait(body)     # run() de la classe parente fait le POST
        except vision.queue.Full:
            pass


runner: VisionRunner = None          # créé dans main()
DELIVERY = vision.DeliveryStats(enabled=False)   # bilan des envois d'alertes, réglé dans main()
faces_lock = threading.Lock()        # une seule modification de la base de visages à la fois
_engine = None


def enroll_engine():
    """FaceEngine dédié à l'enrôlement (chargé à la première utilisation)."""
    global _engine
    if _engine is None:
        _engine = FaceEngine()
    return _engine


# --- Sécurité ------------------------------------------------------------------------------------
@app.before_request
def check_token():
    if request.path == "/health":
        return None
    given = request.headers.get("X-Service-Token", "")
    if not SERVICE_TOKEN or not hmac.compare_digest(given.encode(), SERVICE_TOKEN.encode()):
        return jsonify(error="Token de service invalide"), 401
    return None


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="Fichier trop volumineux (5 Mo max)"), 413


def valid_name(name):
    if not NAME_RE.match(name or ""):
        abort(jsonify_error(400, "Nom invalide (lettres, chiffres, _ et -, 50 max)"))
    return name


def jsonify_error(status, message):
    resp = jsonify(error=message)
    resp.status_code = status
    return resp


# --- Routes vision -------------------------------------------------------------------------------
@app.get("/health")
def health():
    return jsonify(status="ok", running=runner.running)


@app.get("/status")
def status():
    return jsonify(enabled=runner.enabled, running=runner.running, enrolling=runner.enrolling,
                   error=runner.error, alerts=DELIVERY.as_dict(), **runner.last)


@app.post("/start")
def start():
    started = runner.start()
    if runner.enrolling:
        return jsonify(enabled=True, running=False, enrolling=True), 202   # relancée après l'enrôlement
    # Laisse le temps d'ouvrir la caméra pour renvoyer une erreur claire si elle échoue
    time.sleep(1.5)
    if runner.error:
        return jsonify(running=False, error=runner.error), 500
    return jsonify(enabled=True, running=runner.running, started=started)


@app.post("/stop")
def stop():
    runner.stop()
    return jsonify(enabled=False, running=False)


@app.get("/stream")
def stream():
    if not runner.enabled and not runner.enrolling:
        return jsonify(error="Vision arrêtée : POST /start d'abord"), 409

    def frames():
        # Le flux reste ouvert pendant un enrôlement (aperçu de la capture) et pendant une relance
        last_id = -1
        while runner.enabled or runner.enrolling:
            frame_id, jpeg = runner.latest_frame()
            if jpeg is not None and frame_id != last_id:
                last_id = frame_id
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
            time.sleep(1 / STREAM_FPS)

    return Response(frames(), mimetype="multipart/x-mixed-replace; boundary=frame",
                    headers={"Cache-Control": "no-store"})


# --- Routes visages (équivalent de enroll.py) ----------------------------------------------------
@app.get("/faces")
def list_faces():
    db = FaceDB()
    return jsonify([{"name": n, **info} for n, info in db.list().items()])


@app.post("/faces")
def add_face():
    name = valid_name(request.form.get("name", "").strip())
    status_ = request.form.get("status", "autorise")
    if status_ not in STATUSES:
        return jsonify(error=f"Statut invalide (choisir parmi {list(STATUSES)})"), 400
    files = request.files.getlist("image")
    if not files:
        return jsonify(error="Aucune image (champ 'image')"), 400
    if len(files) > MAX_IMAGES:
        return jsonify(error=f"{MAX_IMAGES} images maximum"), 400

    engine = enroll_engine()
    embeddings, rejected = [], []
    for f in files:
        frame = cv2.imdecode(np.frombuffer(f.read(), np.uint8), cv2.IMREAD_COLOR)
        faces = engine.detect(frame) if frame is not None else []
        if len(faces) != 1:
            rejected.append({"file": f.filename, "faces": len(faces)})
            continue
        embeddings.append(engine.embed(frame, faces[0]))

    if not embeddings:
        return jsonify(error="Aucun visage exploitable (il faut exactement un visage par photo)",
                       rejected=rejected), 422
    with faces_lock:
        db = FaceDB()        # relu à chaque fois : la base a pu changer (enroll.py, autre requête)
        db.add(name, status_, embeddings)
    return jsonify(name=name, status=status_, added=len(embeddings), rejected=rejected), 201


@app.post("/faces/capture")
def capture_face():
    """Équivalent de "python enroll.py add <name>" : capture par la webcam, vision en pause pendant ce temps."""
    body = request.get_json(silent=True) or {}
    name = valid_name(str(body.get("name", "")).strip())
    status_ = body.get("status", "autorise")
    if status_ not in STATUSES:
        return jsonify(error=f"Statut invalide (choisir parmi {list(STATUSES)})"), 400
    samples = body.get("samples", config.ENROLL_SAMPLES)
    if not isinstance(samples, int) or not 1 <= samples <= MAX_SAMPLES:
        return jsonify(error=f"samples : entier entre 1 et {MAX_SAMPLES}"), 400

    try:
        with runner.paused():
            # Moteur dédié : les réseaux OpenCV ne doivent pas être partagés entre deux requêtes
            embeddings = enroll.capture_from_camera(
                FaceEngine(), samples, runner.source,
                display=False, on_frame=runner.publish, timeout=config.ENROLL_TIMEOUT_S,
            )
    except RuntimeError as e:   # enrôlement déjà en cours, caméra introuvable
        code = 409 if runner.enrolling else 500
        return jsonify(error=str(e)), code

    if not embeddings:
        return jsonify(error=f"Aucun visage capturé en {config.ENROLL_TIMEOUT_S} s "
                             "(une seule personne, bien éclairée, face à la caméra)"), 422
    with faces_lock:
        FaceDB().add(name, status_, embeddings)
    return jsonify(name=name, status=status_, added=len(embeddings), requested=samples), 201


@app.patch("/faces/<name>")
def set_face_status(name):
    valid_name(name)
    status_ = (request.get_json(silent=True) or {}).get("status")
    if status_ not in STATUSES:
        return jsonify(error=f"Statut invalide (choisir parmi {list(STATUSES)})"), 400
    with faces_lock:
        try:
            FaceDB().set_status(name, status_)
        except KeyError:
            return jsonify(error="Personne inconnue"), 404
    return jsonify(name=name, status=status_)


@app.delete("/faces/<name>")
def delete_face(name):
    valid_name(name)
    with faces_lock:
        try:
            FaceDB().remove(name)
        except KeyError:
            return jsonify(error="Personne inconnue"), 404
    return "", 204


def preflight_alerts():
    """Vérifie dès le lancement que les alertes pourront partir : sinon l'échec resterait silencieux
    jusqu'à la première détection. Le résultat est aussi visible dans /status (donc sur le dashboard)."""
    sender = BackendAlertSender(enabled=True, stats=DELIVERY)
    problem = vision.check_api(sender.session, sender.verify)
    if problem:
        DELIVERY.fail(problem, count=False)
        print("=" * 72)
        print(f"[alertes] ATTENTION : les alertes ne pourront PAS être transmises au backend")
        print(f"[alertes] {problem}")
        print("=" * 72)
    else:
        print(f"[alertes] liaison backend OK ({config.API_URL})")


def main():
    global runner
    parser = argparse.ArgumentParser(description="Service HTTP vision Sentinel-X")
    parser.add_argument("--host", default=os.getenv("SENTINEL_SERVICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("SENTINEL_SERVICE_PORT", "5000")))
    parser.add_argument("--no-yolo", action="store_true", help="désactiver la détection de personnes")
    parser.add_argument("--no-api", action="store_true", help="ne pas envoyer les alertes au backend")
    parser.add_argument("--no-autostart", action="store_true",
                        help="ne pas démarrer la vision au lancement (attendre POST /start)")
    args = parser.parse_args()

    if len(SERVICE_TOKEN) < 32:
        raise SystemExit("SENTINEL_SERVICE_TOKEN manquant ou trop court (32 caractères min) dans le .env")

    send_alerts = config.API_ENABLED and not args.no_api
    DELIVERY.enabled = send_alerts
    if send_alerts:
        preflight_alerts()
    else:
        print("[alertes] envoi au backend désactivé (SENTINEL_API_ENABLED=0 ou --no-api)")

    runner = VisionRunner(use_yolo=config.USE_YOLO and not args.no_yolo,
                          send_alerts=send_alerts,
                          source=config.CAMERA_INDEX)
    if not args.no_autostart:
        runner.start()
    print(f"Service vision sur http://{args.host}:{args.port}")
    # threaded=True : le flux MJPEG ne bloque pas les autres requêtes
    app.run(host=args.host, port=args.port, threaded=True)


if __name__ == "__main__":
    main()
