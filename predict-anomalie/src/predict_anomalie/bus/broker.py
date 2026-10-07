"""Connexion au broker : abonnements, publication, file d'attente.

Les evenements partent en QoS 1 : un evenement perdu est perdu. Les scores partent
en QoS 0, parce qu'une valeur remplacee dans dix secondes ne merite pas qu'on
attende son accuse.

La session est persistante et le testament est declare, comme sur le nœud esp01 :
le broker garde les commandes adressees a la brique pendant qu'elle est absente, et
annonce sa disparition a sa place si elle s'arrete sans prevenir.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
from collections import deque
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import aiomqtt

from predict_anomalie.config import Settings
from predict_anomalie.events import EventRecord

log = logging.getLogger(__name__)

QUEUE_SIZE = 64
RECONNECT_MIN_S = 1.0
RECONNECT_MAX_S = 30.0
KEEPALIVE_S = 15


def jitter(delay: float) -> float:
    """Trois quarts du delai, plus un quart au hasard : deux briques qui redemarrent
    ensemble ne reviennent pas frapper a la porte a la meme seconde."""
    return delay * 0.75 + random.random() * delay * 0.5


class Broker:
    def __init__(
        self,
        settings: Settings,
        on_telemetry: Callable[[str, dict], Awaitable[None]],
        on_node_event: Callable[[str, dict], Awaitable[None]],
        on_command: Callable[[dict], Awaitable[None]],
    ) -> None:
        self._settings = settings
        self._on_telemetry = on_telemetry
        self._on_node_event = on_node_event
        self._on_command = on_command

        device = settings.device_id
        self.topic_events = f"sentinel/{device}/events"
        self.topic_score = f"sentinel/{device}/score"
        self.topic_status = f"sentinel/{device}/status"
        self.topic_config = f"sentinel/{device}/config"
        self.topic_command = f"sentinel/{device}/command"

        self._client: aiomqtt.Client | None = None
        self._pending: deque[EventRecord] = deque(maxlen=QUEUE_SIZE)
        self._config_payload: dict | None = None
        self.connected = False
        self.last_connected_at: datetime | None = None
        self.dropped = 0

    # -- boucle de connexion -----------------------------------------------

    async def run(self) -> None:
        delay = RECONNECT_MIN_S
        while True:
            try:
                await self._session()
            except aiomqtt.MqttError as error:
                self.connected = False
                self._client = None
                log.warning("bus perdu (%s), nouvelle tentative dans %.0f s", error, delay)
                await asyncio.sleep(jitter(delay))
                delay = min(delay * 2, RECONNECT_MAX_S)
            except asyncio.CancelledError:
                self.connected = False
                raise
            else:
                delay = RECONNECT_MIN_S

    async def _session(self) -> None:
        settings = self._settings
        will = aiomqtt.Will(self.topic_status, b"offline", qos=1, retain=True)

        async with aiomqtt.Client(
            hostname=settings.mqtt_host,
            port=settings.mqtt_port,
            username=settings.mqtt_user or None,
            password=settings.mqtt_password or None,
            identifier=settings.device_id,
            clean_session=False,
            keepalive=KEEPALIVE_S,
            will=will,
        ) as client:
            self._client = client
            self.connected = True
            self.last_connected_at = datetime.now(UTC)
            log.info("bus connecte sur %s:%s", settings.mqtt_host, settings.mqtt_port)

            await client.publish(self.topic_status, b"online", qos=1, retain=True)
            await client.subscribe("sentinel/+/telemetry", qos=0)
            await client.subscribe("sentinel/+/events", qos=1)
            await client.subscribe(self.topic_command, qos=1)
            await self._flush()
            if self._config_payload is not None:
                await self.publish_config(self._config_payload)

            async for message in client.messages:
                await self._dispatch(message)

    # -- reception ---------------------------------------------------------

    async def _dispatch(self, message: aiomqtt.Message) -> None:
        topic = str(message.topic)
        parts = topic.split("/")
        if len(parts) != 3 or parts[0] != "sentinel":
            return
        source, kind = parts[1], parts[2]

        # On est abonne a sentinel/+/events, donc aussi a ses propres publications.
        if source == self._settings.device_id and kind != "command":
            return

        body = _decode(message.payload)
        if body is None:
            return

        if kind == "telemetry":
            await self._on_telemetry(source, body)
        elif kind == "events":
            await self._on_node_event(source, body)
        elif kind == "command":
            await self._on_command(body)

    # -- publication -------------------------------------------------------

    async def publish_event(self, record: EventRecord) -> bool:
        if not self.connected or self._client is None:
            if len(self._pending) == self._pending.maxlen:
                self.dropped += 1
            self._pending.append(record)
            return False
        try:
            await self._client.publish(
                self.topic_events, json.dumps(record.payload()).encode(), qos=1
            )
            return True
        except aiomqtt.MqttError:
            self._pending.append(record)
            return False

    async def publish_score(self, body: dict) -> None:
        if not self.connected or self._client is None:
            return
        with contextlib.suppress(aiomqtt.MqttError):
            await self._client.publish(self.topic_score, json.dumps(body).encode(), qos=0)

    async def publish_config(self, body: dict) -> None:
        """Configuration effective, retenue : au redemarrage la brique la retrouve,
        et le backend peut la lire a tout moment sans rejouer l'historique."""
        self._config_payload = body
        if not self.connected or self._client is None:
            return
        with contextlib.suppress(aiomqtt.MqttError):
            await self._client.publish(
                self.topic_config, json.dumps(body).encode(), qos=1, retain=True
            )

    async def _flush(self) -> None:
        while self._pending and self._client is not None:
            record = self._pending.popleft()
            try:
                await self._client.publish(
                    self.topic_events, json.dumps(record.payload()).encode(), qos=1
                )
            except aiomqtt.MqttError:
                self._pending.appendleft(record)
                return

    async def goodbye(self) -> None:
        """Annonce le depart avant une extinction propre.

        Le testament ne sert qu'aux disparitions brutales : un DISCONNECT en regle
        l'annule, et le topic resterait a online alors que la brique est partie.
        """
        if not self.connected or self._client is None:
            return
        with contextlib.suppress(aiomqtt.MqttError):
            await self._client.publish(self.topic_status, b"offline", qos=1, retain=True)

    @property
    def queued(self) -> int:
        return len(self._pending)


def _decode(payload: bytes | bytearray | str | None) -> dict | None:
    if payload is None:
        return None
    try:
        body = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return body if isinstance(body, dict) else None
