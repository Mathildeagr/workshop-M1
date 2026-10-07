"""Point d'entree : la brique et son API dans la meme boucle d'evenements."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
import sys

import uvicorn

from predict_anomalie.api import create_api
from predict_anomalie.config import Settings
from predict_anomalie.service import Service

log = logging.getLogger("predict_anomalie")


GRACE_S = 5.0


async def serve(service: Service, server: uvicorn.Server) -> None:
    worker = asyncio.create_task(service.run(), name="service")
    api = asyncio.create_task(server.serve(), name="api")

    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    for received in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(received, stop.set)

    waiter = asyncio.create_task(stop.wait(), name="arret")
    done, _ = await asyncio.wait([worker, api, waiter], return_when=asyncio.FIRST_COMPLETED)
    if waiter in done:
        log.info("arret demande")

    # On laisse uvicorn fermer ses connexions de lui-meme. L'annuler en pleine
    # phase de demarrage ou d'arret fait remonter une trace depuis starlette,
    # sans consequence mais a chaque extinction.
    server.should_exit = True
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(asyncio.shield(api), timeout=GRACE_S)

    for task in (worker, api, waiter):
        task.cancel()
    for task in (worker, api, waiter):
        with contextlib.suppress(asyncio.CancelledError):
            await task


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s : %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)

    settings = Settings()
    if not settings.database_url:
        log.error("DATABASE_URL manquante")
        return 1

    service = Service(settings)
    server = uvicorn.Server(
        uvicorn.Config(
            create_api(service),
            host=settings.http_host,
            port=settings.http_port,
            log_level="warning",
            access_log=False,
        )
    )
    log.info(
        "brique %s : bus %s:%s, API sur %s",
        settings.device_id,
        settings.mqtt_host,
        settings.mqtt_port,
        settings.http_port,
    )
    asyncio.run(serve(service, server))
    return 0


if __name__ == "__main__":
    sys.exit(main())
