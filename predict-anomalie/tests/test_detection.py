"""Les quatre evenements doivent se separer sur les deux axes : ampleur et vitesse."""

from predict_anomalie.policy import EnvironmentPolicy
from tests.conftest import calm, ramp, replay, sample


def names(events) -> list[str]:
    return [e.event for e in events]


def test_regime_normal_ne_leve_rien(model, runtime, history):
    policy = EnvironmentPolicy("esp01", runtime)
    events = replay(model, runtime, policy, calm, duration_s=3600, history=history)

    assert names(events) == []
    # Le taux observe doit rester du meme ordre que celui annonce par la bande.
    assert policy.observed_rate <= 4 * (1 - runtime.band.drift)


def test_orage_leve_une_derive(model, runtime, history):
    """Modification legere : l'environnement bouge, sans gravite."""

    def storm(elapsed_s: float) -> dict:
        base = calm(elapsed_s)
        progress = min(1.0, elapsed_s / 2400.0)
        return sample(base["temperature"] - 2.0 * progress, 52.0 + 6.0 * progress)

    policy = EnvironmentPolicy("esp01", runtime)
    events = replay(model, runtime, policy, storm, duration_s=3000, history=history)

    assert "env_drift" in names(events)
    assert events[0].event == "env_drift"
    assert events[0].level == "info"
    # Ce qui en fait une derive et pas une anomalie : l'ampleur reste moderee.
    assert events[0].magnitude < runtime.band.magnitude
    assert "env_anomaly" not in names(events)


def test_montee_marquee_et_lente_leve_une_anomalie(model, runtime, history):
    """45 C atteints en trois heures : marque, mais pas vif."""
    policy = EnvironmentPolicy("esp01", runtime)
    events = replay(
        model, runtime, policy, ramp(45.0, over_s=3 * 3600), duration_s=3 * 3600, history=history
    )

    assert "env_anomaly" in names(events)
    anomaly = next(e for e in events if e.event == "env_anomaly")
    assert anomaly.level == "warning"
    # L'ampleur est marquee, mais la vitesse reste sous la bande : c'est ce qui
    # le distingue du critique.
    assert anomaly.magnitude >= runtime.band.magnitude
    assert anomaly.velocity < runtime.band.velocity


def test_montee_marquee_et_rapide_leve_un_critique(model, runtime, history):
    """45 C atteints en deux minutes : la meme ampleur, mais vive."""
    policy = EnvironmentPolicy("esp01", runtime)
    events = replay(
        model, runtime, policy, ramp(45.0, over_s=120), duration_s=900, history=history
    )

    assert "env_critical" in names(events)
    assert next(e for e in events if e.event == "env_critical").level == "critical"


def explosion(elapsed_s: float) -> dict:
    """100 C en deux secondes, a la dixieme minute."""
    return calm(elapsed_s) if elapsed_s < 600 else sample(100.0, 20.0)


def delay(events, name: str) -> float:
    """Secondes entre le saut et le premier evenement de ce nom."""
    return next(e for e in events if e.event == name).elapsed_s - 600


def test_saut_brutal_leve_un_critique(model, runtime, history):
    policy = EnvironmentPolicy("esp01", runtime)
    events = replay(model, runtime, policy, explosion, duration_s=700, history=history)

    assert "env_critical" in names(events)
    # Deux notations suffisent : la premiere voit le saut, la seconde le confirme.
    assert delay(events, "env_critical") <= 15.0


def test_la_calibration_de_saut_fait_gagner_une_demi_minute(model, blind_model, runtime, history):
    """Toute la raison d'etre du second signal.

    Sans lui, le critique finit par tomber : la pente sur quinze minutes se charge
    a mesure que la moyenne rattrape la marche. Mais elle met une trentaine de
    secondes a franchir la bande, alors que l'ecart entre deux mesures brutes le
    dit immediatement. Sur un incendie, ces secondes sont tout ce qui compte.
    """
    quick = replay(model, runtime, EnvironmentPolicy("esp01", runtime), explosion, 700, history)
    slow = replay(blind_model, runtime, EnvironmentPolicy("esp01", runtime), explosion, 700, history)

    assert blind_model.meta is not None and not blind_model.meta.has_jump_calibration
    assert "env_critical" in names(quick)
    assert "env_critical" in names(slow)
    assert delay(slow, "env_critical") - delay(quick, "env_critical") >= 20.0


def test_une_lecture_aberrante_isolee_ne_declenche_pas_de_critique(model, runtime, history):
    """Un DHT22 bafouille de temps en temps. La confirmation sur deux notations est
    la pour que ca ne reveille personne."""

    def glitch(elapsed_s: float) -> dict:
        return sample(100.0, 20.0) if 600 <= elapsed_s < 602 else calm(elapsed_s)

    policy = EnvironmentPolicy("esp01", runtime)
    events = replay(model, runtime, policy, glitch, duration_s=1500, history=history)

    assert "env_critical" not in names(events)
    assert "env_anomaly" not in names(events)


def test_retour_a_la_normale_se_signale(model, runtime, history):
    """Une anomalie qui se resorbe doit produire env_cleared, et un seul."""

    def spike_then_calm(elapsed_s: float) -> dict:
        if 300 <= elapsed_s < 1500:
            return sample(38.0, 30.0)
        return calm(elapsed_s)

    policy = EnvironmentPolicy("esp01", runtime)
    events = replay(model, runtime, policy, spike_then_calm, duration_s=2700, history=history)

    assert names(events).count("env_cleared") == 1
    assert names(events)[-1] == "env_cleared"


def test_les_contributions_designent_la_variable_en_cause(model, runtime, history):
    policy = EnvironmentPolicy("esp01", runtime)
    events = replay(
        model, runtime, policy, ramp(45.0, over_s=3 * 3600), duration_s=3 * 3600, history=history
    )

    anomaly = next(e for e in events if e.event == "env_anomaly")
    assert anomaly.contributions
    assert abs(sum(anomaly.contributions.values()) - 1.0) < 0.01
    assert anomaly.detail.startswith("temperature")
