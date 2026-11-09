# Diagnostic du rendu visuel (issue #249)

Constat utilisateur : « des assets et des images en fond sont affichés alors que, dans le jeu
d'origine, ce n'étaient pas ces images-là à ce moment », surtout au début du jeu (testé sur `main`
avec les vrais assets, sans enregistrement de référence au départ).

Ce document consigne la méthode, les causes confirmées et corrigées, les hypothèses éliminées et
les écarts restants. Il ne contient aucun asset ni texte du jeu : uniquement des noms de
commandes, d'assets et des mesures.

## Méthode

1. **Trace visuelle headless** (`npm run trace:visual`, voir [`TRACE_VISUELLE.md`](TRACE_VISUELLE.md)) :
   rejeu de `1-0.ks`, `1-1.ks` et de scènes classiques avec l'état exact rendu par le moteur
   (fond, calques, position, zoom, crop, page fore/back) ; `docs/PROLOGUE_TIMELINE.md` est la
   timeline générée du prologue.
2. **Sources du moteur installé** (fichiers locaux non commités) : `data/override/tagex.tjs`
   (tags étendus, chargé par `Override.tjs` → `TagEx.tjs`), `data/scenario/partbgplugin.tjs`,
   `data/scenario/macro.ks`. La sémantique documentée de `docs/KAG_MAHOYO_SEMANTICS.md` y a été
   confrontée et corrigée quand elle divergeait (§2 et §4 du document).
3. **Contrôles corpus** sur les 251 scripts : nombres de commandes concernées et cohérence
   géométrique (rects dans l'image, positions par défaut).
4. **Contrôle négatif vidéo** : comparaison image par image de l'ouverture (vidéo OP fournie par
   l'utilisateur, 196,05 s) avec le rendu du player — MAE médian 4,16 %, 15/16 changements de plan
   alignés → l'ouverture est fidèle ; les écarts sont des questions de timing (flash, pan final),
   traités séparément. Le défaut « mauvais fonds » n'est donc pas dans l'ouverture.

## Causes confirmées et corrigées

### 1. Placement vertical par défaut d'un fond (`@bg`)

Le moteur (`@bg` de `tagex.tjs`) place un fond sans `left`/`top` en **X centré**
(`(scWidth - imageWidth) / 2`) et pose le **bas de l'image 48 px sous le bas de l'écran**
(`scHeight - imageHeight + 48`). Le port centrait verticalement.

- 3 788 `@bg` du corpus n'ont pas de `top` : 3 156 images font 672 px de haut (aucune différence),
  **632 en font une autre** — 345 en 1050 px (écart vertical de **189 px**), 59 en 960 px (144 px),
  22 en 1152 px (240 px)… Le port montrait donc une autre portion du décor que le jeu d'origine.
- Correction : `background-position: 50% calc(100% + 48px)` (et `bottom: -48px` pour les fonds
  zoomés/tournés), chaque axe restant indépendant (`left=` seul n'impose plus le centrage vertical).
- Preuve : tests unitaires (défauts d'axe, axes indépendants, fond zoomé) ; formule vérifiée dans
  `docs/KAG_MAHOYO_SEMANTICS.md` §2.

### 2. Les `@partbg` doivent se cumuler (montages de fenêtres)

Le moteur (`partbgplugin.tjs`) n'efface **jamais** les autres partbg : chaque `@partbg` ajoute ou
remplace **son** calque (par `id`/`storage`) ; `noclear` ne contrôle que le backlay avant une
transition, et la suppression est explicite (`@clpartbg`, `@clall`, `@bg` sans `noclear`). Le
runtime supprimait tous les calques « crop » dès qu'un `@partbg` arrivait sans `noclear=1`.

- Exemple vérifié : `1-1.ks` page 11 (début du jeu) pose cinq fenêtres de pièces
  (`id=pb1..pb5`, centres 220 → 813, `index` 1000 → 5000, `noclear=0`) qui doivent former un mur
  d'images ; le port n'affichait que la dernière.
- **208 `@partbg`** du corpus tombaient dans ce cas (1-1, 1-2, 5a-8…).
- Correction : la commande n'efface plus que son propre `id` ; test unitaire (cumul de trois
  partbg, `@clpartbg`, `@bg` sans `noclear`) ; trace de `1-1.ks` régénérée : 5 calques au lieu de 1.

## Hypothèses éliminées

| Hypothèse | Verdict et preuve |
|---|---|
| Deux assets écrasés dans le manifeste | Éliminé (reconnaissance Lead) : 5 422 images, 0 collision de basename. |
| Crop `@partbg` faux (modèle `srcleft/srctop`) | Éliminé : les sources du plugin montrent un offset relatif à `srcafx`/`srcafy` = centre de l'image, mais les deux chemins du plugin concordent avec le modèle du port ; contrôle corpus : 809/855 rects sans zoom entièrement dans l'image (94,6 %) contre 319 (37,3 %) pour un rect centré. |
| Variantes `nom|x` ignorées | Éliminé / documenté : aucun fichier de « parts » dans les archives installées (5 422 images = bg/fg/image/rule/data), code TJS de composition commenté ; la résolution vers l'asset de base est la règle du dépôt (`docs/LECTURE_COMPLETE.md`). |
| Sens back→fore de `@trans` (mauvais fond dans 1-0/1-1) | Non observé : la trace de 1-0 et 1-1 montre des fore corrects après chaque `@trans` ; aucun enchaînement `nowait=1` puis commande `noclear=1` sans resynchronisation dans ces deux scripts. L'écart réel (exchange/backlay) est documenté ci-dessous. |
| Frames animées `@fgact page=back` | Vérifié en navigateur (assets réels) : les séquences a→b→c du prologue alternent correctement (opacités relevées sur 5 échantillons par page). |

## Écarts restants (suivis séparément)

1. **Effets et modes de fusion des calques ignorés** (suivi : #252) — `type=`, `effect=`, `blur`/`xblur`/`yblur`,
   `brightness=`, `contrast=` ne sont pas lus par le parser. Corpus : 10 451 `effect`, 9 011 `type`,
   7 812 `blur`, 1 584 `brightness`, 1 498 `contrast` ; concernés dans le début du jeu : 1-0
   (scène des runes : `type=13/14/19`, `effect=nega/monocro/mono…`), 1-1 (17 `type`, 21 `effect`,
   16 `contrast`, 8 `brightness` sur le collage avant l'OP). C'est l'explication la plus probable de
   l'impression « ce ne sont pas les mêmes images » sur les scènes à silhouettes teintées /
   fondues : le port affiche l'asset brut, coloré, sans filtre ni mode de fusion.
2. **`@trans` : sémantique `exchange=true` + backlay après `@wt`** (suivi : #253) — le port garde
   `exchange=false` ; le fore affiché est identique dans les cas courants, mais l'état de back après
   un `@trans nowait=1` diffère du moteur (visible seulement dans des enchaînements particuliers).
3. **Ouverture** (suivi : #254) : flash blanc (démarre ~1 s trop tôt, s'éteint ~1 s trop tôt) et panoramique final
   `im01オープニング12_背景c` en retard local de ~2 s (mesures Lead vidéo ↔ rendu).
4. **Flakiness e2e** : `tests/e2e/routes.spec.ts:84` échoue par timeout (30 s) dans la suite
   complète en parallèle et passe isolément (7,4 s) — sans lien avec ce correctif.

## Suites

- Correctifs 1 et 2 livrés dans la PR #249 avec tests de non-régression.
- Utiliser `npm run trace:visual -- <script> --md <fichier>` pour confronter tout nouvel écart à une
  commande `script:ligne` ; la timeline du prologue sert de référence de lecture.
