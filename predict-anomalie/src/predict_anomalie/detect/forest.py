"""Foret d'isolement, plus les deux echelles qui rendent son verdict ordonnable.

La foret repond bien a une question : ce point est-il rare au vu de ce que j'ai
appris. Son score brut n'a pas d'unite, on le convertit en p-valeur par les
quantiles des scores d'apprentissage, et le taux d'alerte devient previsible.

Mais une p-valeur est un rang, et un rang sature : au-dela de la plage apprise,
45 degres et 23 degres rendent la meme valeur, parce qu'isoler l'un ou l'autre
prend une seule coupe. Elle ne peut donc pas dire si un ecart est modere ou
marque. Deux grandeurs non bornees s'en chargent, chacune ramenee a la dispersion
relevee pendant l'apprentissage :

    ampleur  = ecart a la mediane      / q999 des ecarts observes
    vitesse  = pente, ou saut brut     / q999 des pentes observees

Un rapport de 1 veut dire aussi extreme que le plus extreme point de la fenetre.
Ce sont des rapports sans dimension a une echelle apprise, pas des seuils
physiques ecrits en dur.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

import numpy as np
import polars as pl
from sklearn.ensemble import IsolationForest

from predict_anomalie import features as F

log = logging.getLogger(__name__)

ESTIMATORS = 250
SUBSAMPLE = 512
GRID = 1001
MIN_ROWS = 120
SCALE_QUANTILE = 0.999

# Variables sur lesquelles l'ampleur se mesure : le niveau et l'ecart au profil.
MEASURED = F.LEVEL + F.RESIDUAL


class InsufficientHistory(RuntimeError):
    pass


class Ecdf:
    """Fonction de repartition empirique, resumee par une grille de quantiles.

    Garder la grille plutot que toutes les valeurs borne la taille du modele : un
    an de mesures se resume en mille nombres.
    """

    def __init__(self, values: np.ndarray) -> None:
        clean = np.asarray(values, dtype=float)
        clean = clean[np.isfinite(clean)]
        self.grid = np.quantile(clean, np.linspace(0.0, 1.0, GRID)) if clean.size else np.zeros(1)

    def p(self, value: float | None) -> float:
        if value is None or not np.isfinite(value):
            return 0.0
        return float(np.searchsorted(self.grid, value, side="right")) / float(self.grid.size)

    def at(self, quantile: float) -> float:
        index = min(self.grid.size - 1, max(0, round(quantile * (self.grid.size - 1))))
        return float(self.grid[index])


@dataclass(frozen=True)
class Scale:
    """Centre et dispersion d'une variable, releves sur la fenetre d'apprentissage."""

    center: float
    spread: float

    def ratio(self, value: float | None) -> float:
        if value is None or not np.isfinite(value) or self.spread <= 0:
            return 0.0
        return abs(value - self.center) / self.spread


@dataclass
class Verdict:
    """Ce que le modele retient d'une mesure.

    L'explication par ablation coute une notation par variable. Elle n'est
    calculee que si on la demande, c'est-a-dire au moment de lever un evenement.
    """

    score: float        # p-valeur de la foret : y a-t-il quelque chose
    magnitude: float    # ampleur de l'ecart, en multiples de la dispersion apprise
    velocity: float     # vitesse sur quinze minutes, meme echelle
    jump: float         # saut entre deux mesures brutes, meme echelle
    rates: dict[str, float] = field(default_factory=dict)   # pentes physiques, par heure
    explainer: Callable[[], dict[str, float]] | None = field(default=None, repr=False)
    _shares: dict[str, float] | None = field(default=None, repr=False)

    @property
    def contributions(self) -> dict[str, float]:
        if self._shares is None:
            self._shares = self.explainer() if self.explainer else {}
        return self._shares

    @property
    def dominant(self) -> str:
        shares = self.contributions
        return max(shares, key=shares.get) if shares else "environnement"


@dataclass
class Metadata:
    trained_at: datetime
    rows: int
    window_days: float
    effective_days: float
    first_bucket: datetime | None
    last_bucket: datetime | None
    has_jump_calibration: bool


class AnomalyModel:
    def __init__(self) -> None:
        self._forest: IsolationForest | None = None
        self._profile = F.hourly_profile(pl.DataFrame())
        self._score = Ecdf(np.zeros(0))
        self._levels: dict[str, Scale] = {}
        self._slopes: dict[str, float] = {}
        self._jumps: dict[str, float] = {}
        self._medians = np.zeros(len(F.FEATURES))
        self.meta: Metadata | None = None

    @property
    def ready(self) -> bool:
        return self._forest is not None

    @property
    def profile(self) -> pl.DataFrame:
        return self._profile

    # -- apprentissage -----------------------------------------------------

    def fit(
        self,
        minutes: pl.DataFrame,
        window_days: float,
        jump_scales: dict[str, float] | None = None,
    ) -> Metadata:
        profile = F.hourly_profile(minutes)
        featured = F.trainable(F.build(minutes, profile))
        if featured.height < MIN_ROWS:
            raise InsufficientHistory(f"{featured.height} minutes exploitables, {MIN_ROWS} demandees")

        matrix = featured.select(F.FEATURES).to_numpy()
        forest = IsolationForest(
            n_estimators=ESTIMATORS,
            max_samples=min(SUBSAMPLE, matrix.shape[0]),
            contamination="auto",
            random_state=42,
            n_jobs=1,
        )
        forest.fit(matrix)

        self._forest = forest
        self._profile = profile
        self._score = Ecdf(-forest.score_samples(matrix))
        self._medians = np.nanmedian(matrix, axis=0)
        self._levels = {name: _scale(featured[name].to_numpy()) for name in MEASURED}
        self._slopes = {name: _spread(featured[name].to_numpy()) for name in F.SLOPE}
        self._jumps = {
            name: float(value)
            for name, value in (jump_scales or {}).items()
            if value and np.isfinite(value) and value > 0
        }

        first, last = featured["bucket"].min(), featured["bucket"].max()
        covered = (last - first).total_seconds() / 86400.0 if first and last else 0.0
        self.meta = Metadata(
            trained_at=datetime.now(UTC),
            rows=featured.height,
            window_days=window_days,
            effective_days=covered,
            first_bucket=first,
            last_bucket=last,
            has_jump_calibration=bool(self._jumps),
        )
        log.info("modele entraine sur %d minutes (%.2f jours couverts)", featured.height, covered)
        return self.meta

    # -- detection ---------------------------------------------------------

    def judge(
        self,
        row: pl.DataFrame,
        deltas: dict[str, float] | None = None,
        latest: dict[str, float] | None = None,
    ) -> Verdict:
        """Note une ligne de variables deja construite par features.build.

        deltas porte le plus grand ecart entre deux mesures brutes depuis la
        derniere notation, latest la derniere mesure brute elle-meme. L'ampleur se
        lit sur les deux : une moyenne d'une minute qui n'a avale qu'un echantillon
        sur trente est en retard, pas moderee.
        """
        if self._forest is None:
            raise InsufficientHistory("modele non entraine")

        vector = row.select(F.FEATURES).to_numpy()
        raw = float(-self._forest.score_samples(vector)[0])

        averaged = max(
            (scale.ratio(row[name].item()) for name, scale in self._levels.items()), default=0.0
        )
        instant = max(
            (self._levels[name].ratio(value) for name, value in (latest or {}).items()
             if name in self._levels),
            default=0.0,
        )
        velocity = max(
            (_divide(row[name].item(), spread) for name, spread in self._slopes.items()), default=0.0
        )
        jump = max(
            (_divide(value, self._jumps[name]) for name, value in (deltas or {}).items()
             if name in self._jumps),
            default=0.0,
        )
        rates = {
            name: round(row[name].item(), 3) for name in F.SLOPE if row[name].item() is not None
        }

        return Verdict(
            score=self._score.p(raw),
            magnitude=max(averaged, instant),
            velocity=velocity,
            jump=jump,
            rates=rates,
            explainer=lambda: self._contributions(vector, raw),
        )

    def _contributions(self, vector: np.ndarray, raw: float) -> dict[str, float]:
        """Part de chaque variable dans l'ecart, par ablation.

        On remplace la variable par sa mediane d'apprentissage et on regarde ce que
        le score perd. C'est ce qui permet au dashboard de dire pourquoi, et pas
        seulement que.
        """
        assert self._forest is not None
        probes = np.repeat(vector, len(F.FEATURES), axis=0)
        for index in range(len(F.FEATURES)):
            probes[index, index] = self._medians[index]
        drops = np.maximum(raw - (-self._forest.score_samples(probes)), 0.0)

        total = drops.sum()
        if total <= 0:
            return {}
        return {
            name: round(float(drop / total), 4)
            for name, drop in zip(F.FEATURES, drops, strict=True)
            if drop > 0
        }

    # -- lecture pour l'API ------------------------------------------------

    def scales(self) -> dict[str, float]:
        """Echelles apprises, en unites physiques. Rend les rapports lisibles."""
        return {name: round(spread, 4) for name, spread in self._slopes.items()} | {
            name: round(scale.spread, 4) for name, scale in self._levels.items()
        }


def _scale(values: np.ndarray) -> Scale:
    clean = values[np.isfinite(values)]
    if clean.size == 0:
        return Scale(0.0, 0.0)
    center = float(np.median(clean))
    return Scale(center, float(np.quantile(np.abs(clean - center), SCALE_QUANTILE)))


def _spread(values: np.ndarray) -> float:
    clean = values[np.isfinite(values)]
    return float(np.quantile(np.abs(clean), SCALE_QUANTILE)) if clean.size else 0.0


def _divide(value: float | None, spread: float) -> float:
    if value is None or not np.isfinite(value) or spread <= 0:
        return 0.0
    return abs(value) / spread
