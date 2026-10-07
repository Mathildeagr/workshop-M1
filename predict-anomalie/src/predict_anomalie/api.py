"""Les trois routes de lecture.

La brique n'expose rien en ecriture : les consignes passent par le bus, comme
celles du nœud esp01. Ces routes servent au healthcheck de compose, au dashboard
qui veut savoir pourquoi une alerte est tombee, et a la demonstration.
"""

from __future__ import annotations

from fastapi import FastAPI

from predict_anomalie.service import Service


def create_api(service: Service) -> FastAPI:
    # Pas de documentation interactive : trois routes en lecture seule n'en ont pas
    # besoin, et c'est une surface de moins a defendre.
    app = FastAPI(title="predict-anomalie", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    def health() -> dict:
        return service.health()

    @app.get("/state")
    def state() -> dict:
        """Etat courant par source : score, ampleur, vitesse, et silence eventuel."""
        return service.state()

    @app.get("/model")
    def model() -> dict:
        """Ce sur quoi le modele a appris, et les echelles qu'il en a tirees."""
        return service.trainer.state()

    @app.get("/config")
    def config() -> dict:
        """Consignes effectives. Memes valeurs que le topic config retenu."""
        return service.config()

    return app
