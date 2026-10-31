# Timelines d'animation (`@playtimeline`)

Comment le player rejoue les séquences animées embarquées dans les scripts du jeu, en
particulier **l'ouverture** (`opening.ks`, troisième script de l'histoire).

## Principe

Certains scripts portent, dans leur section `*tladata`, un projet d'animation complet
(format « TLA » du jeu d'origine) : 465 Ko pour l'ouverture, avec 49 objets, des pistes
audio et des fonds animés. `@playtimeline scene=N next=ms` lance la scène `N`.

Le projet n'en reproduit **qu'une version simplifiée** :

1. **Extraction** : `npm run timelines -- <dossier d'assets>` lit les scripts et écrit
   `timelines.json` (le fond visible plan par plan, ses panoramiques et les pistes audio
   de chaque scène).
2. **Lecture** : le runtime transforme la scène en calendrier d'événements (fonds en fondu
   enchaîné ou en coupe, panoramiques `bgMove`, pistes audio) ; le player les joue à leur instant.
3. **Saut** : **un seul clic**, ou le mode skip, applique d'un coup tout ce qui reste.

Sans `timelines.json`, `@playtimeline` est sans effet (avertissement) et l'histoire enchaîne.

## Ce qui est repris, et ce qui ne l'est pas

| Repris | Non repris |
|---|---|
| Fond de la page visible, dans l'ordre où le `PageObject` le montre | Zooms, rotations |
| Fondu enchaîné de la durée du changement de page ; coupe franche sinon | Calques (cartons de générique, personnages, images posées en calque) |
| Panoramiques : `left`/`top` interpolés linéairement | Accélération des interpolations (3e indicateur) |
| Pistes BGM et SE (lecture, boucle, volume), changements de volume | Effets (brume, tremblement, balancement) |
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

### Scène jouée : 4 plutôt que 7

`opening.ks` choisit la scène 4 si `cf.speffect` est vrai, la 7 sinon. Le runtime expose
désormais `cf` aux expressions avec `speffect` vrai (réglage par défaut du jeu, effets
activés) : la scène 4 est jouée. C'est aussi la meilleure pour ce lecteur simplifié : ses fonds
portent toutes les images du film, alors que la scène 7 en pose deux comme calques (non rendus).

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
panoramique) mais garde l'ancien ordre des plans : relancer `npm run timelines`.

## Test

`tests/integration/timelines.test.ts` vérifie que l'ouverture ne cite que des assets présents
dans le manifest ; `tests/integration/story-play.test.ts` joue l'histoire avec les timelines
(l'ouverture produit un arrêt `timeline`). Ils demandent les assets locaux
(`MAHOYO_ASSETS_DIR`) et `timelines.json`, sinon ils sont ignorés.
