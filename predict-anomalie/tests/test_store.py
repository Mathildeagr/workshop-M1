"""Verification du SQL contre une vraie base.

Ignore si aucune base n'est fournie. Pour la lancer :

    docker run -d --rm --name pg -e POSTGRES_PASSWORD=verif -p 55432:5432 postgres:16-alpine
    PREDICT_TEST_DSN=postgres://postgres:verif@localhost:55432/postgres uv run pytest tests/test_store.py
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest

from predict_anomalie.config import RuntimeConfig, Settings
from predict_anomalie.seed import dew_point, synthesize
from predict_anomalie.store import Database
from predict_anomalie.trainer import Trainer

DSN = os.environ.get("PREDICT_TEST_DSN", "")
pytestmark = pytest.mark.skipif(not DSN, reason="PREDICT_TEST_DSN non fournie")


@pytest.fixture
def database():
    base = Database(DSN)
    base.connect()
    with base._cursor() as cur:                      # noqa: SLF001 - preparation de test
        cur.execute("DROP TABLE IF EXISTS sensor_readings, sensor_minutes CASCADE")
    base.migrate()
    yield base
    with base._cursor() as cur:                      # noqa: SLF001
        cur.execute("DROP TABLE IF EXISTS sensor_readings, sensor_minutes CASCADE")
    base.close()


def raw_rows(count: int, start: datetime, step_s: float = 2.0) -> list[dict]:
    rows = []
    for index in range(count):
        temperature = 20.0 + (index % 60) * 0.01
        humidity = 52.0 - (index % 60) * 0.005
        rows.append(
            {
                "device_id": "esp01",
                "measured_at": start + timedelta(seconds=index * step_s),
                "temperature": temperature,
                "humidity": humidity,
                "dew_point": dew_point(temperature, humidity),
                "gas": 180,
                "gas_ratio": 1.0,
                "motion": False,
                "presence_count": 1,
                "tilt": "repos",
                "optic": "repos",
                "uptime_s": index * 2,
                "climate_age_ms": 400,
                "gas_age_ms": 120,
            }
        )
    return rows


def test_migration_est_idempotente(database):
    database.migrate()
    database.migrate()
    first, last, count = database.coverage()
    assert (first, last, count) == (None, None, 0)


def test_le_repli_agrege_a_la_minute(database):
    start = datetime.now(UTC) - timedelta(minutes=10)
    assert database.insert_raw(raw_rows(300, start)) == 300

    folded = database.rollup()
    assert folded >= 9          # dix minutes, la derniere encore en cours est laissee

    minutes = database.load_window(1.0)
    assert minutes.height == folded
    assert minutes["samples"].max() == 30
    assert 19.0 < minutes["temperature"].mean() < 21.0


def test_la_purge_epargne_ce_qui_n_est_pas_replie(database):
    start = datetime.now(UTC) - timedelta(days=30)
    database.insert_raw(raw_rows(120, start))

    # Rien n'est encore replie : la purge ne doit toucher a rien, meme vieux d'un mois.
    assert database.purge(days=7) == 0

    database.rollup()
    assert database.purge(days=7) == 120


def test_les_echelles_de_saut_se_calculent_en_sql(database):
    start = datetime.now(UTC) - timedelta(hours=1)
    rows = raw_rows(600, start)
    rows[300]["temperature"] = 80.0           # une marche, pour avoir une dispersion
    database.insert_raw(rows)

    scales = database.jump_scales(days=7)
    assert set(scales) <= {"temperature", "humidity", "gas_ratio"}
    assert scales["temperature"] > 1.0


def test_l_apprentissage_tourne_de_bout_en_bout(database, tmp_path):
    database.insert_minutes(synthesize(3.0, device_id="esp01"))
    database.insert_raw(raw_rows(600, datetime.now(UTC) - timedelta(hours=1)))

    settings = Settings(_env_file=None, model_dir=str(tmp_path), window_days=3.0)
    runtime = RuntimeConfig(settings)
    trainer = Trainer(database, runtime, settings)

    assert trainer.train() is True
    assert trainer.model.ready
    assert trainer.model.meta.rows > 3000
    assert 2.9 < runtime.effective_days <= 3.0
    assert trainer.state()["jump_calibrated"] is True

    # Le modele doit se recharger a l'identique apres un redemarrage.
    revived = Trainer(database, runtime, settings)
    assert revived.restore() is True
    assert revived.model.meta.rows == trainer.model.meta.rows


def test_une_fenetre_trop_large_est_annoncee_telle_quelle(database, tmp_path):
    database.insert_minutes(synthesize(2.0, device_id="esp01"))

    settings = Settings(_env_file=None, model_dir=str(tmp_path), window_days=3650.0)
    runtime = RuntimeConfig(settings)
    trainer = Trainer(database, runtime, settings)

    assert trainer.train() is True
    # La consigne est acceptee, mais la brique repond la couverture reelle : au
    # backend de l'afficher correctement.
    assert runtime.window_days == 3650.0
    assert runtime.effective_days < 3.0


def test_un_historique_trop_court_ne_remplace_pas_le_modele(database, tmp_path):
    settings = Settings(_env_file=None, model_dir=str(tmp_path), window_days=7.0)
    runtime = RuntimeConfig(settings)
    trainer = Trainer(database, runtime, settings)

    assert trainer.train() is False
    assert trainer.last_error is not None
    assert not trainer.model.ready


def test_une_insuffisance_ne_fait_pas_perdre_le_modele_en_service(database, tmp_path):
    database.insert_minutes(synthesize(2.0, device_id="esp01"))
    settings = Settings(_env_file=None, model_dir=str(tmp_path), window_days=2.0)
    runtime = RuntimeConfig(settings)
    trainer = Trainer(database, runtime, settings)
    assert trainer.train() is True
    served = trainer.model

    # On vide l'historique et on redemande un apprentissage : il doit echouer sans
    # rendre la brique muette.
    with database._cursor() as cur:                  # noqa: SLF001
        cur.execute("TRUNCATE sensor_minutes")
    assert trainer.train() is False
    assert trainer.model is served
    assert trainer.model.ready


def test_un_modele_sur_disque_illisible_ne_bloque_pas_le_demarrage(database, tmp_path):
    (tmp_path / "model.joblib").write_bytes(b"ceci n'est pas un modele")
    settings = Settings(_env_file=None, model_dir=str(tmp_path))
    trainer = Trainer(database, RuntimeConfig(settings), settings)

    assert trainer.restore() is False
    assert not trainer.model.ready
