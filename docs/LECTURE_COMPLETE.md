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
- **Fichiers binaires ignorés** : fichiers `.ks` qui sont en réalité des médias
  (images PNG, sons WAV) placés par le jeu dans `data/scenario/` et utilisés par
  des plugins moteur — pas des scripts. Leur nature est détectée par signature
  (voir « Fichiers binaires ignorés (16) »). Ils ne sont ni narratifs, ni des
  assets manquants.
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

Les 221 viennent de 251 fichiers `.ks` trouvés dans `scenario/`, dont :

- **235 vrais scripts** (issus de l'archive), répartis en 14 scripts système
  (menus, configuration, plugins) et **221 scripts narratifs** ;
- **16 médias** que le jeu place dans `data/scenario/` (5 images PNG, 11 sons WAV) :
  ce ne sont pas des scripts.

L'audit exclut les 16 médias par détection de signature (5 images, 11 sons) et les
14 scripts système par nom : `251 - 14 - 16 = 221`. Le chiffre de 234 utilisé
auparavant (251 - 17) comptait les 16 médias comme des scripts. Le couple
« 17 système / 13 binaires » des anciennes mesures était arithmétiquement juste
(221 = 251 - 17 - 13) mais **3 des 17 « système » étaient en fait 3 des 11 sons**
(`basicchoice.ks`, `basicdecide.ks`, `button-47.ks`, noms présents dans la liste
d'exclusion) : la détection binaire prime désormais sur cette liste.

## Fichiers binaires ignorés (16)

Ces fichiers ne sont pas des scripts : ce sont des médias du dossier
`data/scenario/` de l'archive 2012. Une ancienne exécution du pipeline les a
transcodés comme des `.ks` parce que l'inventaire classait **tout** fichier d'un
dossier `scenario/` en scénario : un PNG/WAV lu comme du texte donne un fichier
illisible (non chiffré — le contenu d'origine est simplement perdu). C'est
corrigé : seuls les `.ks` de `data/scenario` sont des scénarios ; les médias
suivent leur extension (image/son) et les fichiers moteur (`.tjs`, `.ttd`, `.tla`)
sont ignorés (voir [`PIPELINE.md`](PIPELINE.md)). Les fichiers `scenario/` déjà
installés restent ignorés par l'audit.

| Fichier | Nature d'origine | Usage dans le jeu | Décision |
|---|---|---|---|
| `im15木乃実銀行券(吹雪1枚回転a).ks` | PNG 2400×60 RGBA (ex-`.tlg`) | `fallnoteplugin.tjs` : billets tombants (animation 20 frames) | **Ignorer durablement** : effet de plugin moteur, aucune référence dans les scripts narratifs ; le pipeline le classe désormais en image |
| `im15木乃実銀行券(吹雪1枚回転b).ks` | PNG 2400×60 RGBA | `fallnoteplugin.tjs` (16 frames) | idem |
| `im15木乃実銀行券(吹雪1枚舞).ks` | PNG 2400×60 RGBA | `fallnoteplugin.tjs` (24 frames) | idem |
| `note0.ks` | PNG 1386×107 RGBA | aucune référence textuelle trouvée (résidu d'effet non câblé) | **Ignorer durablement** ; pipeline → image |
| `雪原型(blur).ks` | PNG 544×32 RGBA | `snowplugin.tjs` / `snow3d.dll` : neige procédurale | **Ignorer durablement** ; pipeline → image |
| `my01_042.ks` | WAV PCM 16 bits stéréo 48 kHz | `archivemenu.tjs` : son de page du menu archives | **Ignorer durablement** (menu KiriKiri non porté) ; pipeline → son |
| `shu03.ks` | WAV PCM 16 bits stéréo | `archivemenu.tjs` : retour de page / press | idem |
| `sei_ge_book01.ks` | WAV PCM 16 bits stéréo | `archivemenu.tjs` : entrée / press | idem |
| `typemoon_ci.ks` | WAV PCM 16 bits stéréo 44,1 kHz | `logo.ks` : audio de la timeline du logo Type-Moon (présent dans `timelines.json`) | **À gérer par la timeline** si la séquence `logo.ks` est jouée (le pipeline l'importe désormais en son) ; sinon ignoré |
| `se083.ks` | WAV | aucune référence textuelle (TJS/KS) | **Ignorer durablement** (résidu inutilisé) ; pipeline → son |
| `se086.ks` | WAV | aucune référence textuelle | idem |
| `se089.ks` | WAV | aucune référence textuelle | idem |
| `se101.ks` | WAV | aucune référence textuelle | idem |
| `basicchoice.ks` | WAV (anciennement compté « système ») | son de choix de l'interface | **Déclassé en binaire** ; ignoré durablement ; pipeline → son |
| `basicdecide.ks` | WAV (anciennement compté « système ») | son de validation d'interface | idem |
| `button-47.ks` | WAV (anciennement compté « système ») | son de bouton d'interface | idem |

Aucun de ces médias n'est nécessaire au corpus narratif : ils appartiennent aux
plugins et menus du moteur KiriKiri (effets de neige/billets, menu archives),
non portés dans le player web. La timeline `logo.ks` est le seul consommateur
potentiel côté player, et son audio devient disponible avec la correction du
pipeline.

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
**7 références d'asset de nom vide**. La vérification statique du pipeline
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

### Références d'asset de nom vide (7)

Ce ne sont pas des fichiers manquants. Deux mécanismes du script d'origine :

- `@fg` avec un `storage` vide : après expansion d'une macro, l'attribut absent
  (paramètre `%…` non fourni) produit un calque sans image (4 calques dans
  `5b-1.ks` et `5b-14.ks`) ;
- `@movefg`/`@movepartbg` ciblant un calque pas encore créé : le runtime crée un
  calque vide (id `pbN`…) pour porter l'animation ; l'image peut arriver ensuite
  par `@chgfg`, ou jamais.

C'est le comportement attendu du script (les calques KAG sont adressés par id et
peuvent être transparents), pas un bug du parser. Occurrences par script
(recomptage du 2026-11-09) : `5b-1.ks` 3, `wik_g-a.ks` 3, `5b-14.ks` 1. Le
renderer ignore ces calques (aucun `<img>` vide dans le DOM) et l'audit les
compte à part, sans les signaler comme manquants. Le chiffre de 188 cité par #112
(37 en #110) a baissé avec les évolutions du rendu des calques ; le recomptage
donne 7.
