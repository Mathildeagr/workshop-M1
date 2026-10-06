"""Détection faciale avec YuNet, puis conversion en vecteur pour la comparaison"""
import cv2
import numpy as np

import config

# On réduit les logs OpenCV pour éviter le bruit inutile
cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)


class FaceEngine:
    def __init__(self):
        for path in (config.DETECTOR_MODEL, config.RECOGNIZER_MODEL):
            if not path.exists():
                raise FileNotFoundError(
                    f"Modèle manquant : {path}\nLance d'abord ./download_models.sh"
                )
        self.detector = cv2.FaceDetectorYN.create(
            str(config.DETECTOR_MODEL), "",
            (config.FRAME_WIDTH, config.FRAME_HEIGHT),
            score_threshold=config.DETECTION_SCORE,
        )
        self.recognizer = cv2.FaceRecognizerSF.create(str(config.RECOGNIZER_MODEL), "")

    def detect(self, frame):
        """Retourne la liste des visages détectés dans l’image"""
        h, w = frame.shape[:2]
        self.detector.setInputSize((w, h))
        _, faces = self.detector.detect(frame)
        if faces is None:
            return []
        return [f for f in faces if min(f[2], f[3]) >= config.MIN_FACE_SIZE]

    def embed(self, frame, face):
        """On aligne le visage et on calcule un embedding normalisé"""
        aligned = self.recognizer.alignCrop(frame, face)
        feature = self.recognizer.feature(aligned).flatten().astype(np.float32)
        return feature / (np.linalg.norm(feature) + 1e-9)
