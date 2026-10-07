"""Generateur d'historique de synthese.

Le projet a quatre jours d'existence : au-dela d'une journee, il n'y a rien a
apprendre. Ce module fabrique un passe plausible pour que les fenetres longues
soient exercees et que la demonstration tienne. Les donnees sont synthetiques et
doivent etre annoncees comme telles.

    uv run seed-history --days 30
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import random
from datetime import UTC, datetime, timedelta

log = logging.getLogger(__name__)

BASE_TEMPERATURE = 19.5
BASE_HUMIDITY = 52.0
PEAK_HOUR = 16.0


class Episode:
    """Evenement passager applique en rampe plutot qu'en marche d'escalier.

    Une aeration ne refroidit pas une piece en une minute. Sans la rampe, la serie
    porte des pentes de cent degres par heure et la calibration de vitesse devient
    incapable de distinguer un incendie d'une fenetre ouverte.
    """

    def __init__(self, ramp: int) -> None:
        self.ramp = ramp
        self.total = 0
        self.elapsed = 0

    @property
    def idle(self) -> bool:
        return self.elapsed >= self.total

    def start(self, duration: int) -> None:
        self.total, self.elapsed = duration, 0

    def step(self) -> float:
        """Enveloppe entre 0 et 1 : montee, plateau, descente."""
        if self.idle:
            return 0.0
        self.elapsed += 1
        remaining = self.total - self.elapsed
        return max(0.0, min(1.0, self.elapsed / self.ramp, remaining / self.ramp))


def dew_point(temperature: float, humidity: float) -> float:
    """Magnus-Tetens, la meme approximation que celle embarquee dans le nœud."""
    humidity = min(max(humidity, 1.0), 100.0)
    gamma = math.log(humidity / 100.0) + (17.62 * temperature) / (243.12 + temperature)
    return 243.12 * gamma / (17.62 - gamma)


def synthesize(
    days: float,
    device_id: str = "esp01",
    until: datetime | None = None,
    seed: int = 20261006,
) -> list[dict]:
    """Serie en minutes : cycle jour/nuit, chauffage, aerations, cuisine, presence."""
    rng = random.Random(seed)
    end = (until or datetime.now(UTC)).replace(second=0, microsecond=0)
    count = int(days * 24 * 60)
    start = end - timedelta(minutes=count)

    wander = 0.0           # derive lente du local, marche aleatoire bornee
    airing = Episode(ramp=6)    # aeration : la piece se refroidit progressivement
    cooking = Episode(ramp=4)   # emission de gaz, puis dissipation
    rows: list[dict] = []

    for index in range(count):
        bucket = start + timedelta(minutes=index)
        hour = bucket.hour + bucket.minute / 60.0
        weekday = bucket.weekday() < 5

        wander = max(-1.5, min(1.5, wander + rng.gauss(0, 0.004)))

        daily = 2.5 * math.sin((hour - PEAK_HOUR + 6.0) / 24.0 * 2 * math.pi)
        heating = 1.2 if weekday and 6.0 <= hour < 9.0 else 0.0
        temperature = BASE_TEMPERATURE + daily + heating + wander + rng.gauss(0, 0.08)

        if airing.idle and rng.random() < 0.0006:
            airing.start(rng.randint(18, 40))
        opening = airing.step()
        temperature -= 1.8 * opening

        humidity = BASE_HUMIDITY - 1.2 * (temperature - BASE_TEMPERATURE) + rng.gauss(0, 0.7)
        humidity -= 7.0 * opening

        if cooking.idle and rng.random() < 0.0004:
            cooking.start(rng.randint(14, 30))
        gas_ratio = 1.0 + rng.gauss(0, 0.012) + 0.28 * cooking.step()

        if not weekday or hour < 7.5 or hour > 19.0:
            presence = 0 if rng.random() < 0.9 else 1
        else:
            presence = rng.randint(0, 5)

        rows.append(
            {
                "device_id": device_id,
                "bucket": bucket,
                "samples": rng.randint(28, 30),
                "temperature": round(temperature, 2),
                "temperature_min": round(temperature - rng.uniform(0.05, 0.25), 2),
                "temperature_max": round(temperature + rng.uniform(0.05, 0.25), 2),
                "humidity": round(min(max(humidity, 10.0), 95.0), 2),
                "dew_point": round(dew_point(temperature, humidity), 2),
                "gas_ratio": round(gas_ratio, 4),
                "gas": round(180.0 * gas_ratio, 1),
                "presence_count": presence,
            }
        )

    return rows


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Insere un historique de synthese en base")
    parser.add_argument("--days", type=float, default=30.0)
    parser.add_argument("--device", default="esp01")
    parser.add_argument("--dsn", default=os.environ.get("DATABASE_URL", ""))
    args = parser.parse_args()

    if not args.dsn:
        parser.error("DATABASE_URL absente et --dsn non fournie")

    from predict_anomalie.store import Database

    rows = synthesize(args.days, args.device)
    database = Database(args.dsn)
    database.migrate()
    written = database.insert_minutes(rows)
    database.close()

    log.info(
        "%d minutes de synthese inserees pour %s, du %s au %s",
        written,
        args.device,
        rows[0]["bucket"].isoformat(timespec="minutes"),
        rows[-1]["bucket"].isoformat(timespec="minutes"),
    )
    log.info("Ces donnees sont fabriquees. A annoncer comme telles.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
