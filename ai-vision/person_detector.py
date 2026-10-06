"""Détection des personnes avec YOLOv8n, pour repérer les silhouettes même sans visage net"""
import config


def pick_device():
    """On essaie la GPU si elle est dispo, sinon on retombe sur le CPU"""
    if config.YOLO_DEVICE != "auto":
        return config.YOLO_DEVICE
    import torch
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class PersonDetector:
    PERSON_CLASS = 0  # la classe 0 dans COCO correspond aux personne

    def __init__(self):
        print("Chargement de YOLO... ça peut prendre un peu de temps au premier lancement")
        from ultralytics import YOLO
        self.model = YOLO(config.YOLO_MODEL)
        self.device = pick_device()
        print(f"YOLO chargé ({config.YOLO_MODEL}) sur {self.device}")

    def detect(self, frame):
        """Retourne une liste de (x, y, w, h, confiance) pour chaque personne"""
        result = self.model.predict(
            frame,
            classes=[self.PERSON_CLASS],
            conf=config.YOLO_CONF,
            imgsz=config.YOLO_IMGSZ,
            device=self.device,
            verbose=False,
        )[0]
        persons = []
        for box, conf in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist()):
            x1, y1, x2, y2 = map(int, box)
            persons.append((x1, y1, x2 - x1, y2 - y1, float(conf)))
        return persons
