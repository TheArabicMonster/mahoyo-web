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
- `@textoff time=4000` : masque la textbox avec un fondu de 4 s.
- `@visibleframe` / `@invisibleframe` : affiche/masque le cadre de la textbox.
- `@cm4pg` : reset de mise en page pour le changement de page (à valider).

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
  commande).
- Sémantique exacte de `accel` (formule d'accélération KAG).
