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
- **Assets manquants** : références d'images/sons absentes du manifest. Attention :
  les références à variante (`nom|e`, `nom|b`…) sont comptées comme absentes alors
  que l'image de base existe, ce qui gonfle ce chiffre. Sur le corpus de référence,
  330 des 348 images signalées sont dans ce cas ; une vingtaine sont réellement
  introuvables.

## Critère de réussite

Le test exige au moins 221 scripts narratifs lus, 0 erreur fatale et 0 boucle
sans progression.

Les 221 viennent de : 251 fichiers `.ks` trouvés, moins 17 scripts système
(menus, configuration, plugins), moins 13 fichiers binaires. Le chiffre de 234
utilisé auparavant (251 - 17) comptait ces 13 binaires comme des scripts.
