"""utilitaire pour enregistrer des visages connus dans la base locale"""
import argparse
import sys
import time
from pathlib import Path

import cv2

import config
from face_db import STATUSES, FaceDB
from face_engine import FaceEngine
from vision import BACKENDS, open_camera


def capture_from_camera(engine, samples, camera_index, backend=None, mjpg=None,
                        display=True, on_frame=None, timeout=None):
    """On capte quelques embeddings devant la caméra, à intervalle régulier.

    display=False : sans fenêtre (appel depuis server.py), on_frame(image) reçoit l'aperçu annoté
    et timeout (s) arrête la capture avec les échantillons déjà obtenus.
    """
    cap = open_camera(camera_index, backend=backend, mjpg=mjpg)
    embeddings, last = [], 0.0
    deadline = time.time() + timeout if timeout else None
    print("Regarde la caméra et tourne un peu la tête. [q] pour annuler")
    while len(embeddings) < samples:
        if deadline and time.time() > deadline:
            print(f"Temps écoulé : {len(embeddings)}/{samples} échantillon(s)")
            break
        ok, frame = cap.read()
        if not ok:
            continue
        faces = engine.detect(frame)
        msg = f"{len(embeddings)}/{samples}"
        if len(faces) == 1:
            x, y, w, h = map(int, faces[0][:4])
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 200, 0), 2)
            if time.time() - last > 0.4:
                embeddings.append(engine.embed(frame, faces[0]))
                last = time.time()
        elif len(faces) > 1:
            msg += "  - une seule personne devant la caméra !"
        cv2.putText(frame, msg, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
        if on_frame:
            on_frame(frame)
        if display:
            cv2.imshow("Enrolement", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                embeddings = []
                break
    cap.release()
    if display:
        cv2.destroyAllWindows()
    return embeddings


def capture_from_images(engine, folder):
    embeddings = []
    for img_path in sorted(Path(folder).iterdir()):
        if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            continue
        frame = cv2.imread(str(img_path))
        if frame is None:
            continue
        faces = engine.detect(frame)
        if len(faces) != 1:
            print(f"  ignorée ({len(faces)} visage(s)) : {img_path.name}")
            continue
        embeddings.append(engine.embed(frame, faces[0]))
        print(f"  ok : {img_path.name}")
    return embeddings


def main():
    parser = argparse.ArgumentParser(description="Gestion des visages Sentinel-X")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_add = sub.add_parser("add", help="ajouter une personne (ou des échantillons)")
    p_add.add_argument("name")
    p_add.add_argument("--status", choices=STATUSES, default="autorise")
    p_add.add_argument("--images", help="dossier de photos au lieu de la webcam")
    p_add.add_argument("--samples", type=int, default=10)
    p_add.add_argument("--camera", type=int, default=config.CAMERA_INDEX)
    p_add.add_argument("--backend", choices=list(BACKENDS), help="pilote caméra (voir cam_test.py)")
    p_add.add_argument("--mjpg", action="store_true", help="forcer le format MJPG")

    p_rm = sub.add_parser("remove", help="supprimer une personne")
    p_rm.add_argument("name")

    p_st = sub.add_parser("status", help="changer le statut d'une personne")
    p_st.add_argument("name")
    p_st.add_argument("status", choices=STATUSES)

    sub.add_parser("list", help="lister les personnes connues")
    args = parser.parse_args()

    db = FaceDB()
    try:
        if args.cmd == "list":
            people = db.list()
            if not people:
                print("Base vide : tout visage sera considéré comme inconnu.")
            for name, info in people.items():
                print(f"  {name:20s} {info['status']:10s} {info['samples']} échantillon(s)")
        elif args.cmd == "remove":
            db.remove(args.name)
            print(f"{args.name} supprimé.")
        elif args.cmd == "status":
            db.set_status(args.name, args.status)
            print(f"{args.name} -> {args.status}")
        elif args.cmd == "add":
            engine = FaceEngine()
            if args.images:
                embeddings = capture_from_images(engine, args.images)
            else:
                embeddings = capture_from_camera(engine, args.samples, args.camera,
                                                 args.backend, args.mjpg or None)
            if not embeddings:
                sys.exit("Aucun visage enregistré.")
            db.add(args.name, args.status, embeddings)
            print(f"{args.name} ({args.status}) : {len(embeddings)} échantillon(s) ajouté(s).")
    except (KeyError, ValueError) as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
