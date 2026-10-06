"""script pour tester les caméras et trouver le bon réglage"""
import platform
import time
from pathlib import Path

import cv2

from vision import open_camera

OUT = Path("cam_test")
OUT.mkdir(exist_ok=True)

if platform.system() == "Windows":
    backends = ["msmf", "dshow"]
elif platform.system() == "Darwin":
    backends = ["avfoundation"]
else:
    backends = ["any"]

print(f"{'combinaison':28s} {'taille':10s} {'img/s':>6s}  bruit")
for index in range(3):
    for backend in backends:
        for mjpg in (False, True):
            name = f"cam{index}_{backend}{'_mjpg' if mjpg else ''}"
            try:
                cap = open_camera(index, backend=backend, mjpg=mjpg)
            except RuntimeError:
                continue
            frame, ok = None, False
            for _ in range(10):  # les premières images peuvent être noires
                ok, frame = cap.read()
            t0, n = time.time(), 0
            while n < 15 and time.time() - t0 < 3:
                ok, f = cap.read()
                if ok:
                    frame, n = f, n + 1
            fps = n / max(time.time() - t0, 1e-6)
            cap.release()
            if frame is None or not ok:
                print(f"{name:28s} aucune image")
                continue
            # Si l'image est floue, elle a souvent beaucoup de détails parasites, on mesure ça
            noise = cv2.Laplacian(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
            verdict = "BROUILLEE ?" if noise > 3000 else "ok"
            cv2.imwrite(str(OUT / f"{name}.jpg"), frame)
            print(f"{name:28s} {frame.shape[1]}x{frame.shape[0]:<5d} {fps:6.1f}  {noise:7.0f} {verdict}")

print(f"\nImages enregistrées dans {OUT.resolve()}")
