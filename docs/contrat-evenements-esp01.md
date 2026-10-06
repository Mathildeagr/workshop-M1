# Contrat d'événements — nœud `esp01` → backend

Document de référence pour l'équipe backend. Le firmware est écrit contre ce
contrat ; toute modification doit être décidée des deux côtés.

---

## 1. Transport

```
POST http://<backend>:3000/api/firmware/events
Content-Type: application/json
X-API-Key: <clé de l'appareil>
```

**L'identité de l'appareil n'est pas dans le corps.** Elle est déduite de la
clé, côté serveur, via la table `DEVICE_API_KEYS` (`esp01:<clé>`). Un nœud ne
peut donc pas se faire passer pour un autre en modifiant sa charge utile.

### Réponses attendues

| Code | Signification | Comportement du firmware |
|---|---|---|
| `201` | événement enregistré | retiré de la file |
| `200` | accepté | retiré de la file |
| `4xx` | trame refusée | **abandonné**, rejouer ne changerait rien |
| `5xx`, timeout, hors ligne | serveur indisponible | **conservé**, rejoué plus tard |

---

## 2. Charge utile

```json
{
  "event":    "tamper_opened",
  "level":    "warning",
  "value":    3,
  "detail":   "objectif",
  "uptime_s": 412
}
```

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `event` | chaîne, `[a-z_]`, ≤ 23 car. | oui | identifiant de l'événement, liste en §3 |
| `level` | `info` \| `warning` \| `critical` | oui | gravité |
| `value` | nombre | non | grandeur associée, voir §3 |
| `detail` | chaîne, ≤ 23 car. | non | capteur ou cause à l'origine |
| `uptime_s` | entier | oui | secondes écoulées depuis le démarrage du nœud |

### Pourquoi `uptime_s`

Le nœud n'a **pas d'horloge** : sans Wi-Fi il n'y a pas de NTP, et il n'embarque
pas de pile de sauvegarde. Il ne peut donc pas dater ses événements.

Le backend doit horodater à la réception. `uptime_s` lui sert à deux choses :
détecter un redémarrage du nœud (la valeur repart à zéro), et replacer dans le
bon ordre les événements qui arrivent **en différé** après une coupure réseau
(voir §4). Un événement avec `uptime_s = 412` reçu alors que le dernier connu
était à `600` est un événement ancien, pas un nouveau.

---

## 3. Liste des événements émis

### Intrusion — détecteur de présence

| `event` | `level` | `value` | `detail` | Quand |
|---|---|---|---|---|
| `intrusion_suspected` | `info` | détections sur 5 min | `pir` | mouvement détecté |
| `intrusion_cleared` | `info` | — | `pir` | plus de mouvement |

Le PIR ne sort **jamais** de l'état « à vérifier » : seul, il ne prouve rien, et
les faux positifs sont fréquents. C'est la vision par caméra qui confirmera.

### Sabotage — inclinaison et masquage de l'objectif

| `event` | `level` | `value` | `detail` | Quand |
|---|---|---|---|---|
| `tamper_suspected` | `info` | épisodes sur 5 min | `inclinaison` | secousse brève |
| `tamper_removed` | `critical` | épisodes sur 5 min | `inclinaison` | position changée et maintenue |
| `tamper_opened` | `warning` | épisodes sur 5 min | `objectif` | objectif masqué |
| `tamper_cleared` | `info` | épisodes sur 5 min | `inclinaison` \| `objectif` | retour au repos |

### État du nœud

| `event` | `level` | `detail` | Quand |
|---|---|---|---|
| `node_boot` | `info` | — | premier raccordement réseau après démarrage |
| `sensor_fault` | `warning` | `dht22` \| `mq2` | 3 lectures en échec d'affilée |
| `sensor_recovered` | `info` | `dht22` \| `mq2` | le capteur répond à nouveau |

`node_boot` ne peut pas être émis avant que le réseau soit disponible : il
arrive donc quelques secondes après la mise sous tension réelle.

---

## 4. Ce que le firmware n'émet pas

Important pour éviter les doublons et les malentendus de périmètre.

| Événement | Émetteur |
|---|---|
| `intrusion_unknown`, `intrusion_prohibited` | script de vision, sur le PC serveur |
| `env_drift`, `env_anomaly`, `env_critical` | modèle de maintenance prédictive, sur le PC serveur |

Le nœud **ne décide jamais** d'une anomalie environnementale. Il remonte des
mesures brutes ; c'est le modèle qui tranche. Le sujet interdit explicitement
les seuils statiques embarqués, et cette séparation en est la conséquence.

### Les mesures n'ont pas encore de destination

Le firmware produit en continu température, humidité, valeur du MQ-2, fréquence
de détections. Ces séries sont ce dont le modèle prédictif a besoin pour
apprendre, et **aucun endpoint ne les reçoit aujourd'hui**. À trancher avec
l'équipe backend : un `POST /api/firmware/telemetry` cadencé à 2 s, ou une
publication MQTT. Tant que ce point n'est pas réglé, l'équipe IA n'a pas de jeu
de données.

---

## 5. Comportement du firmware

**Aucun événement n'est perdu sur coupure réseau.** Les événements émis hors
ligne sont gardés dans une file de 8 entrées et rejoués dès le retour du lien,
un par 500 ms. File pleine, le plus ancien est sacrifié : les événements récents
décrivent mieux la situation courante.

**Les événements sont rares.** Ils ne sont émis que sur **changement d'état**,
jamais en continu. Un mouvement qui dure dix minutes produit deux événements,
pas six cents.

**Le nœud ne déclenche plus ses alarmes lui-même.** Capteurs et actionneurs sont
découplés : le firmware rapporte, le backend décide. C'est lui qui commandera le
buzzer et la LED, puisque lui seul voit les trois nœuds à la fois — un mouvement
détecté par le PIR et confirmé par la caméra n'a pas la même gravité qu'un
mouvement seul.

Le canal de commande descendant reste à définir.

---

## 6. Points à trancher avec l'équipe backend

1. **L'adresse.** Le sujet impose `POST /api/v1/alerts`, et cette route existe
   déjà côté backend, avec un schéma strict `{ type, level, value }`. Le présent
   contrat utilise `/api/firmware/events` avec une trame plus riche. Choisir :
   soit le backend expose les deux, soit on s'aligne sur la route du sujet et on
   perd `detail` et `uptime_s`.
2. **Le canal descendant** pour commander buzzer et LED : REST en scrutation,
   WebSocket, ou MQTT.
3. **La destination des mesures**, voir §4.
4. **Le passage en HTTPS/MQTTS**, exigé par le sujet pour jeudi. Côté nœud, cela
   représente 16 à 25 Ko de RAM supplémentaires ; la marge actuelle le permet.
