-- Deux resolutions pour une seule serie.
--
-- Garder du 2 secondes sur un an n'a aucun sens : 15 millions de lignes pour une
-- information qui tient en 525 000. Le brut sert au diagnostic immediat et part au
-- bout de quelques jours ; la minute sert au modele et reste.

CREATE TABLE IF NOT EXISTS sensor_readings (
    id              BIGSERIAL PRIMARY KEY,
    device_id       VARCHAR(50)  NOT NULL,
    measured_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    temperature     REAL,
    humidity        REAL,
    gas             INTEGER,
    motion          BOOLEAN
);

-- Colonnes absentes du modele Sequelize du backend. Elles arrivent dans la trame
-- telemetry et lui sont transparentes : il ne selectionne que ses propres champs.
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS dew_point      REAL;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS gas_ratio      REAL;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS presence_count SMALLINT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS tilt           VARCHAR(12);
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS optic          VARCHAR(12);
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS uptime_s       INTEGER;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS climate_age_ms INTEGER;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS gas_age_ms     INTEGER;

CREATE INDEX IF NOT EXISTS sensor_readings_device_time
    ON sensor_readings (device_id, measured_at);

-- Pas de cle etrangere vers devices ici : l'historique doit survivre a la
-- suppression d'un boitier, et le modele doit pouvoir s'entrainer sans que le
-- backend ait seme sa table.
CREATE TABLE IF NOT EXISTS sensor_minutes (
    device_id       VARCHAR(50)  NOT NULL,
    bucket          TIMESTAMPTZ  NOT NULL,
    samples         SMALLINT     NOT NULL,
    temperature     REAL,
    temperature_min REAL,
    temperature_max REAL,
    humidity        REAL,
    dew_point       REAL,
    gas_ratio       REAL,
    gas             REAL,
    presence_count  SMALLINT,
    PRIMARY KEY (device_id, bucket)
);

CREATE INDEX IF NOT EXISTS sensor_minutes_bucket ON sensor_minutes (bucket);
