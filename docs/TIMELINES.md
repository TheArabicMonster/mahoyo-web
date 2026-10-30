# Timelines d'animation (`@playtimeline`)

Comment le player rejoue les séquences animées embarquées dans les scripts du jeu, en
particulier **l'ouverture** (`opening.ks`, troisième script de l'histoire).

## Principe

Certains scripts portent, dans leur section `*tladata`, un projet d'animation complet
(format « TLA » du jeu d'origine) : 465 Ko pour l'ouverture, avec 49 objets, des pistes
audio et des fonds animés. `@playtimeline scene=N next=ms` lance la scène `N`.

Le projet n'en reproduit **qu'une version simplifiée** :

1. **Extraction** : `npm run timelines -- <dossier d'assets>` lit les scripts et écrit
   `timelines.json` (les fonds et les pistes audio de chaque scène).
2. **Lecture** : le runtime transforme la scène en calendrier d'événements (fonds en fondu
   enchaîné de 1,5 s, pistes audio) ; le player les joue à leur instant.
3. **Saut** : **un seul clic**, ou le mode skip, applique d'un coup tout ce qui reste.

Sans `timelines.json`, `@playtimeline` est sans effet (avertissement) et l'histoire enchaîne.

## Ce qui est repris, et ce qui ne l'est pas

| Repris | Non repris |
|---|---|
| Images de fond et leur date, fusionnées entre les deux pages | Panoramiques (`left`/`top` animés), zooms, rotations |
| Pistes BGM et SE (lecture, boucle, volume) | Calques (cartons de générique, personnages en surimpression) |
| Changements de volume (`continuous`) | Effets (brume, tremblement, balancement) |
| Durée de la scène, ou `next` | Interpolations entre keyframes |

La position `left`/`top` d'un fond n'est transmise que si les deux valeurs sont présentes
dans la keyframe ; sinon le fond est centré.

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
- Une ligne = `[instant, 4 indicateurs d'interpolation, valeurs…]` : la valeur de la
  propriété `i` est à l'indice `5 + i` ; `"~"` signifie « inchangé ».
- **Unité de temps : 50 ms**, déduite parce que la plus grande valeur (3945) donne
  197 250 ms, exactement le `next=197250` du script. Non vérifiée dans une documentation.

## Ouverture sur le corpus de référence

Scène 4 : 197,3 s, musique `m01s` à 1 s, 17 changements de fond, pluie `se01004` en boucle
à partir de 187,5 s (puis volume 0,5 à 190 s). La pluie continue dans `1-2.ks`, qui la relance
elle-même par `@seloop … cond=!kag.isplayingse('se01004')` si elle ne joue pas.

## Génération et légalité

`timelines.json` dérive des fichiers de l'utilisateur et cite des noms d'images et de pistes :
il est généré dans le dossier d'assets et **ne doit jamais être commité** (le `.gitignore`
l'exclut par son nom).

## Test

`tests/integration/timelines.test.ts` vérifie que l'ouverture ne cite que des assets présents
dans le manifest ; `tests/integration/story-play.test.ts` joue l'histoire avec les timelines
(l'ouverture produit un arrêt `timeline`). Ils demandent les assets locaux
(`MAHOYO_ASSETS_DIR`) et `timelines.json`, sinon ils sont ignorés.
