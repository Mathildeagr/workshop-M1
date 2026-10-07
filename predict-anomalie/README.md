# predict-anomalie

Détection d'anomalies environnementales sur le flux capteurs de Sentinel-X.

La brique écoute les mesures sur Mosquitto, les archive en base, et publie quatre
événements. Elle reçoit ses consignes sur le bus et expose trois routes de lecture.

## Ce qu'elle émet

| `event` | `level` | Quand |
|---|---|---|
| `env_drift` | `info` | écart modéré — l'environnement a bougé, sans gravité |
| `env_anomaly` | `warning` | écart marqué — 45 °C atteints en trois heures |
| `env_critical` | `critical` | écart marqué **et vif** — 45 °C atteints en deux minutes |
| `env_cleared` | `info` | retour sous la bande basse |

Deux axes décident, pas un seul. L'ampleur de l'écart sépare la dérive de
l'anomalie ; la vitesse à laquelle il s'installe fait passer l'anomalie en
critique. Un orage fait bouger l'environnement vite sans que ce soit grave : la
vitesse seule n'aggrave donc jamais.

## Comment elle décide

Une forêt d'isolement, entraînée sur la fenêtre de référence demandée, répond à
une question : ce point est-il rare. Son score est converti en p-valeur par les
quantiles des scores d'apprentissage, ce qui rend le taux d'alerte prévisible —
en `medium`, la brique parle une fois sur vingt.

Mais une p-valeur est un rang, et un rang sature : au-delà de la plage apprise,
45 °C et 23 °C rendent la même valeur. Deux grandeurs non bornées s'en chargent,
chacune ramenée à la dispersion relevée pendant l'apprentissage :

```
ampleur = écart à la médiane       / q999 des écarts observés
vitesse = pente, ou saut brut      / q999 des pentes observées
```

Un rapport de 1 veut dire « aussi extrême que le plus extrême point de la
fenêtre ». Ce sont des rapports sans dimension à une échelle apprise, pas des
seuils physiques : le sujet interdit ces derniers.

La vitesse se mesure à deux échelles de temps. La pente des moindres carrés sur
quinze minutes voit les montées lentes. L'écart entre deux mesures brutes voit ce
qu'une moyenne d'une minute n'a pas encore avalé — une pointe de deux secondes ne
déplace cette moyenne que de quelques pourcents, et ce retard se paierait en
secondes sur un incendie.

Les variables d'entrée sont construites en Polars : niveaux, écart au profil
horaire, pentes, volatilité, heure du jour en sinus et cosinus. Le même code sert
à l'apprentissage et à la détection — c'est la seule garantie que le modèle note
des grandeurs de la même forme que celles qu'il a vues.

## Topics

```
sentinel/+/telemetry          entrée    mesures de tous les nœuds
sentinel/+/events             entrée    pannes de capteur annoncées par les nœuds
sentinel/predictive/command   entrée    consignes, retenues
sentinel/predictive/events    sortie    les quatre événements, QoS 1
sentinel/predictive/score     sortie    score continu pour le dashboard, QoS 0
sentinel/predictive/config    sortie    consignes effectives, retenues
sentinel/predictive/status    sortie    online / offline, retenu + testament
```

## Consignes

```json
{ "event": "modify_sensitivity", "mode": "low" }
{ "event": "modify_window", "window_days": 14 }
{ "event": "retrain" }
```

`window_days` est un nombre de jours, **sans borne**. La brique accepte la
consigne et publie la fenêtre effective — celle que l'historique permet
réellement de couvrir. Au backend de l'afficher correctement.

| `mode` | p-valeur | ampleur | vitesse | taux d'alerte attendu |
|---|---|---|---|---|
| `low` | 0.990 | ×3.0 | ×8.0 | 1 mesure sur 100 |
| `medium` | 0.950 | ×2.0 | ×5.0 | 1 sur 20 |
| `high` | 0.900 | ×1.2 | ×3.0 | 1 sur 10 |

Les consignes sont publiées en retenu : au redémarrage la brique retrouve le
dernier réglage de l'opérateur, sans état à stocker.

## Routes de lecture

| Route | Réponse |
|---|---|
| `GET /health` | vivant, bus connecté, base joignable, modèle prêt |
| `GET /state` | par source : score, ampleur, vitesse, silence éventuel |
| `GET /model` | date d'apprentissage, volume appris, échelles, taux observé |
| `GET /config` | consignes effectives, mêmes valeurs que le topic retenu |

Rien en écriture : les consignes passent par le bus, comme celles du nœud esp01.
La brique reste sur le réseau `internal`, le dashboard passe par le backend.

## Stockage

Deux résolutions pour une seule série.

| Table | Résolution | Rétention | Volume par nœud |
|---|---|---|---|
| `sensor_readings` | 2 s, brut | 7 jours | ≈ 5 Mo/jour |
| `sensor_minutes` | 1 min, agrégé | conservée | ≈ 0,2 Mo/jour, soit 63 Mo/an |

Un repli toutes les dix minutes agrège le brut en minutes, puis une purge
supprime le brut périmé. La purge ne touche jamais à du brut qui n'a pas encore
été replié : si le repli tombe, elle s'arrête d'elle-même.

C'est ce qui rend la fenêtre décennale représentable : dix ans de minutes font
5,2 millions de lignes. Avec du brut à 2 secondes, ce serait 157 millions.

## Lancer

Dans la stack :

```bash
docker compose up -d --build predict-anomalie
```

Il faut au préalable un compte MQTT `predictive` dans `mosquitto/config/passwd`
(voir le README de la racine) et les variables `PREDICT_*` dans le `.env` racine.

Hors Docker :

```bash
cp .env.example .env     # puis renseigner DATABASE_URL et le compte MQTT
uv run python -m predict_anomalie
```

## Historique de synthèse

Le projet a quatre jours d'existence : au-delà d'une journée, il n'y a rien à
apprendre, et les fenêtres longues resteraient décoratives.

```bash
uv run seed-history --days 30
```

Cycle jour/nuit, chauffage le matin, aérations, cuisine, présence aux heures
ouvrées. **Ces données sont fabriquées et doivent être annoncées comme telles.**
Les mesures réelles s'y raccordent sans rien à faire.

## Tests

```bash
uv run pytest
```

Les tests de détection rejouent des scénarios à la cadence réelle du nœud et
vérifient que les quatre événements se séparent bien sur les deux axes. Les tests
de stockage demandent une base ; sans elle, ils sont ignorés :

```bash
docker run -d --rm --name pg -e POSTGRES_PASSWORD=verif -p 55432:5432 postgres:16-alpine
PREDICT_TEST_DSN=postgres://postgres:verif@localhost:55432/postgres uv run pytest
```
