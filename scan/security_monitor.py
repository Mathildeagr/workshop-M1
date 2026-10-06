import subprocess
import json
import urllib.request
from datetime import datetime

# L'URL de la route API créée par vos développeurs sur le backend
API_ENDPOINT = "http://localhost:3000/api/alerts"

print("Surveillance cyber Sentinel-X activée (Transfert vers Dashboard)...")

# Écoute des logs Mosquitto en continu
process = subprocess.Popen(
    ['docker', 'compose', 'logs', '-f', 'mosquitto'],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)

# Liste des mots-clés qui déclenchent une alerte d'intrusion
mots_cles_suspects = ["error", "unauthorized", "denied", "bad password", "connection refused"]

for ligne in iter(process.stdout.readline, ''):
    ligne_min = ligne.lower()
    
    # Vérification des mots-clés dans la nouvelle ligne de log
    if any(mot in ligne_min for mot in mots_cles_suspects):
        alerte_msg = ligne.strip()
        print(f"Alerte détectée et envoyée à l'API : {alerte_msg}")
        
        # Format JSON propre pour faciliter le travail d'intégration des développeurs
        payload = {
            "source": "mosquitto_security",
            "timestamp": datetime.now().isoformat(),
            "level": "critical",
            "message": alerte_msg
        }
        
        # Envoi de la requête POST vers le backend
        req = urllib.request.Request(
            API_ENDPOINT, 
            data=json.dumps(payload).encode('utf-8'), 
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'}
        )
        
        try:
            urllib.request.urlopen(req)
        except Exception as e:
            print(f"Impossible de joindre le dashboard (le backend est-il allumé ?) : {e}")