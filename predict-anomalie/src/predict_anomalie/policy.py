"""Du verdict du modele aux quatre evenements.

Deux axes decident, pas un seul : l'ampleur de l'ecart, et la vitesse a laquelle
il s'installe.

    ecart modere, lent ou rapide      -> env_drift      l'orage
    ecart marque                      -> env_anomaly    45 degres en trois heures
    ecart marque et vif               -> env_critical   45 degres en deux minutes
    retour sous la bande basse        -> env_cleared

Un orage fait bouger l'environnement vite, sans que ce soit grave : la vitesse
seule ne suffit jamais a aggraver, elle n'intervient qu'une fois l'ampleur
etablie. Un ecart modere arrive violemment, c'est un capteur qui a bafouille, pas
un incendie.

Le critique demande deux mesures de suite pour la meme raison : une lecture
aberrante de DHT22 ne doit pas reveiller la nuit, et ce qui tient dix secondes
n'est plus une lecture aberrante.
"""

from __future__ import annotations

import logging
from collections import deque
from datetime import datetime
from enum import IntEnum

from predict_anomalie.config import BEYOND_WINDOW, Band, RuntimeConfig
from predict_anomalie.detect import Verdict
from predict_anomalie.events import EventRecord

log = logging.getLogger(__name__)


class Stage(IntEnum):
    NORMAL = 0
    DRIFT = 1
    ANOMALY = 2
    CRITICAL = 3


EVENT_NAME = {
    Stage.DRIFT: "env_drift",
    Stage.ANOMALY: "env_anomaly",
    Stage.CRITICAL: "env_critical",
}
EVENT_LEVEL = {
    Stage.DRIFT: "info",
    Stage.ANOMALY: "warning",
    Stage.CRITICAL: "critical",
}
CLEARED = "env_cleared"

# Un saut est par nature fugace : la temperature monte d'un coup puis se tient, donc
# l'ecart entre deux mesures redevient nul des la mesure suivante. La violence de la
# transition, elle, reste vraie. On la garde quelques notations, le temps que la
# confirmation puisse s'appuyer dessus.
JUMP_MEMORY = 3

# Variable dominante -> libelle lisible, et la pente a citer avec.
FAMILY = {
    "temperature": ("temperature", "temperature_slope"),
    "humidity": ("humidite", "humidity_slope"),
    "gas_ratio": ("gaz", "gas_ratio_slope"),
    "dew_point": ("rosee", None),
    "presence_count": ("presence", None),
    "hour": ("horaire", None),
}


def describe(dominant: str, rates: dict[str, float]) -> str:
    for prefix, (label, slope) in FAMILY.items():
        if dominant.startswith(prefix):
            rate = rates.get(slope) if slope else None
            return f"{label} {rate:+.1f}/h" if rate else label
    return "environnement"


class EnvironmentPolicy:
    """Machine a etats d'un boitier. Un objet par source de mesures."""

    def __init__(self, source: str, runtime: RuntimeConfig) -> None:
        self.source = source
        self._runtime = runtime
        self.stage = Stage.NORMAL
        self._streak_stage = Stage.NORMAL
        self._streak = 0
        self._calm = 0
        self._jumps: deque[float] = deque(maxlen=JUMP_MEMORY)
        self.judged = 0
        self.above = 0
        self.last_verdict: Verdict | None = None
        self.last_event: EventRecord | None = None
        self.entered_at: datetime | None = None

    # -- decision ----------------------------------------------------------

    def _candidate(self, verdict: Verdict, band: Band) -> Stage:
        self._jumps.append(verdict.jump)
        unusual = verdict.score >= band.drift or verdict.magnitude >= BEYOND_WINDOW
        if not unusual:
            return Stage.NORMAL

        if verdict.magnitude < band.magnitude:
            return Stage.DRIFT

        # Deux echelles de temps pour une seule question : est-ce arrive vite.
        # La pente voit les minutes, le saut voit les secondes.
        fast = max(verdict.velocity, max(self._jumps)) >= band.velocity
        return Stage.CRITICAL if fast else Stage.ANOMALY

    def _needed(self, stage: Stage, band: Band) -> int:
        if stage is Stage.DRIFT:
            return band.persistence
        return max(2, band.persistence // 2)

    # -- mise a jour -------------------------------------------------------

    def update(self, verdict: Verdict, now: datetime, effective_days: float) -> EventRecord | None:
        band = self._runtime.band
        self.judged += 1
        self.last_verdict = verdict
        if verdict.score >= band.drift:
            self.above += 1

        candidate = self._candidate(verdict, band)
        if candidate == self._streak_stage:
            self._streak += 1
        else:
            self._streak_stage, self._streak = candidate, 1

        self._calm = self._calm + 1 if candidate is Stage.NORMAL and verdict.score < band.clear else 0

        if candidate > self.stage and self._streak >= self._needed(candidate, band):
            self.stage = candidate
            self.entered_at = now
            return self._emit(candidate, verdict, now, effective_days)

        # On ne redescend jamais d'un cran : seul le retour a la normale se signale.
        if self.stage is not Stage.NORMAL and self._calm >= band.persistence:
            previous, self.stage = self.stage, Stage.NORMAL
            self.entered_at = None
            self._streak_stage, self._streak = Stage.NORMAL, 0
            log.info("%s : retour a la normale apres %s", self.source, EVENT_NAME[previous])
            return self._emit(Stage.NORMAL, verdict, now, effective_days)

        return None

    def _emit(
        self, stage: Stage, verdict: Verdict, now: datetime, effective_days: float
    ) -> EventRecord:
        if stage is Stage.NORMAL:
            name, level = CLEARED, "info"
        else:
            name, level = EVENT_NAME[stage], EVENT_LEVEL[stage]

        record = EventRecord(
            event=name,
            level=level,
            detail=describe(verdict.dominant, verdict.rates),
            value=verdict.score,
            source=self.source,
            ts=now,
            score=verdict.score,
            magnitude=verdict.magnitude,
            velocity=verdict.velocity,
            jump=verdict.jump,
            sensitivity=self._runtime.sensitivity,
            window_days=self._runtime.window_days,
            effective_days=effective_days,
            rates=verdict.rates,
            contributions=verdict.contributions,
        )
        self.last_event = record
        return record

    def resync(self) -> None:
        """Les compteurs d'une bande ne veulent plus rien dire dans une autre."""
        self._streak_stage, self._streak, self._calm = Stage.NORMAL, 0, 0
        self._jumps.clear()

    # -- lecture pour l'API ------------------------------------------------

    @property
    def observed_rate(self) -> float:
        return self.above / self.judged if self.judged else 0.0

    def state(self) -> dict:
        verdict = self.last_verdict
        return {
            "source": self.source,
            "stage": self.stage.name.lower(),
            "since": self.entered_at.isoformat() if self.entered_at else None,
            "score": round(verdict.score, 4) if verdict else None,
            "magnitude": round(verdict.magnitude, 3) if verdict else None,
            "velocity": round(verdict.velocity, 3) if verdict else None,
            "jump": round(verdict.jump, 3) if verdict else None,
            "rates": verdict.rates if verdict else {},
            "judged": self.judged,
            "expected_rate": round(1.0 - self._runtime.band.drift, 5),
            "observed_rate": round(self.observed_rate, 5),
            "last_event": self.last_event.event if self.last_event else None,
        }
