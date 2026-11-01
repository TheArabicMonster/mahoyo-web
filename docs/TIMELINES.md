# Timelines d'animation (`@playtimeline`)

Comment le player rejoue les séquences animées embarquées dans les scripts du jeu, en
particulier **l'ouverture** (`opening.ks`, troisième script de l'histoire).

## Principe

Certains scripts portent, dans leur section `*tladata`, un projet d'animation complet
(format « TLA » du jeu d'origine) : 465 Ko pour l'ouverture, avec 49 objets, des pistes
audio et des fonds animés. `@playtimeline scene=N next=ms` lance la scène `N`.

Le projet n'en reproduit **qu'une version simplifiée** :

1. **Extraction** : `npm run timelines -- <dossier d'assets>` lit les scripts et écrit
   `timelines.json` (le fond visible plan par plan, ses panoramiques, les calques et les
   pistes audio de chaque scène).
2. **Lecture** : le runtime transforme la scène en calendrier d'événements (fonds en fondu
   enchaîné ou en coupe, panoramiques `bgMove`, calques `timelineLayer`, pistes audio) ; le
   player précharge les images des calques et joue chaque événement à son instant.
3. **Saut** : **un seul clic**, ou le mode skip, applique d'un coup tout ce qui reste ; les
   calques sont retirés à la fin de la séquence.

Sans `timelines.json`, `@playtimeline` est sans effet (avertissement) et l'histoire enchaîne.

## Ce qui est repris, et ce qui ne l'est pas

| Repris | Non repris |
|---|---|
| Fond de la page visible, dans l'ordre où le `PageObject` le montre | Brume, tremblement, balancement : aucun script ne les active (voir l'inventaire) |
| Fondu enchaîné de la durée du changement de page ; coupe franche sinon | Fondu de page accéléré (aucun `PageObject` du corpus n'a d'accélération) |
| Panoramiques : `left`/`top` interpolés, linéairement ou avec l'accélération des données (phase 2) | Fidélité de la pluie et de la formule d'accélération (aucune vidéo de référence) |
| Calques (#125) : image, position, opacité (fondus), ordre d'empilement, appartenance à une page | `canskip` (l'ouverture reste sautable, voir « Écarts assumés ») |
| Accélération des interpolations (3e indicateur) : panoramiques, mouvements et fondus de calques | Pivot du zoom/rotation d'un fond autre que le centre de son image |
| Zoom (`zoomx`/`zoomy`, négatif = miroir) et rotation (`rotate`) des fonds et des calques, point d'ancrage `afx`/`afy` des calques | Menus système (logo, titre…) : jamais joués dans l'histoire |
| `effect` d'un calque : `none`/`void` (aucun effet) ; tout autre nom est signalé par un avertissement | |
| Pluie animée d'un calque (`processing = "rain1"`), approchée par un motif CSS | |
| Pistes BGM et SE (lecture, boucle, volume), changements de volume | |
| Durée de la scène, ou `next` | |

Une position `left`/`top` absente d'une keyframe garde sa valeur précédente (elle n'est pas
recentrée) : les images de l'ouverture dépassent l'écran (jusqu'à 1600×672 ou 1120×1344) et
un recentrage les montrerait recadrées en gros plan. Un fond dont les données ne donnent
aucune position reste centré.

### Pages et ordre des plans (#135)

Chaque scène de l'ouverture a deux `BGObject` (pages 0 et 1) et un `PageObject` dont la
propriété `page` passe de 0 à 1 (et inversement) par interpolation : c'est un fondu enchaîné
entre les deux pages. Une page cachée **prépare** son image avant d'être montrée. Le plan
affiché est donc celui de la page visible, et non le dernier fond modifié : fusionner les deux
pages par date (comportement d'avant #135) montrait des images trop tôt, hors de l'ordre du film.

Règles d'extraction :

- un changement de page ouvre un plan au début du fondu ; l'image retenue est celle de la page
  à la fin du fondu (une image posée pendant le fondu est celle qu'on voit) ;
- un changement d'image sur la page visible, hors fondu, ouvre un plan en coupe franche ;
- la position d'un plan est celle de la page à son début (interpolée si un panoramique est
  en cours), puis chaque segment de mouvement donne un `bgMove` ; quand un fondu commence en
  plein panoramique, l'ancien fond poursuit son mouvement en s'effaçant ;
- sans `PageObject`, seule la page du premier `BGObject` est montrée.

### Calques (#125)

Un `LayerObject` est l'enfant d'un `BGObject` : il appartient à sa page. Propriétés lues :

| Propriété | Sens |
|---|---|
| 1er indicateur de la ligne | 1 = calque masqué, 0 = montré (garde sa valeur d'une ligne à l'autre ; masqué au départ) |
| `storage` | image du calque |
| `center` / `vcenter` | centre de l'image (repère 1024×576 ; 512/288 par défaut) |
| `opacity` | 0..255, interpolée comme les panoramiques (2e indicateur) |
| `absolute` | ordre d'empilement |
| `processing` | `"rain1"` : pluie animée par-dessus l'image ; `"void"` l'arrête |
| `zoomx` / `zoomy` | zoom en % (100 par défaut ; négatif = miroir) |
| `rotate` | rotation en degrés (0 par défaut) |
| `afx` / `afy` | point d'ancrage du zoom et de la rotation, en px dans l'image depuis son coin haut gauche ; `-100000` = pas d'ancrage (centre) |
| `effect` | `"none"` / `"void"` : aucun effet (seules valeurs du corpus) |

Règles d'extraction (`buildLayers`) :

- chaque propriété est une courbe linéaire par morceaux ; entre deux instants clés (union des
  points de toutes les courbes et de la courbe de page), le calque va en ligne droite de l'état
  du début à celui de la fin : une pose (`time` = 0) puis un mouvement (`time` > 0) ;
- l'opacité est multipliée par le **poids de la page** (1 affichée, 0 cachée, intermédiaire
  pendant le fondu du `PageObject`) : un calque s'efface avec sa page, comme dans le jeu ; un
  produit de deux rampes est approché par une rampe ;
- deux mouvements consécutifs à la même vitesse (et sans accélération) sont fusionnés ; un segment invisible ne produit rien ;
- le zoom, la rotation et l'ancrage ne sont écrits dans une clé que s'ils diffèrent de leur valeur par
  défaut (100 %, 0°, centre) : une clé sans ces champs remet les valeurs par défaut ;
- un `effect` autre que `none`/`void` serait écrit dans la clé ; le runtime le signale par un
  avertissement (`effet de calque non pris en charge : …`) et ne rend rien.

Au rendu, les calques sont des `<div>` (image + pluie éventuelle) placés entre le fond et les
sprites, animés par transitions CSS (`left`, `top`, `opacity`, `transform`) avec la fonction
d'accélération de leur clé. Ils sont **transitoires** : hors de `SceneState`
(une sauvegarde ne les contient pas) et retirés à la fin de la séquence (rien n'est visible à la
fin de l'ouverture).

### Accélération des interpolations (#125, phase 2)

Le 3e indicateur d'une ligne est l'accélération du segment qui **part** de cette ligne (comme le
2e indicateur pour l'interpolation) ; il garde sa valeur tant qu'une ligne ne le change pas.
Il ne compte que si le segment est interpolé (2e indicateur actif). Valeurs observées : 0, 2, 3, 7, 20.

Formule retenue (`src/core/easing.ts`, partagée par l'extraction, le runtime et le renderer) :
la convention de KiriKiri pour `accel` (0 = vitesse constante, positif = accélération,
négatif = décélération) avec une loi de puissance. Pour une progression linéaire `t` dans [0, 1] et
`k = 1 + ln(1 + |accel|)` :

| `accel` | progression |
|---|---|
| 0 | `t` |
| > 0 (départ lent) | `t^k` |
| < 0 (arrivée douce) | `1 - (1 - t)^k` |

Soit `k = 2,4` pour `accel` 3, `3,1` pour 7 et `4,0` pour 20 : la courbe est continue en 0 et un
`accel` de 20 ne fige pas l'image pendant des secondes (contrairement à `t^20`). **La formule exacte du
jeu n'est pas connue** : c'est une approximation raisonnable, pas une mesure.

Choix suivant le corpus (comptage des segments dont la valeur change et qui sont interpolés) :

| Objet | Interpolés linéaires | Interpolés non linéaires | Remarque |
|---|---|---|---|
| `BGObject` | 26 | 6 (`accel` 20 ×2, 3 ×4) | dont 1 par scène de l'ouverture (`top`, 14,5 s) et 4 au logo |
| `LayerObject` | 470 | 4 (`accel` 20) | 2 par scène de l'ouverture : l'opacité et `vcenter` du dernier calque (14,5 s) |
| `MenuItemObject` | 1404 | 108 (`accel` 3 ×69, 7 ×39) | menus système, jamais joués |
| `PageObject`, `SEObject` | 24 | 0 | le fondu enchaîné des fonds est donc toujours linéaire |

Dans l'ouverture, seuls le panoramique final et la sortie du dernier calque sont accélérés (une
seule fois dans le film, sur 14,5 s à partir de 162,4 s). Une loi de puissance simple suffit ; elle
est rendue côté navigateur par une fonction CSS `linear(…)` de 24 échantillons (repli `ease-in` /
`ease-out` si le navigateur ne la comprend pas), et l'interpolation de position d'un fond
interrompu (fondu commencé en plein panoramique) utilise la même fonction, pour que l'ancien fond
poursuive son mouvement sans à-coup.

Règles d'extraction :

- une valeur accélérée porte `accel` dans le `bgMove` ou la clé de calque ; position, opacité,
  zoom et rotation d'une même clé partagent la même accélération (l'indicateur est par ligne,
  pas par propriété) ;
- si un instant clé d'une autre courbe (typiquement le fondu de page) tombe **dans** un segment
  accéléré, ou si deux courbes d'un même intervalle n'ont pas la même accélération, l'intervalle
  est approché par 8 morceaux linéaires qui suivent la courbe (aucun `accel` dans ces clés) ;
- les segments sans accélération gardent exactement la sortie d'avant la phase 2 : le champ `accel`
  est absent et les trajectoires sont identiques (vérifié sur le corpus : seules des clés optionnelles
  s'ajoutent).

### Zoom, rotation et point d'ancrage (#125, phase 2)

- **Calques** : `transform` CSS `translate(-50%, -50%) rotate(r) scale(zx, zy)` avec
  `transform-origin` à `afx afy` (px dans l'image) ou au centre. Zoom et rotation sont animés par la
  même transition que la position. Dans le corpus, aucun calque n'a un zoom ou une rotation autres que
  100 % / 0° ; un calque de chaque scène de l'ouverture a un ancrage (`afx = 121,5`, `afy = 204`) sans effet visible
  puisque leur zoom et leur rotation restent neutres.
- **Fonds** : `zoomx`/`zoomy`/`rotate` du `BGObject` suivent les panoramiques (`bgMove`), posés à
  chaque plan quand la scène a une transformation (un plan sans zoom remet 100 % et 0°). Le pivot est le
  centre de l'image placée en (`left`, `top`) ; sa taille vient de l'image chargée (le centre de l'écran
  sert de pivot le temps de la charger). Seul `logo.ks` en a (zoom 800 % -> 60 % avec accélération 3, rotation
  de 315°) ; ce script n'est jamais atteint par l'histoire (appelé par `first.ks`, hors chaîne), le
  rendu est donc vérifié par des tests et en lançant le script à la main.
- Sens de la rotation (horaire comme en CSS) et lien entre `left`/`top` et le pivot : **déduits, non
  vérifiés** faute de référence.

### Inventaire du corpus (#125)

Relevé sur les 15 scripts à timeline (93 scènes) de la version de référence :

| Objet | Ouverture, scène 4 | Ouverture, scène 7 | Ailleurs |
|---|---|---|---|
| `LayerObject` | 22 (416 valeurs d'opacité, 65 images posées, 194 positions) | 17 (127 opacités, 48 images) | 4 (logo) |
| Zoom / rotation animés | aucun (valeurs par défaut 100 / 0) | aucun | logo (zoom ×3 valeurs, rotation) et menus (`MenuItemObject`) |
| Point d'ancrage `afx`/`afy` | 1 calque (121,5 ; 204), sans zoom ni rotation | idem | menus (4 valeurs) |
| Brume, tremblement, balancement | une seule valeur par paramètre (défauts), jamais modifiée | idem | idem sur les 492 lignes de menus |
| `effect` d'un calque | `"none"` ×10 / `"void"` ×8 | idem | — |
| `processing = "rain1"` | 1 calque (≈ 19 s) | aucun | — |

Extraits pour la scène 4 : 498 changements d'état sur 19 calques (dont 427 mouvements ou
fondus, 52 images différentes) ; scène 7 : 196 sur 16 calques.

### Scène jouée : 4 plutôt que 7

`opening.ks` choisit la scène 4 si `cf.speffect` est vrai, la 7 sinon. Le runtime expose
désormais `cf` aux expressions avec `speffect` vrai (réglage par défaut du jeu, effets
activés) : la scène 4 est jouée. Les calques étant rendus, la scène 7 serait aussi jouable.

## Écarts assumés

- **`canskip` est ignoré** : l'ouverture est toujours sautable d'un clic. L'information existe dans
  le script (`@playtimeline scene=4 canskip=&(sf.openingplaycount>0) …` : non sautable tant que le
  compteur est à 0, c'est-à-dire à la première lecture) mais trois minutes d'images non sautables
  seraient pire qu'un écart avec l'original. Le jour où l'on veut la respecter, il faudra lire
  l'argument dans l'instruction `playtimeline`, l'évaluer et refuser le saut tant qu'il est faux.
- Les scènes des **menus système** (titre, sauvegarde, réglages, galeries) sont extraites
  mais jamais jouées : `ui-manager` fournit ses propres écrans.

## Format déduit

Aucune documentation n'existe ; ce qui suit vient de l'observation des données.

```
global.__tmp_tla = Scripts.eval('(const) %[ "scenes" => [ <id>, <scène>, <id>, <scène> … ] … ]');
global.__tla_name = "opening";
```

- `scenes` est une liste plate `[identifiant, scène, identifiant, scène…]`.
- Une scène est un tableau positionnel : `[0]` objets racine, `[2]` cadence, `[4]` nom
  (l'ouverture a une scène 4 « avec animation de pluie » et une scène 7 « sans »,
  choisies selon `cf.speffect`).
- Un objet porte `className` (`BGObject`, `LayerObject`, `BGMObject`, `SEObject`…), `name`,
  `children` et `timeline = [noms des propriétés, lignes de keyframes, durée]`.
- Une ligne = `[instant, 4 indicateurs, valeurs…]` : la valeur de la propriété `i` est à
  l'indice `5 + i` ; absente ou `"~"`, elle reste inchangée.
- Indicateurs, par observation : le 1er vaut 1 quand un calque est masqué ; le **2e** active
  (1) ou coupe (0) l'interpolation vers la ligne suivante et garde sa valeur tant qu'une ligne
  ne le précise pas ; le **3e** est l'accélération de cette interpolation (voir plus haut), sticky
  comme le 2e ; le 4e n'est pas compris : il vaut 1 sur la première ligne de tous les objets et
  0 ou 1 sur 12 autres lignes seulement (8 de `BGObject`, 4 de `LayerObject`), sans effet constaté
  sur les trajectoires.
- **Unité de temps : 50 ms**, déduite parce que la plus grande valeur (3945) donne
  197 250 ms, exactement le `next=197250` du script. Non vérifiée dans une documentation.

## Ouverture sur le corpus de référence

Scène 4 : 197,3 s, musique `m01s` à 1 s, 16 plans (fondus de 1,35 à 5 s) dont 12 avec
panoramique, pluie `se01004` en boucle
à partir de 187,5 s (puis volume 0,5 à 190 s). La pluie continue dans `1-2.ks`, qui la relance
elle-même par `@seloop … cond=!kag.isplayingse('se01004')` si elle ne joue pas.

## Génération et légalité

`timelines.json` dérive des fichiers de l'utilisateur et cite des noms d'images et de pistes :
il est généré dans le dossier d'assets et **ne doit jamais être commité** (le `.gitignore`
l'exclut par son nom).

## Régénérer après une mise à jour

`timelines.json` généré avant #135 reste lisible (fondu par défaut de 1,5 s, pas de
panoramique) mais garde l'ancien ordre des plans ; généré avant #125, il n'a pas de calques
(champ `layers` optionnel) ; généré avant la phase 2, il n'a ni accélération, ni zoom, ni rotation,
ni ancrage (champs optionnels, tout est linéaire et neutre) : relancer `npm run timelines`.

## Reste à faire et non faisable (#125)

Fait en phase 2 : accélération des interpolations, zoom, rotation, point d'ancrage, `effect`.

- **Brume, tremblement, balancement** (`haze*`, `quake*`, `shake*`, `swing*`) : rien à rendre. Les
  paramètres n'ont qu'une seule valeur dans tout le corpus (celle par défaut) et `effect` ne prend que
  `none`/`void` ; le jour où un script active un effet, l'avertissement du runtime le signalera.
- **`canskip` à la première lecture** : l'information existe mais l'ouverture reste sautable (voir
  « Écarts assumés »).
- **Sens du 4e indicateur** : toujours inconnu.
- **Non faisable sans référence** : synchronisation fine avec la musique (aucune mesure du jeu
  d'origine) et validation visuelle face à une capture du jeu (fidélité de la pluie, de la formule
  d'accélération, du pivot des zooms et du sens de rotation).

## Test

`tests/integration/timelines.test.ts` vérifie que l'ouverture ne cite que des assets présents
dans le manifest ; `tests/integration/story-play.test.ts` joue l'histoire avec les timelines
(l'ouverture produit un arrêt `timeline`). Ils demandent les assets locaux
(`MAHOYO_ASSETS_DIR`) et `timelines.json`, sinon ils sont ignorés.
