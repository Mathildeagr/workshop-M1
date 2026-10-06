"""protocole pour envoyer des images et des événements au back Node"""
import json
import os
import struct
import sys

if os.name == "nt":  # Windows: utile pour éviter la conversion de fin de ligne
    import msvcrt
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

_proto_fd = os.dup(1)            # copie de la vraie sortie standard
os.dup2(2, 1)                    # on envoie tout le stdout vers les logs pour ne pas casser le protocole
_out = os.fdopen(_proto_fd, "wb", buffering=0)
sys.stdout = sys.stderr          # les print() ne doivent pas polluer le flux vidéo


def _write(kind, payload):
    try:
        _out.write(kind + struct.pack(">I", len(payload)) + payload)
    except (BrokenPipeError, OSError):
        os._exit(0)  # le back s'est arrêté, on quitte proprement


def send_frame(jpeg_bytes):
    _write(b"F", jpeg_bytes)


def send_event(event_type, **data):
    _write(b"J", json.dumps({"type": event_type, **data}).encode("utf-8"))
