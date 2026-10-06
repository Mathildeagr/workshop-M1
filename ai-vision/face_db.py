"""Base des visages connus. On stocke les embeddings, pas les photos"""
import json
import threading

import numpy as np

import config

STATUSES = ("autorise", "interdit")


class FaceDB:
    def __init__(self, path=config.FACES_DB):
        self.path = path
        self._lock = threading.Lock()
        self._mtime = None
        self.people = {}
        self.reload()

    def reload(self):
        """On relit le fichier si le back l'a modifié pendant que la vision tourne"""
        if not self.path.exists():
            self.people, self._mtime = {}, None
            self._rebuild_index()
            return
        try:
            mtime = self.path.stat().st_mtime
            if mtime == self._mtime:
                return
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return  # le back est en train de remplacer le fichier, on retente plus tard
        with self._lock:
            self.people = data.get("people", {})
            self._mtime = mtime
            self._rebuild_index()

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"people": self.people}, indent=1), encoding="utf-8")
        tmp.replace(self.path)  # écriture propre, sans laisser un fichier incomplet
        self._mtime = self.path.stat().st_mtime
        self._rebuild_index()

    def _rebuild_index(self):
        """On prépare les embeddings dans une matrice pour comparer plus vite"""
        names, vectors = [], []
        for name, person in self.people.items():
            for emb in person["embeddings"]:
                names.append(name)
                vectors.append(emb)
        self._names = names
        self._matrix = np.array(vectors, dtype=np.float32) if vectors else None

    def add(self, name, status, embeddings):
        if status not in STATUSES:
            raise ValueError(f"Statut invalide : {status} (choisir parmi {STATUSES})")
        person = self.people.setdefault(name, {"status": status, "embeddings": []})
        person["status"] = status
        person["embeddings"].extend(e.tolist() for e in embeddings)
        self.save()

    def remove(self, name):
        if self.people.pop(name, None) is None:
            raise KeyError(f"Personne inconnue : {name}")
        self.save()

    def set_status(self, name, status):
        if name not in self.people:
            raise KeyError(f"Personne inconnue : {name}")
        if status not in STATUSES:
            raise ValueError(f"Statut invalide : {status}")
        self.people[name]["status"] = status
        self.save()

    def list(self):
        return {n: {"status": p["status"], "samples": len(p["embeddings"])}
                for n, p in self.people.items()}

    def match(self, feature):
        """Retourne nom, statut et score. Si rien ne correspond, on renvoie None"""
        if self._matrix is None:
            return None, "inconnu", 0.0
        scores = self._matrix @ feature          # similarité cosinus sur des vecteurs normalisés
        best = int(np.argmax(scores))
        score = float(scores[best])
        if score < config.MATCH_THRESHOLD:
            return None, "inconnu", score
        name = self._names[best]
        return name, self.people[name]["status"], score
