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

Après résolution des variantes : 16 assets distincts (15 images, 1 son), 41 occurrences,
contre 348 images signalées avant la correction (863 références à variante sont
désormais résolues). État des causes :

- **Espace final dans le nom du fichier** (1 image, `wik_f-a.ks`, `wik_x-2.ks`) : le
  fichier source porte un espace avant son extension, la clé du manifest aussi,
  alors que les scripts le référencent sans espace. `storageKey` retire désormais cet
  espace ; le manifest doit être régénéré (`npm run pipeline`) pour que la clé
  corresponde.
- **Variantes précises absentes du manifest** (14 images, surtout des sprites de
  `5a-*`, `5b-*`, `8.5`, `9-*`, `d-*`) : des variantes voisines existent (autre
  numéro ou autre cadrage) mais pas celle-ci. Il reste à vérifier si le fichier est
  absent de l'archive d'origine ou perdu à la conversion.
- **Son `bgm101`** (1 son, `staffroll.ks`) : aucune clé audio proche.

Les 188 références d'asset de nom vide sont presque toutes dans un seul script
(`a-4.ks`, 160) : des calques sans image, positionnés et animés.
