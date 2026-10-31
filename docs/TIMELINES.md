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
| Fond de la page visible, dans l'ordre où le `PageObject` le montre | Zooms, rotations (inutilisés par l'ouverture, voir l'inventaire) |
| Fondu enchaîné de la durée du changement de page ; coupe franche sinon | Accélération des interpolations (3e indicateur) |
| Panoramiques : `left`/`top` interpolés linéairement | Effets brume, tremblement, balancement (paramètres présents mais jamais activés dans l'ouverture) |
| Calques (#125) : image, position, opacité (fondus), ordre d'empilement, appartenance à une page | Point d'ancrage `afx`/`afy`, `effect` d'un calque |
| Pluie animée d'un calque (`processing = "rain1"`), approchée par un motif CSS | Fidélité de la pluie (aucune vidéo de référence) |
| Pistes BGM et SE (lecture, boucle, volume), changements de volume | Menus système (logo, titre…) : jamais joués |
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

Règles d'extraction (`buildLayers`) :

- chaque propriété est une courbe linéaire par morceaux ; entre deux instants clés (union des
  points de toutes les courbes et de la courbe de page), le calque va en ligne droite de l'état
  du début à celui de la fin : une pose (`time` = 0) puis un mouvement (`time` > 0) ;
- l'opacité est multipliée par le **poids de la page** (1 affichée, 0 cachée, intermédiaire
  pendant le fondu du `PageObject`) : un calque s'efface avec sa page, comme dans le jeu ; un
  produit de deux rampes est approché par une rampe ;
- deux mouvements consécutifs à la même vitesse sont fusionnés ; un segment invisible ne produit rien.

Au rendu, les calques sont des `<div>` (image + pluie éventuelle) placés entre le fond et les
sprites, animés par transitions CSS linéaires. Ils sont **transitoires** : hors de `SceneState`
(une sauvegarde ne les contient pas) et retirés à la fin de la séquence (rien n'est visible à la
fin de l'ouverture).

### Inventaire du corpus (#125)

Relevé sur les 15 scripts à timeline (93 scènes) de la version de référence :

| Objet | Ouverture, scène 4 | Ouverture, scène 7 | Ailleurs |
|---|---|---|---|
| `LayerObject` | 22 (416 valeurs d'opacité, 65 images posées, 194 positions) | 17 (127 opacités, 48 images) | 4 (logo) |
| Zoom / rotation animés | aucun (valeurs par défaut 100 / 0) | aucun | logo (zoom ×3 valeurs, rotation) et menus (`MenuItemObject`) |
| Brume, tremblement, balancement | paramètres par défaut, jamais modifiés | idem | idem |
| `effect` d'un calque | `"none"` / `"void"` seulement | idem | — |
| `processing = "rain1"` | 1 calque (≈ 19 s) | aucun | — |

Extraits pour la scène 4 : 498 changements d'état sur 19 calques (dont 427 mouvements ou
fondus, 52 images différentes) ; scène 7 : 196 sur 16 calques.

### Scène jouée : 4 plutôt que 7

`opening.ks` choisit la scène 4 si `cf.speffect` est vrai, la 7 sinon. Le runtime expose
désormais `cf` aux expressions avec `speffect` vrai (réglage par défaut du jeu, effets
activés) : la scène 4 est jouée. Les calques étant rendus, la scène 7 serait aussi jouable.

## Écarts assumés

- **`canskip` est ignoré** : l'ouverture est toujours sautable. Le jeu d'origine la rend
  non sautable à la première lecture ; trois minutes d'images non sautables seraient pire
  qu'un écart avec l'original.
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
  (1) ou coupe (0) l'interpolation linéaire vers la ligne suivante et garde sa valeur tant
  qu'une ligne ne le précise pas ; le 3e ressemble à une accélération (ignorée) ; le 4e n'est
  pas compris.
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
(champ `layers` optionnel) : relancer `npm run timelines`.

## Reste à faire (#125)

- Accélération des interpolations (3e indicateur, valeur 20 observée) et 4e indicateur.
- Zoom et rotation (logo et menus seulement : jamais joués aujourd'hui).
- Effets brume, tremblement, balancement : non activés par l'ouverture ; à rendre si un autre
  script les utilise.
- Point d'ancrage `afx`/`afy` (2 calques sur 39 en dehors de la valeur par défaut).
- `canskip` (non sautable à la première lecture) et synchronisation fine avec la musique.
- Validation visuelle face à une capture du jeu d'origine.

## Test

`tests/integration/timelines.test.ts` vérifie que l'ouverture ne cite que des assets présents
dans le manifest ; `tests/integration/story-play.test.ts` joue l'histoire avec les timelines
(l'ouverture produit un arrêt `timeline`). Ils demandent les assets locaux
(`MAHOYO_ASSETS_DIR`) et `timelines.json`, sinon ils sont ignorés.
