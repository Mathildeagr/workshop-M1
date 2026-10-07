"""Acces Postgres : ecriture du flux, repli en minutes, purge, lecture de la fenetre.

Tout est synchrone et bloquant. Les appelants le font tourner dans un thread
plutot que dans la boucle d'evenements.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path

import polars as pl
import psycopg

log = logging.getLogger(__name__)

SCHEMA_FILE = Path(__file__).with_name("schema.sql")

# L'ordre nomme exige que chaque parametre existe, meme vide.
RAW_COLUMNS = (
    "device_id", "measured_at", "temperature", "humidity", "dew_point",
    "gas", "gas_ratio", "motion", "presence_count", "tilt", "optic",
    "uptime_s", "climate_age_ms", "gas_age_ms",
)

INSERT_RAW = """
INSERT INTO sensor_readings
    (device_id, measured_at, temperature, humidity, dew_point, gas, gas_ratio,
     motion, presence_count, tilt, optic, uptime_s, climate_age_ms, gas_age_ms)
VALUES
    (%(device_id)s, %(measured_at)s, %(temperature)s, %(humidity)s, %(dew_point)s,
     %(gas)s, %(gas_ratio)s, %(motion)s, %(presence_count)s, %(tilt)s, %(optic)s,
     %(uptime_s)s, %(climate_age_ms)s, %(gas_age_ms)s)
"""

# Le repli repart du dernier bucket connu. Reagreger la minute frontiere ne coute
# rien et evite de tenir un curseur de progression quelque part.
ROLLUP = """
WITH bounds AS (
    SELECT COALESCE(
        (SELECT max(bucket) FROM sensor_minutes),
        (SELECT min(measured_at) FROM sensor_readings)
    ) AS since
)
INSERT INTO sensor_minutes
    (device_id, bucket, samples, temperature, temperature_min, temperature_max,
     humidity, dew_point, gas_ratio, gas, presence_count)
SELECT r.device_id,
       date_trunc('minute', r.measured_at),
       count(*)::smallint,
       avg(r.temperature), min(r.temperature), max(r.temperature),
       avg(r.humidity), avg(r.dew_point), avg(r.gas_ratio), avg(r.gas),
       max(r.presence_count)
FROM sensor_readings r, bounds b
WHERE r.measured_at >= b.since
  AND r.measured_at < date_trunc('minute', now())
GROUP BY r.device_id, date_trunc('minute', r.measured_at)
ON CONFLICT (device_id, bucket) DO UPDATE SET
    samples         = EXCLUDED.samples,
    temperature     = EXCLUDED.temperature,
    temperature_min = EXCLUDED.temperature_min,
    temperature_max = EXCLUDED.temperature_max,
    humidity        = EXCLUDED.humidity,
    dew_point       = EXCLUDED.dew_point,
    gas_ratio       = EXCLUDED.gas_ratio,
    gas             = EXCLUDED.gas,
    presence_count  = EXCLUDED.presence_count
"""

# On ne supprime jamais du brut qui n'a pas encore ete replie : si le repli est en
# panne, la purge s'arrete d'elle-meme au lieu de perdre les mesures. La borne est
# la fin du dernier bucket agrege, pas son debut, sinon une minute reste a chaque fois.
PURGE = """
DELETE FROM sensor_readings
WHERE measured_at < LEAST(
    now() - make_interval(days => %(days)s),
    COALESCE(
        (SELECT max(bucket) + interval '1 minute' FROM sensor_minutes),
        '-infinity'::timestamptz
    )
)
"""

WINDOW = """
SELECT device_id, bucket, samples, temperature, temperature_min, temperature_max,
       humidity, dew_point, gas_ratio, gas, presence_count
FROM sensor_minutes
WHERE bucket >= now() - make_interval(secs => %(seconds)s)
  AND (%(device_id)s::text IS NULL OR device_id = %(device_id)s::text)
ORDER BY bucket
"""

# Dispersion des ecarts entre deux mesures consecutives. Calculee cote serveur :
# le quantile tient en un nombre, la semaine de brut qui le produit en trois cent
# mille lignes qu'il serait absurde de rapatrier.
JUMP_SCALES = """
SELECT percentile_cont(%(quantile)s) WITHIN GROUP (ORDER BY d_temperature),
       percentile_cont(%(quantile)s) WITHIN GROUP (ORDER BY d_humidity),
       percentile_cont(%(quantile)s) WITHIN GROUP (ORDER BY d_gas_ratio)
FROM (
    SELECT abs(temperature - lag(temperature) OVER w) AS d_temperature,
           abs(humidity    - lag(humidity)    OVER w) AS d_humidity,
           abs(gas_ratio   - lag(gas_ratio)   OVER w) AS d_gas_ratio
    FROM sensor_readings
    WHERE measured_at >= now() - make_interval(days => %(days)s)
    WINDOW w AS (PARTITION BY device_id ORDER BY measured_at)
) deltas
"""

MINUTE_SCHEMA = {
    "device_id": pl.Utf8,
    "bucket": pl.Datetime("us", "UTC"),
    "samples": pl.Int16,
    "temperature": pl.Float64,
    "temperature_min": pl.Float64,
    "temperature_max": pl.Float64,
    "humidity": pl.Float64,
    "dew_point": pl.Float64,
    "gas_ratio": pl.Float64,
    "gas": pl.Float64,
    "presence_count": pl.Int16,
}


class Database:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._conn: psycopg.Connection | None = None

    # -- connexion ---------------------------------------------------------

    def connect(self) -> None:
        if self._conn is not None and not self._conn.closed:
            return
        self._conn = psycopg.connect(self._dsn, autocommit=True, connect_timeout=5)
        # Session en UTC : les horodatages qui remontent sont alors deterministes,
        # quelle que soit la configuration du serveur.
        with self._conn.cursor() as cur:
            cur.execute("SET TIME ZONE 'UTC'")

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()
        self._conn = None

    @property
    def connected(self) -> bool:
        return self._conn is not None and not self._conn.closed

    def _cursor(self):
        self.connect()
        assert self._conn is not None
        return self._conn.cursor()

    def _drop(self) -> None:
        """Une connexion qui a echoue n'est pas reutilisable."""
        try:
            self.close()
        except psycopg.Error:
            self._conn = None

    # -- schema ------------------------------------------------------------

    def migrate(self) -> None:
        sql = SCHEMA_FILE.read_text(encoding="utf-8")
        try:
            with self._cursor() as cur:
                cur.execute(sql)
                self._link_devices(cur)
        except psycopg.Error:
            self._drop()
            raise

    def _link_devices(self, cur) -> None:
        """Pose la cle etrangere vers devices, mais seulement si la table existe.

        Le backend cree devices au demarrage via Sequelize. On ne veut ni dupliquer
        son DDL, ni refuser de demarrer parce qu'il n'est pas encore passe.
        """
        cur.execute("SELECT to_regclass('devices') IS NOT NULL")
        if not cur.fetchone()[0]:
            log.info("table devices absente, cle etrangere non posee")
            return
        cur.execute("""
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'sensor_readings'::regclass AND contype = 'f'
        """)
        if cur.fetchone():
            return
        cur.execute("""
            ALTER TABLE sensor_readings
            ADD CONSTRAINT sensor_readings_device_fk
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        """)
        log.info("cle etrangere vers devices posee")

    # -- ecriture ----------------------------------------------------------

    def insert_raw(self, rows: list[dict]) -> int:
        """Ecrit un lot de mesures brutes.

        Un capteur en panne ou en chauffe ne fournit pas sa valeur, et le contrat
        du nœud veut une absence plutot qu'un zero. On complete donc a NULL ici,
        plutot que d'obliger chaque appelant a connaitre la liste des colonnes :
        c'est cet ordre d'insertion qui les exige, c'est a lui de s'en charger.
        """
        if not rows:
            return 0
        complete = [{name: row.get(name) for name in RAW_COLUMNS} for row in rows]
        try:
            with self._cursor() as cur:
                cur.executemany(INSERT_RAW, complete)
            return len(rows)
        except psycopg.Error:
            self._drop()
            raise

    def rollup(self) -> int:
        try:
            with self._cursor() as cur:
                cur.execute(ROLLUP)
                return max(cur.rowcount, 0)
        except psycopg.Error:
            self._drop()
            raise

    def purge(self, days: int) -> int:
        try:
            with self._cursor() as cur:
                cur.execute(PURGE, {"days": days})
                return max(cur.rowcount, 0)
        except psycopg.Error:
            self._drop()
            raise

    # -- lecture -----------------------------------------------------------

    def load_window(self, days: float, device_id: str | None = None) -> pl.DataFrame:
        params = {"seconds": days * 86400.0, "device_id": device_id}
        try:
            with self._cursor() as cur:
                cur.execute(WINDOW, params)
                rows = cur.fetchall()
        except psycopg.Error:
            self._drop()
            raise
        if not rows:
            return pl.DataFrame(schema=MINUTE_SCHEMA)
        return pl.DataFrame(rows, schema=MINUTE_SCHEMA, orient="row")

    def coverage(self, device_id: str | None = None) -> tuple[datetime | None, datetime | None, int]:
        """Bornes et volume de l'historique en minutes. Sert a repondre la fenetre effective."""
        sql = """
            SELECT min(bucket), max(bucket), count(*)
            FROM sensor_minutes
            WHERE (%(device_id)s::text IS NULL OR device_id = %(device_id)s::text)
        """
        try:
            with self._cursor() as cur:
                cur.execute(sql, {"device_id": device_id})
                first, last, count = cur.fetchone()
        except psycopg.Error:
            self._drop()
            raise
        return first, last, count or 0

    def jump_scales(self, days: int, quantile: float = 0.999) -> dict[str, float]:
        try:
            with self._cursor() as cur:
                cur.execute(JUMP_SCALES, {"days": days, "quantile": quantile})
                temperature, humidity, gas_ratio = cur.fetchone()
        except psycopg.Error:
            self._drop()
            raise
        found = {"temperature": temperature, "humidity": humidity, "gas_ratio": gas_ratio}
        return {name: float(v) for name, v in found.items() if v is not None and v > 0}

    def insert_minutes(self, rows: list[dict]) -> int:
        """Utilisee par le generateur d'historique de synthese."""
        if not rows:
            return 0
        sql = """
            INSERT INTO sensor_minutes
                (device_id, bucket, samples, temperature, temperature_min, temperature_max,
                 humidity, dew_point, gas_ratio, gas, presence_count)
            VALUES
                (%(device_id)s, %(bucket)s, %(samples)s, %(temperature)s, %(temperature_min)s,
                 %(temperature_max)s, %(humidity)s, %(dew_point)s, %(gas_ratio)s, %(gas)s,
                 %(presence_count)s)
            ON CONFLICT (device_id, bucket) DO NOTHING
        """
        try:
            with self._cursor() as cur:
                cur.executemany(sql, rows)
            return len(rows)
        except psycopg.Error:
            self._drop()
            raise


def utcnow() -> datetime:
    return datetime.now(UTC)
