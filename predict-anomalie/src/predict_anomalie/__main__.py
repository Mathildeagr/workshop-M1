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


async def serve(service: Service, server: uvicorn.Server) -> None:
    tasks = [
        asyncio.create_task(service.run(), name="service"),
        asyncio.create_task(server.serve(), name="api"),
    ]
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    for received in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(received, stop.set)

    waiter = asyncio.create_task(stop.wait(), name="arret")
    done, _ = await asyncio.wait([*tasks, waiter], return_when=asyncio.FIRST_COMPLETED)

    if waiter in done:
        log.info("arret demande")
    server.should_exit = True
    for task in tasks:
        task.cancel()
    for task in (*tasks, waiter):
        with contextlib.suppress(asyncio.CancelledError, Exception):
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
