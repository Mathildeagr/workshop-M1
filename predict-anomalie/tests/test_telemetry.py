"""Lecture des trames du nœud esp01, telles que le contrat les decrit."""

from predict_anomalie import telemetry

FULL = {
    "uptime_s": 412,
    "temperature_c": 22.4,
    "humidity_pct": 54.1,
    "dew_point_c": 12.6,
    "gas_raw": 184,
    "gas_warming": False,
    "gas_ratio": 1.021,
    "presence": True,
    "presence_count": 3,
    "tilt": "repos",
    "optic": "repos",
    "climate_age_ms": 1200,
    "gas_age_ms": 300,
}


def test_une_trame_complete_est_traduite():
    measurement = telemetry.parse(FULL)

    assert measurement["temperature"] == 22.4
    assert measurement["humidity"] == 54.1
    assert measurement["dew_point"] == 12.6
    assert measurement["gas"] == 184.0
    assert measurement["gas_ratio"] == 1.021
    assert measurement["presence_count"] == 3
    assert measurement["motion"] is True
    assert measurement["climate_age_ms"] == 1200


def test_les_mesures_de_chauffe_du_mq2_sont_ecartees():
    """Pendant une vingtaine de minutes la valeur monte sans rapport avec l'air."""
    measurement = telemetry.parse(FULL | {"gas_warming": True})

    assert "gas" not in measurement
    assert "gas_ratio" not in measurement
    assert measurement["temperature"] == 22.4


def test_un_capteur_en_panne_laisse_son_champ_absent():
    """Le contrat veut une absence, pas un zero : une valeur manquante doit se
    distinguer d'une mesure valide qui vaut zero."""
    partial = {k: v for k, v in FULL.items() if not k.startswith(("temperature", "humidity", "dew"))}
    measurement = telemetry.parse(partial)

    assert measurement is not None
    assert "temperature" not in measurement
    assert measurement["gas_ratio"] == 1.021


def test_une_trame_sans_aucune_mesure_est_ignoree():
    assert telemetry.parse({"uptime_s": 12, "presence": False}) is None


def test_les_types_fantaisistes_sont_ecartes():
    """Rien ne garantit ce qui arrive sur le bus."""
    measurement = telemetry.parse(
        FULL | {"temperature_c": "chaud", "presence_count": "trois", "tilt": 42}
    )

    assert "temperature" not in measurement
    assert measurement["presence_count"] == 0
    assert measurement["tilt"] is None
