"""Vérifie que la politique d'alerte lève bien ce qu'elle a déclenché.

Sans dépendance de test : .venv/bin/python test_alert_policy.py
"""
import config
import vision

INCONNU = {"name": None, "status": "inconnu", "kind": "face", "score": 0.9, "box": (0, 0, 10, 10)}
AUTORISE = {"name": "connu", "status": "autorise", "kind": "face", "score": 0.95, "box": (0, 0, 10, 10)}


class Scene:
    """Fait défiler des images devant la politique, à horloge contrôlée."""

    def __init__(self):
        self.t = 1000.0
        self.policy = vision.AlertPolicy(clock=lambda: self.t)

    def jouer(self, detections, images=1, pas=1.0):
        sortis = []
        for _ in range(images):
            self.t += pas
            sortis += [d["status"] for d in self.policy.update(detections)]
        return sortis


def test_un_inconnu_leve_une_alerte():
    assert "inconnu" in Scene().jouer([INCONNU], config.CONFIRM_FRAMES + 1)


def test_une_zone_qui_se_vide_est_signalee():
    """Sans ça, la sirène hurle jusqu'à extinction manuelle."""
    s = Scene()
    s.jouer([INCONNU], config.CONFIRM_FRAMES + 1)
    assert "cleared" in s.jouer([], int(config.LOST_TOLERANCE_S) + 3)


def test_enroler_la_personne_detectee_leve_l_alerte():
    """Le cas qui nous a occupés : une fois enrôlée elle devient autorisée, donc
    plus suivie — mais personne ne disait que la zone était redevenue sûre."""
    s = Scene()
    s.jouer([INCONNU], config.CONFIRM_FRAMES + 1)
    assert "cleared" in s.jouer([AUTORISE], int(config.LOST_TOLERANCE_S) + 3)


def test_pas_de_fin_d_alerte_sans_alerte():
    """Une scène vide depuis le début ne doit rien émettre."""
    assert Scene().jouer([], 10) == []


def test_une_seule_fin_d_alerte():
    """Elle ne doit pas se répéter à chaque image une fois la zone dégagée."""
    s = Scene()
    s.jouer([INCONNU], config.CONFIRM_FRAMES + 1)
    assert s.jouer([], 20).count("cleared") == 1


if __name__ == "__main__":
    for nom, fonction in sorted(globals().items()):
        if nom.startswith("test_"):
            fonction()
            print(f"  OK  {nom[5:].replace('_', ' ')}")
    print("\n  tout passe")
