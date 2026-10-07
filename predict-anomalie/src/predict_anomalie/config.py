"""Reglages de la brique : variables d'environnement, et consignes recues en cours de route."""

from dataclasses import dataclass

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SENSITIVITIES = ("low", "medium", "high")


@dataclass(frozen=True)
class Band:
    """Seuils d'une sensibilite.

    Le premier est un quantile des scores d'apprentissage : il rend le taux
    d'alerte previsible, en medium la brique parle une fois sur vingt. Les deux
    suivants sont des rapports sans dimension a la dispersion relevee pendant
    l'apprentissage, parce qu'un quantile sature et ne sait pas dire si un ecart
    est modere ou marque.

    Aucun des quatre n'est un seuil physique ecrit en dur, ce que le sujet interdit.
    """

    drift: float        # p-valeur au-dela de laquelle il se passe quelque chose
    magnitude: float    # ampleur au-dela de laquelle l'ecart est marque
    velocity: float     # vitesse au-dela de laquelle un ecart marque devient vif
    clear: float        # p-valeur en dessous de laquelle on est revenu a la normale
    persistence: int    # echantillons consecutifs avant de lever une derive


BANDS = {
    "low":    Band(drift=0.990, magnitude=3.0, velocity=8.0, clear=0.950, persistence=5),
    "medium": Band(drift=0.950, magnitude=2.0, velocity=5.0, clear=0.900, persistence=3),
    "high":   Band(drift=0.900, magnitude=1.2, velocity=3.0, clear=0.800, persistence=2),
}

# Un ecart aussi marque que le plus marque de la fenetre d'apprentissage ne peut
# pas passer inapercu, meme si la foret le classe au milieu du peloton.
BEYOND_WINDOW = 1.0


class Settings(BaseSettings):
    """Ce qui est fixe au demarrage. Les consignes du backend sont dans RuntimeConfig."""

    model_config = SettingsConfigDict(env_prefix="PREDICT_", env_file=".env", extra="ignore")

    device_id: str = "predictive"

    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883
    mqtt_user: str = ""
    mqtt_password: str = ""

    database_url: str = Field(
        default="",
        validation_alias=AliasChoices("PREDICT_DATABASE_URL", "DATABASE_URL"),
    )

    # Sortie HTTP de secours : le backend n'a pas encore d'abonne MQTT, et sans ca
    # les evenements ne seraient recus par personne. Vide = desactivee.
    api_url: str = Field(
        default="",
        validation_alias=AliasChoices("PREDICT_API_URL", "SENTINEL_API_URL"),
    )
    api_token: str = Field(
        default="",
        validation_alias=AliasChoices("PREDICT_API_TOKEN", "SENTINEL_API_TOKEN"),
    )

    http_host: str = "0.0.0.0"
    http_port: int = 8000

    # Les nœuds publient toutes les 2 s ; au-dela de ce silence on les considere muets.
    sample_period_s: float = 2.0
    silence_factor: float = 1.5

    raw_retention_days: int = 7
    rollup_interval_s: int = 600

    score_interval_s: float = 5.0
    retrain_interval_s: int = 3600
    min_train_minutes: int = 120

    sensitivity: str = "medium"
    window_days: float = 7.0

    model_dir: str = "/var/lib/predict-anomalie"


class RuntimeConfig:
    """Les consignes du backend. Mutable, et c'est la seule chose qui l'est."""

    def __init__(self, settings: Settings) -> None:
        self.sensitivity = settings.sensitivity if settings.sensitivity in BANDS else "medium"
        self.window_days = max(0.01, settings.window_days)
        # Renseignee par l'entraineur : la fenetre demandee n'est pas toujours celle
        # que l'historique permet de couvrir.
        self.effective_days = 0.0

    @property
    def band(self) -> Band:
        return BANDS[self.sensitivity]

    def set_sensitivity(self, mode: str) -> bool:
        if mode not in BANDS:
            return False
        self.sensitivity = mode
        return True

    def set_window(self, days: float) -> bool:
        """Aucune borne haute : le backend choisit sa periode de reference en jours."""
        try:
            value = float(days)
        except (TypeError, ValueError):
            return False
        if value <= 0:
            return False
        self.window_days = value
        return True

    def payload(self) -> dict:
        band = self.band
        return {
            "sensitivity": self.sensitivity,
            "window_days": self.window_days,
            "effective_days": round(self.effective_days, 3),
            "drift_quantile": band.drift,
            "magnitude_ratio": band.magnitude,
            "velocity_ratio": band.velocity,
            "persistence": band.persistence,
        }
