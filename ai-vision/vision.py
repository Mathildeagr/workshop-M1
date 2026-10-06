"""logiciel de vision pour Sentinel-X. On capture la vidéo, on repère les personnes, puis on compare les visages"""
import argparse
import os
import platform
import queue
import select
import sys
import threading
import time
from datetime import datetime, timezone

import cv2

import config
from face_db import FaceDB
from face_engine import FaceEngine

# Palette de couleurs, en BGR (bleu, vert, rouge)
COLORS = {
    "autorise": (0, 200, 0),         # vert
    "interdit": (0, 0, 255),         # rouge
    "inconnu": (0, 165, 255),        # orange
    "non_identifie": (200, 0, 200),  # violet pour une personne sans visage net
}
PERSON_COLOR = (255, 160, 0)          # bleu clair pour le cadre YOLO


# pilotes de caméra disponibles
BACKENDS = {
    "msmf": cv2.CAP_MSMF,               # Windows: Media Foundation
    "dshow": cv2.CAP_DSHOW,             # Windows: DirectShow
    "avfoundation": cv2.CAP_AVFOUNDATION,  # Mac
    "any": cv2.CAP_ANY,
}


def default_backend():
    system = platform.system()
    if system == "Darwin":
        return "avfoundation"
    if system == "Windows":
        return "msmf"
    return "any"


def open_camera(index, backend=None, mjpg=None):
    backend = backend or (config.CAMERA_BACKEND if config.CAMERA_BACKEND != "auto" else default_backend())
    mjpg = config.CAMERA_MJPG if mjpg is None else mjpg
    cap = cv2.VideoCapture(index, BACKENDS[backend])
    if not cap.isOpened():
        raise RuntimeError(
            f"Impossible d'ouvrir la caméra {index} ({backend}). Essaie une autre --source, "
            "ou lance python cam_test.py pour voir la bonne config."
        )
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.FRAME_HEIGHT)
    if mjpg:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


# analyse
def _inside(px, py, box):
    x, y, w, h = box[:4]
    return x <= px <= x + w and y <= py <= y + h


def analyse(frame, engine, db, person_detector=None):
    """Retourne la liste des personnes et des détections pour la frame courante"""
    persons = person_detector.detect(frame) if person_detector else []
    detections = []
    persons_with_face = set()

    for face in engine.detect(frame):
        name, status, score = db.match(engine.embed(frame, face))
        x, y, w, h = map(int, face[:4])
        cx, cy = x + w / 2, y + h / 2
        for i, p in enumerate(persons):
            if _inside(cx, cy, p):
                persons_with_face.add(i)
        detections.append({"kind": "face", "name": name, "status": status,
                           "score": score, "box": (x, y, w, h)})

    for i, p in enumerate(persons):
        if i not in persons_with_face:
            detections.append({"kind": "person", "name": None, "status": "non_identifie",
                               "score": p[4], "box": p[:4]})
    return persons, detections


# logique d’alerte
class AlertPolicy:
    """Décide quand il faut envoyer une alerte selon ce qu’on a détecté"""

    def __init__(self, clock=time.time):
        self.clock = clock
        self.tracks = {}       # identité -> {"first", "last", "frames"}
        self.last_alert = {}   # identité -> horodatage
        self.last_authorized = 0.0

    @staticmethod
    def key(d):
        return d["name"] or d["status"]

    def update(self, detections):
        now = self.clock()
        to_alert = []
        if any(d["status"] == "autorise" for d in detections):
            self.last_authorized = now

        for d in detections:
            if d["status"] == "autorise":
                continue
            if d["status"] == "inconnu" and not config.ALERT_ON_UNKNOWN:
                continue
            key = self.key(d)
            t = self.tracks.get(key)
            if t is None or now - t["last"] > config.LOST_TOLERANCE_S:
                t = {"first": now, "last": now, "frames": 0}
                self.tracks[key] = t
            if t["last"] == now and t["frames"] > 0:
                continue
            t["last"] = now
            t["frames"] += 1

            if d["status"] == "non_identifie":
                ready = (now - t["first"] >= config.NO_FACE_ALERT_S
                         and now - self.last_authorized >= config.NO_FACE_ALERT_S)
            else:
                ready = t["frames"] >= config.CONFIRM_FRAMES
            recent = now - self.last_alert.get(key, 0) < config.ALERT_COOLDOWN_S
            if ready and not recent:
                self.last_alert[key] = now
                to_alert.append(d)

        for key in [k for k, t in self.tracks.items() if now - t["last"] > config.LOST_TOLERANCE_S]:
            del self.tracks[key]
        return to_alert


# envoi des alertes
class AlertSender(threading.Thread):
    """Envoie les alertes en arrière-plan pour ne pas bloquer la lecture vidéo"""

    def __init__(self, enabled):
        super().__init__(daemon=True)
        self.enabled = enabled
        self.queue = queue.Queue(maxsize=50)
        if enabled:
            import requests
            self.session = requests.Session()
            if config.API_TOKEN:
                self.session.headers["Authorization"] = f"Bearer {config.API_TOKEN}"
            self.verify = config.API_CA_CERT or True

    def send(self, payload):
        print(f"[ALERTE] {payload['label']} ({payload['status']}, score {payload['confidence']})")
        if self.enabled:
            try:
                self.queue.put_nowait(payload)
            except queue.Full:
                pass

    def run(self):
        if not self.enabled:
            return
        while True:
            payload = self.queue.get()
            try:
                r = self.session.post(config.API_URL, json=payload, timeout=3, verify=self.verify)
                if r.status_code >= 300:
                    print(f"  API a répondu {r.status_code} : {r.text[:120]}")
            except Exception as e:
                print(f"  envoi impossible : {e}")


def build_payload(d, frame):
    ts = datetime.now(timezone.utc)
    label = d["name"] or ("presence_non_identifiee" if d["kind"] == "person" else "inconnu")
    config.SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    snap = config.SNAPSHOTS_DIR / f"{ts:%Y%m%d_%H%M%S}_{label}.jpg"
    cv2.imwrite(str(snap), frame)
    return {
        "source": "vision",
        "type": "intrusion",
        "level": "critical" if d["status"] == "interdit" else "warning",
        "label": label,
        "status": d["status"],
        "detector": "yolo" if d["kind"] == "person" else "face",
        "confidence": round(d["score"], 3),
        "snapshot": snap.name,
        "timestamp": ts.isoformat(),
    }


# affichage
def draw(frame, persons, detections, ms):
    for x, y, w, h, conf in persons:
        cv2.rectangle(frame, (x, y), (x + w, y + h), PERSON_COLOR, 1)
        cv2.putText(frame, f"person {conf:.2f}", (x + 4, y + h - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, PERSON_COLOR, 1)
    for d in detections:
        x, y, w, h = d["box"]
        color = COLORS[d["status"]]
        if d["kind"] == "face":
            label = f"{d['name'] or 'INCONNU'} {d['score']:.2f}"
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
        else:
            label = "NON IDENTIFIE"
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
        cv2.putText(frame, label, (x, max(y - 8, 15)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
    cv2.putText(frame, f"{ms:.0f} ms/image", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
    return frame


def _quit_requested():
    """Retourne True si q ou Esc a été tapé dans le terminal ou sur la fenêtre OpenCV"""
    if os.name == "nt":
        import msvcrt
        if msvcrt.kbhit():
            key = msvcrt.getwch()
            return key.lower() in ("q", "\x1b")
        return False

    ready, _, _ = select.select([sys.stdin], [], [], 0)
    if ready:
        key = sys.stdin.read(1)
        return key.lower() in ("q", "\x1b")
    return False


# programme principal
def main():
    parser = argparse.ArgumentParser(description="Vision Sentinel-X")
    parser.add_argument("--source", default=str(config.CAMERA_INDEX), help="index caméra ou chemin d'image")
    parser.add_argument("--no-api", action="store_true", help="ne pas envoyer les alertes")
    parser.add_argument("--no-display", action="store_true", help="sans fenêtre (serveur)")
    parser.add_argument("--no-yolo", action="store_true", help="désactiver la détection de personnes")
    parser.add_argument("--backend", choices=list(BACKENDS), help="pilote caméra (voir cam_test.py)")
    parser.add_argument("--mjpg", action="store_true", help="forcer le format MJPG")
    args = parser.parse_args()

    engine, db = FaceEngine(), FaceDB()
    person_detector = None
    if config.USE_YOLO and not args.no_yolo:
        from person_detector import PersonDetector
        person_detector = PersonDetector()
    sender = AlertSender(enabled=config.API_ENABLED and not args.no_api)
    sender.start()

    if not args.source.isdigit():
        frame = cv2.imread(args.source)
        if frame is None:
            raise SystemExit(f"Image illisible : {args.source}")
        if person_detector:
            person_detector.detect(frame)
        t0 = time.perf_counter()
        persons, detections = analyse(frame, engine, db, person_detector)
        ms = (time.perf_counter() - t0) * 1000
        for d in detections:
            print(f"{d['kind']:6s} {d['name'] or '-':12s} {d['status']:13s} score={d['score']:.3f} box={d['box']}")
        out = "resultat.jpg"
        cv2.imwrite(out, draw(frame, persons, detections, ms))
        print(f"{len(persons)} personne(s), {len(detections)} identité(s), {ms:.0f} ms. Image annotée : {out}")
        return

    cap = open_camera(int(args.source), backend=args.backend, mjpg=args.mjpg or None)
    policy, last_reload = AlertPolicy(), time.time()
    print("Vision démarrée. Appuie sur [q] ou [Esc] pour quitter")
    try:
        while True:
            if _quit_requested():
                break

            if not args.no_display:
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), ord("Q"), 27):
                    break

            ok, frame = cap.read()
            if not ok:
                time.sleep(0.05)
                continue
            if frame.shape[1] != config.FRAME_WIDTH:
                frame = cv2.resize(frame, (config.FRAME_WIDTH, config.FRAME_HEIGHT))

            t0 = time.perf_counter()
            persons, detections = analyse(frame, engine, db, person_detector)
            ms = (time.perf_counter() - t0) * 1000

            for d in policy.update(detections):
                sender.send(build_payload(d, frame))

            if time.time() - last_reload > 2:
                db.reload()
                last_reload = time.time()

            if not args.no_display:
                cv2.imshow("Sentinel-X vision", draw(frame, persons, detections, ms))
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), ord("Q"), 27):
                    break

            if _quit_requested():
                break
    finally:
        cap.release()
        if not args.no_display:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
