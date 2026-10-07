"""Les sorties par lesquelles un evenement quitte la brique.

Le bus est le contrat. La route HTTP est une seconde sortie, parce que le backend
n'a pas encore d'abonne MQTT et que sans elle les evenements ne seraient recus par
personne. Le meme montage que dans le firmware du nœud : deux sorties derriere une
seule interface, et le code qui leve l'alerte n'a pas a savoir combien il y en a.
"""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

from predict_anomalie.events import EventRecord

log = logging.getLogger(__name__)


class EventSink(Protocol):
    async def emit(self, record: EventRecord) -> bool: ...


class MqttSink:
    """Publication sur le bus, en QoS 1, avec file d'attente si le broker manque."""

    def __init__(self, broker) -> None:
        self._broker = broker

    async def emit(self, record: EventRecord) -> bool:
        return await self._broker.publish_event(record)


class ApiSink:
    """POST vers /api/v1/alerts, authentifie par la cle d'appareil."""

    def __init__(self, url: str, token: str, timeout: float = 3.0) -> None:
        self._url = url
        self._client = httpx.AsyncClient(
            timeout=timeout,
            headers={"X-API-Key": token, "Content-Type": "application/json"},
        )

    async def emit(self, record: EventRecord) -> bool:
        try:
            response = await self._client.post(self._url, json=record.api_payload())
        except httpx.HTTPError as error:
            log.warning("API injoignable : %s", error)
            return False
        if response.status_code >= 400:
            log.warning("API a refuse %s : %s %s", record.event, response.status_code, response.text[:200])
            return False
        return True

    async def close(self) -> None:
        await self._client.aclose()


class TeeSink:
    """Diffuse sur plusieurs sorties. Une seule qui aboutit suffit."""

    def __init__(self, *sinks: EventSink) -> None:
        self._sinks = [s for s in sinks if s is not None]

    async def emit(self, record: EventRecord) -> bool:
        delivered = False
        for sink in self._sinks:
            delivered = await sink.emit(record) or delivered
        return delivered
