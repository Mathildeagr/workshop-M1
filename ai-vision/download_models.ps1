# Télécharge les deux modèles OpenCV (Windows / PowerShell)
New-Item -ItemType Directory -Force -Path models | Out-Null
$base = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models"
Invoke-WebRequest "$base/face_detection_yunet/face_detection_yunet_2023mar.onnx" -OutFile "models/face_detection_yunet_2023mar.onnx"
Invoke-WebRequest "$base/face_recognition_sface/face_recognition_sface_2021dec.onnx" -OutFile "models/face_recognition_sface_2021dec.onnx"
Get-ChildItem models
