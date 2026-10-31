# Lecture complète du corpus KAG

Ce document décrit le test d'intégration qui lit l'ensemble des scripts narratifs
Mahoyo avec les vrais assets locaux.

## Prérequis

Le test nécessite les assets originaux convertis par le pipeline. Le chemin
du dossier d'assets est fourni par la variable d'environnement
`MAHOYO_ASSETS_DIR`.

Exemple :

```bash
export MAHOYO_ASSETS_DIR=/chemin/vers/assets
npm run test:full-read
```

## Comportement en l'absence d'assets

Si `MAHOYO_ASSETS_DIR` n'est pas définie et que `public/assets` ne contient
pas `asset-manifest.json`, le test est ignoré proprement (skip) et reste vert.

## Sortie du test

Le test écrit deux fichiers dans `reports/` (ignoré par git) :

- `reports/full-read.json` — rapport machine au format JSON.
- `reports/full-read.md` — rapport humain au format Markdown.

La console affiche uniquement un résumé chiffré (pas de texte original).

## Interprétation du rapport

- **Scripts trouvés** : nombre total de fichiers `.ks` dans `scenario/`.
- **Scripts système ignorés** : menus, config, plugins, etc. (ne font pas partie
  du corpus narratif).
- **Scripts chiffrés ignorés** : fichiers `.ks` qui sont en réalité des données
  binaires, illisibles comme du texte. Leur nature exacte n'est pas déterminée
  (aucun script ne les cite par leur nom).
- **Scripts narratifs audités** : scripts effectivement lus du début à la fin.
- **Scripts en erreur fatale** : scripts qui ont provoqué une exception runtime.
- **Scripts ayant atteint maxSteps** : scripts qui n'ont pas atteint la fin avant
  le plafond de steps (boucle probable).
- **Commandes inconnues** : commandes KAG actuellement traitées comme no-op,
  avec leur effectif.
- **Assets de base manquants** : références d'images/sons dont l'asset de base est
  absent du manifest. La résolution est la même que celle du player (`storageKey`
  puis recherche dans le manifest) : casse, dossier, extension et suffixe de
  variante `|x` sont ignorés. Toutes les variantes d'un même asset absent sont
  regroupées en une entrée.
- **Références à variante résolues** : références `nom|x` dont l'asset de base
  existe (elles ne sont pas des manques).
- **Références d'asset de nom vide** : calques positionnés et animés sans image
  (storage vide). Ce ne sont pas des fichiers à charger ; elles sont comptées à part.

## Critère de réussite

Le test exige au moins 221 scripts narratifs lus, 0 erreur fatale et 0 boucle
sans progression.

Les 221 viennent de : 251 fichiers `.ks` trouvés, moins 17 scripts système
(menus, configuration, plugins), moins 13 fichiers binaires. Le chiffre de 234
utilisé auparavant (251 - 17) comptait ces 13 binaires comme des scripts.

## Assets de base manquants sur le corpus de référence

Après résolution des variantes et du repli de nom (#153) : 15 assets distincts
(14 images, 1 son), 39 occurrences, contre 348 images signalées avant la correction
(863 références à variante sont désormais résolues). État des causes :

- **Espace final dans le nom du fichier** (1 image, `wik_f-a.ks`, `wik_x-2.ks`) :
  **résolu**. Le fichier source porte un espace avant son extension et le manifest
  installé a gardé cette clé avec l'espace, alors que les scripts la référencent sans
  espace. `storageKey` le retire à la génération, et le resolver retombe désormais sur
  une clé repliée (NFKC, espaces de bordure, casse) quand la clé exacte manque : le
  manifest déjà installé fonctionne sans régénération.
- **Image présente dans l'archive mais non convertie** (14 images, sprites de
  `5a-*`, `5b-*`, `8.5`, `9-*`, `d-*`) : **cause établie**. Ces fichiers sont des
  conteneurs `TLG0.0` (`sds`) qui enveloppent une image `TLG5.0`. Le décodeur utilisé par
  l'ancien POC (`tlg.py`) ne lit que du `TLG6` dans un conteneur `TLG0.0` et n'implémente
  pas `TLG5` (« Unsupported tlg version ») : le `.tlg` est resté tel quel
  dans le dossier de sortie et n'a pas de `.png`, donc pas d'entrée de manifest. Ce n'est
  ni un défaut de nom ni une absence de l'archive. Le correctif est un décodeur `TLG5`
  dans le convertisseur externe (hors périmètre ici, voir `docs/BUGS_PROLOGUE.md`).
- **Son `bgm101`** (1 son, `staffroll.ks`) : aucune clé audio proche.

Les 188 références d'asset de nom vide sont presque toutes dans un seul script
(`a-4.ks`, 160) : des calques sans image, positionnés et animés.
