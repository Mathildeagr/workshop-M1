"""Tampon des mesures recentes d'un boitier, et passage du flux brut au verdict.

Deux echelles de temps cohabitent. La foret travaille sur des moyennes a la
minute, comme a l'apprentissage. Le saut entre deux mesures brutes est surveille
a part : une pointe de deux secondes ne deplace une moyenne d'une minute que de
quelques pourcents, et c'est pourtant elle qui signale un incendie.
"""

from __future__ import annotations

import logging
from collections import deque
from datetime import datetime, timedelta

import polars as pl

from predict_anomalie import features as F
from predict_anomalie.detect import AnomalyModel, Verdict
from predict_anomalie.store.postgres import MINUTE_SCHEMA

log = logging.getLogger(__name__)

TRACKED = ("temperature", "humidity", "gas_ratio")
AVERAGED = ("temperature", "humidity", "dew_point", "gas_ratio", "gas")

# Les fenetres de variables remontent a une heure ; on en garde trois pour que la
# pente longue soit calculable des la premiere minute apres un redemarrage.
MINUTE_DEPTH = 180
SLIDING_SECONDS = 60.0


class DeviceStream:
    def __init__(self, source: str) -> None:
        self.source = source
        self._minutes: deque[dict] = deque(maxlen=MINUTE_DEPTH)
        self._raw: deque[tuple[datetime, dict]] = deque()
        self._bucket: datetime | None = None
        self._accumulating: list[dict] = []
        self._previous: dict[str, float] = {}
        self._peaks: dict[str, float] = {}
        self.last_seen: datetime | None = None
        self.samples = 0

    # -- alimentation ------------------------------------------------------

    def prime(self, frame: pl.DataFrame) -> int:
        """Amorce depuis la base. Sans ca, la brique est aveugle une heure apres
        chaque redemarrage, le temps que les fenetres se remplissent."""
        if frame.is_empty():
            return 0
        rows = frame.sort("bucket").tail(MINUTE_DEPTH).to_dicts()
        self._minutes.clear()
        self._minutes.extend(rows)
        return len(rows)

    def ingest(self, sample: dict, at: datetime) -> None:
        """Range une trame telemetry et retient le plus grand saut depuis la derniere
        notation.

        La foret note toutes les cinq secondes, les mesures arrivent toutes les deux :
        sans ce maximum glissant, quatre sauts sur cinq passeraient inapercus. Or
        c'est justement le saut qui signale ce qu'une moyenne d'une minute ne voit
        pas encore.
        """
        self.last_seen = at
        self.samples += 1

        bucket = at.replace(second=0, microsecond=0)
        if self._bucket is None:
            self._bucket = bucket
        elif bucket != self._bucket:
            self._finalize()
            self._bucket = bucket

        self._accumulating.append(sample)
        self._raw.append((at, sample))
        horizon = at - timedelta(seconds=SLIDING_SECONDS)
        while self._raw and self._raw[0][0] < horizon:
            self._raw.popleft()

        for name in TRACKED:
            value = sample.get(name)
            if value is None:
                continue
            if name in self._previous:
                delta = abs(value - self._previous[name])
                self._peaks[name] = max(self._peaks.get(name, 0.0), delta)
            self._previous[name] = value

    def _finalize(self) -> None:
        """Clot la minute ecoulee et la pousse dans l'historique local."""
        rows = [r for r in self._accumulating if r.get("temperature") is not None]
        self._accumulating = []
        if not rows or self._bucket is None:
            return
        self._minutes.append(self._aggregate(rows, self._bucket))

    def _aggregate(self, rows: list[dict], bucket: datetime) -> dict:
        def mean(name: str) -> float | None:
            values = [r[name] for r in rows if r.get(name) is not None]
            return sum(values) / len(values) if values else None

        temperatures = [r["temperature"] for r in rows if r.get("temperature") is not None]
        presences = [r["presence_count"] for r in rows if r.get("presence_count") is not None]
        return {
            "device_id": self.source,
            "bucket": bucket,
            "samples": len(rows),
            "temperature": mean("temperature"),
            "temperature_min": min(temperatures) if temperatures else None,
            "temperature_max": max(temperatures) if temperatures else None,
            "humidity": mean("humidity"),
            "dew_point": mean("dew_point"),
            "gas_ratio": mean("gas_ratio"),
            "gas": mean("gas"),
            "presence_count": max(presences) if presences else 0,
        }

    # -- notation ----------------------------------------------------------

    def judge(self, model: AnomalyModel, at: datetime) -> Verdict | None:
        """Note l'instant courant : minutes closes, plus la minute en cours vue
        comme une moyenne glissante sur soixante secondes."""
        if not model.ready or not self._raw:
            return None
        peaks, self._peaks = self._peaks, {}
        latest = self._raw[-1][1]

        provisional = self._aggregate([s for _, s in self._raw], at.replace(second=0, microsecond=0))
        history = [r for r in self._minutes if r["bucket"] < provisional["bucket"]]
        if len(history) < 5:
            return None

        frame = pl.DataFrame(history + [provisional], schema=MINUTE_SCHEMA)
        featured = F.build(frame, model.profile)
        row = featured.tail(1)
        if row.select(F.FEATURES).null_count().to_numpy().sum() > 0:
            return None
        return model.judge(row, peaks, latest)

    # -- etat --------------------------------------------------------------

    def silent_for(self, at: datetime) -> float | None:
        if self.last_seen is None:
            return None
        return (at - self.last_seen).total_seconds()

    def state(self, at: datetime) -> dict:
        return {
            "samples": self.samples,
            "minutes_buffered": len(self._minutes),
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
            "silent_for_s": round(self.silent_for(at), 1) if self.last_seen else None,
        }
