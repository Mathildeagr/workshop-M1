"""Les quatre evenements de la famille environnement, et leur mise en forme.

L'enveloppe reprend celle du nœud esp01 (event, level, value, detail) pour que le
backend n'ait pas deux formats a connaitre, et la charge utile est la meme sur le
bus et sur la route HTTP : un seul objet, deux transports.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

DETECTOR = "isolation-forest"


@dataclass
class EventRecord:
    event: str
    level: str
    detail: str
    value: float
    source: str                 # le nœud dont vient la mesure
    ts: datetime
    score: float = 0.0          # p-valeur de la foret : 0 banal, 1 inedit
    magnitude: float = 0.0      # ampleur, en multiples de la dispersion apprise
    velocity: float = 0.0       # vitesse sur quinze minutes, meme echelle
    jump: float = 0.0           # saut entre deux mesures brutes, meme echelle
    sensitivity: str = ""
    window_days: float = 0.0
    effective_days: float = 0.0
    origin: str = "model"
    rates: dict[str, float] = field(default_factory=dict)
    contributions: dict[str, float] = field(default_factory=dict)
    elapsed_s: float = 0.0      # renseigne par les rejeux de test, absent des charges utiles

    def payload(self) -> dict:
        return {
            "event": self.event,
            "level": self.level,
            "detail": self.detail,
            "value": _finite(self.value),
            "origin": self.origin,
            "source": self.source,
            "ts": self.ts.isoformat(),
            "detector": DETECTOR,
            "score": round(self.score, 4),
            "magnitude": round(self.magnitude, 3),
            "velocity": round(self.velocity, 3),
            "jump": round(self.jump, 3),
            "sensitivity": self.sensitivity,
            "window_days": self.window_days,
            "effective_days": round(self.effective_days, 3),
            "rates": self.rates,
            "contributions": self.contributions,
        }

    def api_payload(self) -> dict:
        """Meme contenu, renomme pour la route /api/v1/alerts : leur champ s'appelle
        type la ou le bus parle d'event."""
        body = self.payload()
        body["type"] = body.pop("event")
        return body


def _finite(value: float) -> float | None:
    """Un NaN n'est pas du JSON valide."""
    if value is None or not math.isfinite(value):
        return None
    return round(float(value), 4)
