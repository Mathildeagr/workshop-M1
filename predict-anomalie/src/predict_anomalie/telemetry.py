"""Lecture d'une trame telemetry du nœud esp01.

Les noms de champs du contrat ne sont pas ceux des colonnes : la trame parle de
temperature_c, la base de temperature. La traduction est ici, et nulle part
ailleurs, pour que le reste du code ignore la forme du message.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

MAPPING = {
    "temperature": "temperature_c",
    "humidity": "humidity_pct",
    "dew_point": "dew_point_c",
    "gas_ratio": "gas_ratio",
    "gas": "gas_raw",
}


def parse(body: dict) -> dict | None:
    """Trame -> mesure interne. Rend None si rien d'exploitable n'y figure.

    Un champ absent reste absent : le contrat du nœud veut qu'un capteur en panne
    n'envoie rien plutot qu'un zero, et une valeur manquante doit se distinguer
    d'une mesure valide qui vaut zero.
    """
    measurement = {}
    for column, field in MAPPING.items():
        value = body.get(field)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            measurement[column] = float(value)

    # Le MQ-2 monte fortement pendant une vingtaine de minutes apres la mise sous
    # tension, sans rapport avec l'air ambiant. Ces valeurs sont a jeter.
    if body.get("gas_warming"):
        measurement.pop("gas", None)
        measurement.pop("gas_ratio", None)

    presence = body.get("presence_count")
    measurement["presence_count"] = int(presence) if isinstance(presence, int) else 0

    if not any(column in measurement for column in ("temperature", "humidity", "gas_ratio")):
        return None

    measurement["uptime_s"] = _integer(body.get("uptime_s"))
    measurement["motion"] = bool(body.get("presence", False))
    measurement["tilt"] = _label(body.get("tilt"))
    measurement["optic"] = _label(body.get("optic"))
    measurement["climate_age_ms"] = _integer(body.get("climate_age_ms"))
    measurement["gas_age_ms"] = _integer(body.get("gas_age_ms"))
    return measurement


def _integer(value: object) -> int | None:
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else None


def _label(value: object) -> str | None:
    return value[:12] if isinstance(value, str) else None
