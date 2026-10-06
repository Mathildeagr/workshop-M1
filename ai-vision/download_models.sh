#!/bin/sh
# Télécharge les deux modèles OpenCV (détection YuNet + reconnaissance SFace)
set -e
mkdir -p models
BASE=https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models
curl -L -o models/face_detection_yunet_2023mar.onnx   $BASE/face_detection_yunet/face_detection_yunet_2023mar.onnx
curl -L -o models/face_recognition_sface_2021dec.onnx $BASE/face_recognition_sface/face_recognition_sface_2021dec.onnx
ls -lh models
