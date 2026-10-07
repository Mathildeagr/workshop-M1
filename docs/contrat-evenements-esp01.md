# Contrat d'événements — nœud `esp01`

Document de référence pour les équipes backend et infra. Le firmware est écrit
contre ce contrat ; toute modification se décide des deux côtés.

---

## 1. Transport

Le nœud **ne parle pas au backend**. Il publie sur Mosquitto ; le backend est
abonné et relaie vers sa propre route REST.

```
esp01  ──MQTT──>  Mosquitto  ──>  backend  ──>  POST /api/v1/alerts  ──>  base
```

Le nœud ne connaît donc ni l'adresse du backend ni son contrat HTTP. Un
changement de port ou de route côté API ne demande aucun reflashage.

### Topics

| Topic | Sens | Rétention | Contenu |
|---|---|---|---|
| `sentinel/esp01/events` | publication | non | événements, §3 |
| `sentinel/esp01/telemetry` | publication | non | mesures, §4 |
| `sentinel/esp01/status` | publication | **oui** | `online` / `offline` |
| `sentinel/esp01/command` | abonnement | non | commandes descendantes, §7 |

Le client MQTT s'identifie avec le `client-id` `esp01`.

### Le topic `status` et le testament

La connexion déclare un **testament** (*last will*) : si le nœud disparaît sans
se déconnecter proprement, le broker publie `offline` à sa place, en retenu.

C'est ce qui permet au dashboard de signaler un **module arraché** — un
événement que le module lui-même ne peut évidemment pas annoncer. Sans ce
mécanisme, un boîtier volé passerait pour un boîtier silencieux.

---

## 2. Format commun

Charge utile JSON, encodage UTF-8.

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
| `event` | chaîne, `[a-z_]`, ≤ 23 car. | oui | identifiant, liste en §3 |
| `level` | `info` \| `warning` \| `critical` | oui | gravité |
| `value` | nombre | non | grandeur associée |
| `detail` | chaîne, ≤ 23 car. | non | capteur ou cause à l'origine |
| `uptime_s` | entier | oui | secondes depuis le démarrage du nœud |

L'identité de l'émetteur vient du **topic**, pas du corps : un nœud ne peut pas
se faire passer pour un autre en modifiant sa trame.

### Pourquoi `uptime_s`

Le nœud n'a **pas d'horloge** : sans Wi-Fi il n'y a pas de NTP, et il n'embarque
pas de pile de sauvegarde. Il ne peut donc pas dater ses événements.

Le backend horodate à la réception. `uptime_s` lui sert à détecter un
redémarrage du nœud — la valeur repart à zéro — et à replacer dans l'ordre les
événements arrivés **en différé** après une coupure réseau (voir §5).

### Correspondance vers `/api/v1/alerts`

| Champ MQTT | Champ API | Remarque |
|---|---|---|
| topic | `source` | déduit côté backend, ou via la clé d'appareil |
| `event` | `type` | identique |
| `level` | `level` | identique |
| `value` | `value` | identique |
| `detail`, `uptime_s` | — | le schéma actuel est `.strict()` et les rejetterait |

À trancher : soit le backend assouplit son schéma pour conserver `detail` et
`uptime_s`, soit il les absorbe à l'ingestion sans les stocker.

---

## 3. Événements émis

### Sabotage

Toute activité détectée autour du boîtier relève de cette famille.

| `event` | `level` | `value` | `detail` | Quand |
|---|---|---|---|---|
| `tamper_suspected` | `info` | détections sur 5 min | `pir` | mouvement détecté à proximité |
| `tamper_suspected` | `info` | épisodes sur 5 min | `inclinaison` | secousse brève du boîtier |
| `tamper_removed` | `critical` | épisodes sur 5 min | `inclinaison` | position changée **et maintenue** |
| `tamper_opened` | `warning` | épisodes sur 5 min | `objectif` | objectif de la caméra masqué |
| `tamper_cleared` | `info` | compteur | `pir` \| `inclinaison` \| `objectif` | retour au repos |

Le champ `detail` est **le seul moyen de savoir quel capteur a parlé** : trois
sources alimentent les mêmes noms d'événement.

### État du nœud

| `event` | `level` | `detail` | Quand |
|---|---|---|---|
| `node_boot` | `info` | — | premier raccordement au broker après démarrage |
| `sensor_fault` | `warning` | `dht22` \| `mq2` | 3 lectures en échec d'affilée |
| `sensor_recovered` | `info` | `dht22` \| `mq2` | le capteur répond à nouveau |

---

## 4. Mesures

Publiées sur `sentinel/esp01/telemetry` **toutes les 2 secondes**. C'est le flux
dont le modèle de maintenance prédictive a besoin pour apprendre.

```json
{
  "uptime_s": 412,
  "temperature_c": 22.4,
  "humidity_pct": 54.1,
  "dew_point_c": 12.6,
  "gas_raw": 184,
  "gas_warming": false,
  "gas_ratio": 1.021,
  "presence": true,
  "presence_count": 3,
  "tilt": "repos",
  "optic": "repos"
}
```

Les champs d'un capteur en panne sont **absents** plutôt que nuls ou à zéro :
une valeur manquante se distingue ainsi d'une mesure valide qui vaut zéro.

À retenir pour l'équipe IA :

- `gas_warming` à `true` signale que le MQ-2 chauffe encore. **Ces mesures sont
  à exclure de l'apprentissage** : pendant une vingtaine de minutes après la
  mise sous tension, la valeur monte fortement puis redescend, sans rapport avec
  l'air ambiant.
- `gas_ratio` est l'écart à la ligne de base relevée en air sain. C'est une
  grandeur relative, bien plus exploitable que la valeur brute, qui dépend du
  capteur et de son vieillissement.
- `dew_point_c` est calculé à partir de la température et de l'humidité. Il
  combine les deux en une grandeur physique décorrélée, utile à un détecteur
  d'anomalies.
- `presence_count` et `tilt` transforment des capteurs binaires en séries
  continues, exploitables là où un simple booléen ne l'est pas.

---

## 5. Ce que le firmware n'émet pas

| Événement | Émetteur |
|---|---|
| `intrusion_unknown`, `intrusion_unidentified`, `intrusion_prohibited`, `intrusion_cleared` | script de vision, sur le PC serveur |
| `env_drift`, `env_anomaly`, `env_critical` | modèle de maintenance prédictive, sur le PC serveur |

**Aucun événement de la famille `intrusion` ne vient du nœud.** Son détecteur de
présence ne sait pas distinguer une personne d'une source de chaleur, et une
intrusion n'est établie que par la caméra. Ce que le PIR constate est une
activité autour du boîtier, remontée en `tamper_suspected`.

De même, le nœud **ne décide jamais** d'une anomalie environnementale. Il publie
des mesures brutes ; c'est le modèle qui tranche. Le sujet interdit les seuils
statiques embarqués, et cette séparation en est la conséquence directe.

---

## 6. Comportement du firmware

**Aucun événement n'est perdu sur coupure.** Les événements émis alors que le
broker est injoignable sont gardés dans une file de 8 entrées et rejoués dès la
reconnexion, un toutes les 200 ms. File pleine, le plus ancien est sacrifié.

**Les mesures ne sont pas mises en file.** Une valeur climatique vieille de dix
minutes n'intéresse personne, et la suivante arrive dans deux secondes.

**Les événements sont rares.** Ils ne sont émis que sur **changement d'état**,
jamais en continu. Une présence qui dure dix minutes produit deux événements.

**Le nœud ne déclenche plus ses alarmes lui-même.** Il rapporte, le backend
décide — lui seul voit les trois nœuds à la fois, et un mouvement confirmé par
la caméra n'a pas la même gravité qu'un mouvement seul. Le buzzer et la LED
attendent les commandes sur `sentinel/esp01/command`.

---

## 7. Commandes reçues

Topic `sentinel/esp01/command`. Le nœud ignore silencieusement ce qu'il ne
comprend pas : le topic peut porter des instructions destinées à d'autres
briques.

### 7.1 Déclencher un signal

Même format que les événements publiés. Le nœud joue la séquence sonore et
lumineuse correspondante.

```json
{ "event": "intrusion_prohibited", "level": "critical" }
```

**Les séquences restent embarquées.** Le backend envoie un nom, jamais des
durées ni des fréquences : retoucher un rythme ne doit pas demander un
déploiement backend.

Noms acceptés : les six de la famille sabotage et environnement listés en §3 et
§5, plus les quatre de la famille intrusion.

| `event` | Signification | Gravité |
|---|---|---|
| `intrusion_unknown` | personne détectée, visage absent de la base | la plus faible |
| `intrusion_unidentified` | **visage non identifiable** : cagoule, masque, dos tourné | intermédiaire |
| `intrusion_prohibited` | visage reconnu, présent en liste noire | la plus forte |
| `intrusion_cleared` | zone redevenue vide | — |

Un visage délibérément dissimulé est plus inquiétant qu'un visage simplement
inconnu de la base, qui peut être celui d'un visiteur légitime.
`intrusion_unidentified` porte donc le signal le plus marqué des deux, et
`intrusion_unknown` le plus discret.

### 7.2 Couper ou rétablir un signal

```json
{ "event": "deactivate", "target": "sabotage", "signal": "sonore" }
{ "event": "activate",   "target": "tout",     "signal": "tous" }
```

| Champ | Valeurs | Défaut |
|---|---|---|
| `target` | `intrusion`, `sabotage`, `environnement`, `tout` | `tout` |
| `signal` | `sonore`, `lumineux`, `tous` | `tous` |

Couper le son n'arrête pas la remontée des événements : le nœud continue de
rapporter, il se tait seulement. C'est ce qu'il faut pendant une démonstration
ou une intervention de maintenance.

Une coupure du signal sonore interrompt immédiatement l'alarme en cours ; une
coupure du signal lumineux ramène la LED à son état de repos.

Les réglages ne survivent pas à un redémarrage : au boot, tout est actif.

### 7.3 Régler la sensibilité

```json
{ "event": "modify_sensitivity", "target": "environnement", "mode": "high" }
```

| Champ | Valeurs |
|---|---|
| `mode` | `low`, `medium`, `high` |

**Le nœud ne lit pas cette commande.** Elle est destinée à la brique d'analyse
environnementale, qui ajuste le seuil de détection de son modèle. Elle figure
ici parce qu'elle circule sur le même broker et doit faire partie du vocabulaire
commun ; à publier sur le topic de la brique concernée.

---

## 8. Points à trancher

1. **La conservation de `detail` et `uptime_s`** côté API, voir §2.
2. **Le passage en MQTTS**, exigé par le sujet pour jeudi : certificat du broker,
   et 16 à 25 Ko de RAM supplémentaires côté nœud. La marge actuelle le permet.
4. **L'authentification du broker** : identifiants par nœud, ou accès ouvert sur
   le réseau de table isolé.
