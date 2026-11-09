# Registre des bugs du prologue

Diagnostic du 2026-10-30 sur `main` (080b2bf), assets réels, Chromium headless 1280×720. Méthode : trace du runtime sur les 204 scripts installés en **japonais et en français**, puis prologue joué dans un navigateur dans les deux langues (touches Espace/Entrée, relevé du DOM et captures).

## Résultat principal

**Le français n'est pas en cause.** Le runtime produit le même déroulement en `ja` et en `fr` : mêmes sauts de script, mêmes clics (écart < 20 % sur 203 scripts sur 204), aucune erreur, aucune boucle. Les défauts du prologue sont identiques dans les deux langues : ils viennent du **player / renderer**, pas de la traduction.

## Registre

| N° | Symptôme | Langue | Où | Cause établie ou probable | Gravité | État |
|---|---|---|---|---|---|---|
| B1 | Maintenir Espace/Entrée enchaîne les pages à toute vitesse (6 répétitions → plusieurs pages sautées, texte non lu) | ja, fr | `ui-manager.ts` `onKeyDown` | `e.repeat` n'est pas filtré : chaque répétition clavier appelle `advance()` | Grave | **Vérifié** |
| B2 | Espace et Entrée font la même chose (avancer) ; seul `S` ou Ctrl donne le skip, ce qui surprend | ja, fr | `ui-manager.ts` | Pas de convention claire ; à définir (cf. tableau de touches cible ci-dessous) | Gênant | Vérifié (lecture du code) |
| B3 | Écrans blancs/noirs sans texte (≈ 5 pages d'affilée au début de `1-0`, ≈ 10 sur 70 étapes) | ja, fr | `1-0.ks` / player | Les attentes (`@wait`, timelines) consomment les appuis de touche sans rien afficher ; à relier au lecteur TLA incomplet | Grave | Observé, cause à confirmer |
| B4 | L'animation d'ouverture ne se joue pas comme prévu : fonds panoramiques figés et recadrés, sans le mouvement | ja, fr | `opening.ks`, `timelines.json` | **Vérifié le 2026-10-31** (voir « Ouverture : vérification ») : les fonds sont bien animés et panoramiqués ; restent les calques, zooms et effets, non rejoués (issue #125, v1.1) | Gênant | Partiellement vérifié, reste lié à #125 |
| B5 | Les scènes de l'ouverture ne suivent pas l'ordre du film | ja, fr | `opening.ks` | Scène 4 jouée (`cf.speffect` vrai, #135) ; **ordre des 16 plans de fonds vérifié** dans Chromium le 2026-10-31 : conforme à `timelines.json`. L'ordre des calques reste hors périmètre (#125) | Mineur | **Corrigé** (fonds) |
| B6 | Au tout début, une image de nuages s'affiche petite (~640×360) et décalée vers la droite au lieu de remplir l'écran | ja, fr | `stage-renderer.ts` (sprite/partbg) | Dimensionnement ou position d'un sprite hors repère 1280×720 ; à isoler | Gênant | Observé (capture `fr-00`) |
| B7 | Quelques textes sont effacés avant d'être lus (`clearText` sans clic) | ja, fr | `3-1`, `5a-3`, `5a-11`, `a-8`, `c-12`, `nz1`, `nz5`, `wik_o` | 10 occurrences en fr contre 11 en ja : défaut du moteur, pas de la traduction | Gênant | **Vérifié** (trace) |
| B8 | 21 clics sans texte en français contre 2 en japonais | fr | `1.5-1`, `1.5-2`, `1.5-4`, `2-2`, `5a-7`, `5a-11`, `5a-12`, `5b-10`, `5b-14`, `wik_*` | La traduction ajoute des commandes (`@se`, `@sestop`…) qui créent des pauses sans texte | Gênant | **Vérifié** (trace) ; les 12 clics restants après #138 sont neutralisés à l'installation (#141) |
| B9 | Voix et sons manquants : 3 « Audio introuvable » dans `1-0` en fr ; ~9 000 références à des assets Steam absents en tout | fr | assets | Fichiers de la version Steam, absents du manifest (limite documentée) | Mineur | Connu |
| B10 | Pendant un tremblement d'écran (`@quake`), l'image (par exemple la maison sous la pluie, fin de `1-0`) tombe à 1024×576 : collée en haut à gauche, bandes noires à droite et en bas | ja, fr | `stage-renderer.ts` `startQuake` | Le tremblement posait `transform: translate(…)` en ligne sur `.mh-stage` et écrasait le `scale(1.25)` du CSS ; corrigé en `translate(…) scale(1.25)` (#148) | Gênant | **Corrigé** |
| B11 | Bande sombre d'environ 29 px à gauche de l'écran, avec le badge ↶ (rollback) en haut, même sur une image claire | ja, fr | `ui-manager.css` `.mh-ui-status` | `.mh-ui-overlay > div { inset: 0 }` (0,1,1) l'emportait sur `.mh-ui-status { top; right }` (0,1,0) : la barre d'état couvrait tout l'écran en flex et son badge s'étirait sur 29×720 px (fond noir 60 %). Corrigé par `.mh-ui-overlay > .mh-ui-status { inset: 0.5rem 0.5rem auto auto; align-items: flex-start }` (#150) ; le badge fait désormais 29×22 px en haut à droite | Gênant | **Corrigé** |
| B12 | `@lockquickmenu`, `@pauseautomode`, `@resumeautomode` ignorées avec un avertissement (`opening.ks`, `first.ks`, `call.ks`) | ja, fr | `src/kag/`, `src/ui/player.ts` | Le registre les croyait « sans sens dans le player » : elles verrouillent le menu rapide et suspendent l'auto pendant le film d'ouverture. Sémantique dans `KAG_MAHOYO_SEMANTICS.md` (§6) | Gênant | **Corrigé** (#153) |
| B13 | Images `im家絵02a/b/c` « Asset introuvable » dans `1-0` (français) ; autres images absentes | fr (a/b/c), ja et fr (autres) | assets | Voir « Images absentes : causes » | Mineur | **Documenté** ; nommage **corrigé** (#153) |
| B15 | À partir de l'image de la maison au crayon (page 3 de `1-0`, après le premier `@textoff`), plus aucun texte visible : `#textbox` reste à `opacity: 0` alors que `#text` contient du texte (884 échantillons sur 902 en mesure initiale) | ja, fr | `src/kag/runtime.ts` | `@textoff` masque la boîte, seul `@texton` (9 scripts) la réaffiche ; le texte qui suit n'avait aucune règle de réaffichage (#159). Règle : un texte lisible réaffiche la boîte (`docs/KAG_MAHOYO_SEMANTICS.md` §11) | Bloquant | **Corrigé** (#159) : mesure Chromium sur 12 min de jeu, 2355/2395 (ja) et 2940/3074 (fr) échantillons avec texte et boîte masquée avant, 19 et 21 après (fondus) |
| B16 | Page de la carte du titre du chapitre 1 (fin de `1-0`) : les dernières lignes du texte long passent sur le titre, posé en bas à droite par le script | ja (légèrement), fr | `src/renderer/stage-renderer.ts`, `text-fit.ts` | La zone de texte est ancrée à 5 % du bas : tout texte de plus de 3-4 lignes occupe la bande basse (y > 77 % de la hauteur) où les scripts posent la carte, qui ne bouge pas. Mesure Chromium 1280×720 : texte français de 7 lignes, dernière ligne dans y 612-650 pour un titre dans y 556-671 | Gênant | **Règle remplacée** (#163) : la correction de #161 (boîte qui remontait au-delà de 5 lignes) faisait sauter la boîte d'une page à l'autre (60 pages sur 190 en français, 10 géométries distinctes). Désormais la boîte est fixe (bas à 5 %, hauteur 47 % de la scène, une seule géométrie sur 190 pages) et la police diminue par pas de 5 % jusqu'à 70 % sur les pages longues (46 pages réduites en français, 16 en japonais) ; règle dans `KAG_MAHOYO_SEMANTICS.md` §6. Contrepartie assumée : sur la page du titre (fr : 6 lignes, police à 85 %), la dernière ligne ne recouvre plus que le bord de la carte (seule la 5e ligne touche sa barre verticale) ; en japonais (6 lignes à taille nominale) la dernière ligne passe sur le titre. Pages qui débordent (zone défilable) : 3 sur 190 en français, 1 en japonais à `fontScale` 1 ; à 1,4, 42 en français et 16 en japonais. **Règle remplacée à nouveau** (#173) : la fenêtre de message reprend le cadre image du jeu (`txtwindow02` par défaut), avec une zone de texte haute (8,1 % à 91,9 % de la hauteur, jusqu'à 11 lignes avant réduction). La carte du titre occupe toujours la bande 77-93 % : une page de 8 lignes ou plus peut encore la recouvrir, à vérifier sur la page du chapitre 1. L'ancienne boîte fixe #163 ne sert plus que de repli quand l'image de cadre manque |
| B17 | Après l'ouverture, au début de `1-2` (3e appui sur Espace) : fond noir, gros fragment de parapluie rouge coupé net au milieu-gauche, rectangle de pluie grise collé au coin bas-droit | ja, fr | `src/kag/parser.ts`, `runtime.ts`, `stage-renderer.ts` | `@bg`, `@fg` et `@chgfg` ignoraient `zoom=`, `zoomx=`, `zoomy=` et `rotate=` (2 389 `@bg zoom`, 6 215 `@fg zoom`, 8 710 `@fg rotate` dans le corpus ja) : sprites à leur taille d'origine, fond posé en (853, 198) sans zoom donc quasi hors écran. S'y ajoutait `@bgact`, lu comme un `@bg` sans position, qui recentrait le fond et vidait ses calques (#164). Ce n'était **pas** la timeline : 0 calque restant et fond correct à la fin de l'ouverture, en fin naturelle comme après un clic | Bloquant | **Corrigé** (#164) ; l'animation de `@bgact` (panoramique de plusieurs secondes) reste non rejouée |
| B20 | Gros plan d'un professeur dans `1-2` (fr) : le sprite s'arrête net vers y = 676 / 720, coin net à gauche vers x = 290, fond visible en dessous | ja, fr | `1-2.ks` (données), boîte de texte | Soupçon de pivot de zoom faux **écarté** : le sprite n'a aucun `zoom=` (boîte mesurée 915 × 840 = 732 × 672 × 1,25 en (294, −164)), il est posé tel que le script le dit et finit à y = 541 sur 576. Le jeu d'origine cache ce bord sous la fenêtre de texte ; la boîte du port (noir à 70 %) le laisse voir. Statistiques d'ancrage dans `KAG_MAHOYO_SEMANTICS.md` (#171) | Gênant | **Analysé**, pivot au centre confirmé ; bord visible à traiter avec la boîte (#171) |
| B18 | Scène de cuisine de `1.5-1` (pages 12 à 31) : le personnage n'apparaît pas à la page 12, puis surgit avec le fond ; bande noire d'environ 49 px à gauche, haut de la casquette hors cadre. Même défaut dans `1-3` (pages 1-2) : écran noir pendant que le texte parle du personnage | ja, fr | `src/kag/runtime.ts`, `parser.ts` | `@fg` et `@chgfg` avec `time=` et sans `page=` ne faisaient pas leur transition (2 810 commandes dans le corpus fr) : le calque restait sur back jusqu'à la transition suivante. **La bande et la casquette ne sont pas un défaut du renderer** : `@partbg width=723 center=401` laisse 39,5 px à gauche (49,4 px à l'écran) et le sprite de 672 px posé en `vcenter=305` dépasse de 31 px en haut ; le rendu suit les valeurs du script (sur 2 102 `@fg` de sprites de 672 px sans zoom, le haut médian est à -79 : cadrages serrés voulus) | Gênant | **Corrigé** (#166) pour l'apparition tardive ; la bande et le cadrage sont conformes au script, à confirmer contre le jeu d'origine |
| B19 | Page « elle ouvre la porte de la salle des professeurs » de `1-2` (5 lignes de texte) : le fond ne couvre que le coin bas droit de la fenêtre (image à partir de (486, 218) en 1280×720, coupée à droite et en bas), le haut et la gauche sont noirs | ja, fr | `src/renderer/stage-renderer.ts`, `transform-helpers.ts` | **Ce n'était pas un `@bgact`** (aucun sur la page) mais un `@partbg … srcleft=-150 srctop=-174 srczoom=140 width=775 center=626` : l'image interne était zoomée autour de son **coin haut gauche**, donc repoussée de (+150, +174) par les valeurs négatives (30 % des `@partbg`). Le pivot est le **centre de l'image**, comme pour `@bg`. Contrôle sur le corpus japonais : pour les 1 793 `@partbg` dont le zoom permet de couvrir la fenêtre, le pivot au centre la couvre dans 1 716 cas (95,7 %), contre 1 257 (70 %) avec le pivot au coin | Bloquant | **Corrigé** (#169) |
| B20 | L'indicateur de fin de page (`pagebreak_a`, livre animé) pend sous la ligne de texte, environ 20 px plus bas que le dernier mot | ja, fr | `src/renderer/stage-renderer.ts`, `text-frame.ts` | L'icône était un `inline-block` contenant encore son glyphe de secours (`▼`) à `font-size: 0` : sa ligne de base se trouvait en haut de la boîte et `vertical-align: -2px` la faisait descendre sous le texte. Elle agrandissait aussi la hauteur de ligne (70 px au lieu de 51 px en 1280×720), ce qui faussait la mesure de `fitTextBox` | Gênant | **Corrigé** (#175) : l'indicateur est hors du flux (`position: absolute`), positionné sur la dernière lettre par `indicatorOffset` (centre vertical de la boîte du caractère, 2 px à droite), sans élargir la ligne. Mesure Chromium : écart de centre 0,02 px, hauteur de ligne 51,20 px |

## Images absentes : causes (2026-10-31, #153)

Méthode : recherche de chaque nom absent dans le manifest installé, dans les assets installés et dans les sources extraites de l'archive 2012 (dossiers `decrypted/` et `xp3/` de l'ancien POC), avec comparaison insensible à la casse et à la forme Unicode (NFKC).

**`im家絵02a`, `im家絵02b`, `im家絵02c`** : références **ajoutées par la traduction française** (5 occurrences, lignes de `1-0.ks` autour du fond de la maison, avec `zoom=120`). Le script japonais de `1-0.ks` ne cite que `im家絵a`, `im家絵b`, `im家絵c`, qui sont dans le manifest. Les fichiers `02a/b/c` n'existent **nulle part** dans l'archive 2012 (ni `.tlg`, ni `.png`, aucun nom voisin) : ce sont des images de la version Steam, comme les voix (B9). Ce n'est donc pas un défaut de nom ni de manifest, et aucune image n'est fabriquée ni substituée (un repli vers `im家絵a` changerait le cadrage voulu par la traduction). Le player les tolère : un seul avertissement par image.

**Autres images absentes du japonais** (14 images, après correction) : trois causes distinctes.

| Cause | Images | État |
|---|---|---|
| Espace avant l'extension dans le nom du fichier (`…) .png`) : la clé du manifest installé garde l'espace, les scripts non | 1 (fond de la salle de verdure, orage de nuit) | **Corrigé** (#153) : le resolver retombe sur une clé repliée (NFKC, bordures, casse) |
| Fichier présent dans l'archive mais jamais converti : conteneur `TLG0.0` enveloppant un `TLG5.0`, que le décodeur du POC (`tlg.py`) ne sait pas lire | 14 sprites d'Aoko, Sôjûrô et Alice (tenues « 全 », « 近 », « 大 ») | **Corrigé** (#155) : décodeur `TLG0.0`/`TLG5` intégré au convertisseur (`tools/tlg-decode.ts`). 32 fichiers de l'archive sont dans ce cas ; 15 n'avaient aucune image (les 14 absents du japonais et un autre), les 17 autres avaient déjà un PNG, que le nouveau décodeur reproduit au pixel près |
| Absent de l'archive (son `bgm101`) | 1 son | Limite connue : voir ci-dessous |

**Autres images ajoutées par la traduction** (français) : 45 avant correction, 43 après. Les 2 images corrigées sont des silhouettes dont la traduction écrit une lettre pleine chasse (`ｌ`) alors que le fichier a un `l` ASCII (**corrigé** par le repli, #153). Les 43 restantes sont absentes de l'archive 2012 (sprites de tenues, fonds et événements de la version Steam), `im家絵02a/b/c` comprises. Mesure après correction sur les 221 scripts, avec les assets installés : 57 images absentes en français (60 avant), 14 en japonais (15 avant).

Les sprites TLG5 sont récupérés par #155 : le convertisseur décode désormais `TLG0.0` enveloppant du `TLG5.0` (voir `docs/PIPELINE.md`). Après reconversion, la lecture complète ne signale plus que le son `bgm101`.

**Son `bgm101` (mise à jour #110, 2026-11-09)** : référence unique du corpus, dans `staffroll.ks` (`@play storage=bgm101.ogg`, générique de fin). Le manifest audio installé compte 870 clés (`bgm/` = `m01`–`m63`, `se/` = 810 fichiers) et aucune clé voisine de `bgm101` : ce n'est ni une variante `|x`, ni un défaut de nom, ni un espace résiduel. Le fichier n'existe pas dans l'archive PC 2012 convertie (méthode de recherche de #153, dossiers `decrypted/` et `xp3/` de l'ancien POC) ; sans fichier source, la référence ne peut pas être corrigée dans le pipeline. Le player affiche un avertissement unique et joue le générique sans musique. La vérification statique du pipeline (`report.json`) applique désormais la même résolution que le player (clé normalisée + repli NFKC) : elle ne signale plus l'image à espace final et ne laisse que ce `bgm101` (1 storage manquant, contre 5 refs dont 4 pour l'image à espace final avant #110).

## Ouverture : vérification (2026-10-31, `main` + #150)

Méthode : Chromium 1280×720, assets réels, langue `fr`, script Playwright hors dépôt. Le `Player` est exposé sur `window` en réécrivant à la volée la réponse de `/src/main.ts` (le dépôt n'est pas modifié), puis `opening.ks` est lancé directement ; un traceur relève toutes les 250 ms le fond, sa position calculée, le rectangle du stage et l'état du player. Le parcours naturel a aussi été joué : `1-0` puis `1-1` à coups d'Espace (589 appuis, 73 s) mènent à `opening.ks`, avec le même résultat que le lancement direct (mêmes 16 plans, mêmes positions à 1 px près).

Constaté :

- La timeline est atteinte (`opening.ks`, état `waiting-wait`) et dure 197,25 s ; le player enchaîne ensuite sur `1-2.ks` à 197,25 s.
- Ordre des 16 plans conforme à `timelines.json`, aux dates près (écart < 250 ms, pas du traceur) : noir, 02b pin (2 plans), blanc, 01 miroir, entrée sous la pluie, 06a, 07, 08, 09, 10, 11a, 12 a/b/c, école sous la pluie fine.
- Panoramiques : la position du fond évolue de façon continue pendant chaque plan (par exemple le plan 06a de -164 à -415 px, le plan 12c de -750 à -149 px).
- Aucun trou : dans le repère 1024×576, `left ≤ 0`, `top ≤ 0`, `left + largeur ≥ 1024` et `top + hauteur ≥ 576` à chaque échantillon.
- Stage et scène : 1280×720 plein à (0, 0) sur les 801 échantillons ; plus de bande sombre à gauche.

Défauts restants (tous liés à #125, non corrigés ici) :

- Aucun calque n'est rendu (0 sprite pendant toute la timeline) : le plan 01 « miroir » apparaît **flou** (le calque net manque), les cartons et personnages posés en calque sont absents.
- Pas de zooms ni d'effets (brume, tremblement).
- Console : `@lockquickmenu`, `@pauseautomode` et `@resumeautomode` étaient ignorées avec un avertissement. **Corrigé (#153)** : voir B12 ci-dessous.
- Les voix et sons manquants de la version Steam restent muets (B9) ; dans le script français de `1-0`, trois images `im家絵02a/b/c` sont aussi absentes des assets installés (avertissement « Asset introuvable »). Cause établie : voir B13 ci-dessous.
- Stage : seul écart relevé hors ouverture, 1 px de décalage pendant un `@quake` de `1-0` (attendu, c'est le tremblement).

## Non constaté (à ne pas chercher)

- Texte français qui déborde de la boîte : 0 débordement mesuré sur 70 étapes en `fr`.
- Texte français vide alors que le japonais en a : aucun script concerné.
- Ordre des scripts différent entre `ja` et `fr` : aucun écart.

## Proposition de touches (à valider)

| Action | Touche |
|---|---|
| Avancer | Espace, Entrée, clic, molette bas (sans répétition clavier) |
| Retour | molette haut, flèche gauche |
| Skip (maintenu) | Ctrl |
| Skip (bascule) | `S` |
| Auto | `A` |
| Menu | Échap |

## Ordre de correction suggéré

1. B1 (une ligne, effet immédiat), puis B2 après validation du tableau de touches.
2. B3 et B6 (affichage), avec captures avant/après.
3. B4 et B5 via #125, ou en simplifiant l'ouverture (diaporama fixe et ordre correct) si #125 est trop long.
4. B7 et B8 : décider si la traduction doit être limitée aux scripts stricts quand elle ajoute des pauses.
