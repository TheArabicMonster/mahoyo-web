# Placement des sprites — architecture et correctif (#315)

> Correctif du décalage du sprite du professeur (plan rapproché) **sans aucune constante par scène** :
> cause identifiée dans les TJS du moteur, placement calculé par une fonction pure en pixels absolus,
> dimensions d'images connues avant décodage et clip des sprites `partbgid`.

## Causes confirmées (code + TJS)

### 1. `@chgfg` sélectionnait le calque sur la mauvaise page → orphelin centré en 512×288

`data/scenario/fgplugin.tjs`, fonction `chgfg(elm)` :
`elm.page = "back" if .page === void` puis `searchpage = (.page == "back") ? "fore" : "back"` :
le calque à modifier est **sélectionné sur la page opposée** (typiquement `fore`, le personnage
visible), puis l'image est posée sur la page demandée. La sélection, quand `id`/`pos`/`target` ne sont
pas fournis, passe par `getSameCharacterLayerNo(.storage)` : préfixe de personnage
`^([^0-9a-z]+)`, calques visibles dont le storage commence par ce préfixe.

Le port cherchait dans la page cible (`back`) uniquement : le calque n'y existait pas → **création
d'un orphelin à (512, 288)** au lieu de conserver la position du personnage. C'est le mécanisme
principal du décalage du plan rapproché. Le parser ignorait en outre `center`/`vcenter` de `@chgfg`
(49 occurrences `center=`, 43 `vcenter=` dans 2 402 `@chgfg`).

**Correctif** (`src/kag/parser.ts`, `src/kag/runtime.ts`) : `center`/`vcenter` sont parsés ; la
sélection suit le moteur — `id`, sinon même id, sinon **même personnage sur la page opposée** — et le
calque source (position, crop, `partbgId`, apparence) est **copié sur la page cible** avec la nouvelle
image. L'orphelin n'est créé qu'en dernier recours (position fournie ou 512×288), avec la position
`center`/`vcenter` demandée.

### 2. Boîte 0×0 avant décodage (`translate(-50%)` sur un point)

Les sprites étaient posés avec `left=center; top=vcenter; transform: translate(-50%, -50%)` sur une
`<img>` sans `width`/`height` : avant décodage la boîte vaut 0×0, donc decalage de (−largeur/2,
−hauteur/2) nul, puis saut à la première frame décodée ; les partbg n'avaient pas non plus de taille
native réservée pour l'image interne.

**Correctif** : manifeste des dimensions généré au build (`tools/image-dimensions.ts`,
`npm run assets:dimensions`, appelé aussi par le pipeline et les placeholders e2e), chargé par
`main.ts` (`image-dimensions.json`) et injecté au renderer. La taille native est **réservée avant
décodage** ; sans manifeste, le renderer re-rend après `load` (jamais de boîte 0×0 figée).

### 3. `partbgid` non clippé

Les sprites `partbgid` (77 `@chgfg`, `@fg`…) étaient positionnés sans tenir compte de la fenêtre de
leur `@partbg` parent : 605 sprites hors fenêtre dans l'audit de l'issue. **Correctif** :
`resolvePlacement` intersecte le rectangle du partbg parent avec le stage et le renderer applique un
`clip-path: inset(...)` ; un sprite ne peut plus dépasser sa fenêtre de partbg.

## Architecture

- **`src/renderer/sprite-placement.ts`** — fonction pure :
  `resolvePlacement(params, imageSize, stage) → { x, y, width, height, transform, transformOrigin, clip, inner }`
  - `params` : `center`/`vcenter` (centre du calque), `zoomx`/`zoomy` (%), `rotate` (deg), `afx`/`afy`
    (pivot absolu), `crop` (`@partbg`), `clipRect` (`partbgid`) ;
  - boîte = taille native de l'image (ou rectangle du crop), coin haut-gauche = centre − taille/2 ;
  - `inner` : image interne du partbg en `(-srcleft, -srctop)`, `scale(srczoom/100)` autour du centre ;
  - `clip` : intersection du partbg parent avec le stage.
- **Manifeste des dimensions** : `assets:dimensions` / pipeline / placeholders e2e → clé logique →
  `{width,height}` ; lecture PNG/WebP/JPEG sans décodage (`src/core/image-dimensions.ts`).
- **Renderer** (`src/renderer/stage-renderer.ts`) : réserve `width`/`height` depuis le manifeste, rérend
  après décodage si inconnu, applique le clip absolu des `partbgid`. Les transformations
  d'animation existantes (`action-compiler`, `translate(-50%)` sur une boîte **désormais taille
  réservée**) restent compatibles avec le moteur de pistes de #317.
- Aucune position/offset par scène : tout dépend des paramètres du script, de la taille de l'image et
  du stage 1024×576.

## Preuves et tests

| Test | Contenu |
|---|---|
| `tests/unit/renderer/sprite-placement.test.ts` | 13 cas paramétrés : ancrage centre, `center`/`vcenter` explicites, image plus grande que l'écran, zoom/rotation, pivot `afx`,`@partbg` (crop, `srcleft` négatif, crop > image), clip partbgid intersection/hors stage |
| `tests/unit/renderer/stage-renderer.test.ts` | boîte réservée avant décodage (200×100, plus de 0×0), clip d'un sprite `partbgid` = `inset(200px 250px 200px 250px)` pour une image 800×600 dans un partbg 300×200, absence de clip sans `partbgid` |
| `tests/unit/core/image-dimensions.test.ts` | lecture PNG/WebP VP8X/VP8L/JPEG, format inconnu |
| `tests/unit/kag/runtime.test.ts` | `@chgfg` sans page copie le calque `fore` du même personnage sur `back` (position conservée), `center`/`vcenter` explicites appliqués, position conservée sinon, orphelin à la position demandée |
| `tests/e2e/player.spec.ts` | `image-dimensions.json` servi et non vide, `@partbg` de l'ouverture positionné en absolu (x=487, y=0, 522×576 en repère 1024×576, identique à #70) |

Mesure e2e : wrapper partbg `left=487, top=0, width=522, height=576` (stage 1024×576) ; boîte sprite
réservée (`width` inline en px) avant décodage. Corpus : **2 402 `@chgfg`** dont 49 `center=` / 43
`vcenter=` désormais honorés, **77 `partbgid`** clippés, 605 sprites hors fenêtre traités par le clip.

## Limites / approximations

- Le clip `partbgid` est calculé sur la boîte **non transformée** du sprite ; pour un sprite
  zoomé/rotationné, le `clip-path` suit la transformation (intersection bornée, léger décalage
  possible). Consigné au registre #296 : `sprite-clip-bbox`.
- La comparaison visuelle nœud↔décor de l'enregistrement propriétaire reste à refaire sur un nouveau
  `ours.mov` : le correctif supprime la création d'orphelin (cause mesurée), les preuves ci-dessus
  vérifient la géométrie DOM/formule ; aucun asset n'est commité.
- Le panoramique de fond (`@bgact`) relève de **#317**, pas de cette issue.

## Correctif 2026-11-11 — ancrage `vcenter` et view area (#315, validation visuelle #347)

La validation visuelle automatisée (`npm run validate:visual`, assets réels locaux) montrait encore
un écart vertical de **−42 px (5,83 %)** au plan rapproché, alors que l'horizontal était bon
(−10 px, 0,78 %).

Cause confirmée : `center2top(c) = c − height/2 − verticalCorrect` (TJS `compositionlayer.tjs`).
Pour le sprite `山城01(大)` (304×672), le port utilisait `height = 672` (hauteur native). La **view
area** du calque de sprite est plafonnée par la scène (+ marge de couche KAG `CharacterLayer`
par défaut 32) : `height = min(672, 576 + 32) = 608`, donc `top = 335 − 304 = 31` au lieu de
`−1`. Le renderer compense le `translate(-50%)` CSS de `(hauteur native − view area)/2` et
`resolvePlacement` expose `spriteAnchorSize(imageSize, stage)` ; aucun offset par scène.

Validation après correctif (même outil, assets réels) : **Δx = −10,0 px (0,78 %)**,
**Δy = −2,0 px (0,28 %)**, décor NCC 97,3 %, sprite NCC 89,9 % → **critère ≤ 1 % respecté**.
Tests : plan rapproché 304×672→608 et image 2048×1152→1024×608 dans
`tests/unit/renderer/sprite-placement.test.ts`. L'échelle horizontale n'est pas plafonnée pour une
image plus étroite que le stage (304 < 1024).
