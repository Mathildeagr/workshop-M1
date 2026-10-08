"""Rejoue les pannes de caméra sur une fausse capture : aucune webcam requise.

Les trois pannes testées ici sont celles qui ne lèvent aucune erreur, donc
celles qui figeaient le flux en silence.
"""
import threading
import time

import numpy as np

import server


class FakeCap:
    """cap.read() d'OpenCV, en panne au choix."""

    def __init__(self, mode):
        self.mode = mode
        self.released = False
        self.reads = 0
        self._frozen = np.full((48, 64, 3), 7, dtype=np.uint8)

    def read(self):
        self.reads += 1
        if self.mode == "blocked":
            time.sleep(60)                      # le périphérique a disparu : la lecture ne revient pas
        if self.mode == "failing":
            return False, None
        if self.mode == "frozen":
            return True, self._frozen.copy()    # le même tampon, recopié : indétectable par identité d'objet
        return True, np.random.randint(0, 255, (48, 64, 3), dtype=np.uint8)

    def release(self):
        self.released = True


def feed_on(*modes):
    """CameraFeed dont chaque réouverture consomme le mode suivant."""
    caps = [FakeCap(m) for m in modes]
    opened = []
    server.vision.open_camera = lambda _src: (opened.append(caps[len(opened)]), caps[len(opened) - 1])[1]
    return server.CameraFeed("fake"), caps


def test_camera_saine_rend_des_images():
    feed, _ = feed_on("normal")
    assert feed.read(1.0) is not None
    feed.close()


def test_image_figee_compte_comme_absence_dimage():
    feed, (cap,) = feed_on("frozen")
    assert feed.read(1.0) is not None, "la première image est neuve : le gel ne se voit qu'après"
    assert feed.read(0.4) is None, "un tampon répété ne doit pas passer pour une image fraîche"
    assert cap.reads > 2, "la lecture, elle, tourne bien"
    feed.close()


def test_lecture_bloquee_ne_bloque_pas_la_boucle():
    feed, _ = feed_on("blocked")
    started = time.time()
    assert feed.read(0.3) is None
    assert time.time() - started < 1.0, "la boucle de vision doit garder la main"
    feed.close()


def test_lecture_en_echec_signale_labsence():
    feed, _ = feed_on("failing")
    assert feed.read(0.3) is None
    feed.close()


def test_reouverture_apres_panne_reprend_le_flux():
    feed, (panne, saine) = feed_on("frozen", "normal")
    feed.read(1.0)                               # première image, puis le flux se tait
    assert feed.read(0.3) is None
    feed.open()                                  # ce que fait la boucle quand la caméra se tait
    assert feed.read(1.0) is not None, "la nouvelle capture doit alimenter le flux"
    assert panne.released, "l'ancien lecteur libère son périphérique"
    feed.close()


def test_close_libere_le_peripherique():
    feed, (cap,) = feed_on("normal")
    feed.read(1.0)
    feed.close()
    assert cap.released


def test_image_de_panne_est_affichable():
    frame = server.notice("la caméra ne renvoie plus d'image")
    assert frame.shape == (server.config.FRAME_HEIGHT, server.config.FRAME_WIDTH, 3)
    assert frame.any(), "le texte doit être tracé, pas un carré noir"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"  ok  {name}")
    print(f"\n{sum(n.startswith('test_') for n in globals())} vérifications passées")
