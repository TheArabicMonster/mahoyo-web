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
- **Assets de base absents** : références d'images/sons dont l'asset de base est
  absent du manifest. La résolution est la même que celle du player (`storageKey`
  puis recherche dans le manifest) : casse, dossier, extension et suffixe de
  variante `|x` sont ignorés. Toutes les variantes d'un même asset absent sont
  regroupées en une entrée.
- **Variantes non résolues** : références `nom|x` dont l'asset de base est aussi
  absent. Elles sont listées à part (ce ne sont pas des fichiers supplémentaires) ;
  la cause racine reste l'asset de base absent.
- **Références à variante résolues** : références `nom|x` dont l'asset de base
  existe (elles ne sont pas des manques).
- **Références d'asset de nom vide** : calques sans image (storage vide, voir
  « Références d'asset de nom vide » plus bas). Ce ne sont pas des fichiers à
  charger ; elles sont comptées à part.

## Critère de réussite

Le test exige au moins 221 scripts narratifs lus, 0 erreur fatale et 0 boucle
sans progression.

Les 221 viennent de : 251 fichiers `.ks` trouvés, moins 17 scripts système
(menus, configuration, plugins), moins 13 fichiers binaires. Le chiffre de 234
utilisé auparavant (251 - 17) comptait ces 13 binaires comme des scripts.

## Résolution des références d'assets

La résolution est celle du player (`src/core/asset-resolver.ts`) :

1. **Variante `|x`** : dans KAG, `nom|x` (`nom|e`, `nom|b`, `nom|k2`, `nom|首輪a`…)
   désigne une **variante d'expression** du **calque de base `nom`** (couleur,
   visage, tenue) gérée par le moteur. Le fichier sur disque ne porte jamais le
   suffixe : `nom|x` se résout en cherchant l'asset de base `nom`. Une variante
   dont l'asset de base existe n'est donc pas un manque.
2. **Clé de base** : le parser puis le resolver normalisent la référence
   (`storageKey`) : dossier, extension, casse, espaces de bordure et suffixe `|x`
   sont retirés ; la clé est cherchée dans le manifest, avec un repli replié
   (NFKC, casse, espaces) pour les manifests où une clé a gardé un espace ou une
   forme Unicode différente.
3. **Regroupement** : toutes les variantes d'un même asset absent sont regroupées
   sous une seule entrée « asset de base absent » ; les références `nom|x`
   concernées sont en plus listées à part comme « variantes non résolues ».
4. **Référence vide** : un `image:` (storage vide) est un calque sans image, pas
   un fichier (voir plus bas).

## Assets de base absents sur le corpus de référence

État actuel (221 scripts, assets installés) : **1 asset distinct** (1 son, `bgm101`),
**0 image** ; **939 références à variante résolues**, **0 variante non résolue**,
**37 références d'asset de nom vide**. La vérification statique du pipeline
(`report.json`, voir [`PIPELINE.md`](PIPELINE.md)) donne le même résultat : 1 seul
storage manquant (`bgm101`).

Historique : 348 images signalées avant #112 (résolution des variantes), 15 assets
distincts ensuite (14 images + 1 son), puis 1 après #155. Causes des images qui
manquaient, toutes corrigées (détail dans [`BUGS_PROLOGUE.md`](BUGS_PROLOGUE.md)) :

- **Espace avant l'extension dans le nom du fichier** (1 image, fond de la salle de
  verdure) : **résolu** (#153). La clé du manifest installé avait gardé l'espace,
  les scripts non. `storageKey` le retire désormais à la génération (`tools/inventory.ts`)
  et le resolver retombe sur une clé repliée (NFKC, espaces de bordure, casse) quand
  la clé exacte manque : le manifest déjà installé fonctionne sans régénération.
- **Image présente dans l'archive mais non convertie** (14 sprites de `5a-*`,
  `5b-*`, `8.5`, `9-*`, `d-*`) : **résolu** (#155). Ces fichiers sont des conteneurs
  `TLG0.0` (`sds`) qui enveloppent une image `TLG5.0` ; le décodeur de l'ancien POC
  (`tlg.py`) ne lisait que du `TLG6` dans un conteneur `TLG0.0`, si bien que le
  `.tlg` était resté tel quel. `tools/tlg-decode.ts` décode maintenant `TLG0.0` et
  `TLG5` ; les fichiers sont convertis en PNG et ajoutés au manifest installé.
- **Images ajoutées par la traduction française** (3 au japonais, dont `im家絵02a/b/c`) :
  elles n'existent nulle part dans l'archive 2012 (images de la version Steam). Ce
  n'est ni un défaut de nom ni un défaut de manifest, et aucune image n'est
  substituée ; le player les tolère avec un avertissement unique par image.

### Son `bgm101`

Seul asset encore absent : le **son `bgm101`**, référencé une fois par
`staffroll.ks` (générique de fin, `@play storage=bgm101.ogg`). Le manifest audio
compte 870 clés (`bgm/` = `m01`–`m63`, `se/` = 810 fichiers) et aucune clé voisine
de `bgm101`. Ce n'est ni une variante ni un défaut de nom : le fichier est absent
de l'archive PC 2012 convertie (limite connue, voir [`BUGS_PROLOGUE.md`](BUGS_PROLOGUE.md)).
Le player affiche un avertissement unique et joue le générique sans musique.

### Références d'asset de nom vide (37)

Ce ne sont pas des fichiers manquants. Deux mécanismes du script d'origine :

- `@fg` avec un `storage` vide : après expansion d'une macro, l'attribut absent
  (paramètre `%…` non fourni) produit un calque sans image (4 calques dans
  `5b-1.ks` et `5b-14.ks`) ;
- `@movefg`/`@movepartbg` ciblant un calque pas encore créé : le runtime crée un
  calque vide (id `pbN`…) pour porter l'animation ; l'image peut arriver ensuite
  par `@chgfg`, ou jamais (`pb1`–`pb4` dans `a-4.ks`, `pb2` dans `c-11.ks`).

C'est le comportement attendu du script (les calques KAG sont adressés par id et
peuvent être transparents), pas un bug du parser. Occurrences par script :
`a-4.ks` 17, `c-5.ks` 6, `c-12.ks` 5, `5b-1.ks` 3, `wik_g-a.ks` 3, `c-11.ks` 2,
`5b-14.ks` 1. Le renderer ignore ces calques (aucun `<img>` vide dans le DOM) et
l'audit les compte à part, sans les signaler comme manquants. Le chiffre de 188
cité par #112 datait d'avant les évolutions du moteur qui ont réduit le nombre de
scènes émises ; le recomptage donne 37.
