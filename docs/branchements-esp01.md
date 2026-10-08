# Sentinel-X — Plan de câblage du nœud `esp01`

Module : **Espressif ESP8266 ESP-12E / NodeMCU Lolin v3**
Pinout de référence : <https://mischianti.org/nodemcu-v3-high-resolution-pinout-and-specs/>
État : **tel que monté et validé**, firmware `firmware/esp01`.

> ⚠️ Ce n'est **pas** un ESP32. Carte PlatformIO : `board = esp12e`, plateforme `espressif8266`.

---

## 1. Tableau récapitulatif

| Composant (nom commun) | Référence | Rôle | Broche | GPIO | Alim. |
|---|---|---|---|---|---|
| Capteur température / humidité | DHT22 | climat | `D5` | 14 | `3V` |
| Capteur de gaz et fumées | MQ-2 | qualité de l'air | `A0` **via diviseur** | ADC0 | **`VU` (5V)** |
| Détecteur de mouvement | HC-SR501 / APKLVSR | présence | `D6` | 12 | **`VU` (5V)** |
| Accéléromètre 3 axes | ADXL345 | module déplacé, choc | `D1` + `D2` (I²C, `0x53`) | 5 + 4 | `3V` |
| Micro-switch à tige | — | couvercle ouvert | `D0` | 16 | — |
| Capteur infrarouge de proximité | FC-51 | objectif masqué | `D0` | 16 | `3V` |
| Écran OLED | SSD1306 0.96" I2C | affichage, adresse `0x3C` | `D1` + `D2` | 5 + 4 | `3V` |
| LED bicolore rouge/verte | cathode commune | statut visuel | `D7` + `D4` | 13 + 2 | — |
| Buzzer passif | module 3 broches | alertes sonores | `D8` | 15 | `3V` |
| Webcam USB | Full HD 1080p | vision IA | — | — | sur le **PC serveur** |

**`D3` est libre** depuis que l'inclinaison passe par l'ADXL345 : il partage le bus I²C de l'écran et ne coûte aucune broche numérique. C'était la broche critique au démarrage, celle qui empêchait la carte de booter quand le contact était fermé.

Il ne reste **aucune entrée analogique**.

### Rails d'alimentation

```
3V  ──┬── DHT22 VCC          VU  ──┬── HC-SR501 VCC   (5V issu de l'USB)
      ├── OLED VCC                 └── MQ-2 VCC
      ├── FC-51 VCC
      └── resistance 10k vers D0

G   ──── masse commune de TOUS les composants
```

---

## 2. Détail par composant

### DHT22 — température et humidité → `D5`

**Module 3 broches** (tirage intégré) :
```
+ ou VCC        →  3V
out, DATA ou S  →  D5
- ou GND        →  G
```

**Composant nu 4 pattes**, grille face à vous, de gauche à droite :
```
patte 1 (VCC)   →  3V
patte 2 (DATA)  →  D5      + resistance 10 kΩ entre patte 2 et 3V
patte 3         →  non connectée
patte 4 (GND)   →  G
```

Cadence maximale : **une lecture toutes les 2,5 s**. La datasheet annonce 2 s, mais à cette valeur exacte une transaction sur deux échoue.

### MQ-2 — gaz et fumées → `A0`

```
VCC  →  VU                     (5 V : le datasheet exige 5,0 V ± 0,1 V)
GND  →  G
AO   →  10 kΩ  →  A0
                  └── 10 kΩ  →  G
DO   →  non connecté
```

**`AO` et jamais `DO`.** Le sujet interdit les seuils statiques pour le modèle prédictif, or `DO` *est* un seuil réglé au potentiomètre. Corollaire : **le potentiomètre du module n'agit que sur `DO`** et ne changera rien aux relevés.

**Le diviseur n'est pas optionnel.** L'élément sensible chauffe à 5 V, donc `AO` monte jusqu'à 5 V, alors que `A0` n'accepte que 3,2 V. Branché en direct, `A0` reste collé à 1024 : la ligne de base ne se relève jamais, `gas_ratio` reste NAN, et la brique prédictive n'a plus une seule minute exploitable — sans que rien ne le dise avant la version qui signale `sensor_fault / mq2 en butee`.

Deux résistances **identiques de 10 kΩ** ramènent le maximum à 2,5 V. On perd la moitié de l'échelle sans rien perdre d'utile : `gas_ratio` est un rapport à la ligne de base, la normalisation absorbe le facteur. 10 kΩ / 20 kΩ donnerait 3,33 V, encore au-dessus de la limite.

Alimenter en `3V` évite le diviseur mais sous-chauffe l'élément : les relevés tombent à quelques unités sur 1023 et ne veulent plus rien dire.

Préchauffage : **20 min** avant valeurs stables, **24 h de rodage** à la première utilisation. Le capteur tiédit, c'est normal. Une saturation à 1024 pendant la chauffe est normale : la valeur monte fort puis redescend. Passé le préchauffage, une butée qui dure plus de cinq minutes est une panne, et le nœud émet alors `sensor_fault` avec le détail `mq2 en butee`.

### HC-SR501 / APKLVSR — présence → `D6`

```
VCC  →  VU   (4,5 V minimum, d'où VU et pas 3V)
OUT  →  D6
GND  →  G
```

⚠️ **L'ordre des broches varie** : lire la sérigraphie. Une inversion VCC/GND détruit le module. Sa sortie est en 3,3 V, sans danger pour l'ESP8266.

| Réglage | Position | Effet |
|---|---|---|
| Cavalier `H` / `L` | **`H`** | sortie haute tant qu'il y a du mouvement |
| Potentiomètre `Tx` | **minimum** | sinon la sortie reste haute plusieurs minutes |
| Potentiomètre `Sx` | **milieu** | portée 3 à 7 m |

Les variantes sans cavalier ni potentiomètres sont figées en mode répétable : rien à régler.

**60 s de stabilisation** après mise sous tension, pendant lesquelles il déclenche au hasard. Le firmware affiche ces détections en les marquant explicitement comme non fiables.

### ADXL345 — déplacement et choc → I²C

Le module a huit broches ; **trois ne se branchent pas**.

```
VCC   →  3V          (le GY-291 tolère 5 V, mais rien n'oblige à le risquer)
GND   →  G
SCL   →  D1          partagé avec l'écran
SDA   →  D2          partagé avec l'écran
CS    →  3V          ← indispensable : à l'état bas, le module parle SPI
SDO   →  G           adresse 0x53 (au niveau haut ce serait 0x1D)
INT1  →  non connecté
INT2  →  non connecté
```

**`CS` est le piège.** Laissée flottante ou à l'état bas, la puce bascule en SPI
et reste muette sur l'I²C — le firmware affichera `ADXL345 absent a l'adresse
0x53` sans autre explication. La plupart des modules GY-291 ont un tirage haut,
mais le relier explicitement à `3V` coûte un fil et supprime la question.

Deux appareils cohabitent sans conflit sur le bus : l'écran répond en `0x3C`,
l'accéléromètre en `0x53`.

#### Ce qu'il détecte, et comment

Le contact à bille ne savait dire que « fermé » ou « ouvert ». L'accéléromètre
mesure **où pointe la pesanteur** et **à quel point le boîtier est secoué** —
deux grandeurs indépendantes, qui alimentent les deux niveaux déjà définis :

| Mesure | Niveau | Événement |
|---|---|---|
| écart instantané à la pesanteur au repos > **0,35 g** | `Disturbed` | `tamper_suspected` |
| angle avec la position apprise > **12°**, tenu 300 ms | `Triggered` | `tamper_removed` |

Un choc passe et revient ; une inclinaison maintenue ne revient pas. C'est
exactement la distinction que le contact à bille ne savait pas faire, et qui
obligeait à bricoler des temporisations pour deviner laquelle des deux on avait.

L'angle se calcule sur une pesanteur **filtrée**, pour qu'un coup sur la table
ne se lise pas comme un déplacement. Le choc, lui, se lit sur la mesure brute.

La position de repos est apprise au démarrage, sur 32 mesures : **le boîtier
doit être posé à sa place quand la carte démarre.** Après un déplacement
légitime, `relearnRest()` reprend la référence.

### Micro-switch à tige + IR de proximité → `D0`

Les deux signifient la même chose — on s'en prend au boîtier — et déclenchent la même alerte `tamper_opened`. Ils sont donc câblés en **OU** sur la même broche, tous deux actifs à l'état bas.

```
                 ┌──[ 10 kΩ ]── 3V        ← indispensable
                 │
D0 ──────────────┤
                 ├── NC du micro-switch ── COM ── G
                 └── OUT du FC-51

FC-51 :  VCC → 3V     GND → G
Micro-switch : borne NO non connectée
```

**La résistance de 10 kΩ est indispensable** : GPIO16 est la seule broche de l'ESP8266 sans tirage interne vers le haut. Sans elle, `D0` flotte et déclenche en permanence.

**Micro-switch : la borne `NC`, pas `NO`.** Monté de sorte que le couvercle fermé presse le levier, `NC` est alors ouvert. Soulever le couvercle relâche le levier, ferme `NC` et tire `D0` à la masse. Si les bornes ne sont pas marquées, les trouver au multimètre : au repos la continuité est entre `COM` et `NC`.

**FC-51 : sortie à collecteur ouvert** (comparateur LM393 visible sur la platine). C'est ce qui rend le OU câblé possible : le module ne peut que tirer vers le bas, jamais forcer le haut. **Sans cette puce, ne pas câbler les deux ensemble.**

Potentiomètre de portée : **au plus court, ~5 cm**. Au-delà les faux positifs explosent.

GPIO16 n'a aucune contrainte au démarrage : un couvercle ouvert ou une main devant l'objectif à la mise sous tension n'empêchent pas la carte de démarrer. C'est la raison de ce choix de broche.

### OLED SSD1306 — affichage → `D1` / `D2`

```
SCL  →  D1   (GPIO5)
SDA  →  D2   (GPIO4)
VCC  →  3V   (jamais VU)
GND  →  G
```

Adresse I2C `0x3C` ; quelques modules sont en `0x3D`. L'ordre des broches varie selon les modules : **lire la sérigraphie**, une inversion VCC/GND détruit l'écran. Le firmware sonde l'adresse au démarrage et le signale dans le moniteur si rien ne répond.

### LED bicolore rouge/verte — statut → `D7` / `D4`

```
anode rouge  ──[ 220 Ω ]──  D7
anode verte  ──[ 220 Ω ]──  D4
cathode commune ──────────  G
```

Les résistances ne sont pas négociables : une sortie ESP8266 ne doit pas dépasser ~12 mA, et 220 Ω sous 3,3 V donnent ~6 mA. La cathode commune est généralement la patte la plus longue.

Deux comportements normaux : `D4` est GPIO2, qui pilote aussi la LED bleue de la carte — celle-ci étant active à l'état bas, elle s'allume quand le vert est éteint. Et le vert s'allume brièvement au démarrage, avant que le programme prenne la main.

### Buzzer passif — alertes → `D8`

**Module 3 broches** :
```
S ou I-O  →  D8
milieu    →  3V      ← la broche non marquée est le VCC
-         →  G
```

**Buzzer piézo nu 2 pattes** : une patte sur `D8`, l'autre sur `G`.

⚠️ **Mesurer la résistance avant de brancher un buzzer nu.** Circuit ouvert ou plusieurs MΩ = piézo, pilotable directement. Environ 16 Ω ou 42 Ω = électromagnétique : il tirerait 200 mA sous 3,3 V et il faut un transistor NPN (base via 1 kΩ) plus une diode 1N4148 en parallèle.

`D8` est choisie parce que GPIO15 a un tirage externe vers le bas : **le buzzer est muet au démarrage**. Sur presque toute autre broche, il crierait à chaque reset.

---

## 3. Broches critiques au démarrage

L'ESP8266 lit trois broches au boot pour choisir son mode.

| Broche | GPIO | État imposé | Occupée par | Pourquoi c'est sûr |
|---|---|---|---|---|
| `D3` | 0 | **HAUT** | *libre* | plus rien n'y est câblé depuis l'ADXL345 |
| `D4` | 2 | **HAUT** | LED verte | sortie, maintenue haute par le tirage de la carte |
| `D8` | 15 | **BAS** | buzzer | tirage externe bas → silencieux au boot |

Plus aucun risque résiduel : la seule broche qui en portait un, `D3`, n'est plus utilisée.

---

## 4. Règles d'alimentation

> **Ne JAMAIS connecter le bloc 7.5 V sur `VIN` en même temps que le câble USB.**

- **Développement** : alimentation exclusivement par l'USB.
- **Production** : bloc 220 V→7,5 V sur `VIN` + `G`, **USB débranché**.
- L'ESP8266 ne tolère que **3,3 V** sur ses broches de signal.

Budget courant, alimentation USB : ESP8266 ~170 mA, MQ-2 ~150 mA, OLED ~20 mA, PIR + IR + LED ~30 mA, ADXL345 ~0,1 mA → **~370 mA**. À brancher sur un port direct de la machine, pas sur un hub : un hub applique le courant que le périphérique a *déclaré*, et le CH340 en déclare 104 mA.

---

## 5. Ordre de montage et validation

| # | Composant | Validation |
|---|---|---|
| 1 | — | blink + liaison série |
| 2 | buzzer | les 12 signaux se distinguent à l'oreille |
| 3 | DHT22 | valeurs plausibles, humidité qui monte au souffle |
| 4 | MQ-2 | ratio qui grimpe nettement au gaz de briquet |
| 5 | PIR | passe à 1 au mouvement après les 60 s |
| 6 | OLED | les deux pages défilent |
| 7 | LED | les cinq séquences se distinguent |
| 8 | SW-520D | secousse ≠ inclinaison maintenue |
| 9 | micro-switch + IR | `SABOTAGE` sans oscillation, et démarrage OK main devant l'objectif |

---

## 6. Points encore ouverts

1. **1 ou 2 ESP8266 ?** Le tableau matériel du sujet annonce « IoT (1 à 2) », la section EISI DEV parle de « l'unique module ». Toutes les broches étant occupées, la réponse conditionne tout ajout de capteur.
2. **Webcam intégrée au boîtier ?** L'IR de proximité ne protège l'objectif que s'il en est distant de quelques centimètres. Sinon, le retirer.
3. **Adresse IP sur l'OLED** : exigée par le sujet (« statut IP/Wi-Fi »), à ajouter dès que le Wi-Fi sera en place.
