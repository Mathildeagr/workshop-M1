"""Racine de composition : assemble le bus, la base, le modele et la politique.

C'est le seul endroit qui connait les implementations concretes. Le detecteur ne
sait pas d'ou viennent les mesures, la politique ne sait pas par ou partent les
evenements, et la base ne sait rien du modele.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import UTC, datetime

import psycopg

from predict_anomalie import telemetry
from predict_anomalie.bus import ApiSink, Broker, MqttSink, TeeSink
from predict_anomalie.config import RuntimeConfig, Settings
from predict_anomalie.pipeline import DeviceStream
from predict_anomalie.policy import EnvironmentPolicy
from predict_anomalie.store import Database
from predict_anomalie.trainer import Trainer

log = logging.getLogger(__name__)

WRITE_INTERVAL_S = 5.0
WRITE_BUFFER = 5400          # trois heures de mesures : de quoi tenir une panne de base
RETRY_DATABASE_S = 15.0


class Service:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.runtime = RuntimeConfig(settings)
        self.database = Database(settings.database_url)
        self.trainer = Trainer(self.database, self.runtime, settings)
        self.broker = Broker(settings, self.on_telemetry, self.on_node_event, self.on_command)

        self._api_sink = (
            ApiSink(settings.api_url, settings.api_token)
            if settings.api_url and settings.api_token
            else None
        )
        self.sink = TeeSink(MqttSink(self.broker), self._api_sink)

        self.streams: dict[str, DeviceStream] = {}
        self.policies: dict[str, EnvironmentPolicy] = {}
        self.faults: dict[str, str] = {}

        self._writes: list[dict] = []
        self._dropped_writes = 0
        self._retrain = asyncio.Event()
        self._schema_ready = False
        self.started_at = datetime.now(UTC)

    # -- cycle de vie -------------------------------------------------------

    async def run(self) -> None:
        await asyncio.to_thread(self._prepare_database)
        if not await asyncio.to_thread(self.trainer.restore):
            self._retrain.set()
        await self._prime()
        await self.broker.publish_config(self.config())

        tasks = [
            asyncio.create_task(self.broker.run(), name="bus"),
            asyncio.create_task(self._scoring(), name="notation"),
            asyncio.create_task(self._writing(), name="ecriture"),
            asyncio.create_task(self._maintenance(), name="entretien"),
            asyncio.create_task(self._training(), name="apprentissage"),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            await self.broker.goodbye()
            for task in tasks:
                task.cancel()
            await self.close()

    async def close(self) -> None:
        if self._api_sink is not None:
            await self._api_sink.close()
        await asyncio.to_thread(self.database.close)

    def _prepare_database(self) -> None:
        try:
            self.database.migrate()
            self._schema_ready = True
            log.info("schema en place")
        except psycopg.Error as error:
            log.warning("base indisponible au demarrage (%s), nouvelle tentative plus tard", error)

    async def _prime(self) -> None:
        """Amorce les tampons depuis la base : sans ca la brique est aveugle une
        heure apres chaque redemarrage, le temps que les fenetres se remplissent."""
        if not self._schema_ready:
            return
        try:
            recent = await asyncio.to_thread(self.database.load_window, 0.2)
        except psycopg.Error as error:
            log.warning("amorcage impossible : %s", error)
            return
        for source in recent["device_id"].unique().to_list():
            stream = self._stream(source)
            count = stream.prime(recent.filter(recent["device_id"] == source))
            log.info("%s : %d minutes rechargees", source, count)

    # -- reception ----------------------------------------------------------

    async def on_telemetry(self, source: str, body: dict) -> None:
        measurement = telemetry.parse(body)
        if measurement is None:
            return
        now = datetime.now(UTC)
        self._stream(source).ingest(measurement, now)
        self._queue_write(source, measurement, now)

    async def on_node_event(self, source: str, body: dict) -> None:
        """Les pannes de capteur annoncees par le nœud expliquent les trous."""
        event, detail = body.get("event"), body.get("detail")
        if event == "sensor_fault" and isinstance(detail, str):
            self.faults[f"{source}/{detail}"] = body.get("ts") or datetime.now(UTC).isoformat()
            log.info("%s signale une panne de %s", source, detail)
        elif event == "sensor_recovered" and isinstance(detail, str):
            self.faults.pop(f"{source}/{detail}", None)

    async def on_command(self, body: dict) -> None:
        """Le nœud ignore ce qu'il ne comprend pas, on fait pareil : le topic peut
        porter des instructions destinees a d'autres briques."""
        event = body.get("event")

        if event == "modify_sensitivity":
            if not self.runtime.set_sensitivity(str(body.get("mode", ""))):
                log.info("sensibilite refusee : %r", body.get("mode"))
                return
            for policy in self.policies.values():
                policy.resync()
            log.info("sensibilite reglee sur %s", self.runtime.sensitivity)

        elif event == "modify_window":
            days = body.get("window_days", body.get("days"))
            if not self.runtime.set_window(days):
                log.info("fenetre refusee : %r", days)
                return
            log.info("fenetre de reference reglee sur %g jours", self.runtime.window_days)
            self._retrain.set()

        elif event == "retrain":
            self._retrain.set()

        else:
            return

        await self.broker.publish_config(self.config())

    # -- boucles ------------------------------------------------------------

    async def _scoring(self) -> None:
        while True:
            await asyncio.sleep(self.settings.score_interval_s)
            now = datetime.now(UTC)
            for source, stream in list(self.streams.items()):
                try:
                    verdict = stream.judge(self.trainer.model, now)
                except Exception:                      # noqa: BLE001
                    log.exception("notation impossible pour %s", source)
                    continue
                if verdict is None:
                    continue

                policy = self._policy(source)
                record = policy.update(verdict, now, self.runtime.effective_days)
                await self.broker.publish_score(
                    {
                        "source": source,
                        "ts": now.isoformat(),
                        "stage": policy.stage.name.lower(),
                        "score": round(verdict.score, 4),
                        "magnitude": round(verdict.magnitude, 3),
                        "velocity": round(verdict.velocity, 3),
                        "sensitivity": self.runtime.sensitivity,
                        "window_days": self.runtime.window_days,
                    }
                )
                if record is None:
                    continue
                if await self.sink.emit(record):
                    log.info("%s %s (%s)", record.event, record.detail, source)
                else:
                    log.warning("%s mis en file : aucune sortie disponible", record.event)

    async def _writing(self) -> None:
        while True:
            await asyncio.sleep(WRITE_INTERVAL_S)
            if not self._writes:
                continue
            batch, self._writes = self._writes, []
            try:
                if not self._schema_ready:
                    await asyncio.to_thread(self._prepare_database)
                await asyncio.to_thread(self.database.insert_raw, batch)
            except psycopg.Error as error:
                log.warning("ecriture refusee (%s), %d mesures remises en file", error, len(batch))
                self._writes = batch + self._writes
                self._trim_writes()
                await asyncio.sleep(RETRY_DATABASE_S)

    async def _maintenance(self) -> None:
        while True:
            await asyncio.sleep(self.settings.rollup_interval_s)
            if not self._schema_ready:
                continue
            try:
                folded = await asyncio.to_thread(self.database.rollup)
                purged = await asyncio.to_thread(
                    self.database.purge, self.settings.raw_retention_days
                )
            except psycopg.Error as error:
                log.warning("entretien reporte : %s", error)
                continue
            if folded or purged:
                log.info("%d minutes repliees, %d mesures brutes purgees", folded, purged)

            # Au premier demarrage la table brute est vide, donc le modele part sans
            # calibration de saut et ne sait pas reconnaitre une marche brutale.
            # Des que du brut existe, on reapprend sans attendre l'heure suivante.
            meta = self.trainer.model.meta
            if meta is not None and not meta.has_jump_calibration and folded:
                log.info("brut disponible, reapprentissage pour calibrer les sauts")
                self._retrain.set()

    async def _training(self) -> None:
        while True:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    self._retrain.wait(), timeout=self.settings.retrain_interval_s
                )
            self._retrain.clear()
            if not self._schema_ready:
                continue
            try:
                trained = await asyncio.to_thread(self.trainer.train)
            except psycopg.Error as error:
                log.warning("apprentissage reporte : %s", error)
                continue
            if trained:
                await self.broker.publish_config(self.config())

    # -- interne ------------------------------------------------------------

    def _stream(self, source: str) -> DeviceStream:
        if source not in self.streams:
            self.streams[source] = DeviceStream(source)
            log.info("nouvelle source de mesures : %s", source)
        return self.streams[source]

    def _policy(self, source: str) -> EnvironmentPolicy:
        if source not in self.policies:
            self.policies[source] = EnvironmentPolicy(source, self.runtime)
        return self.policies[source]

    def _queue_write(self, source: str, measurement: dict, now: datetime) -> None:
        self._writes.append({"device_id": source, "measured_at": now} | measurement)
        self._trim_writes()

    def _trim_writes(self) -> None:
        excess = len(self._writes) - WRITE_BUFFER
        if excess > 0:
            del self._writes[:excess]
            self._dropped_writes += excess

    # -- lecture pour l'API -------------------------------------------------

    def config(self) -> dict:
        return self.runtime.payload() | {"device_id": self.settings.device_id}

    def health(self) -> dict:
        return {
            "status": "ok" if self.broker.connected and self._schema_ready else "degraded",
            "bus": self.broker.connected,
            "database": self._schema_ready and self.database.connected,
            "model": self.trainer.model.ready,
            "uptime_s": round((datetime.now(UTC) - self.started_at).total_seconds()),
        }

    def state(self) -> dict:
        now = datetime.now(UTC)
        expected_silence = self.settings.sample_period_s * self.settings.silence_factor
        sources = []
        for source, stream in self.streams.items():
            silence = stream.silent_for(now)
            sources.append(
                stream.state(now)
                | self._policy(source).state()
                | {
                    # Le backend et le dashboard affichent cette duree des qu'elle
                    # depasse la moitie de l'intervalle prevu en plus.
                    "silent": silence is not None and silence > expected_silence,
                    "expected_period_s": self.settings.sample_period_s,
                }
            )
        return {
            "config": self.config(),
            "sources": sources,
            "queued_events": self.broker.queued,
            "dropped_events": self.broker.dropped,
            "pending_writes": len(self._writes),
            "dropped_writes": self._dropped_writes,
            "sensor_faults": sorted(self.faults),
        }
