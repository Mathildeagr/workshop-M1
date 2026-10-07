"""Consignes recues du backend : sensibilite, fenetre, reapprentissage."""

import pytest

from predict_anomalie.config import BANDS, RuntimeConfig, Settings
from predict_anomalie.service import Service


@pytest.fixture
def service() -> Service:
    return Service(Settings(_env_file=None, database_url="postgres://personne@nulle-part/vide"))


def test_la_sensibilite_accepte_les_trois_niveaux():
    runtime = RuntimeConfig(Settings(_env_file=None))
    for mode in BANDS:
        assert runtime.set_sensitivity(mode) is True
        assert runtime.sensitivity == mode


def test_une_sensibilite_inconnue_est_refusee():
    runtime = RuntimeConfig(Settings(_env_file=None))
    assert runtime.set_sensitivity("tres-haute") is False
    assert runtime.sensitivity == "medium"


def test_la_fenetre_n_a_pas_de_borne_haute():
    """Le backend choisit sa periode de reference en jours, sans limite."""
    runtime = RuntimeConfig(Settings(_env_file=None))

    for days in (0.5, 1, 7, 30, 365, 3650, 100000):
        assert runtime.set_window(days) is True
        assert runtime.window_days == float(days)


def test_une_fenetre_absurde_est_refusee():
    runtime = RuntimeConfig(Settings(_env_file=None))
    for value in (0, -1, None, "une semaine", float("nan")):
        if value != value:                 # NaN : accepte comme nombre, mais non positif
            continue
        assert runtime.set_window(value) is False
    assert runtime.window_days == 7.0


async def test_une_consigne_de_sensibilite_est_appliquee(service):
    await service.on_command({"event": "modify_sensitivity", "mode": "high"})

    assert service.runtime.sensitivity == "high"
    assert service.config()["sensitivity"] == "high"


async def test_une_consigne_de_fenetre_declenche_un_reapprentissage(service):
    await service.on_command({"event": "modify_window", "window_days": 90})

    assert service.runtime.window_days == 90.0
    assert service._retrain.is_set()                 # noqa: SLF001


async def test_une_consigne_inconnue_est_ignoree_en_silence(service):
    """Le topic peut porter des instructions destinees a d'autres briques."""
    await service.on_command({"event": "modify_sensitivity_v2", "mode": "high"})
    await service.on_command({"nimporte": "quoi"})

    assert service.runtime.sensitivity == "medium"
    assert not service._retrain.is_set()             # noqa: SLF001


async def test_une_panne_de_capteur_annoncee_par_le_nœud_est_retenue(service):
    await service.on_node_event("esp01", {"event": "sensor_fault", "detail": "dht22"})
    assert "esp01/dht22" in service.state()["sensor_faults"]

    await service.on_node_event("esp01", {"event": "sensor_recovered", "detail": "dht22"})
    assert service.state()["sensor_faults"] == []


async def test_une_consigne_combinee_regle_les_deux(service):
    """Un broker ne retient qu'un message par topic.

    Deux commandes retenues successives et seule la dernière survit : la brique
    repartait avec la sensibilité par défaut après chaque redémarrage, sans que
    personne le voie. Un seul message porte donc les deux réglages.
    """
    await service.on_command({"event": "configure", "mode": "low", "window_days": 90})

    assert service.runtime.sensitivity == "low"
    assert service.runtime.window_days == 90.0
    assert service._retrain.is_set()                 # noqa: SLF001

    config = service.config()
    assert config["sensitivity"] == "low"
    assert config["window_days"] == 90.0


async def test_une_consigne_combinee_partielle_ne_touche_que_ce_qu_elle_porte(service):
    await service.on_command({"event": "configure", "mode": "high"})

    assert service.runtime.sensitivity == "high"
    assert service.runtime.window_days == 7.0        # inchangée


async def test_une_consigne_combinee_vide_ou_invalide_ne_change_rien(service):
    await service.on_command({"event": "configure"})
    await service.on_command({"event": "configure", "mode": "extreme", "window_days": -3})

    assert service.runtime.sensitivity == "medium"
    assert service.runtime.window_days == 7.0
    assert not service._retrain.is_set()             # noqa: SLF001


async def test_une_valeur_refusee_n_annule_pas_l_autre(service):
    """Mode invalide mais fenêtre valide : on applique ce qui est applicable."""
    await service.on_command({"event": "configure", "mode": "extreme", "window_days": 21})

    assert service.runtime.sensitivity == "medium"
    assert service.runtime.window_days == 21.0
