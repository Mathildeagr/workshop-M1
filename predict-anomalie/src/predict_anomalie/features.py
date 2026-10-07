"""Construction des variables d'entree du modele, a partir de la serie en minutes.

Le meme code sert a l'apprentissage et a la detection. C'est la seule garantie
que le modele note bien des grandeurs de la meme forme que celles qu'il a vues.
"""

from __future__ import annotations

import polars as pl

# Niveau : ou en est l'environnement.
LEVEL = ["temperature", "humidity", "dew_point", "gas_ratio"]

# Ecart au profil de la meme heure. Un local est chaud a 15 h et frais a 4 h ;
# sans ca, chaque apres-midi ressemble a une anomalie.
PROFILED = ["temperature", "humidity", "gas_ratio"]
RESIDUAL = [f"{c}_resid" for c in PROFILED]

# Vitesse, en unites par heure. C'est ce qui separe une anomalie installee en
# trois heures d'une anomalie installee en deux minutes.
SLOPE = ["temperature_slope", "humidity_slope", "gas_ratio_slope", "temperature_slope_long"]

# Agitation : une valeur stable et une valeur qui oscille ne disent pas la meme chose.
SPREAD = ["temperature_spread", "humidity_spread"]

CONTEXT = ["hour_sin", "hour_cos", "presence_count"]

FEATURES = LEVEL + RESIDUAL + SLOPE + SPREAD + CONTEXT

SHORT_WINDOW = "15m"
LONG_WINDOW = "60m"

# Une minute reconstituee avec trois mesures sur trente ne vaut pas une minute pleine.
MIN_SAMPLES = 10


def hourly_profile(frame: pl.DataFrame) -> pl.DataFrame:
    """Valeur attendue pour chaque heure de la journee. Fait partie du modele.

    Les heures que la fenetre ne couvre pas recoivent la mediane globale : une
    fenetre de six heures ne doit pas rendre les dix-huit autres aveugles.
    """
    if frame.is_empty():
        return pl.DataFrame(
            {"hour": list(range(24))} | {f"{c}_ref": [None] * 24 for c in PROFILED}
        ).with_columns([pl.col(f"{c}_ref").cast(pl.Float64) for c in PROFILED])

    observed = (
        frame.with_columns(pl.col("bucket").dt.hour().alias("hour"))
        .group_by("hour")
        .agg([pl.col(c).median().alias(f"{c}_ref") for c in PROFILED])
    )
    overall = {c: frame[c].median() for c in PROFILED}

    return (
        pl.DataFrame({"hour": list(range(24))}, schema={"hour": observed["hour"].dtype})
        .join(observed, on="hour", how="left")
        .with_columns(
            [pl.col(f"{c}_ref").fill_null(overall[c]).cast(pl.Float64) for c in PROFILED]
        )
        .sort("hour")
    )


def _slope(column: str, window: str, name: str) -> pl.Expr:
    """Pente des moindres carres sur une fenetre de temps, en unites par heure.

    Formulee par les moments plutot que par une difference de valeurs decalees :
    la serie a des trous des que le nœud se tait, et un decalage par lignes
    comparerait alors deux instants qui n'ont rien a voir.
    """
    t = pl.col("t_min")
    y = pl.col(column)
    opts = {"by": "bucket", "window_size": window, "min_samples": 5}

    mean_t = t.rolling_mean_by(**opts)
    mean_y = y.rolling_mean_by(**opts)
    mean_ty = (t * y).rolling_mean_by(**opts)
    mean_tt = (t * t).rolling_mean_by(**opts)
    variance = mean_tt - mean_t * mean_t

    return (
        pl.when(variance > 1e-9)
        .then((mean_ty - mean_t * mean_y) / variance * 60.0)
        .otherwise(None)
        .alias(name)
    )


def build(frame: pl.DataFrame, profile: pl.DataFrame) -> pl.DataFrame:
    """Serie en minutes -> table de variables. Trie par bucket, un seul boitier."""
    if frame.is_empty():
        return pl.DataFrame(schema={c: pl.Float64 for c in FEATURES} | {"bucket": frame["bucket"].dtype})

    hour = pl.col("bucket").dt.hour()
    prepared = frame.sort("bucket").with_columns(
        (pl.col("bucket").dt.epoch("s") / 60.0).alias("t_min"),
        hour.alias("hour"),
    )

    withref = prepared.join(profile, on="hour", how="left")

    return withref.with_columns(
        [(pl.col(c) - pl.col(f"{c}_ref")).alias(f"{c}_resid") for c in PROFILED]
        + [
            _slope("temperature", SHORT_WINDOW, "temperature_slope"),
            _slope("humidity", SHORT_WINDOW, "humidity_slope"),
            _slope("gas_ratio", SHORT_WINDOW, "gas_ratio_slope"),
            _slope("temperature", LONG_WINDOW, "temperature_slope_long"),
            pl.col("temperature")
            .rolling_std_by("bucket", SHORT_WINDOW, min_samples=5)
            .alias("temperature_spread"),
            pl.col("humidity")
            .rolling_std_by("bucket", SHORT_WINDOW, min_samples=5)
            .alias("humidity_spread"),
            # L'heure en sinus et cosinus : 23 h et 0 h redeviennent voisines.
            ((hour.cast(pl.Float64) / 24.0) * 2 * 3.141592653589793).sin().alias("hour_sin"),
            ((hour.cast(pl.Float64) / 24.0) * 2 * 3.141592653589793).cos().alias("hour_cos"),
            pl.col("presence_count").cast(pl.Float64).fill_null(0.0),
        ]
    )


def trainable(featured: pl.DataFrame) -> pl.DataFrame:
    """Ne garde que les lignes exploitables pour l'apprentissage."""
    if featured.is_empty():
        return featured
    frame = featured
    if "samples" in frame.columns:
        frame = frame.filter(pl.col("samples") >= MIN_SAMPLES)
    return frame.drop_nulls(subset=FEATURES)
