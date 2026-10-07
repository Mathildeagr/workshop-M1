import math
import random
from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl
import pytest

from predict_anomalie.config import RuntimeConfig, Settings
from predict_anomalie.detect import AnomalyModel
from predict_anomalie.seed import dew_point, synthesize
from predict_anomalie.store.postgres import MINUTE_SCHEMA

HISTORY_DAYS = 14
START = datetime(2026, 10, 6, 14, 0, tzinfo=UTC)


@pytest.fixture(scope="session")
def history() -> pl.DataFrame:
    return pl.DataFrame(synthesize(HISTORY_DAYS, until=START), schema=MINUTE_SCHEMA)


@pytest.fixture(scope="session")
def jump_scales() -> dict[str, float]:
    """Dispersion des ecarts entre deux mesures consecutives.

    En production elle vient de la table brute, par un percentile en SQL. Ici on la
    prend sur le meme regime normal que celui des scenarios : c'est l'ecart entre
    deux mesures qu'il faut calibrer, pas le bruit du capteur, et les deux n'ont pas
    le meme ecart-type.
    """
    series = [calm(t) for t in range(0, 20000, 2)]
    return {
        name: float(np.quantile(np.abs(np.diff([s[name] for s in series])), 0.999))
        for name in ("temperature", "humidity", "gas_ratio")
    }


@pytest.fixture(scope="session")
def model(history, jump_scales) -> AnomalyModel:
    trained = AnomalyModel()
    trained.fit(history, window_days=HISTORY_DAYS, jump_scales=jump_scales)
    return trained


@pytest.fixture(scope="session")
def blind_model(history) -> AnomalyModel:
    """Le meme modele, sans calibration de saut : sert a mesurer ce qu'elle apporte."""
    trained = AnomalyModel()
    trained.fit(history, window_days=HISTORY_DAYS)
    return trained


@pytest.fixture
def runtime() -> RuntimeConfig:
    return RuntimeConfig(Settings(_env_file=None, sensitivity="medium", window_days=HISTORY_DAYS))


def sample(temperature: float, humidity: float, gas_ratio: float = 1.0) -> dict:
    return {
        "temperature": temperature,
        "humidity": humidity,
        "dew_point": dew_point(temperature, humidity),
        "gas_ratio": gas_ratio,
        "gas": 180.0 * gas_ratio,
        "presence_count": 1,
    }


def calm(elapsed_s: float) -> dict:
    """Prolongement normal de l'historique : cycle du jour et bruit de capteur."""
    rng = random.Random(int(elapsed_s))
    hour = 14.0 + elapsed_s / 3600.0
    temperature = 19.5 + 2.5 * math.sin((hour - 10.0) / 24.0 * 2 * math.pi) + rng.gauss(0, 0.08)
    return sample(temperature, 52.0 - 1.2 * (temperature - 19.5) + rng.gauss(0, 0.5))


def ramp(target_temperature: float, over_s: float, humidity: float = 52.0):
    """Montee lineaire vers une temperature, en partant du regime normal."""

    def builder(elapsed_s: float) -> dict:
        base = calm(elapsed_s)
        progress = min(1.0, elapsed_s / over_s)
        return sample(
            base["temperature"] + (target_temperature - base["temperature"]) * progress,
            humidity,
        )

    return builder


def replay(model, runtime, policy, builder, duration_s: float, history: pl.DataFrame):
    """Rejoue un scenario a la cadence reelle du nœud.

    Renvoie les evenements leves, chacun accompagne de la seconde ou il est tombe.
    """
    from predict_anomalie.pipeline import DeviceStream

    stream = DeviceStream("esp01")
    stream.prime(history)

    settings = Settings(_env_file=None)
    step = settings.sample_period_s
    every = max(1, round(settings.score_interval_s / step))

    events = []
    for tick in range(int(duration_s / step)):
        elapsed = tick * step
        at = START + timedelta(seconds=elapsed)
        stream.ingest(builder(elapsed), at)
        if tick % every:
            continue
        verdict = stream.judge(model, at)
        if verdict is None:
            continue
        record = policy.update(verdict, at, effective_days=HISTORY_DAYS)
        if record:
            record.elapsed_s = elapsed
            events.append(record)
    return events
