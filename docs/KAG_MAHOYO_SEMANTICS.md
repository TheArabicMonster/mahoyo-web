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

Règles observées dans le prologue :
- `@bg page=back storage=… noclear=0` prépare le fond dans **back** sans toucher fore.
- `@fgact page=back …` attache une animation à un calque de la page **back**.
- `@trans rule=crossfade time=1200 nowait=?` copie **back → fore** avec un fondu.
- Après `@trans`, la page **back doit être vidée** (sinon les calques s'empilent).
- `noclear=0` : la page cible est vidée avant d'écrire le nouveau fond/calques.
  `noclear=1` : on conserve les calques existants (ex. `@bg … noclear=1` garde
  les sprites par-dessus le nouveau fond).
- **Trans implicite** : une commande avec `time>0` et `rule=` mais sans
  `page=back` (ex. `@bg time=1200 rule=crossfade storage=white`) équivaut à
  backlay → modification du back → trans. `nowait=1` → non bloquant.
  S'applique à `@bg`, `@partbg`, `@fg` et `@chgfg` (#166) : `@fg rule=crossfade time=300 …`
  montre le personnage tout de suite (fondu de 300 ms, bloquant sauf `nowait=1`). Sans `time`
  ou avec `page=back`, le calque reste sur back jusqu'au `@trans` ou au `@bg` suivant (le
  corpus empile ainsi plusieurs `@fg` avant un `@bg … time=…`).

## 3. Calques (layers)

- Chaque calque a un **id** (`id=`) sinon son `storage` (jamais `parseInt`).
  `id=pb1` identifie un partbg réutilisé par `@clpartbg id=pb1` et
  `@partbgact`.
- `index=` et `absolute=` (dans les keyframes) sont le **z-index**. Ex. un
  sprite normal à `index=2000`, un flash rouge à `index=6000`.
- `type=` est un **mode de fusion** KiriKiri (entier). À mapper vers
  `mix-blend-mode` (ex. 13/14/19 → valeurs à valider ; laisser no-op + warning
  tant que non figé).
- `effect=` est un filtre : `nega`, `mono8e0707` (teinte), `monocro` (niveaux
  de gris). À mapper vers `filter` CSS.
- `contrast=`, `rotate=`, `zoomx=`/`zoomy=` : transformations du calque.

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
  `translate(-srcleft px, -srctop px) scale(srczoom/100)` (origine 0 0).
  `srczoom=400` = ×4.
- `bgstorage` : remplace le fond de la page cible.
- `rule/time` : transition implicite (voir §2).
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

### Texte long et bande basse (#161)

La zone de texte du port est un choix du player (le jeu d'origine règle la sienne par les
cadres `txtwindow01`/`txtwindow02` et le moteur, non reproduits) : ancrée à 5 % du bas de la
scène (repère 1024×576), marges de 10 % à gauche et à droite, elle grandit vers le haut avec la
page. Les scripts posent des calques décoratifs dans la bande basse (carte du titre de chapitre
`ch01タイトル`, pixels opaques de y 445 à 537 sur 576, soit 77 % à 93 % de la hauteur) : leur
position vient du script et n'est pas modifiée.

Règle retenue (`src/renderer/text-fit.ts`, fonction pure `fitTextBox`, appliquée par le renderer
sur la **page entière** avant la frappe, donc sans saut en cours de texte) :

- Une page de 5 lignes ou moins garde la position et la taille nominales (japonais comme français).
- Au-delà de 5 lignes, la boîte remonte : le bas des lignes de texte reste au-dessus de 76 % de la
  hauteur de scène (la boîte glisse en 0,2 s).
- Si la page ne tient pas dans la place restante (hauteur de scène moins le bas remonté moins 12
  de marge haute), la police diminue par pas de 5 % jusqu'à 75 % de la taille nominale
  (`1,5 rem` multiplié par `fontScale`, qui reste respecté). En dessous, la zone défile
  (`overflow-y: auto`, `data-text-fit="overflow"` sur `#textbox`).
- Limite : une page de 5 lignes ou moins qui contient un texte large dans la bande basse peut
  encore recouvrir une carte posée dans cette bande (la règle ne connaît pas les calques).

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

## 10. Commandes non implémentées à figer plus tard

- `type=` (modes de fusion) : mapping complet vers `mix-blend-mode`.
- `effect=` (nega/mono/monocro) : mapping vers `filter`.
- `partbgid=` : clip de sprite dans un partbg.
- Transition `universal` + image de règle : WebGL dédié (P2/P3).
- `staffroll` : défilement crédits (B14).

## 11. Hypothèses à valider contre une capture vidéo du jeu original

- `page=` par défaut des macros Mahoyo `@fg` (fore ou back ?). Le prologue
  suggère que les macros système écrivent sur **back**, mais il faut lire les
  vraies définitions de macros (scripts système du `data.xp3`, en local) pour
  trancher.
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
