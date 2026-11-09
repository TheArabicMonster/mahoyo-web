# Sémantique KAG Mahoyo (PC 2012)

Ce document fige la sémantique **réelle** des commandes KAG utilisées par
*Mahoutsukai no Yoru*, déduite de l'analyse du prologue `1-0.ks` (fichier local,
non commité) et confrontée au moteur KiriKiri/KAG3. Il sert de référence à
l'implémentation du port web ; aucune hypothèse n'est codée à l'aveugle.

> Les valeurs chiffrées ci-dessous sont **extraites du prologue** et reformulées.
> Aucun code ni texte original n'est reproduit ici.

## 1. Repère de coordonnées

- Le jeu travaille en **1024 × 576** (logique), pas 1280 × 720.
  - `center=512 vcenter=288` est le centre de l'écran.
  - `@partbg … width=1024 height=576` couvre tout l'écran.
- Le viewport UI reste **1280 × 720** (menus/UI inchangés) ; le stage est placé
  à l'intérieur avec `transform: scale(1.25)` (origine `0 0`).
- Les fonds font 1120 × 672 (1024 + 96 de marge). Le centrage se fait par
  `left/top` natifs, **pas** par `background-size: cover`. Exemple :
  `@bg storage=… left=-48 top=-48` recentre un fond 1120×672 sur 1024×576.

## 2. Double buffer (fore / back)

KiriKiri utilise deux pages :
- **fore** : ce qui est affiché.
- **back** : où l'on prépare la modification avant un `@trans`.

Règles vérifiées dans les sources locales du moteur (`data/override/tagex.tjs` — chargé par
`Override.tjs` → `TagEx.tjs` — et `data/override/initialize.tjs`) :
- Sans `page=`, **toutes** les commandes visuelles (`bg`, `fg`, `partbg`, `clfg`, `clpartbg`,
  `fgact`, `partbgact`, `chgfg`) écrivent sur **back** : `@bg` et `@fg` le forcent explicitement
  (`if(.page == void) .page = "back"`).
- `@bg` sans `noclear` **vide les calques** de la page cible (`freeimage` sur chaque calque et
  sur les plugins) ; `noclear=1` les conserve. `@fg`/`@partbg` ne vident pas les autres calques.
- `@trans` (transaction native `BeginTransition`) utilise **`exchange=true` par défaut** : à la fin
  du fondu, fore et back sont **échangés** (fore = contenu préparé, back = ancien fore).
  L'attente `@wt` insère ensuite un **backlay** (copie fore → back), sauf `noback=1` : après une
  transition *bloquante*, back redevient identique à fore ; après une transition `nowait=1`,
  **back contient l'ancien affichage**.
- **Écart connu du port** : `src/kag/runtime.ts` implémente `fore = clone(back)` avec back conservé
  (exchange=false, pas de backlay). Le fore affiché est identique dans les cas simples, mais l'état
  de back après un `@trans nowait=1` diffère : suivi dans une issue dédiée (voir §11).
- **Trans implicite** : une commande avec `time>0` et `rule=` mais sans `page=` (ex.
  `@bg time=1200 rule=crossfade storage=white`) passe par `dotrans` : la commande est appliquée sur
  back puis une transition est lancée. `nowait=1` → non bloquant. S'applique à `@bg`, `@partbg`,
  `@fg` et `@chgfg`, conformément à `@fg`/`@bg` de `tagex.tjs` et #166.
- **Placement par défaut d'un fond** (vérifié dans `tagex.tjs`, handler `bg`) : quand `left`/`top`
  sont omis, chaque axe est indépendant et vaut `left = (scWidth - imageWidth) / 2` (centré en X) et
  `top = scHeight - imageHeight + 48` (bas de l'image 48 px **sous** le bas de l'écran, `scHeight`
  = 576). Ce n'est donc **pas** un centrage vertical : pour un fond de 1050 px de haut, l'écart est
  de 189 px, pour 960 px de 144 px. Le port applique ces défauts depuis #249 (auparavant centrage
  vertical, faux dès que l'image ne fait pas 672 px de haut).

## 3. Calques (layers)

- Chaque calque a un **id** (`id=`) sinon son `storage` (jamais `parseInt`).
  `id=pb1` identifie un partbg réutilisé par `@clpartbg id=pb1` et
  `@partbgact`.
- `index=` et `absolute=` (dans les keyframes) sont le **z-index**. Ex. un
  sprite normal à `index=2000`, un flash rouge à `index=6000`.
- `type=` est un **mode de fusion** KiriKiri (entier). Les codes numériques ont été relevés dans
  les sources du moteur installé (`data/scenario/noiseplugin.tjs`, commentaires « = N ») et sont
  mappés vers `mix-blend-mode` (#252). Table `type → mix-blend-mode` :
  1 `ltOpaque` → aucun (traité normal), 2 `ltAlpha` → `normal`, 3 `ltAdditive` → `plus-lighter`,
  4 `ltSubtractive` → **aucun équivalent CSS**, 5 `ltMultiplicative` → `multiply`,
  8 `ltDodge` → `color-dodge`, 9 `ltDarken` → `darken`, 10 `ltLighten` → `lighten`,
  11 `ltScreen` → `screen`, 12 `ltAddAlpha` → `plus-lighter` (approx.),
  13 `ltPsNormal` → `normal`, 14 `ltPsAdditive` → `plus-lighter`, 15 `ltPsSubtractive` →
  `color-burn` (approx.), 16 `ltPsMultiplicative` → `multiply`, 17 `ltPsScreen` → `screen`,
  18 `ltPsOverlay` → `overlay`, 19 `ltPsHardLight` → `hard-light`, 20 `ltPsSoftLight` → `soft-light`,
  21 `ltPsColorDodge` → `color-dodge`, 22 `ltPsColorDodge5` → `color-dodge` (approx.),
  23 `ltPsColorBurn` → `color-burn`, 24 `ltPsLighten` → `lighten`, 25 `ltPsDarken` → `darken`,
  26 `ltPsDifference` → `difference`, 27 `ltPsDifference5` → `difference` (approx.),
  28 `ltPsExclusion` → `exclusion`. Codes utilisés par le corpus : 1-5, 8-28 (6/7 absents).
- `effect=` est un filtre d'image. Effets intrinsèques appliqués (#252) : `monocro`/`monochrome`
  → `grayscale(1)`, `sepia` → `sepia(1)` (approx.), `nega` → `invert(1)`, `red`/`green`/`blue`
  → filtre SVG `feColorMatrix` (approx.), `mono<rrggbb>` → **aplat de couleur conservant l'alpha**
  (`feFlood` + `feComposite in SourceAlpha`, exact). Les **effets d'ambiance** (`屋外深夜`,
  `mh屋内曇り`, ~240 noms) sont définis dans `data/others/envcolor.ksc` (données du jeu) :
  le pipeline installe ce fichier (`docs/PIPELINE.md` §4 bis) et le player l'applique (#260) —
  niveaux de gris (`feColorMatrix saturate 0`), gamma par canal (`feComponentTransfer` type gamma,
  `exp = 1/gamma`, bornes floor/ceil comme le moteur), puis calques de couleur translucides
  (`feFlood` + `feBlend`, mode mappé depuis `layertype`, ordre du moteur). Sans fichier installé,
  l'effet n'est pas appliqué et un avertissement unique par nom est émis.
- `blur=`/`xblur=`/`yblur=` (double flou de boîte du moteur → gaussien CSS, sigma
  `sqrt(2r(r+1)/3)`), `brightness=` (décalage, filtre SVG linéaire) et `contrast=`
  (`(c+255)/255` en facteur CSS) sont appliqués comme filtres (#252). Un `@bg`/`@fg` sans ces
  attributs les réinitialise (le moteur les remet à zéro à chaque chargement d'image).
- `rotate=`, `zoomx=`/`zoomy=` : transformations du calque.

### Zoom et rotation de `@bg`, `@fg`, `@chgfg` (#164)

Ces trois commandes portent aussi `zoom=` (en %, les deux axes), `zoomx=`/`zoomy=` (un axe, négatif
= miroir) et `rotate=` (degrés, sens horaire). Elles sont partout dans le corpus japonais :
2 389 `@bg` avec `zoom`, 1 095 avec `rotate`, 6 215 `@fg` avec `zoom`, 8 710 avec `rotate`, 546
`@chgfg` avec `zoom` (comptes des valeurs différentes de 100 % et de 0°). Les ignorer affichait les
sprites et les fonds à leur taille d'origine, à une position pensée pour l'image zoomée : fond noir,
fragments coupés (voir B17 dans `docs/BUGS_PROLOGUE.md`).

- `zoomx` et `zoomy` priment sur `zoom` ; un axe non précisé vaut 100 %. Une valeur illisible
  (expression `&…`) est ignorée.
- **Pivot** : le centre de l'image. Pour un sprite, `center`/`vcenter` est ce centre. Pour un fond, l'image
  est d'abord placée en (`left`, `top`) à sa taille d'origine (centrée sans position), puis zoomée et
  tournée autour de **son propre centre**. Contrôle sur les 2 812 `@bg` avec zoom ou rotation du corpus
  japonais dont on connaît la taille d'image : ce modèle couvre tout l'écran 1024 × 576 dans 2 409 cas, contre
  1 341 si le pivot était le coin haut gauche (les 403 autres sont des fonds tournés, que ce contrôle simple
  ignore, ou des images plus petites que l'écran). **Déduit, pas mesuré** sur le jeu d'origine.
- Un `@bg` **remplace** le zoom du fond précédent : sans `zoom=`, le fond est à 100 % et sans rotation.
  Un `@fg` pose un nouveau calque (il ne garde rien de l'ancien du même nom) ; un `@chgfg` garde le zoom et
  la rotation du calque, sauf si la commande en précise (même `zoom=100`, qui remet à zéro).
- Un calque neutre (100 %, 0°) n'écrit rien dans l'état (`SpriteState.zoomx`, `SceneState.bgZoomX`… absents) :
  sauvegardes et snapshots d'avant restent identiques. L'état est en % et en degrés ; seuls les keyframes
  d'`@fgact` sont en proportion (1 = 100 %), et le zoom de leur **dernière** keyframe devient celui de l'état.
- Rendu : un sprite reçoit `transform: translate(-50%, -50%) rotate(r) scale(zx, zy)`. Un fond zoomé ou
  tourné n'est plus un `background-image` (rogné aux 1024 × 576 de sa boîte : un zoom montre ce qui dépasse)
  mais un `<img>` enfant à sa taille d'origine, posé en (`left`, `top`) avec `transform-origin: 50% 50%` ;
  il suit le fondu enchaîné comme un fond ordinaire.
- Non repris : `blur`, `xblur`/`yblur`, `brightness`, `contrast`, `type` et `effect` sur ces commandes,
  et le point d'ancrage `afx`/`afy` des `@bgact` (voir ci-dessous).

### Ancrage des sprites zoomés et bord inférieur des sprites (#171)

Un sprite (`@fg`) est posé par le **centre** de son image (`center`/`vcenter`) et zoomé autour de ce
centre (`translate(-50%, -50%) rotate scale`). Contrôle sur le corpus japonais (`@fg` dont l'image fait au
moins 400 px de haut, 7 774 commandes avec zoom vertical ≠ 100 %) : part dont le **bas** atteint le bas de
l'écran (y ≥ 576, repère 1024 × 576) selon le pivot : centre 5 941 (76,4 %), bas-centre 6 095 (78,4 %),
haut-centre et coin 5 210 (67,0 %) ; part qui couvre à la fois le haut et le bas : centre 3 969, haut-centre
3 533, bas-centre 2 600. Les 7 479 sprites non zoomés atteignent le bas dans 79,4 % des cas : le pivot au
centre garde le même taux que sans zoom, les autres le dégradent ou font sortir le haut. Pivot au centre
conservé. **Déduit du corpus, pas mesuré sur le jeu.**

Un sprite qui s'arrête avant le bas de l'écran n'est pas un défaut de zoom. Exemple vérifié dans Chromium :
le buste d'un professeur (image de 732 × 672) posé à `center=601 vcenter=205`, **sans zoom**, occupe
(294, −164, 915 × 840) à l'écran, donc finit à y = 541 dans le repère 1024 × 576 (676 sur 720). Sur le corpus,
les bas de sprites qui n'atteignent pas 576 se concentrent entre 500 et 560 (1 379 sprites non zoomés finissent
avant 548) : le jeu d'origine les pose pour que leur bord inférieur soit **caché par la fenêtre de texte**. Dans le
port, la boîte (fond noir à 70 %, bas à y = 547) laisse voir ce bord ; c'est un réglage de la boîte, pas du zoom.

### `@bgact` (#164)

`@bgact` anime un fond (`props=-storage,left,top,zoomx,zoomy,rotate…` : panoramique, zoom, rotation ; 720
occurrences dans 107 scripts, surtout `page=back` suivies d'un `@trans`). Le moteur le lisait comme un
`@bg` sans position : il recentrait le fond **et vidait les calques de la page**. Maintenant :

- `@bgact` ne touche ni au fond, ni aux calques ;
- seule la **première keyframe** est posée (position, zoom, rotation, si elle les précise) : c'est
  l'état de départ de l'animation. Les keyframes suivantes (panoramique ou zoom lent de plusieurs
  secondes) **ne sont pas rejouées** : le fond reste à l'image de départ. Limite connue ;
- `page=fore` émet une scène sans transition, `page=back` ne montre rien avant le `@trans`.

## 4. `@partbg` — panorama recadré

`@partbg storage=im0911根源光 srcleft=-188 srctop=38 index=2000 width=1024
height=576 type=13 effect=monocro noclear=1 srczoom=400 id=pb1`

- Crée un wrapper de `width × height` (souvent 1024×576) en `overflow:hidden`,
  positionné à `center/vcenter` (défaut 512/288), `translate(-50%,-50%)`.
- À l'intérieur, une `<img>` en taille **native**, décalée de
  `translate(-srcleft px, -srctop px) scale(srczoom/100)`. `srczoom=400` = ×4.
  **Pivot du zoom : le centre de l'image** (`transform-origin: 50% 50%`, #169), comme pour `@bg`.
  Vérifié dans les sources du plugin local (`data/scenario/partbgplugin.tjs`) : `@partbg` anime
  l'image source par une transformation affine construite autour de `srcafx`/`srcafy`, dont la
  valeur par défaut est **`AFFINEOFFSET_CENTER`**, c'est-à-dire le centre de l'image ; l'image
  transformée est ensuite décalée de `-srcleft`/`-srctop` (`extraAffineFrame` : `offx = srcleft`,
  `offy = srctop`). Sans zoom ni rotation le plugin prend un chemin de copie de région
  (`extraCopyFrame`) qui, après simplification, donne la même origine de rect :
  `srcafx + srcleft - (largeur source)/2` = `srcleft`. Le modèle du renderer
  (`srcleft`/`srctop` = coin haut-gauche du rect source, zoom autour du centre de l'image) est donc
  conforme au moteur.
  Contrôle corpus (8 900 `@bg`/2 171 `@partbg` avec dimensions d'image connues, issue #249) : pour
  les 855 `@partbg` sans zoom, le rect déclaré est **entièrement dans l'image dans 809 cas (94,6 %)**
  avec ce modèle, contre 319 (37,3 %) si le rect était centré sur `srcafx + srcleft`. Les deux
  chemins du plugin (copie de région à 100 %, affine sinon) concordent.
  Un pivot au coin haut gauche repoussait l'image dans un coin de la fenêtre dès que
  `srcleft`/`srctop` sont négatifs (636 des 2 171 `@partbg` du corpus japonais) — correction #169
  conservée.
- `bgstorage` : remplace le fond de la page cible (via `@bg`, donc avec ses défauts de position).
- `rule/time` : transition implicite (voir §2) ; `noclear` ne contrôle que le **backlay**
  effectué avant cette transition, pas l'effacement des calques.
- **Les `@partbg` se cumulent** : chaque commande ajoute (ou remplace, même `id`) **son** calque et
  n'efface **jamais** les autres — c'est le mécanisme des montages (ex. `1-1.ks` page 11 : cinq
  fenêtres `id=pb1..pb5` de pièces différentes posées côte à côte avec `noclear=0`). La suppression
  est explicite : `@clpartbg id=…`, `@clall` (macro `clpartbg`), ou `@bg` sans `noclear` (qui vide
  aussi les calques des plugins, `forEachClearLayers`). Le port effaçait les calques de crop quand
  `noclear` était absent : corrigé (#249), 208 `@partbg` du corpus étaient concernées.
- `partbgid=pb1` (sur `@fg`) : clip le sprite **à l'intérieur** du partbg
  (à implémenter plus tard).
- `@clpartbg id=pb1` : supprime le partbg par id.
- `@partbgact` : animation des propriétés du wrapper (center/vcenter/opacity/
  absolute/zoom/rotate) et de l'img interne (srcleft/srctop/srczoomx/srczoomy).
  Implémenté : keyframes WAAPI séparées par cible (wrapper + inner).

## 5. `@fgact` / `@movefg` / `@partbgact` — keyframes

Format des `keys=` :
```
keys=(time,accel,interp,<cols props>)(...)
```
- **time** : temps **absolu en millisecondes** (pas des frames). La boucle du
  prologue dure 1,8 s.
- **accel** : 0/2/3/6… accélération façon KAG `@move` (pas une durée). 0 =
  linéaire.
- **interp** : `l` = linéaire, `n` = **palier** (aucune interpolation, on garde
  la valeur jusqu'à la keyframe suivante), vide = reprend la précédente.
- **cols** : décrites par `props=` dans l'ordre, **après** les 3 colonnes fixes.
  - Préfixe `-` dans `props=` → propriété **discrète** (ex. `-storage`,
    `-visible`, `-type`, `-effect`) : changement instantané, pas d'interpolation.
  - Colonnes courantes : `storage, center, vcenter, absolute, opacity, type,
    rotate, zoomx, zoomy, effect, contrast, visible`.
  - `absolute` = **z-index** (n'apparaît que sur certaines lignes).
- **Cellule vide** : reprend la valeur de la keyframe précédente.
- **`~`** : valeur inconnue → traiter comme une reprise + warning.
- `opacity` est en /255, `zoomx/zoomy` en /100, `rotate` en degrés.
- `loop=1` : boucle infinie (le prologue fait clignoter 3 calques a→b→c sur
  1,8 s).
- `def.storage` vient de `args.storage`, sinon de la colonne `storage` de la
  keyframe 0.

### Interpolation
- L'interp d'une keyframe k s'applique au segment **k → k+1** (sémantique
  identique à l'`easing` par keyframe de la Web Animations API).
- Pour `n` : `steps(1, end)` (palier).
- Pour `l` : `linear`.
- Pour accel > 0 : approximer par une fonction `linear(...)` CSS
  (`t^a` pour a>0). 16 points suffisent.

### Synchronisation
Toutes les actions d'un même **step** partagent un `startTime` commun
(`document.timeline.currentTime` capturé une fois), sinon les calques b et c
se déphasent et le clignotement a→b→c n'est plus juste.

### Noms avec parenthèses
Les noms de fichiers peuvent contenir des parenthèses :
`im12宇宙の果て01(中心無し)`. La regex `/\([^)]+\)/g` casse sur ce cas →
**tokenizer dédié** gérant l'imbrication de parenthèses.

## 6. Texte

- `@r` en **commande** = saut de ligne (équivalent au tag `[r]`). 34 lignes du
  prologue l'utilisent.
- `[ruby text=ふ]触れた` et `[ruby char=N text=…]` : furigana. Le lexer/parser
  les gèrent ; le rendu doit produire `<ruby>base<rt>lecture</rt></ruby>`.
- `@textoff time=4000` : masque la textbox avec un fondu de 4 s. Le texte qui suit
  la réaffiche (règle au §11, #159).
- `@visibleframe` / `@invisibleframe` : affiche/masque le cadre de la textbox.
- `@cm4pg` : reset de mise en page pour le changement de page (à valider).

### Ruby (`[ruby]`, `@ruby`) — #277

- Balise KAG3 : `text` est le **ruby** (lecture), `char` numérique est le **nombre de caractères du
  texte suivant** couverts (défaut 1). Ex. `[ruby text=こえ char=1]言なき鳥` → « 言 » avec « こえ ».
- **Extension TYPE-MOON** (`data/override/tagex.tjs`, handler `ruby`) : si `char` est une **chaîne**
  (non numérique), elle est le **texte de base affiché** et le ruby est réparti sur ses caractères
  (utilisé pour les incantations latines avec lecture japonaise). Vaut pour la balise `[ruby]`
  (`5a-11.ks:858`) et pour la **commande** `@ruby` (`5a-11.ks:860`), qui sont désormais
  équivalentes dans le parser.
- La répartition du ruby sur le texte de base suit les largeurs de caractères dans le moteur ; le
  port la fait proportionnellement au nombre de caractères (approximation sans écart visible sur
  une chaîne latine mono-espacée).
- Une commande `@ruby` **s'applique au texte qui suit** : le parser ne vide pas le tampon de texte
  avant de la traiter.

### Commandes KAG standard `@s`, `@image`, fermetures conditionnelles orphelines — #277

| Commande | Occurrences du corpus | Décision |
|---|---|---|
| `@image` | `first.ks:2`, `macro.ks:40` (macro), `staffroll.ks:8`, `wik_fin.ks:278` — toutes `layer=base` | **implémentée** : charge l'image dans la couche `base` d'une page **sans transition** (fond de page, calques conservés, apparence réinitialisée comme le moteur). `layer=<n>` pose un sprite centré (approximation, aucune occurrence). |
| `@s` | `system_window.ks:8`, `testcodes.ks:11` | **implémentée** comme arrêt du déroulement avec attente de clic. Sémantique KAG3 exacte : « arrêt, attente d'une sélection (bouton/lien) » — le port n'implémente pas encore les boutons de click-map, d'où l'approximation par attente de clic (aucun impact : ces deux scripts ne sont jamais chargés par le player). |
| `@endif` | `4-3.ks:364` (commande) et `testcodes.ks:8` (balise `[endif]` en ligne) | **no-op justifié** : fermetures **orphelines** (aucun `@if` dans le script). Dans le moteur, `endif`/`endignore` terminent un bloc ; hors bloc ils sont sans effet. Le parser émet un `noop` explicite (n'apparaît plus comme commande inconnue). |
| `@else`, `@elsif`, `@endignore` | — | même traitement préventif (no-op explicite si orphelins). |

### Macros système (`first.ks`, `macro.ks`) — réponse #277

- Le runtime **sait** exécuter les macros (`@macro` → `macrodef`, expansion des `%param` à l'appel),
  mais **ne charge pas** `first.ks`/`macro.ks` : le player démarre sur le premier script narratif et
  l'audit headless n'exécute que les 221 scripts narratifs.
- Vérifié : **aucune dépendance manquante** des scripts narratifs à ces macros. Les noms définis
  dans `macro.ks` (`pg`, `lr`, `clall`, `italic`, `rf`, `誤?`, `?誤`, `startdoublemessage`,
  `enddoublemessage`) correspondent soit à des tags **implémentés nativement** avec la même
  sémantique (`@pg` = saut de page, `@clall` = `clfg`+`clpartbg`+`trans`, `@rf`/`@resetfont`,
  `@italic`), soit ne sont **pas employés** dans le corpus (`lr`, `startdoublemessage`,
  `enddoublemessage`, `誤?`, `?誤` : 0 occurrence). Aucun de ces noms ne figure dans les commandes
  inconnues de l'audit.
- Conclusion : charger les scripts système n'est **pas nécessaire** à la justesse du déroulement
  narratif ; cela ajouterait des dépendances `@eval`/plugins TJS et risquerait de redéfinir des
  tags déjà natifs. Décision documentée ici (pas de chargement des macros système).

### Style du texte (`@font`, `@italic`, `@rf`, `@resetfont`)

- `@font` est la balise `[font]` de KAG3. Attributs retenus : `face`, `size`,
  `color`, `bold`, `italic`, `edge`, `edgecolor`, `shadow`, `shadowcolor`. Les
  couleurs s'écrivent `0xRRGGBB` (ou `#rrggbb`) ; les booléens `true`/`false`/`1`/`0`.
  Une valeur invalide est ignorée sans invalider le reste de la commande.
- Le style est **cumulatif** : chaque `@font` fusionne ses attributs dans le style
  courant. Il s'applique au texte qui **suit** la commande (pas à celui d'avant), y
  compris pour les balises en ligne (`a[font color=0xff0000]b[rf]c`).
- `@resetfont` et `@rf` rétablissent le style par défaut ; sans `@font` préalable,
  ils sont sans effet.
- `@italic` et `@rf` sont des macros de `macro.ks` (`@italic` = `@font italic=true`,
  `@rf` = `@resetfont`). Le moteur les gère en natif pour fonctionner même si
  `macro.ks` n'est pas chargé ; une redéfinition différente dans un script serait
  masquée (aucune n'existe dans le corpus).
- Le style fait partie de l'état sauvegardé (`textStyle`).
- **Hypothèse** : `edgecolor` seul active le contour (le corpus l'emploie ainsi, sans
  `edge=true`) ; `edge=false` le désactive. Le contour est rendu par `text-shadow`.

### Bulle « ploy » (`@beginploy`, `@ploysay`, `@endploy`)

- `@ploysay` **n'affiche pas de texte** : ses attributs sont `mode` (`lu13`, `ru19`,
  `lu192`…) et des décalages `ox`/`oy` en pixels. Il n'apparaît que dans les scripts
  `nz1` à `nz6` (omake), juste après l'affichage d'un personnage (`@chgfg`).
- Le moteur d'origine délègue cela à un plugin TJS absent du dossier `scenario/`. La
  structure de `mode` (côté gauche/droit, taille de bulle…) n'est donc **pas
  établie**. Les images `balloon01` et `balloon02` du manifest sont probablement les
  bulles associées.
- Implémenté : `mode` est conservé tel quel, avec `ox`/`oy`, dans l'état sauvegardé
  (`ploy`) et dans l'événement `ploy` ; `@endploy` retire la bulle. Le renderer
  l'expose sur la textbox (`data-ploy-mode`, `--ploy-ox`, `--ploy-oy`) mais **ne
  dessine pas** la bulle.

### `@return` sans appelant

- Un script lancé par le player (ou, dans le jeu d'origine, par le plugin « tracer ») n'a
  pas d'appelant. Son `@return` le **termine** et rend la main.
- Avant, ce `@return` était ignoré et l'exécution continuait dans le code qui suit : un
  script comme `teatime.ks`, dont des sections étiquetées suivent le `@return`, bouclait
  indéfiniment. Effet de bord : le clic sur une page vide que le joueur devait faire après
  le dernier `@return` d'un chapitre disparaît.
- Les scripts qui s'enchaînent sont décrits dans [`ENCHAINEMENT_SCRIPTS.md`](ENCHAINEMENT_SCRIPTS.md).

### `@playtimeline`, `@seloop`

- `@playtimeline scene=N next=ms` joue une timeline d'animation embarquée dans le script
  (voir [`TIMELINES.md`](TIMELINES.md)). Seul `opening.ks` l'emploie dans l'histoire ; les autres
  occurrences (96 au total) sont dans des scripts système jamais exécutés.
- `@seloop storage=… time=… volume=…` est un SE en boucle avec fondu d'entrée (`time`) ; il accepte
  `cond=`. `1-2.ks` l'emploie avec `cond=!kag.isplayingse('se01004')` pour la pluie d'ambiance.
- `kag.isplayingse(storage)` est approximé par « le dernier SE lancé n'a pas été arrêté ».

### `@lockquickmenu`, `@pauseautomode`, `@resumeautomode`

Ces trois commandes ne sont pas des macros : le moteur d'origine les fournit par un plugin
TJS (le « tracer ») absent du dossier `scenario/`. Leur sens est déduit des appels et des
commentaires du corpus (`opening.ks`, `first.ks`, `call.ks`, `tracerplugin.ks`).

| Commande | Où | Sens retenu |
|---|---|---|
| `@lockquickmenu` | `first.ks` (début de partie, avec `@rclick enabled=false`), `call.ks` (chargement, retour au titre), `opening.ks` (film d'ouverture) | verrouille le **menu rapide** : sauvegarde et chargement rapides, plus le clic droit |
| `@pauseautomode` / `@resumeautomode` | `opening.ks`, de part et d'autre de `@playtimeline` | suspend puis reprend l'**avance automatique** pendant le film |

Indices du corpus : `call.ks` commente « `lockquickmenu` する » dans la routine de chargement, et « `lockquickmenu` を維持するため, `onceIgnoreUnlockQuickMenu=true` »
avant un retour au titre ; `tracerplugin.ks` pose `onceIgnoreUnlockQuickMenu=true` pour que
« le prochain arrêt (`@s`) » ne déverrouille pas. Le déverrouillage se fait donc au prochain
arrêt du tracer, c'est-à-dire en fin de séquence. Aucun script du corpus n'écrit de commande
de déverrouillage ni de reprise sans suspension préalable.

Sémantique implémentée (la plus simple compatible avec ces indices) :

- `@lockquickmenu` pose un verrou dans l'état du runtime et émet `{ kind: "quickMenu", locked: true }`.
  Le player refuse alors `save`, `load` et l'ouverture des écrans Sauvegarder et Charger en
  cours de partie (toast explicatif) ; les boutons correspondants du menu pause sont
  désactivés. Les autres entrées du menu pause (Reprendre, Réglages, Historique, Retour au
  titre) restent disponibles : la pause est la seule sortie. Le clavier n'a pas de raccourci
  de sauvegarde ou de chargement, il n'y a donc pas de touche à verrouiller. L'autosave
  interne n'est pas concernée. Depuis l'écran-titre, le chargement reste possible.
- `@unlockquickmenu` (non employée dans le corpus, ajoutée par symétrie) lève le verrou. Le
  verrou est aussi levé **à la fin du script** qui l'a posé (`@return` sans appelant, fin de
  fichier), ce qui remplace le « prochain arrêt » du tracer. Un `@call` ne le lève pas.
- `@pauseautomode` suspend le déclenchement automatique (`{ kind: "autoMode", paused: true }`) ;
  `@resumeautomode` le reprend. Le **mode choisi par le joueur ne change pas** : s'il avait
  activé « auto », il le retrouve à la reprise, et le badge affiche `AUTO ⏸` pendant la
  suspension. La suspension est aussi levée à la fin du script. `@cancelautomode`, qui
  annule le mode lui-même, n'est pas traité ici.
- Les deux états font partie de l'état sauvegardé (`quickMenuLocked`, `autoModePaused`) ;
  une ancienne sauvegarde sans ces champs se restaure déverrouillée. Les événements ne
  comptent pas comme du contenu visible : une pause `[l]` qui ne suit qu'eux reste « morte ».
- Pas d'effet sur le déroulement du script, qui ne s'arrête sur aucune de ces commandes.

### Fenêtre de message : cadre image du jeu (#173)

Le jeu d'origine ne dessine pas de boîte : `@position frame=txtwindowNN` pose une image
1024×576 sur toute la scène (voile noir fondu sur les côtés, ornements en arabesque en haut
et en bas) et le texte s'écrit par-dessus. L'image vient des assets de l'utilisateur, jamais
du dépôt. Mesures sur une capture du jeu (1920×1080, `1-2.ks`, cadre `txtwindow02`) ramenées
au repère 1024×576 :

- bord gauche du texte à 268/1920 (14 %), bord droit retenu à 91 % (la coupure des lignes
  tombe entre 89 % et 93 %) ;
- première ligne centrée à 126/1080, interligne 77/1080 : haut de la zone à 8,1 % ; bas pris
  symétrique du haut (hypothèse, le bas n'est pas visible sur la capture) ;
- police nominale `1,7 rem`, interligne `1,5`, interlettrage `0,06 em`, ombre portée pour la
  lisibilité (#182). Ces valeurs sont dans le repère du stage (1024×576, agrandi de 1,25) : à
  l'écran à 1280×720, corps 34 px et interligne 51 px, soit les ≈ 34 px / 51 px mesurés sur le jeu
  (77/1080 d'interligne) ; avant #182, 1,6 rem / 1,6 donnait 32 px / 51 px ;
- après un clic sur une attente `[l]`, le texte déjà affiché de la page reste visible à 40 %
  d'opacité jusqu'au changement de page ;
- indicateur d'attente : bandes animées `linebreak_a` (feuille, 40 vignettes de 24 px) et
  `pagebreak_a` (livre, 40 vignettes de 32 px), posées à la suite du dernier caractère ;
  glyphes `▽`/`▼` si l'asset manque. L'indicateur est **hors du flux**, centré sur la boîte
  du dernier caractère : il n'élargit pas la ligne et ne peut pas la faire passer à la ligne
  suivante (#175).

Sémantique retenue (`src/renderer/text-frame.ts`, fonctions pures) :

- `@position frame=…` conserve le nom de l'image dans l'état (`textbox.frameImage`), donc dans
  les sauvegardes ; une sauvegarde antérieure sans ce champ reste valide.
- `@invisibleframe` masque le cadre mais garde l'image choisie ; `@visibleframe` le réaffiche.
  `frame=""` laisse le texte seul sur la scène.
- Tant qu'aucun script n'a posé de cadre, le renderer applique `txtwindow02` : hypothèse (le
  défaut réel est fixé hors des scripts, dans les fichiers système absents), c'est le cadre le
  plus employé du corpus et celui de la capture.
- Si l'image de cadre ne charge pas (asset absent), repli sur l'ancienne boîte fixe décrite
  ci-dessous, pour que le texte reste lisible.
- Le réglage d'opacité de la boîte (0,8 par défaut) rend d'abord l'image telle quelle (son
  voile est déjà dans son alpha) ; en dessous, il l'éclaircit proportionnellement.
- `fontScale`, masquage utilisateur, `@textoff`/`@texton`, recul et chargement s'appliquent ;
  une page restaurée s'affiche en entier, sans atténuation (la sauvegarde ne conserve pas la
  limite de lecture).

Vérifié le 2026-11-08 dans Chromium 1280×720 avec les assets réels : le cadre `txtwindow02`
couvre la scène, le texte commence à 14 % / 8,1 % (mesuré au DOM), l'attente `[l]` affiche
`linebreak_a`, le clic passe le texte déjà lu à 40 % et la fin de page affiche `pagebreak_a`.
La superposition exacte à la capture d'origine reste à confirmer quand elle sera jointe à
l'issue ; seules ses mesures chiffrées ont servi de référence.

### Ancienne boîte fixe (#161, #163), repli

Quand l'image de cadre manque, la fenêtre reprend la boîte fixe du port : ancrée à 5 % du bas
de la scène (repère 1024x576), marges de 10 % à gauche et à droite. Les scripts posent des
calques décoratifs dans la bande basse (carte du titre de chapitre `ch01タイトル`, sprite plein
écran dont les pixels opaques vont de y 445 à 537 sur 576, soit 77 % à 93 % de la hauteur) :
leur position vient du script et n'est pas modifiée.

Règle retenue (`src/renderer/text-fit.ts`, fonction pure `fitTextBox`, appliquée par le renderer
sur la **page entière** avant la frappe, donc sans changement de taille en cours de texte) :

- **La boîte ne bouge jamais** : même position (bas à 5 %), même hauteur (`boxHeightRatio` = 47 %
  de la hauteur de scène, soit 270 sur 576, la place de 6 lignes à la taille nominale), à toutes
  les pages. Le texte est aligné en haut de la boîte. Depuis #163 plus aucune remontée ni
  glissement sur `bottom` : la remontée de #161 faisait sauter la boîte d'une page à l'autre.
- Une page qui tient dans la boîte garde la taille nominale (`1,5 rem` multiplié par `fontScale`).
- Une page plus longue réduit la police par pas de 5 %, jusqu'à 70 % de la taille nominale
  (`fontScale` reste respecté : le plancher est relatif à la taille réglée). La plus grande
  échelle qui tient est retenue (`data-text-fit="shrunk"` sur `#textbox`).
- En dessous du plancher, la zone de texte défile (`overflow-y: auto`, `data-text-fit="overflow"`).
- Limite : la règle ne connaît pas les calques. Un texte qui descend dans la bande basse (à
  partir de 6 lignes, ou de 5 avec une police agrandie) peut recouvrir la carte du titre ;
  voir B16 dans `BUGS_PROLOGUE.md` pour la mesure.

## 7. Attentes (`@wt` / `@wact` / `@wm` / `nowait`)

- `@trans nowait=0` (ou absent) : **bloquant** → le runtime émet
  `waitFor("transition")`.
- `@trans nowait=1` : **non bloquant** → le texte qui suit s'affiche pendant le
  fondu.
- `@wt` → `waitFor("transition")`.
- `@wact` → `waitFor("animation")` ; sans cible → attend **toutes** les actions
  finies.
- `@wm` → `waitFor("quake")`.
- `canskip=0` : non skippable (`wait` avec `skippable: false`). Aujourd'hui
  ignoré.
- `@stoptrans` : termine la transition en cours (nouvel événement
  `finishTransition`).

## 8. Effets

- `@noise monocro=1 opacity=60 type=ltPsScreen` : bruit animé + niveaux de gris
  + mode de fusion `screen`.
- `@stopnoise` : arrête le bruit (sinon il ne s'arrête jamais).
- `@stopaction` : arrête toutes les animations de calques (fige la valeur
  courante : `commitStyles` puis `cancel`).
- Un seul slot `effect` est insuffisant : `@stophaze` couperait aussi `noise`.
  Garder des slots séparés.

## 9. Audio

- `@play delay=1000 storage=m19 volume=100` : BGM avec délai de démarrage.
- `@playstop time=10000 nowait=1` : arrêt fondu sur 10 s, non bloquant.
- `@fadebgm time=5000 volume=100` : fondu vers le volume cible (et **non** vers
  0). `volume=0` = fondu silencieux.
- `@se loop=1` : SE en boucle (aujourd'hui ignoré).
- `@se delay=2000 …` : délai de démarrage.
- `@sestop time=5000 nowait=1` : arrêt fondu des SE.
- L'audio d'un step part **avant** le visuel ; un `@se` placé après un
  `@trans` bloquant sort trop tôt. À adresser avec les transitions non
  bloquantes.

## 9 bis. Triage des commandes KAG restantes (#276)

État au triage : `npm run audit` (vrais assets, 221 scripts narratifs) signalait **51 commandes
distinctes / 181 occurrences** ; les commandes standard `@s`, `@endif`, `@image`, `@ruby` ont été
traitées par #277. Chaque commande ci-dessous a été vérifiée dans les **scripts, les macros et les
TJS du moteur installé** (`data/scenario/*.tjs`, `data/override/*.tjs`) — l'origine et l'effet ne
sont pas déduits du nom.

**Après intégration du registre #275** : les 2 no-ops justifiés ci-dessous (`@autocache`,
`@deffont`) sont **déclarés dans `tools/ignored-commands.ts`**. Les lots **#286 (crédits de fin)** et
**#285 (audio et déroulement)** sont implémentés : `@wstaffroll`, `@staffrolluninit`,
`@staffrollsetting`, `@xchgbgm`, `@wb`, `@clickskip`, `@cancelskip`, `@effectskip` ne sont plus des
inconnues. La baseline est passée à **29 commandes inconnues / 58 occurrences**
(`npm run audit:baseline` — script supprimé depuis la clôture #302, les chiffres cités sont
historiques ; `npm run audit:guard -- --strict` OK). Légende :

- **Origine** : `KAG3` = standard KAG3 (documentation des tags), `plugin TJS` = tag de plugin
  (`data/scenario/*.tjs`), `macro Mahoyo` = macro définie par `@macro` d'un script système,
  `macro plugin` = macro enregistrée par un plugin TJS (`kag.conductor.macros`), `override` =
  extension TYPE-MOON de `data/override/*.tjs`.
- **Effet réel** : `aucun` | `déroulement` | `texte` | `image` | `audio` | `ui` | `effets`.
- **Décision** : *implémenter* | *approximer* (écart documenté) | *no-op justifié* (aucun effet,
  déclaré dans le registre #275 avec `effet: "aucun"` ; un accord explicite est requis pour tout
  effet non nul, interdit par la DoD).

### Lots de suivi (issues créées depuis ce triage)

| Lot | Issue | Commandes | Occ. |
|---|---|---|---|
| Commandes visuelles secondaires | #85 | `chgpartbg`, `dispclock`, `tickclock`, `setdefaultmessageaction`, `resetdefaultmessageaction` | 75 |
| Commandes KAG restantes | #86 | `cm`, `cm4pg` (`@s` traité par #277) | 15 |
| Effets d'écran plugin | #281 | `shake`, `swing`, `stopswing`, `noiseact`, `focusline`, `stopfocusline`, `clearfocusline` | 22 |
| Actions et effets de scène plugin | #282 | `beginfallnote`, `fallnoteopt`, `endfallnote`, `action`, `removeaction`, `pauseaction`, `resumeaction`, `pauseploy`, `resumeploy` | 12 |
| Calques image | #283 | `infg`, `outfg`, `layopt`, `bindbg`, `autocache` | 13 |
| Texte et options message | #284 | `heart`, `ageage`, `ansz`, `ingz`, `eywz`, `swel`, `cockrobin`, `endcockrobin`, `current`, `deffont`, `store` | 16 |
| Audio et déroulement | #285 | `xchgbgm`, `wb`, `clickskip`, `cancelskip`, `effectskip` | 13 |
| Crédits de fin | #286 | `wstaffroll`, `staffrolluninit`, `staffrollsetting` | 6 |
| Tracer et timeline | #287 | `settracerreturn`, `startchart`, `playtimeline`, `loadtimeline` | 5 |

### Tableau de décision (51 commandes)

| Commande | Occ. | Origine | Effet réel (vérifié) | Décision | Issue |
|---|---|---|---|---|---|
| `@chgpartbg` | 22 | plugin TJS (`partbgplugin.tjs`, `kt.chgpartbg`) | image : remplace l'image d'un partbg avec transition | implémenter | #85 |
| `@dispclock` | 20 | plugin TJS (`macro.tjs`, `tagHandlers.dispclock`) | image : horloge (fond + aiguilles par calques) | implémenter | #85 |
| `@tickclock` | 11 | plugin TJS (`macro.tjs`, `tagHandlers.tickclock`) | image : avance les aiguilles de l'horloge | implémenter | #85 |
| `@setdefaultmessageaction` | 11 | override TYPE-MOON (`tagex.tjs`) | texte : action continue des messages suivants | implémenter | #85 |
| `@resetdefaultmessageaction` | 11 | override TYPE-MOON (`tagex.tjs`) | texte : réinitialise cette action continue | implémenter | #85 |
| `@cm` | 8 | KAG3 | texte : vide tous les calques de message | implémenté (voir §9 octies) | #86 |
| `@cm4pg` | 7 | override TYPE-MOON (`tagex.tjs`) | texte : `cm` au changement de page (+ copie d'état) | implémenté (voir §9 octies) | #86 |
| `@shake` | 4 | override TYPE-MOON (`tagex.tjs`, `.shake`) | effets : secousse d'écran | implémenter | #281 |
| `@swing` | 1 | override TYPE-MOON (`tagex.tjs`, `.swing`) | effets : secousse aléatoire continue | implémenter | #281 |
| `@stopswing` | 6 | override TYPE-MOON (`tagex.tjs`, `.stopswing`) | effets : arrêt de la secousse | implémenter | #281 |
| `@noiseact` | 7 | plugin TJS (`noiseplugin.tjs`, `kt.noiseact`) | effets : animation des propriétés du bruit | implémenter | #281 |
| `@focusline` | 1 | plugin TJS (`focuslineplugin.tjs`) | effets : lignes de concentration | approximer (rendu dédié) | #281 |
| `@stopfocusline` | 2 | plugin TJS (`focuslineplugin.tjs`) | effets : arrêt des lignes de concentration | approximer | #281 |
| `@clearfocusline` | 1 | plugin TJS (`focuslineplugin.tjs`) | effets : purge des couches de concentration | approximer | #281 |
| `@beginfallnote` | 1 | plugin TJS (`fallnoteplugin.tjs`) | effets : chute d'objets | approximer (particules) | #282 |
| `@fallnoteopt` | 2 | plugin TJS (`fallnoteplugin.tjs`) | effets : densité de la chute | approximer | #282 |
| `@endfallnote` | 1 | plugin TJS (`fallnoteplugin.tjs`) | effets : fin de la chute | approximer | #282 |
| `@action` | 1 | plugin TJS (`keyframeactionplugin.tjs` / `actionmanager.tjs`) | effets : action animée par module sur un calque | implémenter | #282 |
| `@removeaction` | 3 | override TYPE-MOON (`tagex.tjs`) | effets : détruit les actions en gardant l'état courant | implémenter | #282 |
| `@pauseaction` | 1 | override TYPE-MOON (`tagex.tjs`) | effets : met les actions en pause | implémenter | #282 |
| `@resumeaction` | 1 | override TYPE-MOON (`tagex.tjs`) | effets : reprend les actions | implémenter | #282 |
| `@pauseploy` | 1 | override TYPE-MOON (`tagex.tjs`) | texte : suspend l'affichage bulle/ploy | implémenter | #282 |
| `@resumeploy` | 1 | override TYPE-MOON (`tagex.tjs`) | texte : rétablit l'affichage bulle/ploy | implémenter | #282 |
| `@infg` | 5 | plugin TJS (`fgplugin.tjs`, `kt.infg`) | image : apparition animée d'un calque | implémenter | #283 |
| `@outfg` | 3 | plugin TJS (`fgplugin.tjs`, `kt.outfg`) | image : disparition animée d'un calque | implémenter | #283 |
| `@layopt` | 1 | KAG3 | image : options de calque (visible/opacité/position) | implémenter | #283 |
| `@bindbg` | 3 | override TYPE-MOON (`tagex.tjs`, `.bindbg`) | image/effets : calques liés aux mouvements du fond | approximer | #283 |
| `@autocache` | 1 | override TYPE-MOON (`tagex.tjs`, `.autocache`) | **aucun** (préchargement d'images avant attente) | no-op justifié — **déclaré au registre #275** (`effet: "aucun"`) | #283 |
| `@heart` | 3 | macro plugin (`macro.tjs`, `exCharTags` → `[graph]`) | texte : image emoji dans le texte | implémenté (`[graph]`, voir §9 decies) | #284 |
| `@ageage` | 1 | macro plugin (`macro.tjs`) | texte : emoji | implémenté (`[graph]`, §9 decies) | #284 |
| `@ansz` | 1 | macro plugin (`macro.tjs`) | texte : emoji | implémenté (`[graph]`, §9 decies) | #284 |
| `@ingz` | 1 | macro plugin (`macro.tjs`) | texte : emoji | implémenté (`[graph]`, §9 decies) | #284 |
| `@eywz` | 1 | macro plugin (`macro.tjs`) | texte : emoji | implémenté (`[graph]`, §9 decies) | #284 |
| `@swel` | 3 | macro plugin (`macro.tjs`) | texte : emoji | implémenté (`[graph]`, §9 decies) | #284 |
| `@cockrobin` | 1 | macro plugin (`robinserifplugin.tjs`) | texte/ui : encadrement conditionnel d'une réplique | approximé (bloc masqué par défaut, §9 decies) | #284 |
| `@endcockrobin` | 1 | macro plugin (`robinserifplugin.tjs`) | texte/ui : fin de cet encadrement | approximé (bloc masqué par défaut, §9 decies) | #284 |
| `@current` | 1 | KAG3 | texte : sélection de la couche message (`message0`/`message1`) | implémenté (état `messageLayer`, §9 decies) | #284 |
| `@deffont` | 6 | KAG3 | **aucun ici** : seul `face=user` est utilisé, le port n'expose pas de police utilisateur et `@resetfont` retombe sur la police du thème | no-op justifié — **déclaré au registre #275** (`effet: "aucun"`) | #284 |
| `@store` | 1 | KAG3 | ui : active/désactive sauvegarde et chargement | implémenté (`saveLoadEnabled` + HUD, §9 decies) | #284 |
| `@xchgbgm` | 7 | KAG3 | audio : fondu croisé de BGM | implémenter | #285 |
| `@wb` | 1 | KAG3 | audio/déroulement : attente de fin de fondu BGM | implémenter | #285 |
| `@clickskip` | 2 | KAG3 | déroulement/ui : active/désactive le skip au clic | implémenter | #285 |
| `@cancelskip` | 1 | KAG3 | déroulement : annule l'état de skip courant | implémenter | #285 |
| `@effectskip` | 2 | override TYPE-MOON (`tagex.tjs`) | déroulement/ui : autorise/interdit le skip des effets | implémenter | #285 |
| `@wstaffroll` | 2 | plugin TJS (`staffrollplugin.tjs`, `kt.wstaffroll`) | déroulement : attente de la fin du générique | implémenter | #286 |
| `@staffrolluninit` | 3 | plugin TJS (`staffrollplugin.tjs`) | ui : termine/libère l'affichage des crédits | implémenter | #286 |
| `@staffrollsetting` | 1 | plugin TJS (`staffrollplugin.tjs`) | ui : couleur de fond des crédits | implémenter | #286 |
| `@settracerreturn` | 2 | macro Mahoyo (`tracerplugin.ks`) | ui : cible de retour du flowchart | no-op justifié (sp2.ks non chargé, voir §9 duodecies) | #287 |
| `@startchart` | 1 | macro Mahoyo (`tracerplugin.ks`) | ui : démarre le flowchart | no-op justifié (carte .gc non modélisée, §9 duodecies) | #287 |
| `@playtimeline` | 1 | plugin TJS (`timelineplugin.tjs`, usage de test `frame=0` sans `scene`) | effets : timeline ; l'occurrence brute est malformée | variante tolérée en no-op explicite (§9 duodecies) | #287 |
| `@loadtimeline` | 1 | macro plugin (`timelineplugin.tjs`) | effets : charge un `.tla` puis joue la timeline | no-op justifié (.tla non convertis, §9 duodecies) | #287 |

**Bilan des décisions** : 37 à implémenter, 11 à approximer (écart documenté), 1 variante
malformée à tolérer (`@playtimeline` de test), **5 no-ops justifiés sans effet intégrés au registre
#275** (`@autocache` → #283, `@deffont` → #284, `@settracerreturn`/`@startchart`/`@loadtimeline` →
#287). Aucune commande à effet
visible/audible/de déroulement n'est classée no-op.

**Suivi des lots** : #281 (effets d'écran plugin, §9 quater), #285 (audio/déroulement,
§9 quinquies), #286 (crédits de fin, §9 ter), #283 (calques image, §9 sexies) et #85
(commandes visuelles secondaires, §9 septies) sont traités : la baseline est passée à
**25 commandes inconnues / 46 occurrences** (`npm run audit:baseline` ; `npm run audit:guard
-- --strict` OK). #86 (commandes de texte restantes) est traité — voir §9 octies ; la baseline
passe à **23 commandes / 31 occurrences**. #295 (garde-fous de clôture DoD, §9 nonies) est traité
**sans changement de baseline** (delta 0 commande / 0 occurrence : aucune commande implémentée par ce
lot). #284 (texte et options message) est traité — voir §9 decies ; la baseline passe à
**13 commandes / 17 occurrences**. #282 (actions/effets de scène) est traité — voir §9 undecies ;
la baseline passe à **4 commandes / 5 occurrences**. **#287 (tracer/timeline) est traité — voir
§9 duodecies ; la baseline passe à 0 commande / 0 occurrence**. Tous les lots du triage #276 sont
clos ; la clôture v1.0 (#302, §9 terdecies) passe en **mode zéro strict** : baseline **vide**
(métadonnées seules), plus de `npm run audit:baseline`, toute inconnue fait échouer le garde-fou.

## 9 ter. Crédits de fin (`@staffroll*`) — #286

Le générique de fin (`staffroll.ks`, fin de `wik_fin.ks`, `d-8.ks`) utilise six commandes ; quatre
étaient déjà lues (`@staffrollinit`, `@staffrolltext`, `@staffrollstart`), les trois autres sont
implémentées ici. Sémantique vérifiée dans `data/scenario/staffrollplugin.tjs` :

| Commande | Sémantique moteur | Implémentation port |
|---|---|---|
| `@staffrollinit` | initialise le générique (police par défaut) | état `staffroll` réinitialisé, overlay retiré |
| `@staffrolltext … y=…` | ajoute une ligne à `currentPos += y` (position cumulée) | lignes positionnées à la somme cumulée des `y` ; couleur = style `@font` courant |
| `@staffrollstart height time` | défilement linéaire de `height` px en `time` ms | animation WAAPI de `translateY(0 → -height)` sur `time` ms |
| `@wstaffroll` | attend la fin du défilement (`waittrig`, **canskip forcé à false**) | point d'arrêt `waitFor: "staffroll"` **non skippable** ; la durée du générique (≈ 160 s) est donc respectée |
| `@staffrolluninit` | termine/libère l'affichage | overlay retiré, attente en cours résolue, état effacé |
| `@staffrollsetting bgcolor=…` | le plugin **stocke** la couleur mais ne la peint jamais (aucun `fillRect` avec `bgcolor`) | valeur conservée dans l'état de sauvegarde, **aucun effet visuel** (fidèle au moteur ; `d-8.ks` passe `0xFF000000`) |

- Le fond du générique est celui de la scène (les scripts posent `@bg`/`@image` avant) ; l'overlay
  est au-dessus des calques et de la boîte de texte (`z-index: 2000000`, comme
  `absolute=2000000-5` du plugin).
- Un seul overlay à la fois : les ~800 `@staffrolltext` du corpus arrivent avant `@staffrollstart`
  et ne créent pas d'élément supplémentaire (avant #286, un overlay était créé par événement).
- `@staffrollappearimage` (images apparaissant pendant le défilement) n'est utilisé par aucun
  script du corpus.

## 9 quater. Effets d'écran plugin — implémentation (#281)

Traitement du lot « effets d'écran plugin » du triage #276 (22 occurrences) : les 7 commandes
sortent de la baseline des inconnues, qui passe de **46 commandes / 168 occurrences** (après
#286) à **39 / 146** (`npm run audit:baseline` ; `npm run audit:guard -- --strict` OK). Sémantique lue
dans les sources du moteur installé (`data/override/tagex.tjs`, `data/scenario/noiseplugin.tjs`,
`data/scenario/focuslineplugin.tjs`) et args réels des scripts (`8.5.ks`, `1.5-4.ks`, `nz3.ks`,
`wik_x-2.ks`, `wik_q-a.ks`, `call.ks`).

| Commande | Statut | Rendu |
|---|---|---|
| `@shake` | implémenté (approximation écran entier) | oscillation sinusoïdale de la scène : `vmax`/`hmax` en px, `cycle` en ms, `time` optionnel (absent = continue) |
| `@swing` | implémenté (approximation écran entier) | oscillation aléatoire continue : cycle tiré dans `[mincycle, maxcycle]`, vibration dans `[minvibration, maxvibration]`, `rate` ; arrêt par `@stopswing` |
| `@stopswing` | implémenté | arrêt de la secousse d'écran et restitution de la transformation |
| `@noiseact` | implémenté (approximation propriétés) | action `props=`/`keys=` sur les propriétés du bruit : `opacity`, `monocro`, `visible`, `status` ; fondu d'opacité si ≥ 2 valeurs distinctes |
| `@focusline` | approximé (rendu dédié) | canvas de lignes radiales : `cx`/`cy`, nombre `[lmin,lmax]`, longueur `[cmin,cmax]`, apparition `max(emin,emax)` ms, `color` (entier, `0x`, `#`) et `opacity` |
| `@stopfocusline` | approximé | retire l'effet (l'original masque sans détruire les calques) |
| `@clearfocusline` | approximé | retire l'effet et libère le canvas |

### Écarts documentés

- **Secousses** : `@shake`/`@swing` visent un calque (`storage=`, `page=`) dans le moteur ; le port
  applique l'oscillation à la **scène entière** (`@quake` utilise déjà cette transformation). Les
  attributs `storage`, `page`, `actmode` (shake) et `force` sont **ignorés**. Une seule secousse à
  la fois : un `@quake`, `@shake` ou `@swing` remplace l'effet précédent. Non persisté dans les
  sauvegardes (comme `@quake`). `time` absent = secousse continue jusqu'à `@stopswing`, changement
  de secousse ou fin de session. Désactivé par le réglage « effets spéciaux » et par
  `prefers-reduced-motion` (aucun mouvement agressif).
- **`@noiseact`** : seules les propriétés du bruit du port sont rendues (`opacity`, `monocro`,
  `visible`, `status`). `absolute` et `type` sont parsés puis ignorés (le bruit est une surcouche
  CSS plein écran, sans composition de calques). Les propriétés discrètes s'appliquent
  instantanément ; le fondu n'est joué que si l'opacité change réellement entre keyframes (le
  corpus réel répète la même valeur par carry). `status=stop` ou `visible=0` retire le bruit,
  comme `@stopnoise`.
- **`@focusline`** : rendu **approxé** en canvas (aucun `layerExYADraw` dans le navigateur) :
  lignes radiales autour de (`cx`, `cy`), longueurs/nombre tirés aléatoirement dans les bornes,
  fondu d'apparition puis figement. `page`, `absolute`, `interval` et `time` sont ignorés
  (l'overlay couvre la scène) ; `cmin > cmax` (corpus) est normalisé par ordre. Sous
  `prefers-reduced-motion`, lignes affichées sans fondu. `@stopfocusline` et `@clearfocusline`
  ont le même effet net dans le port (retrait de l'overlay), alors que l'original distingue
  masquage et destruction des calques.
- **Un seul effet à la fois** : `noise`, `haze` et `focusline` partagent `SceneState.effect`
  (limitation antérieure du port) ; un nouvel effet remplace le précédent et `@stopnoise` retire
  aussi un éventuel `@focusline`.
- **Tests** : `tests/unit/kag/plugin-effects.test.ts` (parse + runtime des 7 commandes, args réels
  du corpus), `tests/unit/kag/action.test.ts` (`parseNoiseActKeys`), `tests/unit/renderer/plugin-effects.test.ts`
  (secousses, bruit animé, canvas `@focusline`, effets spéciaux et `prefers-reduced-motion`),
  `tests/unit/kag/stage-state.test.ts` (persistance du bruit animé).
- **Conflit #286** : les crédits (`wstaffroll`, `staffrolluninit`, `staffrollsetting`) restent hors
  de ce lot ; aucun refactor de `runtime.ts` au-delà des nouveaux cas de commandes.
## 9 quinquies. Audio et déroulement (`@xchgbgm`, `@wb`, skips) — #285

Sémantique vérifiée dans `data/system/bgm.tjs` (`exchange`, `waitBGMFade`),
`data/system/mainwindow.tjs` (`clickskip`, `cancelskip`) et `data/override/tagex.tjs`
(`effectskip`, `enableEffectSkip`).

### `@xchgbgm` — échange de BGM avec fondu croisé

- Moteur : l'ancienne piste est fondue sur `outtime` ; la nouvelle démarre immédiatement à
  volume 0 puis monte sur `intime`, le fondu entrant commençant après `outtime - overlap` ms
  (`overlap > 0` = vrai fondu croisé). `time` fixe `intime = outtime` ; `volume` règle le volume
  global BGM ; même `storage` que la piste en cours = aucun effet.
- Port : événements audio `stop` de l'ancienne (fondu `outtime`) puis `play` de la nouvelle
  (fondu `intime`, retard `outtime - overlap`). **Approximation documentée** : `volume` est
  appliqué comme volume de piste (le port n'a pas de volume global BGM scriptable distinct des
  réglages utilisateur). Le fondu entrant est donc audiblement proche du moteur.

### `@wb` — attente de fin de fondu BGM

- Moteur : si aucun fondu en cours, retour immédiat ; sinon attente de l'événement de fin de
  fondu. `canskip` permet au clic d'arrêter le fondu ; par défaut l'attente n'est pas skippable.
- Port : point d'arrêt `waitFor: "bgmFade"` → `AudioPlayer.waitForFade("bgm")`, qui résout à la
  fin du fondu de sortie (`fadeOut`) ou de volume (`fade`). Implémentation dans
  `src/renderer/audio-manager.ts` (attentes de fondu par voix). **Approximation** : quand
  l'attente est skippable et que le joueur clique, seule l'attente est abandonnée (le fondu
  poursuit en arrière-plan) au lieu d'être stoppé net comme `bgm.stopFade()`.

### `@clickskip` / `@cancelskip` / `@effectskip`

- `@clickskip enabled=` (KAG3) : autorise/interdit le **saut au clic** (terminer la frappe,
  interrompre transitions/animations/timelines). `false` désactive ces coupures et neutralise le
  réglage « affichage instantané » pendant la portion concernée.
- `@cancelskip` (KAG3) : annule l'état de skip courant → le player repasse en lecture normale.
- `@effectskip enabled=` (override TYPE-MOON, `enableEffectSkip`) : autorise/interdit le saut des
  effets par réglage utilisateur (scènes de démonstration, OP). `false` neutralise
  « arrêt des animations en cours » et « affichage final des pages » pendant la portion.
- État du player : `clickSkipEnabled` / `effectSkipEnabled`, remis à `true` au début de chaque
  session (comme le moteur, ces réglages ne sont pas sauvegardés) ; événements
  `{kind:"skipSetting"}` et `{kind:"cancelSkip"}` appliqués par le player, sans effet sur la scène.

## 9 sexies. Calques image — implémentation (#283)

Traitement du lot « calques image » du triage #276 (`@infg` 5, `@outfg` 3, `@layopt` 1,
`@bindbg` 3 occurrences) : ces 4 commandes sortent de la baseline des inconnues, qui passe de
**34 commandes / 133 occurrences** (après #285) à **30 / 121**. `@autocache` était déjà un no-op justifié du
registre #275 (`effet: "aucun"`, issue #283) : un test unitaire vérifie qu'il reste classé ainsi.
Sémantique vérifiée dans `data/scenario/fgplugin.tjs` (`kt.infg`/`fg_object.infg`, `kt.outfg`/
`fg_object.outfg`), `data/override/tagex.tjs` (`.bindbg`, `.autocache`) et KAG3 (`mainwindow.tjs`,
`.layopt`).

| Commande | Statut | Rendu |
|---|---|---|
| `@infg` | implémenté (approximation page fore) | le calque est posé à (position finale − `mx`/`my`, opacité 0) puis animé vers sa position finale avec l'opacité demandée ; `time` défaut 300 ms, `accel` défaut 0, `mx` défaut 24, `my` défaut 0 ; `zoom`/`rotate`/`type`/`effect`/`blur`/`brightness`/`contrast`/`index` respectés |
| `@outfg` | implémenté | le calque courant glisse de (`mx`, `my`) et son opacité tombe à 0 en `time` ms (défaut 300) ; calque introuvable : avertissement, aucun événement |
| `@layopt` | implémenté (approximation) | `center`/`vcenter`, `opacity` (0–255) et `visible` sur un calque existant (`id=`/`storage=`) ; `left`/`top` approximés en `center`/`vcenter` |
| `@bindbg` | approximé (écart documenté) | drapeau `SceneState.bindChildren` : pendant un panoramique du fond (`bgMove`), les sprites sont translatés du même delta (propriété CSS `translate`, animée en WAAPI si possible), sans modifier les positions logiques sauvegardées ; réinitialisé quand un nouveau fond rebase la scène |
| `@autocache` | no-op justifié (#275) | préchargement seulement, aucun effet visible/audible/de déroulement — déjà déclaré au registre, testé |

### Écarts documentés

- **`@infg`/`@outfg`** : le moteur passe par la page `back` et un `@trans` ; le port pose et anime
  directement la page affichée (`fore`), ce qui rend l'effet visible sans transition. Comme les
  autres animations du port, elles ne bloquent pas le déroulement (`@wact`/`nowait` non requis).
  Le calque `@outfg` n'est pas détruit (son opacité tombe à 0) : un `@clfg`/`@clall` le retire,
  comme dans le moteur.
- **`@layopt`** : `left`/`top` sont lus comme `center`/`vcenter` (le port ne modélise pas le coin
  haut-gauche d'un calque). Les calques de **message** (`layer=message0`/`message1`, utilisés par
  les macros système `macro.ks`) ne sont pas modélisés : la commande est un no-op pour eux, la
  textbox restant pilotée par `@texton`/`@textoff`. L'unique occurrence du corpus narratif
  (`wik_k.ks`, `page=back id=pb1 center=516`) est couverte.
- **`@bindbg`** : le décalage est **visuel et transitoire** — les positions logiques d'une
  sauvegarde ne changent pas, et le décalage n'est pas persisté (comme `@bgact`, dont le
  panoramique n'est pas rejoué par le port : dans le corpus 6-6.ks, le suivi est donc latent tant
  que le panoramique n'est pas rendu). `page=` n'est pas distingué : le drapeau s'applique aux deux
  pages pour qu'un `enabled=0` ultérieur coupe bien le suivi.
- **Tests** : `tests/unit/kag/layers-image.test.ts` (parse + runtime des 5 commandes, args réels,
  animation `@infg`/`@outfg`, état `@layopt`, drapeau `@bindbg`, no-op `@autocache`),
  `tests/unit/renderer/layers-image.test.ts` (suivi du fond, réinitialisation au changement de fond,
  visibilité `@layopt`).
- **Coordination #285** (audio/déroulement) : aucun chevauchement de fichiers hors `parser.ts`/
  `runtime.ts` (ajouts localisés : instructions + `applyInfg`/`applyOutfg`/`applyLayopt`/`@bindbg`).
## 9 septies. Commandes visuelles secondaires (#85)

Traitement du lot #85 (75 occurrences) : `@chgpartbg`, `@dispclock`, `@tickclock`,
`@setdefaultmessageaction`, `@resetdefaultmessageaction`. Sémantique lue dans
`data/scenario/partbgplugin.tjs`, `data/scenario/macro.tjs` et `data/override/tagex.tjs`.

### `@chgpartbg` (22)

- Moteur : change l'image/les paramètres d'un partbg **existant**. Cible : `id=` si fourni, sinon
  l'unique partbg de la page, sinon celui dont le `storage` partage le plus long préfixe avec le
  nouveau ; aucune cible = no-op. `time=`/`rule=` déclenchent la transition (`doTrans`).
- Port : mise à jour du calque ciblé (storage, zoom/rotation/pivot, apparence `blur`/`effect`/…),
  puis transition implicite back→fore si `time` ou `rule` (sinon rien sur back, scène immédiate sur
  fore). Le `bgstorage` et le crop du partbg sont conservés.

### `@dispclock` / `@tickclock` (20 + 11)

- Moteur (`macro.tjs`) : `@dispclock` pose 4 calques d'aiguilles sur la page arrière — 2 vraies
  (`短針x2` index 1200, `長針x2` index 1300) et 2 ombres (`effect=mono000000`, `blur=2`,
  `opacity=64`, index 1000/1100), pivot `afx/afy`, zoom, rotation calculée depuis `h`/`m` — puis
  charge le fond `im03lロビー時計(x2)` (`noclear=1`, `left`/`top`, `zoom`, `time` = transition).
  `@tickclock` anime les 4 aiguilles en 300 ms (repos → léger dépassement à 100 ms → nouvel
  angle) et attend la fin des animations par défaut.
- Port : traduit ces commandes en primitives existantes (calques `fg` + `@bg` avec transition
  implicite, puis animations `fgact` 3 keyframes). Les angles du moteur (sens anti-horaire) sont
  convertis en **degrés CSS horaires** ; le miroir (`zoomx < 0`) inverse les angles. Le pivot
  `afx`/`afy` est désormais supporté par les calques (`transform-origin` du sprite) et conservé
  pendant les animations.
- **Validation visuelle** (captures locales) : horloge centrée à 3:00, 6:55 et 9:15 — aiguilles
  dans les directions attendues ; `@tickclock` 3:00→6:55 donne bien 207,5° / 330°.
- Écarts : l'heure est suivie dans le runtime (`clockHour`/`clockMinute`, sauvegardés) mais pas
  dans les variables `f.lastHour`/`f.lastMinute` du moteur ; `textoff`/`texton` des commandes
  d'horloge ne sont pas interprétés (le port ne masque pas la boîte pour l'horloge).

### `@setdefaultmessageaction` / `@resetdefaultmessageaction` (11 + 11)

- Moteur (`tagex.tjs`) : règle/reinitialise le `continuousType` du message layer — une **action
  continue appliquée aux caractères** affichés (`swing` = oscillation, `chgfont`, etc.).
  La valeur est sauvegardée avec le message layer.
- Port : `type=` est stocké dans `TextboxState.action` (sauvegardé, événement `textbox` à chaque
  changement). Le renderer approxime l'action `swing` par une animation CSS par caractère
  (oscillation 2,2 s, délai décalé), désactivée par `prefers-reduced-motion`. Les autres types
  (`chgfont`, etc.) sont conservés dans l'état mais **non rendus** (aucune occurrence dans le
  corpus).
- Écarts : animation par caractère approximée côté CSS (le moteur anime les couches de glyphes) ;
  rayon/amplitude non paramétrables par script.

## 9 octies. Commandes de texte restantes — `@cm`/`@cm4pg` (#86)

L'issue #86 (issue d'audit ancienne, #82) listait `@cm`, `@cm4pg`, `@s`, `@emb`, `@waittrig`,
`@history`. Seules **`@cm` (8 occurrences)** et **`@cm4pg` (7)** restaient inconnues du corpus
narratif ; elles sortent de la baseline, qui passe de **25 commandes / 46 occurrences** (après
#85) à **23 commandes / 31 occurrences**. Les autres entrées de l'issue sont périmées ou hors corpus (voir ci-dessous).

| Commande | Statut | Détail |
|---|---|---|
| `@cm` | **implémenté** | vide la fenêtre de texte : le runtime émet un `clearText` **explicite** (`force: true`), qui s'applique même quand le réglage « Effacement du texte au changement de page » (#177) est désactivé. Le texte persistant (`reduceStage`) et la frappe en cours (`typedUnits`/`readUnits`) sont réinitialisés ; style, position et visibilité de la textbox sont conservés (comme le moteur : `cm` ne touche pas à `@font`/`@position`). |
| `@cm4pg` | **implémenté** | `tagex.tjs` : `cm4pg` appelle `cm` puis `originalStoreFlags()` — copie de drapeaux internes de cache de lecture, **sans effet visible**. Rendu identique à `@cm` dans le port (le titre « clear message for page » de l'issue est trompeur : il ne s'agit pas d'un changement de page). |
| `@s` | déjà implémenté (#277) | arrêt du déroulement avec attente de clic (les boutons de click-map ne sont pas modélisés). Aucun travail dans ce lot. |
| `@emb` | **absent du corpus** | 0 occurrence dans les 221 scripts narratifs comme dans les scripts système fournis : aucune inconnue d'audit, non implémenté. Sémantique moteur (évaluation d'expression TJS insérée dans le texte) à traiter si un script l'utilise un jour. |
| `@waittrig` | **hors corpus narratif** | uniquement dans des scripts système exclus de l'audit (`call.ks`, `first.ks`, `teatime.ks`, `tracerplugin.ks`) : attente d'un signal de trigger. Non implémenté ; sans impact sur la DoD (corpus narratif). |
| `@history` | **hors corpus narratif** | idem (`call.ks`, `first.ks`, `teatime.ks`) : active/désactive l'ajout au backlog système. Non implémenté ; le backlog du port est indépendant de cette commande. |

### Cohérence `textoff`/`texton` avec `@cm`/`@cm4pg`

- `@cm`/`@cm4pg` vident le texte **sans toucher à la visibilité de la boîte** : si `@textoff` l'a
  masquée, elle reste masquée (`textbox.visible=false` conservé dans l'état de sauvegarde) ;
  `@cm` n'émet aucun événement `textbox` de réaffichage. La règle « le prochain texte ré-affiche la
  boîte » reste celle de `revealTextboxForText` (#159) : un `textbox visible=true` (fondu 300 ms)
  précède le texte suivant, donc l'état `textoff` est bien consommé par le texte qui doit
  s'afficher. `@texton` explicite fonctionne aussi (boîte ré-affichée, texte vide).
- Cas couverts par les tests : `@textoff` + `@cm` (aucun réaffichage, état sauvegardé invisible),
  texte suivant (réapparition avant le texte, fondu 300 ms), `@cm4pg` + `@texton`, rendu DOM
  (opacité 0 conservée après le vidage, puis 1 avec le texte suivant).
- **Aucun écart résiduel** : la cohérence était déjà assurée par la séparation
  `clearText` (contenu) / `textbox` (visibilité) ; ce lot l'a rendue explicite par des tests et
  par le drapeau `force` (le réglage #177 ne s'applique pas à `@cm`).

### E2e (1 seul, protocole Lead)

`tests/e2e/text-clear.spec.ts` : la première page de test du prologue placeholders affiche un
marqueur, `@cm` vide la page, `@s` marque un point d'arrêt ; le test vérifie que le texte de la
page devient vide, que la boîte reste visible (opacité 1, pas d'état `textoff`), puis qu'un clic
passe à la page suivante. Le prologue placeholders insère cette page après les deux premières
pages « normales » (`pageBodies`/`pagesFor`, numérotation conservée) ; suite e2e Chromium
complète rejouée localement (75/75).

### Notes d'implémentation et tests

- `src/kag/parser.ts` : cas `cm`/`cm4pg` (aucun argument) ; `src/kag/types.ts` : instructions
  dédiées ; `src/kag/runtime.ts` : dispatch → `{ kind: "clearText", force: true }` ;
  `src/kag/events.ts` : `clearText.force` ; `src/renderer/stage-renderer.ts` : un `clearText`
  forcé ignore le réglage #177, un `clearText` implicite de début de page continue de le respecter.
- **Tests** : `tests/unit/kag/text-clear.test.ts` (parse, runtime `@cm`/`@cm4pg`, clearText
  implicite non forcé, état persisté) et `tests/unit/renderer/text-clear.test.ts` (effacement
  forcé malgré le réglage désactivé, respect du réglage pour les clearText implicites).
- **`.s`/`@emb`/`@waittrig`/`@history`** : voir le tableau ; aucun de ces cas n'ajoute d'inconnue
  à la baseline (absents du corpus narratif ou déjà implémentés).

## 9 nonies. Garde-fous de clôture DoD (#295)

La clôture « 0 commande inconnue à effet visible » (#274) doit être **vérifiable et non
maquillable**. Ce lot ajoute quatre garde-fous, branchés sur la CI, et tranche la décision
`f.lastHour`/`f.lastMinute`.

### 1. Invariant d'état persisté

`tests/unit/kag/state-invariant.test.ts` :

- **type-level** : tout champ de `RuntimeState` doit être **soit sérialisé** par
  `Runtime.getSaveData()`, **soit** déclaré dans une allowlist `transient` avec justification. Si
  un futur lot ajoute un champ sans déclaration, `Exclude<keyof RuntimeState, Serialized |
  Transient>` n'est plus `never` → `tsc` échoue.
- **runtime** : `getSaveData().state` produit exactement la liste sérialisée (ni omission, ni
  ajout silencieux). Les champs `transient` justifiés : `clickSkipEnabled`/`effectSkipEnabled`
  (état de fenêtre réinitialisé par `endSession`, comme le moteur qui ne les met pas en
  sauvegarde).
- **snapshot d'affichage** : `StageSnapshot` ne contient que `scene`, `textbox`, `text`,
  `staffroll` ; secousses/effets d'écran et animations restent transitoires (comme `@quake`).

### 2. Aller-retour sauvegarde/restauration

Même fichier : une scène riche (fond/calques/partbg, horloge, action de message, `@bindbg`,
crédits, audio + pause, effet, ploy, variables, macros) est exécutée, sauvegardée puis rechargée
dans un `Runtime` neuf ; `getSaveData()` rechargé est **identique** (comparaison d'état, pas de
capture d'écran), et un deuxième aller-retour est stable (idempotence). Cas non persistés
documentés : `@bindbg` (liaison visuelle transitoire), secousses/effets d'écran, animations.

### 3. Équivalence normal / skip / auto

`tests/unit/ui/player-mode-equivalence.test.ts` : une même séquence (texte, attentes
cliquables/minutées, `@wb` non skippable, fin) jouée en **normal**, **skip** et **auto** produit
la **même séquence d'événements appliqués** et le même état final (titre), sans blocage. Test
dédié : en mode skip, une attente `waitFor: "bgmFade"` **non skippable** bloque toujours le
joueur jusqu'à la fin du fondu (le skip ne contourne pas les attentes verrouillées).

### 4. Registre des approximations

`tools/approximations.ts` (+ `tools/approximations-baseline.json`, garde-fou
`tools/approximations-guard.ts`) : chaque approximation porte **4 éléments obligatoires** —
écart précis, issue de suivi v1.1 ([#296]), **test qui fige le comportement** (marqueur
`approx:<id>`), compteur versionné **non croissant**. `npm run approximations:check` échoue si un
élément manque ou si un compteur dépasse la baseline. Liste initiale (11 entrées), table :

| Id | Écart | Issue | Test figé |
|---|---|---|---|
| `message-actions-non-swing` | actions continues autres que `swing` non rendues | #296 | `tests/unit/renderer/secondary-commands.test.ts` |
| `xchgbgm-volume` | `volume=` traité comme volume de piste | #296 | `tests/unit/kag/runtime.test.ts` |
| `playtimeline-test-variant` | variante `frame=0` tolérée sans effet | #296 | `tests/unit/kag/playtimeline-variant.test.ts` |
| `staffrollsetting-bgcolor` | couleur stockée jamais peinte (paramètre mort moteur) | #296 | `tests/unit/kag/runtime.test.ts` |
| `focusline-canvas` | lignes radiales canvas approximées | #296 | `tests/unit/kag/plugin-effects.test.ts` |
| `shake-fullscreen` | secousse approximée à l'écran entier | #296 | `tests/unit/kag/plugin-effects.test.ts` |
| `bindbg-not-persisted` | liaison visuelle non persistée | #296 | `tests/unit/kag/layers-image.test.ts` |
| `infg-outfg-fore-page` | page fore directe sans transition | #296 | `tests/unit/kag/layers-image.test.ts` |
| `ruby-proportional` | répartition du ruby proportionnelle | #296 | `tests/unit/kag/parser.test.ts` |
| `s-click-wait` | `@s` attend un clic simple | #296 | `tests/unit/kag/parser.test.ts` |
| `clock-runtime-vars` | heure en état runtime, pas en `f.lastHour/f.lastMinute` | #296 | `tests/unit/kag/clock-state.test.ts` |

### 5. CI de régénération / artefacts

Nouvelle étape CI `npm run check:generated` : `npm run audit:doc` (génère sans assets) puis
`git diff --exit-code -- docs/LECTURE_COMPLETE.md` (échec si la doc committée est périmée) puis
`npm run approximations:check`. `npm run audit:guard` reste la vérification statique
baseline↔registre. **Limite documentée** : la baseline réelle (221 scripts) ne peut pas être
régénérée en CI sans les assets utilisateur ; elle se régénère localement avec
`npm run audit:baseline` / `audit:doc` (vrais assets), le delta exact (commandes + occurrences)
est déclaré dans chaque PR et la CI vérifie statiquement qu'elle ne peut pas augmenter.

### 6. Décision `f.lastHour`/`f.lastMinute`

Vérifié : **aucun script narratif ne lit** `f.lastHour`/`f.lastMinute` (0 occurrence). Décision :
conserver l'heure dans l'état runtime (`clockHour`/`clockMinute`, sérialisés) et **documenter
l'écart en v1.1** (registre `clock-runtime-vars`, test figé `tests/unit/kag/clock-state.test.ts`,
issue [#296]) plutôt que dupliquer l'état dans les variables de jeu, ce qui imposerait une
migration de sauvegarde sans bénéfice joueur. Le bug `@dispclock time=0` (aiguilles sur back) est
suivi séparément en v1.1 (#297, 0 occurrence dans le corpus).

## 9 decies. Texte et options message — `[graph]`/emoji, `@cockrobin`, `@current`, `@store` (#284)

Traitement du lot « texte et options message » du triage #276 : les tags emoji (`@heart` 3,
`@swel` 3, `@ageage`/`@ansz`/`@ingz`/`@eywz` 1 chacun = 10 occurrences) et les commandes
`@cockrobin` 1, `@endcockrobin` 1, `@current` 1, `@store` 1 sortent des inconnues. Baseline :
**23 commandes / 31 occurrences → 13 / 17** (`npm run audit:baseline` ; `audit:guard -- --strict`
OK, 221 scripts, 0 erreur, 0 maxSteps). `@deffont` reste un no-op justifié du registre #275.

| Élément | Statut | Implémentation |
|---|---|---|
| `[graph storage=… alt=…]` | **implémenté** | segment de texte `{ graph: { storage, alt? } }` dans l'ordre du flux, rendu inline `<img class="mh-stage-graph">` (une unité de frappe), `src` résolu par l'`AssetResolver`, `alt` pour l'accessibilité et si l'image manque. Persisté dans les sauvegardes/`reduceStage`. |
| Emoji `@heart`, `@ageage`, `@ansz`, `@ingz`, `@eywz`, `@swel` | **implémenté** | macros `macro.tjs` (`exCharTags`) expansées en `[graph storage=<base>+fontSize alt="…"]` : `heart`/`(ハート)`, `アゲアゲ`/`↑`, `アンサズ`/`ANSZ`, `イングズ`/`INGZ`, `エイワズ`/`EYWZ`, `ソウェル`/`SWEL`. `fontSize` = style de texte courant (`@font size=`) sinon défaut moteur 26 (`config.tjs`), conforme aux assets réels (`heart24`, `heart26`, `アゲアゲ26`…). |
| `@cockrobin` / `@endcockrobin` | **approximé (documenté)** | macros `robinserifplugin.tjs` : le bloc est conditionné par `cf.visibileRobinSerifButton && cf.dispRobinSerif`, **tous deux `false` par défaut** → au comportement par défaut du moteur le bloc est **masqué**, et le port l'ignore jusqu'à `[endcockrobin]` (le `[endif]` orphelin de la macro reste toléré). Écart : pas de 2ᵉ couche de message (`message1`) ni de sprite `id=robin` ; si une configuration `cf.*` est ajoutée un jour, le bloc deviendra affichable. |
| `@current` | **implémenté (approximation)** | `layer=message0/1` → état `messageLayer: 0|1` persisté, `withback` mémorisé ; le port n'a qu'une textbox : aucun effet visuel propre. |
| `@store` | **implémenté** | `enabled` (défaut `true`) → état `saveLoadEnabled` persisté + événement `store` ; le HUD **désactive Sauvegarder/Charger** (menu système + boutons tactiles `qsave`/`qload`) avec libellé/toast dédiés (fr/ja/en), et `save()`/`load()`/ouverture des écrans sont refusés tant que `false`. Le verrou `@lockquickmenu` reste indépendant. |
| `@deffont` | **no-op justifié (inchangé)** | Seul `face=user` dans le corpus ; aucun réglage de police utilisateur (`@resetfont` retombe sur le thème) → registre #275 (`effet: "aucun"`, issue #284), toujours classé « ignorée volontairement » par l'audit. |

### Tests et e2e

- `tests/unit/kag/text-graph-emoji.test.ts` : `[graph]` inline, macros emoji (storage = base+taille,
  `alt`, taille 24/26), ordre du flux, absence de warning.
- `tests/unit/renderer/text-graph.test.ts` : image inline `<img.mh-stage-graph>`, `alt`, source,
  unité de frappe unique.
- `tests/unit/kag/text-cockrobin.test.ts` : bloc masqué par défaut, `[endif]` orphelin toléré,
  zéro inconnue.
- `tests/unit/kag/text-current-store.test.ts` : parse/état `@current` (messageLayer),
  `@store` (`saveLoadEnabled`), `@deffont` no-op.
- `tests/unit/ui/system-menu.test.ts` et `tests/unit/ui/player.test.ts` : Save/Load désactivés quand
  `@store enabled=false` (libellé dédié, toast, pause toujours accessible, réactivation).
- **Un seul e2e** (`tests/e2e/text-emoji.spec.ts`) : `[heart]` rendu inline, `alt="(ハート)"`,
  source `heart26` chargée, texte encadrant lisible ; la page de test est insérée dans le prologue
  placeholders (asset `heart26` ajouté au manifeste, PNG original 26×26).

## 9 undecies. Actions et effets de scène — #282

Traitement du lot « actions/effets de scène » du triage #276 : les 9 commandes passent de la
baseline des inconnues à **4 commandes / 5 occurrences** (13/17 → 4/5 ; seules les commandes #287
restent). Sémantique lue dans `data/override/tagex.tjs` (`action`, `removeaction`, `pauseaction`,
`resumeaction`, `pauseploy`, `resumeploy`), `data/override/action.tjs`
(`LayerMoveModule`/`LayerNormalMoveModule`) et `data/scenario/fallnoteplugin.tjs`, plus les
usages réels (`wik_k.ks`, `wik_z-3.ks`, `nz6.ks`, `system_window.ks`, `wik_g-a.ks`, `fallnote.ks`).

| Commande | Statut | Implémentation / écart |
|---|---|---|
| `@action` (1, `wik_k.ks`) | **implémenté** | module `LayerNormalMoveModule` : translation `startx→x` / `starty→y` sur `time` (+ `delay`) via un événement `animate` (AnimationController) ; pour un partbg, les `left/top` moteur sont convertis en centre du wrapper (`+ width/2`, `+ height/2`). `nonstop=0` arrête d'abord l'action en cours. **Écarts** (registre #296 `action-modules-subset`) : les autres modules sont approximés en translation linéaire, `accel` n'est pas interpolé (keyframes port linéaires) et `needlayer` (création du calque manquant) n'est pas reproduit. |
| `@removeaction` (3, `wik_z-3.ks`) | **implémenté** | annule les actions **en conservant l'état courant** (`stopAnimation` ciblé → `commitStyles` puis `cancel`), contrairement à `@stopaction` ; cible `id=`/`storage=`, sinon toutes. La coquille du corpus `pege=` est ignorée (comme le moteur : attribut inconnu). |
| `@pauseaction` (1, `system_window.ks`) | **implémenté** | `{ kind: "pauseAnimation" }` → `pause()` WAAPI (toutes les animations, ou la cible ; `all=1` ignore les non-pausables). |
| `@resumeaction` (1, `system_window.ks`) | **implémenté** | `{ kind: "resumeAnimation" }` → `play()` WAAPI. |
| `@pauseploy` (1, `nz6.ks`) | **implémenté** | masque la bulle ploy (événement `ploy: null`), mémorise son état (champ **transitoire** `ployPaused`, allowlist #295) et réinitialise le style de texte. **Écart** (registre #296 `pauseploy-font`) : le moteur force MS PGothic puis la police utilisateur (`deffont`/`resetfont`), le port retombe sur le style du thème. |
| `@resumeploy` (1, `nz6.ks`) | **implémenté** | restaure la bulle mémorisée (événement `ploy`) ; sans bulle mémorisée, no-op (le moteur relance `beginploy`, sans contenu à afficher). |
| `@beginfallnote` / `@fallnoteopt` / `@endfallnote` (4, `wik_g-a.ks`) | **approximé (documenté)** | particules CSS génériques (`fallnote-particles`, registre #296, test figé) : activation, arrêt et taux `rate` (vitesse/vitesse de chute) seulement ; images de notes, options `sx`/`sy`/`patterns`/`pastTime` et seconde couche du plugin non reproduites. État transitoire `fallnote` (allowlist #295), retiré sur `restore`/`clear`. |

### Tests

- `tests/unit/kag/actions-parse.test.ts` : parse des 9 commandes (args réels, module par défaut,
  coquille `pege=`, `all=`, `rate=`).
- `tests/unit/kag/actions-runtime.test.ts` : `@action` (mapping partbg, événement `animate`),
  `@removeaction`/`@pauseaction`/`@resumeaction` (cibles/all), `@pauseploy`/`@resumeploy`
  (séquence `ploy`), fallnote (activation/rate/arrêt).
- `tests/unit/renderer/actions-renderer.test.ts` : pause/play WAAPI des AnimationController,
  particules `fallnote` (overlay, `data-rate`, retrait).
- Gate #295 : `ployPaused`/`fallnote` ajoutés explicitement à l'allowlist `transient`
  (`state-invariant.test.ts`) ; registre des approximations + baseline mis à jour
  (`npm run approximations:check` OK).
- Aucune nouvelle e2e (protocole « max 1 e2e par lot » ; animations/particules couvertes en unitaire,
  la suite e2e existante reste verte en CI).

## 9 duodecies. Tracer et timelines — clôture du triage (#287)

Dernier lot du triage #276 : les 4 commandes restantes (`@settracerreturn` 2, `@startchart` 1,
`@loadtimeline` 1, `@playtimeline` 1 occurrence de test) sortent de la baseline, qui passe de
**4 commandes / 5 occurrences à 0 / 0**. L'audit réel affiche **125 implémentée(s), 5 ignorée(s)
volontairement (11 occurrences), 0 inconnue** sur les 221 scripts (`npm run audit:baseline` ;
`audit:guard -- --strict` OK) : mode zéro strict atteint.

| Commande | Statut | Justification (registre #275 / documentée) |
|---|---|---|
| `@settracerreturn` | **no-op justifié** (`effet: "aucun"`, issue #287) | Règle la destination de retour du traceur de parcours (mode debug d'origine). Seuls usages : `sp2.ks`, script système **non chargé par le player** (écrans spéciaux/archive) : aucun effet visible, audible ou de déroulement dans le port. |
| `@startchart` | **no-op justifié** (`effet: "aucun"`, issue #287) | Lance une carte de fin de chapitre TYPE-MOON (graphique de flowchart `.gc`) non modélisée par le player ; scripts concernés (`sp2.ks`, `first.ks`) système/non chargés. |
| `@loadtimeline` | **no-op justifié** (`effet: "aucun"`, issue #287) | Charge un `.tla` : le pipeline ne convertit pas ce format (aucun asset timeline au manifeste) ; seul usage utile `menutest.ks` (script de test non chargé). Les timelines jouables passent par les données `*tladata` embarquées + `@playtimeline scene=`. |
| `@playtimeline frame=…` | **variante tolérée en no-op explicite** (hors registre) | Formulaire de test sans `scene=` (`menutest.ks`, `gamemenu.ks`) : le parser renvoie `{ kind: "noop", command: "playtimeline", reason }`, **aucun warning**, aucun effet. Ce n'est pas un no-op volontaire permanent : il ne va **pas** au registre #275. `@playtimeline scene=N` reste inchangé (rejeu depuis les timelines ; sans données : avertissement « timeline introuvable », pas « commande non gérée »). |

### Registre final et classification de l'audit

- `tools/ignored-commands.ts` contient **exactement 5 no-ops** (`effet: "aucun"`), tous sourcés :
  `autocache` (#283), `deffont` (#284), `settracerreturn`/`startchart`/`loadtimeline` (#287).
- Le parser reconnaît explicitement les 3 nouveaux no-ops (plus de warning « commande non
  gérée »), et l'audit compte les no-ops **réellement exécutés** via le nouveau hook léger
  `Runtime.onCommand` : le registre #275 est la source de vérité de la classification
  « ignorée volontairement », indépendamment du warning runtime (les commandes encore lues en
  `raw` comme `autocache`/`deffont` restent classées ignorées). La baseline ne contient donc plus
  **aucune** commande inconnue.
- Tests : `tests/unit/kag/tracer-noops.test.ts` (classement registre + zéro warning + 5 no-ops),
  `tests/unit/kag/playtimeline-frame-noop.test.ts` (no-op explicite, non-régression `scene=N`),
  `tests/unit/tools/audit-ignored.test.ts` (classification audit : ignorées vs implémentée pour
  `frame=`, warnings « timeline introuvable » hors inconnues), et mise à jour des tests figés
  `playtimeline-variant.test.ts`/`timeline.test.ts`.
- **Pas d'e2e ajouté** pour ce lot : aucune commande n'a d'effet visible/jouable (scripts système
  ou de test non chargés par le player) ; la couverture est unitaire + audit réel.

## 9 terdecies. Clôture v1.0 — mode zéro strict (#302)

La clôture DoD v1.0 s'appuie sur le triage #276 entièrement clos (#281–#287) et sur les
garde-fous #295. Le mode **zéro strict** remplace le mécanisme de décroissance de la baseline :

- **Baseline vidée** : `tools/audit-commands-baseline.json` ne contient plus que ses métadonnées
  (`generatedAt`, `source`, `note`, `triageIssue: "#302"`, `commands: {}`) ; elle est **figée** et
  ne doit jamais être modifiée.
- **Garde-fou** (`npm run audit:guard`) : échoue sur **toute** commande inconnue mesurée sur le
  corpus (exit 1), sans comparaison à `origin/main` ; `npm run audit:baseline` a été **supprimé**
  (plus d'écriture possible de la baseline). Le registre des **5 no-ops justifiés** (`@autocache`,
  `@deffont`, `@settracerreturn`, `@startchart`, `@loadtimeline`) reste validé (raison, `effet:
  "aucun"`, issue) et la doc générée est contrôlée (`check:generated`).
- **Mesure de clôture** (vrais assets, 221 scripts) : **125 commandes implémentées**, **5 ignorées
  volontairement** (11 occurrences), **0 inconnue (0 occurrence)**, 0 erreur, 0 maxSteps.
- **CI** : l'étape « Fetch main for audit baseline comparison » est retirée ; `audit:guard`
  s'exécute en `--strict` (zéro strict par défaut) avec le corpus de placeholders,
  `check:generated` et `approximations:check` restent actifs.
- **Démonstration négative** (preuve de non-maquillage) : ajout d'une commande inconnue dans un
  script du corpus de placeholders → `audit:guard` échoue avec « commande inconnue … le mode zéro
  strict interdit toute inconnue » ; retrait → retour au vert.
- Les approximations connues restent suivies en v1.1 via l'issue #296 (registre à 4 éléments) ;
  les bugs de fidélité hors DoD suivent #297 (horloge `time=0`) et #300 (ruby + emoji #graph).

## 10. Commandes non implémentées à figer plus tard

> **Clôture v1.0 (#302)** : le corpus de référence ne contient plus **aucune** commande inconnue
> (mode zéro strict, §9 terdecies). Toute commande KAG rencontrée à l'avenir devra être
> implémentée, approximée (registre #296) ou déclarée no-op justifié (#275) — le garde-fou CI
> échoue sinon. La liste ci-dessous est un historique de triage, plus une liste d'écarts ouverts.

- ~~`@s`, `@image`, `@ruby`, `@endif` (commandes KAG standard)~~ : implémentées (#277) ; voir
  §4 « Ruby » et « Commandes KAG standard ».

- ~~`type=` (modes de fusion)~~ : mappé vers `mix-blend-mode` (#252) ; restent 4 `ltSubtractive`
  et 1 `ltOpaque` sans équivalent CSS exact (documentés ci-dessus).
- ~~`effect=` (nega/mono/monocro)~~ : mappé vers `filter` (#252) ; restent les **effets
  d'ambiance** `envcolor.ksc` (données du jeu non installées — issue de suivi nécessaire : les
  extraire via le pipeline, ou les mesurer sur captures).
- `partbgid=` : clip de sprite dans un partbg.
- Transition `universal` + image de règle : WebGL dédié (P2/P3).
- ~~`staffroll` : défilement crédits~~ — implémenté (#286, §9 ter).

## 11. Hypothèses à valider contre une capture vidéo du jeu original

- ~~`page=` par défaut des macros Mahoyo `@fg` (fore ou back ?)~~ — **tranché (#249)** en lisant
  les sources du moteur : `@bg`, `@fg`, `@partbg`, `@clfg`, `@clpartbg`, `@fgact`, `@partbgact`,
  `@chgfg` écrivent sur **back** par défaut ; `@movefg`/`@movepartbg` ciblent fore. Voir §2.
- `@trans` (`exchange=true` + backlay après `@wt`, voir §2) : le port garde `exchange=false` ; l'état
  de back après un `@trans nowait=1` diffère donc du moteur. Suivi séparément (issue de suivi #249).
- Variantes `storage=nom|partie` : dans le moteur, le suffixe est résolu par la couche native
  (composition de « parts ») ; les archives installées ne contiennent **aucun** fichier de parts
  (vérifié : 5 422 images = bg/fg/image/rule/data uniquement, aucun `.parts`, aucune clé `|` dans le
  manifeste), et le code TJS de composition (`Layer.override.tjs`) est commenté. Le port ignore le
  suffixe (`storageKey`), sans écart observable possible sur les assets installés ; reste à confirmer
  si une version du jeu fournit des parts.
- Valeur par défaut de `textoff=` (probablement : masquer la textbox pendant la
  commande, puis la réafficher ; **non validée**). Le corpus écrit `textoff=0` sur
  environ 4 000 commandes (`@bg`, `@chgfg`, `@fgact`, `@partbg`, `@movefg`, `@trans`…) et
  `textoff=1` sur 15 seulement (`@fgact`, un `@movefg`). Le moteur ignore ce
  paramètre : il ne masque jamais la boîte pendant une commande. Ce qui est
  **tranché** (#159) est la règle sur le texte, ci-dessous.

### Règle retenue : un texte lisible réaffiche la boîte (#159)

Constat sur le corpus (comptes seulement) : 263 `@textoff` en japonais, 240 en
français. Ce qui suit chacun d'eux, dans la page ou plus loin dans le script :

| Suite du `@textoff` | ja | fr |
|---|---|---|
| texte lisible (même page ; 145 / 138 avec un `@clall` entre les deux) | 244 | 227 |
| `@return` (dont 2 / 3 précédés d'un `@clall`) | 11 | 10 |
| `@texton` (dont 1 / 1 précédé d'un `@clall`) | 3 | 2 |
| autre `@textoff`, `@call` ou fin de script sans texte | 5 | 1 |

`@texton` n'existe que dans 9 scripts japonais (11 occurrences) et 7 français. Donc,
dans le jeu d'origine, le texte qui suit un `@textoff` s'affiche sans `@texton` :
la boîte est réaffichée par autre chose (probablement le `@trans` interne des
macros, qui passe `texton=1` dans `macro.ks`). Aucun cas du corpus ne demande de
garder la boîte masquée pendant un texte lisible : le seul texte « vide » après un
`@textoff` (`gamemenu.ks`, script système) ne contient pas de caractère affichable.

Règle du runtime (`revealTextboxForText`, `src/kag/runtime.ts`) :

- `@textoff` (et `@position visible=false`) masquent la boîte comme avant, avec leur fondu.
- Quand un `text` contenant au moins un caractère non blanc doit être émis alors que
  `state.textbox.visible` est faux, le runtime émet d'abord un événement `textbox`
  `visible: true` (fondu de 300 ms, le renderer a une transition CSS de 0,3 s), puis le texte.
  Le cadre (`@invisibleframe`) est conservé.
- `@textoff` sans texte derrière (fondu, écran noir, film d'ouverture) laisse la boîte masquée.
- L'état est celui du runtime, partagé entre scripts : une boîte masquée par un
  `@textoff` suivi d'un `@return` ou de la fin du script reste masquée jusqu'au premier texte
  du script suivant, qui la réaffiche. Pas de réaffichage au démarrage du script
  (écran sans texte : la boîte n'a rien à montrer).
- Le masquage par l'utilisateur (`userHidden`, clic droit) est côté renderer et n'est pas touché ;
  la sauvegarde conserve `textbox` (une boîte masquée au moment de la sauvegarde est
  réaffichée au premier texte après le chargement).
- Sémantique exacte de `accel` (formule d'accélération KAG).
- Sens de `mode=` de `@ploysay` (côté, direction, taille de la bulle) et choix de
  l'image (`balloon01`/`balloon02`) : à déduire du plugin TJS d'origine ou d'une
  capture du jeu.
