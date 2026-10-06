# Sentinel-X — module vision

Système de détection visuelle pour repérer les personnes, comparer les visages et déclencher une alerte si quelqu'un est inconnu ou interdit.

Le programme capte la caméra, détecte les silhouettes avec YOLOv8n, puis repère les visages avec YuNet et SFace. Les visages sont comparés à ceux enregistrés dans la base locale, et on envoie une alerte si le profil ne correspond pas ou s'il manque un visage.

## Idée générale

```
Webcam USB (640x480, MJPG)
   │
   ├── YOLOv8n → détecte les personnes
   │
   └── YuNet + SFace → détecte les visages et les compare au profil connu
                      │
                      ├── autorisé → pas d'alerte
                      ├── interdit → alerte forte
                      ├── inconnu → alerte
                      └── personne sans visage → alerte si ça dure quelques secondes
```

Les modèles sont fournis par OpenCV et le modèle YOLO est téléchargé au premier lancement. Sur Mac avec puce Apple, le réseau peut utiliser le GPU, sinon, il tourne sur le CPU.

## Installation

### Mac

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./download_models.sh
```

Il faut aussi autoriser l'accès à la caméra dans les réglages système :
*Réglages Système > Confidentialité et sécurité > Caméra* → cocher Terminal (ou VS Code) puis relancer le terminal ensuite

### Windows

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
powershell -ExecutionPolicy Bypass -File download_models.ps1
```

Si l'activation de scripts est bloquée, on peut faire :

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Autoriser la caméra : *Paramètres > Confidentialité et sécurité > Caméra* →
activer l'accès pour les applications de bureau.

## Utilisation

```bash
# test simple sans alerte
python vision.py --no-api
python vision.py --no-api --source 1

# ajouter une personne connue
python enroll.py add alice --status autorise --camera 1
python enroll.py add intrus --status interdit --camera 1

# voir les personnes enregistrées
python enroll.py list

# modifier le statut d'une personne 
python enroll.py status intrus autorise

# supprimer une personne
python enroll.py remove intrus
```

Les changements dans la base sont pris en compte sans devoir relancer tout le programme.

## Service pour le backend (server.py)

En production, c'est `server.py` qui tourne : il reprend le traitement de `vision.py` et `enroll.py`
et le backend Node le pilote en HTTP (routes `/api/v1/vision/*` et `/api/v1/faces/*`).

```bash
python server.py            # vision lancée tout de suite, en permanence
python server.py --no-autostart
```

- La vision tourne en continu et est relancée automatiquement si elle s'arrête (caméra débranchée...).
- Un enrôlement webcam (`POST /api/v1/faces/capture`) met la vision en pause le temps de la capture
  (30 s max), puis la relance. L'aperçu de la capture passe par le même flux vidéo.
- `SENTINEL_SERVICE_TOKEN` (`.env`) doit être identique à `VISION_SERVICE_TOKEN` côté backend.

## Fichiers de configuration

Le cœur des réglages est dans `config.py`.
On peut modifier des choses comme :

- la caméra utilisée
- le seuil de confiance pour la reconnaissance
- la durée avant alerte
- le mode YOLO
- l'URL de l'API pour les alertes

Les variables sensibles comme le token API ou l'URL du backend doivent passer par le `.env`, pas être écrites directement dans le code.

## Format des alertes

```json
{
  "source": "vision",
  "type": "intrusion",
  "level": "critical",
  "label": "inconnu",
  "status": "inconnu",
  "detector": "face",
  "confidence": 0.214,
  "snapshot": "20261005_141502_inconnu.jpg",
  "timestamp": "2026-10-05T12:15:02+00:00"
}
```

Les valeurs possibles sont :

- `label` : nom connu, `inconnu` ou `presence_non_identifiee`
- `status` : `autorise`, `interdit`, `inconnu` ou `non_identifie`
- `detector` : `face` ou `yolo`

## Données sensibles

`data/faces.json` contient des empreintes biométriques, donc il ne faut pas le pousser sur Git. Les photos de snapshots et les embeddings doivent rester localement dans le dossier data, sans les exposer dans le dépôt.

