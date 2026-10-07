"""Apprentissage : lecture de la fenetre en base, ajustement, persistance.

Tout est bloquant ici. L'appelant le fait tourner dans un thread plutot que dans
la boucle d'evenements, parce qu'ajuster une foret sur un mois de mesures prend
quelques centaines de millisecondes et que pendant ce temps le bus doit continuer
a repondre.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path

import joblib

from predict_anomalie.config import RuntimeConfig, Settings
from predict_anomalie.detect import AnomalyModel, InsufficientHistory
from predict_anomalie.detect.forest import MIN_ROWS
from predict_anomalie.store import Database

log = logging.getLogger(__name__)

ARTIFACT = "model.joblib"

# La calibration des sauts se prend sur le brut, qui ne remonte pas au-dela de sa
# retention : inutile de demander plus loin que ce que la table garde.
JUMP_DAYS = 7


class Trainer:
    def __init__(self, database: Database, runtime: RuntimeConfig, settings: Settings) -> None:
        self._database = database
        self._runtime = runtime
        self._settings = settings
        self._path = Path(settings.model_dir) / ARTIFACT
        self.model = AnomalyModel()
        self.last_error: str | None = None
        self.last_attempt: datetime | None = None
        self.available = 0
        self._announced: str | None = None

    # -- cycle de vie -------------------------------------------------------

    def restore(self) -> bool:
        """Recharge le dernier modele. Evite d'etre aveugle au redemarrage."""
        if not self._path.exists():
            return False
        try:
            self.model = joblib.load(self._path)
        except Exception as error:               # noqa: BLE001 - un artefact illisible ne doit pas empecher de demarrer
            log.warning("modele sur disque illisible (%s), reapprentissage", error)
            return False
        if self.model.meta:
            self._runtime.effective_days = self.model.meta.effective_days
        log.info("modele recharge depuis %s", self._path)
        return self.model.ready

    def persist(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            joblib.dump(self.model, self._path)
        except OSError as error:
            log.warning("modele non enregistre : %s", error)

    # -- apprentissage ------------------------------------------------------

    def train(self) -> bool:
        """Ajuste sur la fenetre demandee. Renvoie False si l'historique ne suffit pas."""
        self.last_attempt = datetime.now(UTC)
        requested = self._runtime.window_days

        # Compter avant de charger : quand l'historique est trop court, on le sait
        # pour une requete au lieu de rapatrier la fenetre et de construire les
        # variables pour rien. Et le message dit alors ou on en est, ce qui est
        # beaucoup plus utile qu'une erreur.
        _, _, self.available = self._database.coverage()
        if self.available < MIN_ROWS:
            self._report(f"{self.available} minutes en base, {MIN_ROWS} necessaires")
            return False

        minutes = self._database.load_window(requested)
        jump_scales = self._database.jump_scales(JUMP_DAYS)

        candidate = AnomalyModel()
        try:
            meta = candidate.fit(minutes, requested, jump_scales=jump_scales)
        except InsufficientHistory as error:
            if not self.model.ready:
                self._runtime.effective_days = 0.0
            self._report(str(error))
            return False

        # On ne remplace le modele en service qu'une fois le nouveau pret : un
        # apprentissage rate ne doit pas rendre la brique muette.
        self.model = candidate
        self.last_error = None
        self._announced = None
        self._runtime.effective_days = meta.effective_days
        self.persist()

        if meta.effective_days < requested * 0.9:
            log.info(
                "fenetre demandee %.2f jours, historique disponible %.2f jours",
                requested,
                meta.effective_days,
            )
        if not meta.has_jump_calibration:
            log.info("pas de calibration de saut : la table brute est encore vide")
        return True

    def _report(self, reason: str) -> None:
        """Signale un apprentissage impossible, sans repeter le meme message.

        La boucle reessaie toutes les deux minutes tant qu'il n'y a pas de modele :
        annoncer chaque echec noierait le journal.
        """
        self.last_error = reason
        if reason != self._announced:
            log.info("apprentissage reporte : %s", reason)
            self._announced = reason

    # -- lecture pour l'API -------------------------------------------------

    def state(self) -> dict:
        # L'horodatage de la tentative compte autant que son resultat : sans lui,
        # un echec d'il y a une heure se lit comme un echec de maintenant.
        attempt = {
            "attempted_at": self.last_attempt.isoformat() if self.last_attempt else None,
            "minutes_available": self.available,
            "minutes_required": MIN_ROWS,
        }
        meta = self.model.meta
        if meta is None:
            return {"ready": False, "error": self.last_error} | attempt
        return attempt | {
            "ready": self.model.ready,
            "detector": "isolation-forest",
            "trained_at": meta.trained_at.isoformat(),
            "rows": meta.rows,
            "window_days": meta.window_days,
            "effective_days": round(meta.effective_days, 3),
            "first_bucket": meta.first_bucket.isoformat() if meta.first_bucket else None,
            "last_bucket": meta.last_bucket.isoformat() if meta.last_bucket else None,
            "jump_calibrated": meta.has_jump_calibration,
            "scales": self.model.scales(),
            "error": self.last_error,
        }
