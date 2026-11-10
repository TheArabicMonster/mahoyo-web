# Design system du HUD (extrait du jeu d'origine)

Ce document fixe le langage visuel de l'interface de *Mahoutsukai no Yoru* (version PC 2012, patch FR) pour que
chaque écran du port web reste cohérent. Il est assez précis pour qu'un agent implémente un nouvel écran **sans voir
la vidéo**. Les mesures viennent du walkthrough fourni par l'utilisateur (voir
[`ANALYSE_HUD_ORIGINAL.md`](ANALYSE_HUD_ORIGINAL.md), §1) ; chaque valeur est un fait mesuré, pas un asset.

> Règle de dépôt : aucune image du jeu n'est commitée. Les ornements et cadres sont **décrits** et renvoient aux clés
> du manifeste d'assets de l'utilisateur (`public/assets/asset-manifest.json`, `images`). Un écran doit fonctionner
> sans elles (repli en CSS pur, voir §9).

## 0. Conventions

- **Repère de mesure** : capture 1920×1080, jeu plein cadre (aucune bordure). Les valeurs sont données en
  `px@1080`, puis ramenées à la résolution logique du port **1280×720** (`docs/layout.md`) par le facteur ×2/3
  (`px@720`). Pour un affichage en pourcentage, diviser par 1920 (largeur) ou 1080 (hauteur).
- Le jeu d'origine est conçu en 1024×576 et agrandi (×1,875 dans la capture) : les images d'interface
  (`txtwindow*`, `c_*`, `load_*`…) sont à cette échelle. Le port doit mettre l'interface à l'échelle du
  `#viewport`, jamais en pixels fixes de fenêtre.
- Les couleurs sont des hex échantillonnés sur le rendu (anti-crénelage inclus : ±4 sur chaque canal). Là où le
  dégradé compte, on donne le haut puis le bas.
- Les durées sont estimées sur 60 fps (±17 ms).

## 1. Principes

1. **Nuit bleue.** Tous les écrans système (menu, chargement, historique, config, sons, CG) partagent le même fond :
   dégradé vertical bleu nuit, bandeaux de feuillage sombre en haut et en bas, arabesques claires à droite.
2. **Titre clair, système sombre.** Seul l'écran titre est clair (papier crème, texte brun) ; dès qu'on entre dans un
   écran système, tout devient sombre avec du texte clair et des accents sarcelle.
3. **Sarcelle = interactif.** Tout élément actionnable ou actif (boutons, pastilles, curseurs, barre de progression)
   est sarcelle/cyan ; le reste est gris-bleu. Le vert-jaune est réservé à la **sélection** dans une grille.
4. **Texte de jeu sans boîte.** La fenêtre de message n'a pas de cadre : le texte blanc est posé sur la scène, avec
   un voile sur les bords et deux ornements (haut, bas).
5. **Sobriété du mouvement.** Fondus linéaires courts (150 à 400 ms) pour les ouvertures ; 0,8 à 1,2 s pour les
   transitions plein écran. Aucune animation décorative en boucle hors indicateur d'attente.

## 2. Palette (hex mesurés)

### 2.1 Écran titre (clair)

| Rôle | Valeur | Remarque |
|---|---|---|
| Papier (bas de l'écran) | `#eee8de` – `#f2f3ea` | Voile crème sur la photo ; le haut est un ciel gris `#6f757a`. |
| Entrée de menu, repos | `#1f1816` | Brun presque noir (mesure à ±4 ; `#3d2d25` sur les pixels adoucis). |
| Entrée de menu, survol | `#2843ac` | Bleu roi ; le survol ne change que la couleur (pas de fond). |
| Mention de droits | `#514b46` | Serif minuscule, centrée (y 1026–1040, 788–1135). |

### 2.2 Écrans système (sombres)

| Rôle | Valeur | Remarque |
|---|---|---|
| Fond, haut | `#0c1924` | Bande de feuillage (silhouettes `#0c1924` sur `#101c27`). |
| Fond, milieu | `#132337` → `#17273c` | Plus clair au centre et vers la droite. |
| Fond, bas | `#07111b` → `#091118` | Bande de feuillage inférieure. |
| Texte principal clair | `#eef4f5` | Titres d'onglets, libellés de config. |
| Texte de menu, repos | `#a9c8cc` | Entrées du menu système (≈ `#c2dee0` pour l'en-tête et « Back »). |
| Texte de menu, survol | `#b1d6da` + lueur cyan | Le survol éclaircit et ajoute une lueur (≈ +8 de luminosité). |
| Panneau (remplissage) | `#151f2b` – `#18222d` | Cadre de panneau et emplacement de sauvegarde. |
| Panneau (bord) | `#444c56` / `#59616b` | Filet de 2 px, clair en haut-gauche, plus sombre `#333b45` en bas-droite. |
| Libellé de panneau | `#c0d6d6` | Posé sur le bord, avec lueur sarcelle. |
| Encart de saisie | `#04080e` – `#0a1017` | Champ noir bleuté (titre de sauvegarde, aperçu de texte). |

### 2.3 Accents sarcelle

| Rôle | Valeur |
|---|---|
| Bouton actif, haut → bas | `#3d746f` → `#133c39` (bord `#447671`) |
| Bouton inactif, haut → bas | `#404342` → `#171717` (gris neutre) |
| Boîte de dialogue, haut → bas | `#083443` → `#285e69` ; bord `#598f95` ; ornements d'angle `#376b74` |
| Pastille « Oui » survolée | `#33a9a9` (ellipse), « Non » au repos `#2e7179` |
| Boutons de lecteur audio | `#08a8b8` / `#0898a8`, ombre `#084868` |
| Remplissage de barre de progression | `#088888` |
| Curseur de défilement (contour) | `#3f889c` ; reflet `#5fcfc5` ; pastille `#378c9b` |
| Ligne d'information (Sound mode) | texte `#69c8c9`, filet `#5fafb1` |
| Pied d'écran « Back » / « Retour » | `#c7dfe1` |

### 2.4 Sélection et état

| Rôle | Valeur |
|---|---|
| Sélection dans une grille (CG) | bord `#c0f790` / `#ace377` (3 px) |
| Bouton de sauvegarde (Supprimer / Charger) | dégradé `#586888` → `#283858` |
| Bouton « Charger » survolé | éclaircissement bleu vif visible sur la vidéo (t = 94 s) ; valeur non mesurée, à confirmer |
| Message d'information (toast) | fond `#587888` (cadre `#4a6b72` → `#8da9af`), texte blanc |
| Curseur de lecteur / glissière en config | argent `#cbcbcb`, piste noire `#080808` |

### 2.5 Texte de jeu

| Rôle | Valeur |
|---|---|
| Texte de la page courante | `#ffffff`, avec ombre portée noire diffuse |
| Texte de la page précédente (déjà lu) | blanc à 40 % d'opacité par défaut (réglable 0–100 %), soit ≈ `#a5a5a5` sur fond sombre |
| Indicateur d'attente de ligne | feuille bleu-gris de 37×40 px@1080 (`#63829f`) |
| Indicateur de fin de page | livre bleu-blanc de 48×30 px@1080 (`#5b94ce`, reflet `#f9fefe`) |

## 3. Typographie

Aucune police du jeu n'est distribuée. Piles proposées (libres ou système) :

| Usage | Rôle | Pile CSS proposée |
|---|---|---|
| Texte de jeu et historique | Serif classique, interlettrage large | `"Hiragino Mincho ProN", "Yu Mincho", "Shippori Mincho", "Noto Serif JP", "EB Garamond", Georgia, serif` |
| Titres d'écran (« Load », « Config »…) | Serif de titrage, graisse normale, légère lueur | `"Cormorant Garamond", "EB Garamond", Georgia, serif` |
| Menu titre | Serif espacé (≈ +0,25 em) | idem texte de jeu |
| Menu système, boutons, libellés | Humaniste sans, lisible en petit | `"Optima", "Avenir Next", "Segoe UI", system-ui, sans-serif` |
| Japonais (sous-titres) | Gothique gras petit | `"Noto Sans JP", "Hiragino Sans", sans-serif` |

### Échelle (valeurs mesurées → proposées pour 1280×720)

| Élément | Mesure @1080 | @720 | Token |
|---|---|---|---|
| Texte de jeu | hauteur de ligne 77 px, corps ≈ 51 px | interligne ≈ 51 px, corps ≈ 34 px (2,1 rem) | `--mh-text-size: 2.1rem` ; `--mh-text-leading: 1.5` |
| Retrait de première ligne | ≈ 53 px (1 em) | ≈ 35 px | `text-indent: 1em` |
| Entrée du menu titre | hauteur de capitale 28 px (corps ≈ 41 px), pas 73 px | corps ≈ 27 px, pas 49 px | `--mh-title-menu-size: 1.7rem` |
| Titre d'écran (« Load ») | capitale 41 px (corps ≈ 58 px) | corps ≈ 39 px | `--mh-screen-title-size: 2.4rem` |
| Sous-titre japonais | hauteur 19–20 px | ≈ 13 px | `--mh-screen-subtitle-size: 0.8rem` |
| Entrée du menu système | hauteur x 19 px (corps ≈ 38 px), pas ≈ 62 px | corps ≈ 25 px, pas ≈ 42 px | `--mh-sysmenu-size: 1.55rem` |
| « Back » / « Retour » | capitale 32 px | corps ≈ 29 px | `--mh-back-size: 1.8rem` |
| Onglets de config | capitale ≈ 38 px | corps ≈ 35 px | `--mh-tab-size: 2.1rem` |
| Libellés de config et boutons | ≈ 28 px | ≈ 19 px | `--mh-control-size: 1.2rem` |
| Mention de droits | 14 px | ≈ 9 px | `--mh-legal-size: 0.6rem` (jamais sous 10 px réels, voir §10) |

> **Texte de jeu : mise en œuvre (#182, arbitrage #319/#320).** Le player dessine la scène en 1024×576 puis l'agrandit de 1,25 vers 1280×720. La mise en page est exprimée **en unités logiques** (px du repère 1024×576), avec une table de provenance (`FRAME_TEXT_LAYOUT_PROVENANCE` dans `src/renderer/text-fit.ts`).
>
> **Config = modèle, capture = oracle.** Le `config.tjs` de référence (assets locaux non commités : `…/decrypted/data/override/config.tjs`, **sha256 `82ea1af8b44663097027965ba4e868e3e402b487b853298a5c2df4b2e6006893`**) donne dans `MessageLayer_config`, dans l'ordre L, R, T, B (**aucune inversion de lecture**) : `marginL = marginR = 142`, `marginT = marginB = 69`, `mw = 1024`, `mh = 576`, `defaultFontSize = 26`, `defaultLineSpacing = 18` (→ pas de ligne 44), `defaultPitch = 1`, `frameGraphic = "txtwindow01"`.
>
> | Paramètre | Config (logique) | Capture (original) | **Appliqué (logique)** | Écran ×1,25 | Statut |
> |---|---|---|---|---|---|
> | Marge horizontale (g/d) | 142 | ≈6,7 % de largeur → 68,3 | **69** | 86,25 | hypothèse, **contredit la config** |
> | Marge verticale (h/b) | 69 | 8,1 % × 576 = 46,7 | **46,7** | 58,4 | hypothèse, **contredit la config** |
> | Police | 26 | pas des glyphes = 1 em | **26** | 32,5 | hypothèse, confirmée |
> | Pas de ligne | 44 (26+18) | 51 px écran / 1,25 = 40,8 | **40,8** | 51 | hypothèse, **contredit la config** |
>
> La capture (référence visuelle du propriétaire) **contredit la config** sur l'axe horizontal (69 vs 142), vertical (46,7 vs 69) et l'interligne (40,8 vs 44). Cause probable : version localisée/override, `@position frame=` ou graphique de cadre — **non tranchée** ; le port applique donc les valeurs calibrées sur la capture pour ressembler au jeu du propriétaire. Les valeurs restent des **hypothèses sourcées**, jamais des constantes par scène. `defaultPitch = 1` confirme l'absence de `letter-spacing` (`0`). Largeur utile = 1024 − 2 × 69 = **886 px** → **34 caractères pleine chasse/ligne** (`floor(886/26)`), identique à l'original ; pas de tracking.
>
> **Plus d'ajustement automatique de police (#314)** : `fitTextBox` (échelle 1 → 0,7) a été supprimé ; la page entière est mise en page une seule fois (spans par unité, `visibility` pour la révélation), la police reste constante et le texte excédentaire est découpé comme la couche de message du moteur (pagination scriptée via `[p]`/`@pg` ; mesure exhaustive des débordements du corpus #319 : **0 page en débordement** avec cette mise en page ; fallback découpe consigné au registre #296 `text-overflow-clip`). L'accessibilité expose le texte complet une fois (`aria-live="polite"`, couche visuelle `aria-hidden`), et la typographie FR applique des espaces fines insécables avant `? ! : ;` et dans `« »`.
>
> La famille de police exacte du jeu d'origine (Mincho propriétaire) n'étant pas redistribuable, la pile Mincho/serif du système a des **métriques de glyphe** différentes à taille égale (ratio d'encre ~1,19) : écart **cosmétique** suivi au registre #296 (`text-font-metrics`), **sans réduire la police** (le pas de glyphe et les caractères/ligne, eux, sont corrects).
>
> `getComputedStyle` renvoie 26 px / 40,8 px (avant agrandissement) : la conformité se mesure sur le rendu (`getBoundingClientRect` du stage ÷ largeur du stage), pas sur la valeur calculée seule. Contrôles e2e : 32,5 px / 51 px écran, marges 69/69 (symétrie), marge haute 46,7, pas de 1 em et 34 caractères/ligne sur une ligne de `あ`, wrap identique en 1280×720, 1920×1080 et portrait (page longue + 5 pages golden).

## 4. Espacement et grille

| Élément | @1080 | @720 |
|---|---|---|
| Marge gauche/droite du texte de jeu | gauche 265 px (13,8 %), droite ≈ 275 px (14,3 %) | 177 px / 183 px |
| Largeur de zone de texte | ≈ 1380 px (72 %) | ≈ 920 px |
| Départ vertical du texte | première ligne vers 100–130 px, ou centrée verticalement selon la scène | à confirmer (§ non vérifiables) |
| Entrées du menu titre | centre x = 960 ; centres y = 622, 695, 765, 843, 916 | y = 415, 463, 510, 562, 611 |
| Logo | 501–1411 × 184–443 | 334–941 × 123–295 |
| Menu système | colonne x ≥ 1638 ; centres y = 172, 232, 290, 347, 408, 472, 536, 603, 667 | x ≥ 1092 ; pas ≈ 42 |
| En-tête système | « SYSTÈME » 1631–1861 × 44–104 | 1087–1241 × 29–69 |
| « Back » | 1643–1741 × 999–1031 | 1095–1161 × 666–687 |
| Titre d'écran | x = 31–37, y = 40–95 ; sous-titre japonais à +25 px | x = 21–25, y = 27–63 |
| Grille de sauvegarde | 2 colonnes × 4 lignes ; colonnes x = 22–768 et 790–1537 ; lignes de 202 px, pas 219 px | pas 146 px |
| Vignette de sauvegarde | 244×136 px (16:9), décalage (15, 13) dans la fiche | 163×91 |
| Grille CG | 4×4 ; tuile ≈ 300×165, pas 324×199 ; x = 357–1630, y = 148–910 | tuile 200×110 |
| Panneaux de config | gauche 75–762, droite 810–1845 × 215–950 | 50–508, 540–1230 × 143–633 |

Règles d'échelle : aligner sur une grille de 8 px@720 pour les nouveaux écrans ; les marges latérales d'un écran
système sont ≈ 2 % (22 px@1080) ; le pied d'écran (« Back »/« Retour ») occupe toujours la bande y > 960 px@1080
(y > 640 px@720).

## 5. Cadres et ornements (décrits, non copiés)

| Ornement | Description | Clés du manifeste (si connues) |
|---|---|---|
| Voile de fond système | Dégradé vertical bleu nuit, plus clair au centre, vignettage | `c_background`, `c_system_background`, `c_message_background`, `c_sound_background`, `archive_background`, `save_background`, `cg_background` |
| Bandeaux de feuillage | Silhouettes de feuillage sombres en haut (≈ 0–140 px) et en bas (≈ 930–1080 px), très peu contrastées | `c_kusa3`, `save_kusa` |
| Arabesques latérales | Tiges fines et claires courbes sur le bord droit, derrière le menu et en pied d'écran | `c_titleバー`, `archive_background` |
| Fenêtre de message | Voile noir fondu sur les côtés + arabesque en haut et en bas ; image 1024×576 sur toute la scène | `txtwindow00`–`txtwindow02`, `q_txtwindow00` |
| Cadre de panneau (config) | Filet 2 px gris-bleu, coins légèrement biseautés, libellé centré sur le bord supérieur | `c_ウィンドウ表示*`, `system_window`, `font_window` |
| Emplacement de sauvegarde | Fenêtre à bord gris-bleu fin, volute d'angle en bas à gauche quand vide, onglet de fond sombre pour le titre | `save_window`, `load_window`, `save_textwindow` |
| Boîte de dialogue | Rectangle sarcelle, bord clair, volutes d'angle (4), deux pastilles elliptiques sous le texte | `yesnodialog`, `yesno_okbutton`, `yesno_cancelbutton` |
| Toast d'information | Bandeau sarcelle gris, chevrons ornés aux deux extrémités | (pas de clé identifiée) |
| Pagination de sauvegarde | 15 chiffres cursifs sur un fil, l'actif en cyan | `save_pageボタン01`–`15`, `load_pageボタン01`–`15` |
| Ascenseur d'historique | Capsule verticale à contour cyan, pastille mobile ; trois boutons ronds (bas, haut, fermer) | `backlog_カーソルバー`, `backlog_カーソル`, `backlog_矢印下ボタン`, `backlog_矢印上ボタン`, `backlog_キャンセルボタン` |
| Lecteur audio | Boutons rectangulaires sarcelle, boutons ronds (répétition, aléatoire), 10 pastilles de volume | `sound_再生ボタン`, `sound_停止ボタン`, `sound_volumeボタン`, `sound_page1ボタン` |
| Grille CG | Tuiles à cadre ornementé sarcelle, libellé « image non affichée » tant que verrouillée | `cg_サムネイルウィンドウ`, `cg_サムネイルカーソル`, `cg_ページ移動バー` |
| Indicateurs d'attente | Feuille (ligne), livre (page), animés par feuilles de sprites de 40 vignettes | `linebreak_a`, `pagebreak_a` (déjà utilisés, `CLICK_GLYPHS`) |
| Curseur de choix | Curseur dédié animé | `selectcursor`, `selectcursor_a` |

La boîte de dialogue est implémentée en CSS pur dans `src/ui/confirm-dialog.css` (#190) : boîte 390×164 @720, dégradé et bord
issus des tokens `--mh-dialog-*`, quatre volutes d'angle en bordures arrondies, pastilles 97×24 (44 px sur écran tactile),
fondu de `--mh-dur-fast`. Écart d'accessibilité : le texte de la pastille sélectionnée passe en `--mh-bg-night-bottom`
(`#eef4f5` sur `#33a9a9` ne ferait que 2,6:1 ; la valeur d'origine du texte n'a pas été mesurée).

Quand une clé est absente (utilisateur sans assets), l'écran utilise le **repli CSS** de §9.

## 6. Opacités et effets

| Élément | Valeur |
|---|---|
| Page précédente (déjà lue) | 0,40 par défaut ; réglage 0–100 % (config « Opacité ») ; fondu de 1,5 s (« Durée 15 » = 15 dixièmes de seconde) |
| Texte principal | opacité 1, ombre noire diffuse (rayon ≈ 3 px@720) ; pas de contour dur |
| Scène sous le menu système | voile bleu nuit `#152539` à ≈ 80–85 % d'opacité : un noir de scène devient `#152539`, la scène reste devinable |
| Entrée « Archive » (désactivée) | ≈ 0,3 au repos, 1,0 quand activable |
| Entrées de menu titre | 1,0 ; fondu croisé pendant les changements de sous-menu |
| Toast | opacité 0 → 1 en 0,2 s |
| Lueurs de titres | `text-shadow: 0 0 12px rgba(0, 192, 192, .45)` (titres de config, libellés de panneau) |

## 7. Mouvement

| Transition | Durée mesurée | Courbe | Observation |
|---|---|---|---|
| Ouverture d'une boîte de dialogue | 150 ms | linéaire | Pas d'échelle, juste un fondu. |
| Ouverture du menu système (assombrissement de la scène) | 270 ms | linéaire | Le menu apparaît sur le fond déjà assombri. |
| Titre → jeu : fondu au noir | 1,2 s | linéaire | Puis apparition de la scène en 0,85 s. |
| Retour au titre : fondu au noir | 0,4 s | linéaire | Puis le titre apparaît en 0,8 s. |
| Titre → sous-menu « Extra » | ≈ 1 s | fondu croisé des entrées | Les entrées changent sur place. |
| Sous-menu → écran Sound mode | 0,3 s | fondu | |
| Toast | 0,2 s d'entrée, ≈ 2,5 s d'affichage | linéaire | Sortie à la prochaine action. |
| Texte de page | frappe caractère par caractère (vitesse réglable), pas de défilement | | |

> **Toasts : mise en œuvre (#191, HUD-13).** `src/ui/toast.ts` (`ToastStack`) et `src/ui/toast.css`, sans asset. Cadre `--mh-toast-fill` bordé de `#8da9af` → `#4a6b72`, deux chevrons (`<` et `>`) en pseudo-éléments. Mesures de l'original (510×90 px, x 1370–1880, y 950–1040 @1080) ramenées au repère logique 1280×720 du `#viewport` (×2/3, le HUD n'est **pas** dans le repère 1024×576 de la scène) : cadre 340×60 px, marges droite et bas de 27 px, vérifiées au navigateur (`getBoundingClientRect`). Corps de texte `--mh-control-size` (19,2 px) ; un message long passe à la ligne et agrandit la hauteur. Entrée en fondu de 0,2 s, maintien de 2,5 s (`duration` de `toast()` si fourni), fondu de sortie `--mh-dur-fast` ; sous `prefers-reduced-motion`, ni entrée ni sortie animées. Pile de 3 au plus, le plus ancien (en haut) disparaît ; les toasts n'interceptent pas la souris. La région `aria-live="polite"` est le conteneur `#ui-toast`, créé avant les messages.

Tokens proposés : `--mh-dur-fast: 150ms`, `--mh-dur-menu: 270ms`, `--mh-dur-fade-out: 400ms`, `--mh-dur-fade-in: 800ms`,
`--mh-dur-scene-out: 1200ms`, `--mh-dur-scene-in: 850ms`, `--mh-ease: linear`. Avec `prefers-reduced-motion`,
toutes ces durées tombent à 0 sauf la frappe du texte.

> **Transitions plein écran (HUD-14, #205).** Mise en œuvre dans `src/ui/transitions.ts` (séquencement) et
> `src/ui/transitions.css` (rideau et écran de chargement, CSS pur), branchés dans `player.ts` par trois appels :
> `beginScript` (titre → jeu, ou chargement → scène depuis la partie), `returnToTitle` (jeu → titre) et `load`
> (chargement → scène). Un rideau `#ui-transition` (`.mh-ui-transition`, z-index 250, dans `#ui-overlay`) passe par
> les phases `out` → `black` → `in` → `idle` : fondu noir **1,2 s** puis noir **0,2 s** puis scène **0,85 s**
> (titre → jeu), **0,4 s / 0,1 s / 0,8 s** (jeu → titre), **0,4 s** puis **0,85 s** (chargement → scène, ≈ 1 s de noir
> au total). Les durées ne sont pas codées en JS : `transitions.css` pose `--mh-transition-out/-in/-hold` en
> `var(--mh-dur-scene-out)` etc., le module les lit par `getComputedStyle`. Le fondu démarre **avec** le
> préchargement : quand les assets sont prêts pendant le fondu, le noir entièrement opaque ne dure que 0,2 s
> (critère « pas de noir prolongé > 1 s », testé à l'horloge simulée). Si le chargement depasse le fondu,
> `#ui-loading` (z-index 300, au-dessus du rideau) affiche un indicateur stylé, CSS pur, sans texte ni asset ; son
> apparition est retardée pour ne pas clignoter sur une scène déjà prête. Sous `prefers-reduced-motion`, tokens à 0 ms
> et module sans minuteur : aucune transition, aucun flash noir. Le détail est en §9.12.

## 8. États des composants

| Composant | Repos | Survol | Actif / sélectionné | Désactivé | Focus clavier |
|---|---|---|---|---|---|
| Entrée du menu titre | `#1f1816` | `#2843ac` | idem survol | non vu | à ajouter : souligné ou contour |
| Entrée du menu système | `#a9c8cc` | plus clair + lueur cyan | idem | non vu (« auto »/« skip » grisés si le script verrouille) | à ajouter |
| Bouton de config | dégradé gris | non vu | dégradé sarcelle | non vu | à ajouter |
| Onglet de config | blanc | lueur cyan | lueur cyan renforcée, libellé `#cfeff0` | | à ajouter |
| Radio | disque noir, anneau `#8c959a` | non vu | point intérieur gris clair | | |
| Case à cocher (« Verr. ») | carré clair vide | | cochée = verrouille la sauvegarde | | |
| Pastille de dialogue | `#2e7179` | `#33a9a9` | idem survol (la sélection suit le focus) | | contour 2 px `#5fcfc5` (implémenté, #190) |
| Bouton de sauvegarde | `#586888` → `#283858` | éclaircit, bord bleu | | grisé si emplacement vide | |
| Numéro de page | gris cursif | non vu | cyan | | |
| Tuile CG | sarcelle sombre | bord `#c0f790` | idem | libellé « image non affichée » | |
| Boutons du lecteur | `#08a8b8` | non vu | piste en lecture : bouton sarcelle clair `#20c8d0` environ | | |

## 9. Repli sans assets (obligatoire)

Un utilisateur sans extraction complète, ou la CI, ne dispose d'aucune image du jeu. Chaque composant doit :

1. se construire en **CSS pur** à partir des tokens (dégradés, filets, `box-shadow`, `text-shadow`) ;
2. n'ajouter l'image du jeu (clé du manifeste) que comme **surcouche optionnelle** (`background-image` avec
   `image-set`/`var(--mh-asset-*)`) ;
3. rester lisible et utilisable sans elle (contraste, tailles de cibles).

### Convention de clés et variables `--mh-asset-*` (HUD-03, #189)

Le module `src/ui/ui-assets.ts` fait le pont entre le manifeste de l'utilisateur et les feuilles de style.

- **Clé** : le nom de l'image dans `images` du manifeste, tel que listé en §5 (sans dossier ni extension). La recherche
  est tolérante comme celle du reste du player (`foldKey` : NFKC, casse, espaces de bordure). Le dépôt ne contient que
  des clés, jamais d'URL ni de nom de fichier.
- **API** : `createUiAssets(resolver)` renvoie `{ uiAsset, apply, clear }`.
  - `uiAsset(key)` : URL complète (préfixe de base compris) ou `null` si la clé est absente. Aucune requête, aucun
    avertissement : l'absence est un cas normal.
  - `apply(root, keys = UI_ASSET_KEYS)` : pose `--mh-asset-<clé>: url("…")` sur la racine de l'UI **uniquement pour les
    clés présentes**, et retire celles qu'une application précédente avait posées et qui ont disparu. `clear(root)`
    les retire toutes. `UI_ASSET_KEYS` liste les clés exactes de §5 ; un écran passe ses propres clés pour les autres.
- **Nom de variable** : `--mh-asset-` + clé repliée (NFKC, minuscules), toute suite de caractères hors lettres, chiffres,
  `_` et `-` devenant `-` (`c_background` donne `--mh-asset-c_background`, `cadre test (a)` donne
  `--mh-asset-cadre-test-a`). Les lettres japonaises sont conservées (`--mh-asset-c_titleバー`).
- **Usage CSS** : toujours en surcouche du repli, avec `none` comme valeur de secours pour la variable absente :

  ```css
  .mh-ui-screen {
    /* l'image du jeu, si elle existe, au-dessus du dégradé en CSS pur */
    background-image: var(--mh-asset-c_background, none), linear-gradient(var(--mh-bg-night-top), var(--mh-bg-night-bottom));
  }
  ```

  Sans variable, la déclaration se résout en `none` + dégradé : le navigateur ne lance aucune requête et l'écran garde son
  aspect de repli.

### 9.1 Fond « nuit bleue » (`.mh-ui-night`, HUD-02 / #188)

Premier composant à suivre ce principe : `src/ui/night.css` (importé par `src/ui/night.ts`).

- **Usage** : ajouter la classe `mh-ui-night` au conteneur d'un écran système ; le contenu s'empile au-dessus. La variante `mh-ui-night-veil` donne le voile translucide `#152539` à 82 % (§6) pour les écrans qui laissent voir la scène (menu système), avec feuillage et arabesques mais sans image.
- **Rendu sans asset** (repli, toujours présent) : dégradé vertical `--mh-bg-night-top` → `-mid` → `-bottom` avec éclaircie `-mid-right` à droite et vignettage ; bandeaux de feuillage haut (13 %) et bas (14 %) de la hauteur, silhouettes `--mh-bg-night-top` sur un lit `#101c27` ; arabesques en arcs et volutes sur la bande droite et en pied d'écran. Tout est en **pourcentages** du conteneur : les mesures @1080 (140 px et 150 px de bandeau, colonne droite x ≥ 1638 sur 1920) ne dépendent d'aucun repère de pixels.
- **Surcouche d'image** : suit la convention de clés ci-dessus : le calque lit `var(--mh-asset-night, var(--mh-asset-c_background, none))`. `--mh-asset-c_background` (clé du manifeste, posée par `createUiAssets().apply`) est l'image par défaut ; un écran qui veut une autre image pose `--mh-asset-night: var(--mh-asset-<clé>)`. Aucune des deux présente : `none`, donc aucune requête. Le CSS ne contient aucune URL.
- **Contraste** : les ornements sont plafonnés (arabesques à 14 % et 9 % de `--mh-cyan-rail`) pour que tout texte clair des tokens reste ≥ 7:1, même sur un trait d'arabesque posé sur le fond le plus clair. `tests/unit/ui/night-css.test.ts` recalcule ces rapports à partir de `tokens.css` : modifier une opacité ou un token qui casse le seuil fait échouer le test.
- **Démonstration** : `?night` dans l'URL pose la classe sur le slot `#ui-menu` pour les écrans listés dans `NIGHT_DEMO_SCREENS` (`syncNightDemo`, une ligne dans `ui-manager.ts`). Cet ensemble est **vide** depuis HUD-12 (#201) : l'historique porte désormais la classe en permanence (§9.7). Les écrans de sauvegarde et de chargement la portent aussi depuis HUD-10 (#196, `NIGHT_FIXED_SCREENS` dans `night.ts`, §9.5) ; la configuration la porte en permanence depuis HUD-09 (#200, §9.10). L'écran titre en est sorti (HUD-07, #195) : il est clair ; seule la liste de chapitres d'Extra porte `mh-ui-night` en dur. Les autres écrans, dont le menu système (HUD-06, §9.2), adopteront la classe écran par écran.

### 9.2 Menu système plein cadre (`src/ui/system-menu.ts`, HUD-06 / #194)

Écran ouvert par le clic droit ou `Échap` (vue `pause`). Il remplace le panneau centré « Pause ».

- **Entrées** (tableau `SYSTEM_MENU_ENTRIES`, ordre de ANALYSE §2.5 **sans** `exitgame`, décision 3) : `save`, `load`,
  `config`, `auto`, `skip`, `backlog`, `flowchart`, `graphic`, `title`, puis « Back » (`common.back`) en bas à droite.
  `save` et `load` sont désactivés quand `quickMenuLocked` (info-bulle `systemMenu.quickMenuLocked`). `auto` et `skip`
  basculent le mode puis referment le menu (`aria-pressed`, entrée éclaircie quand le mode est actif) ; `graphic` appelle
  `toggleUserHide` puis referme ; `title` passe par `confirm(…)` avec **Non** par défaut ; `flowchart` ouvre la vue
  intégrée (FLOW-05/06/07, branchement FLOW-08 / #207) entre `backlog` et `graphic`.
- **Voile** : le slot `#ui-pause` reçoit `mh-ui-night mh-ui-night-veil` (voile `#152539` à 82 %, feuillage et arabesques
  de HUD-02) tant que le menu est rendu ; apparition en `--mh-dur-menu` (270 ms, linéaire), sans animation sous
  `prefers-reduced-motion`. Un nouveau clic droit ou `Échap` referme ; un clic droit pendant la confirmation ne fait rien.
- **Mise en page mesurée à 1280×720** (repère du HUD, facteur ×2/3 depuis 1920×1080 ; **pas** le repère 1024×576 de la
  scène) : colonne alignée à gauche en x = 1092 (85,3125 %), rangées de 41,25 px (2,578 rem) du centre y = 115 au
  centre y = 445 (la 7e rangée tombe sur l'ancien emplacement de `graphic`, la 9e sur celui d'`exitgame` : `flowchart`
  prend la place de l'une, `title` celle de l'autre) ; corps `--mh-sysmenu-size` (24,8 px) ; en-tête « SYSTÈME » (serif
  1,3 rem, interlettrage 0,45 em, `#c2dee0`) en x = 1087, y = 29, encre mesurée sur le rendu x = 1088–1238 (cible
  1087–1241) ; « Back » (`--mh-back-size` 1,8 rem) encre mesurée x = 1095, y = 667–687 (cible 1095, 666–687). Les
  centres de rangée de l'original ne sont pas réguliers (mesure au x-height) : l'écart maximal avec une colonne
  régulière est de 8 px (1,1 % de la hauteur).
- **Clavier** : le focus initial est la première entrée utilisable ; `Tab` / `Maj+Tab` bouclent entre les entrées et
  « Back » (piège de focus), `↑` `↓` `Début` `Fin` déplacent le focus ; contour 2 px `--mh-focus`. `role="dialog"`,
  `aria-modal="true"`, nommé par l'en-tête ; sous-titre japonais `aria-hidden`.
- **Rendu sans asset** : aucune image ; seule la surcouche `--mh-asset-*` de night.css s'applique aux autres écrans
  (la variante voile ne peint pas d'image).

### 9.3 Écran titre (`title-screen.ts`, HUD-07 / #195)

- **Module** : `src/ui/title-screen.ts` + `title-screen.css` ; `ui-manager.ts` ne fait que l'instancier (`renderTitle`) et appeler `createUiAssets(resolver).apply(overlay, [...UI_ASSET_KEYS, ...TITLE_ASSET_KEYS])` à l'init (le résolveur arrive par `new DomUIManager({ resolver })`, voir `main.ts`).
- **Clés du manifeste** : `title_background` (illustration plein cadre, `background-size: cover`) et `title_titlelogo` (logo, `contain` dans la boîte du logo). Absentes : dégradé crème (`--mh-title-sky` → `--mh-paper` → `#f2f3ea`) et titre textuel `<h1>` (`common.gameTitle`). Avec l'image, le texte reste dans le DOM mais n'est plus dessiné.
- **Mesures** (§4, converties en % du cadre via `container-type: size` + `cqh`/`cqw`) : logo x 334-941, y 123-295 ; menu centré, premier centre y = 415, pas 49 px ; mention de droits y 684-693. Mesurées au navigateur à 1280×720 : écart < 1 px.
- **Menu** : `<nav aria-label>` de `<button>` : *Start*, *Load*, *Continuer* (si autosave), *Flowchart*, *Config*, *Extra*. Pas d'Exit. Serif, interlettrage 0,25 em, repos `--mh-ink`, survol et focus `--mh-ink-hover`, contour de 2 px au clavier. Flèches, Début, Fin déplacent le focus ; Entrée et Espace activent (natif).
- **Extra** : remplace sur place les entrées du menu par Archive, Cgmode, Soundmode, Back (HUD-08, #199, voir §9.9). Les classes `mh-ui-scripts` / `mh-ui-script` et l'attribut `data-file` de la liste des chapitres sont conservés.

### 9.4 Écran « Flowchart » (FLOW-05 / #197)

`src/ui/flowchart-view.css` : CSS pur sur les tokens, fond `mh-ui-night`. Mesures @720 : titre en x 21, y 20-62 (`--mh-screen-title-size`) ;
colonne latérale (compteurs, légende) 236 px ; carte défilante x 277-1265, y 78-650 ; « Retour » en bas à droite (x 1065-1161, `--mh-font-title`).
Nœud 64 x 40 (unités de `layoutFlowchart`), arêtes 2 px `--mh-panel-border-light`, parcourues `--mh-cyan-rail`. Libellés de choix à 12 px (en dessous des
16 px@720 recommandés : le graphe est dense, le zoom de #202 compensera, voir 9.6). Détail des états et de l'anti-spoiler : `ENCHAINEMENT_SCRIPTS.md`.

### 9.5 Écrans de sauvegarde et de chargement (HUD-10 / #196)

`src/ui/save-load-screen.ts` + `save-load-screen.css` (DOM et styles), `src/ui/save-pages.ts` (modèle pur : pagination, curseur, date), branchés dans `ui-manager.ts` par `renderSaveLoad` / `refreshSaveLoad`. CSS pur, sur `mh-ui-night`, aucun asset.

- **Grille** : 2 colonnes × 4 lignes = 8 fiches par page, 15 pages, soit 120 positions. Les emplacements spéciaux du port (`auto`, `quick`) sont **en tête de la page 1** avec une pastille sarcelle (« Auto », « Rapide ») et un liseré cyan ; il reste 118 emplacements numérotés (1 à 118). Le player envoie les 120 emplacements (`saveSlotIds()`), l'écran complète les absents par des vides.
- **Mesures** (repère 1920×1080 de l'analyse, ×2/3 vers 1280×720, vérifiées au navigateur) : grille 1010×573 px à (15, 79) ; fiche 497×135 px, gouttières 15 px (colonnes) et 11 px (lignes) ; vignette 163×91 px ; boutons de 24 px de haut ; sélecteur de pages à (115, 670) sur 794 px ; « Retour » en bas à droite. Le test e2e `tests/e2e/save-load.spec.ts` vérifie les dimensions des fiches, l'absence de débordement et le placement dans le `#viewport`.
- **Fiche** (`<article>` nommé) : vignette 16:9, pastille d'emplacement, titre de scène (`sceneTitle`, sinon nom du fichier), date `AAAA/MM/JJ hh:mm:ss` (heure locale), commentaire (60 caractères au plus, validé par `change`, Échap annule), case « Verr. », *Supprimer*, *Charger* (ou *Sauvegarder*). Emplacement vide : cadre sombre `#18222d` à volute d'angle, sans contenu (en sauvegarde : seulement le nom et *Sauvegarder*).
- **Confirmations** : *Charger* confirme dans l'écran avec **Oui** présélectionné ; l'écrasement et la suppression sont confirmés par le player (`save`, `deleteSave`), **Non** présélectionné. Un emplacement verrouillé désactive *Supprimer* ; *Sauvegarder* y est refusé (`aria-disabled`) avec le message « verrouillé ». Le verrou et le commentaire passent par la commande `updateSave(slot, { comment?, locked? })`, qui appelle `SaveStore.update` puis rafraîchit l'écran.
- **Rafraîchissement** : `DomUIManager.show` met la grille à jour sur place (`setSlots`) : page, focus et saisie sont conservés, seules les fiches modifiées sont reconstruites.
- **Clavier** : tabulation (une seule fiche dans l'ordre de tabulation, curseur itinérant) ; flèches entre fiches ; Entrée sur une fiche = action principale ; `PageUp`/`PageDown` changent de page ; flèches gauche/droite sur le sélecteur ; Échap ferme l'écran (ou annule la saisie d'un commentaire).
- **Export / import JSON** (WEB-03, #198) : deux boutons « Exporter » et « Importer » en haut à droite de la grille quand `DomUIManager` reçoit `saveTransfer` (`main.ts` les branche sur `downloadSaveExport`, `pickSaveFile` et `importSaveFile`). L'export télécharge le fichier ; après un import qui a écrit au moins un emplacement, le message s'affiche puis la page est rechargée (2,2 s) pour que la progression fusionnée soit prise en compte.
- **Lecture des emplacements** : le player lit les 120 positions avec **un seul** `SaveStore.list()` (un parcours IndexedDB) au lieu de 120 `get`, puis complète les vides.
- **Écarts connus** : l'écran Save n'a pas été vu dans la vidéo (écart E10, gabarit de Load réutilisé) ; la colonne du menu système à droite (en jeu, desktop) n'est pas reprise (le menu plein cadre de HUD-06 se referme à l'ouverture de l'écran) ; le portrait (1 colonne, cibles de 44 px) relève de WEB-02 (#210) ; les vignettes restent des data-URL dans `localStorage` jusqu'à WEB-03 (#198).

### 9.6 Routes d'URL des écrans (WEB-04 / #204)

Pas d'élément visuel : l'URL décrit l'écran ouvert, pour le lien direct, le partage et le bouton précédent. `src/ui/router.ts` (module pur et adaptateur d'historique), branché dans `player.ts`.

| Route | Écran | Sans partie en cours |
|---|---|---|
| `#/title` | écran titre | oui |
| `#/game` | partie (le menu système `pause` en fait partie : pas d'entrée d'historique de plus) | repli sur `#/title` |
| `#/load` | chargement (titre ou partie) | oui |
| `#/save` | sauvegarde | repli sur `#/title` |
| `#/config` | configuration (écran `settings`) | oui |
| `#/backlog` | historique | repli sur `#/title` |
| `#/flowchart` | flowchart (vue FLOW-05/06/07, intégrée par FLOW-08 / #207) | oui |

- **Hash, pas de chemin** : aucun `base` Vite n'est configuré et un hébergement statique ne réécrit pas `/load` vers `index.html` ; `#/load` marche partout sans configuration serveur, et le changement de hash ne recharge jamais la page.
- **Aucun spoiler dans l'URL** : seulement le nom de l'écran. Jamais d'identifiant de script, de libellé, de chapitre ni de progression ; `parseRoute` refuse sous-chemins, paramètres et inconnus (repli sur le titre).
- **Précédent ferme l'écran** : ouvrir un écran empile une entrée, le fermer (bouton, Échap ou précédent) revient à l'entrée d'en dessous, sans boucle. Un lien direct vers un écran (`#/config`) est précédé du titre dans l'historique : précédent le ferme et affiche le titre. Titre → partie, chargement d'une sauvegarde et retour au titre *remplacent* l'entrée au lieu d'en ajouter.
- **Précédent depuis la partie vers `#/title`** (possible après un chargement depuis le titre) demande la même confirmation que « Title » du menu système (Non présélectionné) ; refusée, l'URL revient à `#/game`.
- **Repli propre** : un écran qui exige une partie sans partie, une route inconnue, ou un écran refusé (menu rapide verrouillé) laissent l'URL alignée sur la vue réelle. Une partie n'est jamais reconstruite depuis l'URL : recharger sur `#/game` revient au titre.
- Toute API d'historique est entourée d'un `try/catch` ; sans historique (iframe sandbox), les écrans restent utilisables sans URL.

### 9.7 Écran d'historique (`backlog-screen.ts`, HUD-12 / #201)

`src/ui/backlog-screen.ts` + `backlog-screen.css`, branché dans `ui-manager.ts` par `renderBacklog` (3 lignes). Écran plein cadre sur `mh-ui-night` (posé en permanence par `NIGHT_FIXED_SCREENS`, plus de `?night`), CSS pur, aucun asset (clés `backlog_*` du manifeste non utilisées : le repli est le rendu).

- **Contenu** : titre « Back Log » (`history.title`, `history.title.deco` en japonais `aria-hidden`) ; `<ol role="list" aria-label="Historique">` d'une `<li>` par page lue, dans la police (`--mh-font-text`), le corps (`--mh-text-size`, 33,6 px) et l'interligne (`--mh-text-leading`, 50,4 px) du texte de jeu, retrait de première ligne 1 em, une ligne vide entre pages ; `user-select: text`. Ouvert sur la **dernière** page.
- **Mesures à 1280×720** (repère du HUD, ×2/3 depuis 1920×1080, **pas** le repère 1024×576 de la scène ; vérifiées au navigateur, voir `tests/e2e/backlog.spec.ts`) : texte x 177 à 1063 ; zone défilante x 177 à 1172, y 85 à 651 ; ascenseur de 39 px au bord droit de la zone (x 1133 à 1172), pastille de 67 px au minimum ; trois boutons ronds de 33 px (bas, haut, fermer) à y 667 à 699, alignés à gauche en x = 1092 avec 8 px d'écart (l'original ne dit pas leur abscisse : ils sont centrés sous l'ascenseur) ; titre en x 21, y 27 à 63.
- **Ascenseur** : barre de défilement **native** stylée (capsule à contour `--mh-cyan-rail`, pastille en dégradé cyan) : `::-webkit-scrollbar` (Chrome, Edge, Safari) ; `scrollbar-color` n'est posé que sous `@supports not selector(::-webkit-scrollbar)` (Firefox), car Chrome 121+ ignore les pseudo-éléments dès que `scrollbar-color` est présent. Molette et tactile restent natifs.
- **Clavier** : la zone défilante est focusable (`tabindex="0"`, focus initial) ; `PageUp` / `PageDown` (90 % de la hauteur visible), `↑` `↓` (3 lignes), `Début`, `Fin` ; `Tab` boucle entre la zone et les boutons (écran modal) ; `Échap` ferme (géré par `DomUIManager`, comme tous les écrans superposés) ; contour 2 px `--mh-focus`. Le défilement est animé (`scroll-behavior: smooth`) sauf sous `prefers-reduced-motion`. Sur écran tactile, les boutons passent à 44 px.
- **Ouverture à vide** : `Player.openScreen("backlog")` ne montre aucun écran quand l'historique n'a pas de texte et affiche le toast `toast.historyEmpty` (« L'historique n'existe pas encore. ») ; depuis le menu système, le menu reste ouvert. Rouvrir l'historique déjà ouvert (raccourci) n'empile rien.
- **Écarts connus** : le retour à une page par clic sur une entrée n'existe pas dans le port (le retour arrière reste « un point en arrière », `←` ou molette) et n'est pas ajouté ici (la sémantique du rollback est inchangée) ; les deux niveaux de luminosité de l'original (lu/non lu ou survol, non tranché) ne sont pas reproduits ; l'historique contient un point par clic (l'affichage progressif d'une page produit plusieurs entrées cumulatives), comportement du player inchangé ; pas d'onglet Flowchart (décision 2).

### 9.8 Commandes tactiles : gestes et barre d'actions rapides (WEB-01 / #203)

`src/ui/touch-controls.ts` + `touch-controls.css` (DOM et styles), `src/ui/gestures.ts` (reconnaissance des gestes, module pur sans DOM), branchés dans `ui-manager.ts` par une seule instanciation (`createTouchControls` à l'init, `sync` dans `renderStatus`, `dispose`). CSS pur, aucun asset. Ces commandes n'existent pas dans l'original (écarts E24 et E25 de l'analyse, §2.4 et §2.5) : aucune mesure d'origine à reprendre.

- **Détection** : `matchMedia("(pointer: coarse)")`, ou un toucher réellement observé (`pointerType === "touch"`, appareils hybrides), jusqu'à ce qu'un clic de souris le démente. L'overlay reçoit alors la classe `mh-ui-touch` et la racine `#ui-touch` est créée ; **sur desktop souris aucun nœud n'est créé**. Le clic droit, `Échap` et les raccourcis clavier ne changent pas.
- **Geste** : appui simple = avancer (le `click` natif, inchangé) ; **appui long (500 ms, sans bouger de plus de 12 px) = menu système** (`openScreen("pause")`) ; **balayage vers le haut (≥ 56 px, ≤ 700 ms, axe vertical dominant 1,5 fois) = historique**. Les autres balayages et les gestes à deux doigts ne font rien. Un geste ne part pas d'un bouton, d'un panneau ni d'un champ, et seulement en jeu (entrées actives, sans confirmation ouverte). Le `click` synthétique qui suit un geste reconnu est supprimé 400 ms ; le `contextmenu` natif d'un appui long tactile (Android) est neutralisé (sinon le gestionnaire du clic droit refermerait le menu) et vaut lui-même un appui long. Seuils dans `DEFAULT_GESTURE_CONFIG`.
- **Bouton de menu** (`.mh-touch-menu`, trois traits en CSS, `aria-label` « Menu ») : coin haut-droit, discret au repos (opacité 0,4), plein pendant 3 s après un toucher ; un appui ouvre le menu système. Le badge Auto/Skip se décale à sa gauche.
- **Barre d'actions rapides** (`.mh-touch-bar`, `role="toolbar"`) : en bas de la scène, centrée, opacité 0,55 au repos, 1 pendant 3 s après un toucher. Boutons, dans l'ordre : **Q.Save** (`save("quick")`, le player demande la confirmation d'écrasement), **Q.Load** (ouvre l'écran de chargement, comme le raccourci « chargement rapide » : on ne remplace pas la partie sans demander), **Auto** et **Skip** (bascules `aria-pressed`, bord épais cyan + trait d'appui quand actives), **Historique**, **Plein écran** (omis si `requestFullscreen` n'existe pas, par ex. iPhone). Q.Save et Q.Load sont désactivés quand le script a posé `@lockquickmenu`. **Pas de bouton Exit** (décision 3). Barre et bouton sont cachés hors jeu (titre, menus) et quand le texte est masqué. Libellés : clés `touch.*` (et `systemMenu.entry.*` pour Auto, Skip, Historique), aucune chaîne en dur.
- **Cibles en pixels réels** : le viewport 1280×720 est réduit par `transform: scale()` (≈ 0,54 sur un téléphone de 844×390) ; 48 px logiques ne feraient que 26 px à l'écran. `touch-controls.ts` pose `--mh-ui-scale` (échelle courante, relue au `resize`, `orientationchange` et `fullscreenchange`) et `--mh-touch-target-px` (48) sur l'overlay ; la feuille divise : `--touch-target = 48px / --mh-ui-scale`. Marges, gouttières, police (14 px réels) et contour de focus (2 px) suivent la même conversion. Mesuré en émulation tactile de Chromium (844×390, 932×430 et 1024×768) : 7 cibles de 48 px de haut, de 48 à 92 px de large (minimum exigé : 44), toutes dans l'écran, la barre occupant ≈ 450 px sur 844.
- **Pas de zoom ni de défilement de page** : `html, body, #app` ont `touch-action: pan-x pan-y` (pas de pincement ni de double appui de zoom, mais les écrans à contenu long défilent) et `overscroll-behavior: none` ; en jeu l'overlay prend `touch-action: none` (`.mh-ui-overlay[data-screen="game"]`), le glissement appartient aux gestes. Le `viewport` de `index.html` interdit déjà le zoom. `-webkit-touch-callout` et la sélection de texte sont coupés.
- **Accessibilité** : vrais `<button>`, `aria-label` via le dictionnaire, `aria-pressed` sur les bascules, focus visible (contour 2 px `--mh-focus`, décalage 2 px, en pixels réels), pas d'animation sous `prefers-reduced-motion`.
- **Écarts connus** : le **volume** de l'issue n'est pas dans la barre (il exige de lire les réglages audio, que `PlayerStatus` ne porte pas ; il reste dans la config) ; le balayage depuis le bord droit n'est pas câblé ; les entrées du menu système (`system-menu.css`, ≈ 22 px réels sur téléphone) et des autres écrans restent sous 44 px réels : **WEB-02 (#210)** reflowe les écrans (portrait compris), **WEB-06 (#211)** les audite. En portrait la barre passe sur deux lignes (`flex-wrap`) mais l'écran n'est pas adapté avant #210.
### 9.9 Sous-menu Extra et Archive (HUD-08 / #199)

`src/ui/title-screen.ts` (sous-menu), `src/ui/archive-view.ts` + `archive-view.css` (liste des chapitres), `src/ui/chapter-list.ts` (règle de déverrouillage, pure). CSS pur, aucun asset ; `ui-manager.ts` ne fait que transmettre `unlockedChapters` (champ optionnel de la vue `title`), calculé par le player.

- **Sous-menu en place** : *Extra* masque le menu (`nav.mh-ui-title-menu.is-away`) et affiche `nav.mh-ui-title-extra-menu` à la **même place** : Archive, Cgmode, Soundmode, Back, premier centre y = 415, pas 49 px @720 (mesuré au navigateur à 1280×720 : centres 415, 464, 513, 562, x = 640, identiques à ceux du menu). Mêmes classes d'entrée, même typographie, même survol bleu. Libellés d'origine en anglais (`title.entry.archive|cgmode|soundmode|back`), traduits en japonais. **Aucune entrée Flowchart** dans Extra (décision 2) ni Exit.
- **Fondu croisé** : opacité 1 → 0 et 0 → 1 en `--mh-title-extra-fade` (1000 ms) ; l'élément sortant passe `visibility: hidden` à la fin du fondu et reçoit `inert` tout de suite (hors focus et hors lecteur d'écran). Sous `prefers-reduced-motion`, la durée tombe à 0 (le sous-menu apparaît sans fondu).
- **Entrées grisées** : texte à ≈ 30 % (`color-mix(in srgb, var(--mh-ink) 30%, transparent)`, et non `opacity`, pour que le contour de focus reste net), `aria-disabled="true"`, sans action, **toujours atteintes par les flèches** et décrites par un texte masqué (`aria-describedby`) et une infobulle : « Archive se déverrouille après un premier lancement du jeu » ou « Bientôt disponible ». **Cgmode** n'est grisée que si le manifeste de l'utilisateur ne contient aucune image de CG (`title-screen.ts` grise l'entrée quand `TitleActions.cgMode` est absente ; `ui-manager.ts` ne la fournit que si le catalogue est non vide, voir §9.13) ; **Soundmode** n'est grisée que si le manifeste ne contient aucun BGM (`ui-manager.ts` ne fournit `TitleActions.soundMode` que si la liste est non vide, voir §9.16). Aucun écran fantôme d'ici là.
- **Règle de déverrouillage** (`unlockedChapterIds`) : un chapitre est déverrouillé quand son **script d'entrée** a été ouvert (`StoryProgress.visited`), lu jusqu'au `@return` (`finished`) ou terminé (réglage historique `completed`). Une autosave déverrouille le premier chapitre. Aucun chapitre « suivant » n'est offert d'office. **Archive est grisée tant que la liste est vide**, c'est-à-dire sur un profil vierge ; dès qu'une partie a été lancée (Start), le prologue est déverrouillé et Archive s'allume. Le choix de chapitre exigé par la DoD v1.0 reste donc accessible dès la première partie (Extra, Archive, chapitre).
- **Archive** : fond nuit bleue, titre « Archive », grille de 4 colonnes (`ARCHIVE_COLUMNS`), les chapitres déverrouillés gardent `data-file` et le titre local ; **anti-spoiler** : un chapitre verrouillé affiche « ??? », porte `aria-disabled`, un `aria-label` « Chapitre N verrouillé » (numéro de rang uniquement), **ni titre ni `data-file`**, et ne reçoit pas le focus par Tab (les flèches le traversent). Faute d'information de progression (`unlockedChapters` absent), tous les chapitres sont proposés.
- **Clavier** : flèches, Début, Fin dans le sous-menu et dans la grille ; Entrée active ; **Échap = Back** : depuis l'Archive vers le sous-menu (focus sur Archive), depuis le sous-menu vers le menu principal (focus sur Extra) ; au menu principal, Échap n'est pas intercepté.
- **Écarts connus** : l'original n'a pas de grille de « livres » (`archive_*`) dans notre repli : la grille de boutons est conservée, sans illustration ; ces visuels pourront venir en surcouche `--mh-asset-*` plus tard. Le fondu croisé est mesuré par sa durée CSS (1 s), pas par comparaison d'images.
### 9.10 Écran de configuration (HUD-09 / #200)

`src/ui/config-screen.ts` (DOM, comportements) + `config-screen.css` (styles), branchés dans `ui-manager.ts` par `renderSettings` (une fonction ; `ui-manager.css` n'a plus de règle de config). CSS pur sur les tokens, aucun asset, fond `mh-ui-night` sur `#ui-menu` (`NIGHT_FIXED_SCREENS` contient `settings`). Le modèle de réglages et `updateSettings` ne changent pas ; `docs/CONFIG_PLAN.md` §6.1 consigne la décision « retour au design d'origine ».

- **Mesures** (repère 1920×1080 de l'analyse §2.9, ×2/3 vers 1280×720, vérifiées au navigateur) : titre « Config » encre x 22–131, y 26–62 (cible 21–141 × 27–63) ; onglets en serif (`--mh-title-menu-size`), Système x 553 (cible 553), encre y 39–65 ; colonne gauche x 50–508 (cible 50–508), droite x 540–1224 (cible 540–1230), panneaux à partir de y 143, aucun défilement en français ; « Retour » centré en x 643, y 677 ; « Réglages par défaut » 1030–1230 × 663–700 (cible exacte). Les gaps entre onglets ne reproduisent pas ceux de l'original (mesurés sur d'autres libellés) : Raccourcis finit en x 1175 au lieu de 1207.
- **Panneaux** : `<fieldset>` + `<legend>` (libellé centré sur le bord haut, serif `--mh-panel-label`, lueur §6) ; bord 2 px `--mh-panel-border-light` en haut à gauche et `--mh-panel-border-dark` en bas à droite, fond `--mh-panel-fill`. Deux colonnes par onglet ; Raccourcis : un panneau pleine largeur, 14 actions sur deux colonnes, touches en capsules.
- **Contrôles** : boutons à bascule (`aria-pressed` ; actif `--mh-teal-on-*`, inactif `--mh-grey-off-*`) ; interrupteurs (cases natives habillées, même palette) ; radios Oui/Non (disque noir, anneau `#8c959a`, point `#cbcbcb`) ; curseurs `<input type="range">` à piste `#080808`, 5 repères et pastille sphérique `#cbcbcb` ; spinners −/+ à deux chiffres (`role="spinbutton"`, ↑ ↓ PageUp PageDown Début Fin ; durée du fondu au dixième de seconde, opacité en %) ; zone d'aperçu noire qui rejoue le fondu réglé au clic ou à Entrée.
- **Onglets** : `role="tablist"`, tabulation itinérante (un seul onglet dans l'ordre de tabulation), ← → Début Fin changent et activent l'onglet sans reconstruire la barre ; le focus initial est l'onglet actif. Les titres japonais (en-tête, rubrique sous les onglets) sont `aria-hidden` (clés `.deco`).
- **Pied** : *Retour* ferme l'écran ; *Réglages par défaut* demande confirmation (boîte HUD-05, **Non** présélectionné), puis `resetSettings` (langue et progression conservées). Pas de bouton Exit (décision 3).
- **Système → Flowchart** : interrupteur `flowchartRevealAll` (« tout révéler », désactive l'anti-spoiler), défaut désactivé, envoyé seul à `updateSettings`, remis à `false` par « Réglages par défaut ».
- **Tactile** : `@media (pointer: coarse)` porte toutes les cibles à 44 px de haut au moins (les colonnes défilent si besoin).
- **Test** : `tests/unit/ui/config-screen.test.ts`, `config-screen-css.test.ts`, `tests/e2e/config-screen.spec.ts` (mesures à 1280×720, clavier, bascule persistée, confirmation).
### 9.11 Interactions du flowchart (FLOW-06 / #202)

`src/ui/flowchart-viewport.ts` (pan, zoom, mémoire du zoom), `src/ui/flowchart-detail.ts` (volet de détails, relecture), styles dans `flowchart-view.css`. Description des gestes : `ENCHAINEMENT_SCRIPTS.md` (« Interactions »).

- **Mesures @1280×720** (vérifiées au navigateur, `getBoundingClientRect`) : carte 988 × 572 px à (277, 78) (zone visible 984 × 568, bordure de 2 px) ; boutons ronds de zoom et de centrage 34 px (44 px en `pointer: coarse`), pourcentage de zoom entre les deux, colonne à 22 px du bord droit et 16 px du bas de la carte ; volet de détails 280 px de large à 12 px du haut et 22 px de la droite de la carte.
- **Zoom** : 25 % à 300 %, cran ×1,25. Libellés de choix à 12 px à 100 % (sous les 16 px recommandés, voir 9.4) : 24 px à l'écran à 200 %, ce qui les rend lisibles ; le pincement et `Ctrl` + molette zooment sous le curseur.
- **Tokens** : boutons et volet sur `--mh-panel-fill` / `--mh-panel-border(-light)`, survol `--mh-cyan-glint`, titre du volet `--mh-font-title` en `--mh-panel-label`, bouton « Relire depuis ici » en dégradé `--mh-teal-on-*`, nœud sélectionné en contour `--mh-text-title`. Aucune image, l'icône de centrage est dessinée en CSS.
- **Curseurs** : `grab` / `grabbing` sur la carte, `pointer` seulement sur les nœuds ouverts ; silhouettes et nœuds révélés non visités gardent le curseur de la carte.
- **Mouvement** : le zoom est instantané ; le centrage défile en douceur sauf sous `prefers-reduced-motion` (instantané) ; l'animation d'ouverture de l'écran est supprimée dans ce mode.
- **Tactile** : `touch-action: none` sur la carte (le glissement et le pincement passent par les pointer events) ; cibles de 44 px.

### 9.12 Transitions plein écran (`src/ui/transitions.ts`, HUD-14 / #205)

`src/ui/transitions.ts` (séquencement et lecture des durées) + `src/ui/transitions.css` (rideau, phases, écran de chargement) ; branchement minimal dans `player.ts` (trois appels et une dépendance injectable, `PlayerDeps.transitions`). CSS pur, aucun asset, aucune URL. Lecture des mesures : `ANALYSE_HUD_ORIGINAL.md` §2.12 et §7 ci-dessus, écart E23.

- **Rideau** : `#ui-transition` (`.mh-ui-transition`, `aria-hidden="true"`) créé dans `#ui-overlay` — ou dans la racine du player s'il n'y a pas d'overlay. `position: absolute; inset: 0; z-index: 250`, noir opaque, `pointer-events: auto` pendant la transition (il bloque les clics), `none` au repos. L'ordre d'empilement reste celui de `layout.md` : interface 100 < toasts 200 < rideau 250 < `#ui-loading` 300.
- **Phases** : `data-phase` = `idle` → `out` (opacité 0 → 1, `--mh-transition-out`) → `black` (opacité 1, aucun fondu, plateau `--mh-transition-hold`) → `in` (opacité 1 → 0, `--mh-transition-in`) → `idle`. Deux moments distincts sont exposés : `transition.black` (promesse résolue quand le noir est complet, utilisée par le player pour **échanger les écrans** — la scène ou le titre n'apparaît jamais pendant le fondu) puis `reveal()` (appelé une fois le préchargement terminé, après le plateau noir). Le fondu au noir tourne **pendant** `getScript`/`restore`, ce qui évite le noir prolongé quand les assets sont prêts.
- **Durées par type** (`data-kind`), toutes en `var(--mh-dur-*)` de `tokens.css` :

  | `data-kind` | `out` | `hold` | `in` | Mesures |
  |---|---|---|---|---|
  | `title-to-game` (défaut) | `--mh-dur-scene-out` (1200 ms) | 200 ms | `--mh-dur-scene-in` (850 ms) | §2.12 : 1,2 s / 0,2 s / 0,85 s |
  | `game-to-title` | `--mh-dur-fade-out` (400 ms) | 100 ms | `--mh-dur-fade-in` (800 ms) | §2.12 : 0,4 s / 0,1 s / 0,8 s |
  | `loading-to-scene` | `--mh-dur-fade-out` (400 ms) | 0 ms | `--mh-dur-scene-in` (850 ms) | §2.12 : ≈ 1 s avec la scène |

  `--mh-transition-hold` n'est pas une durée d'animation : le CSS la déclare pour que le module la lise par `getComputedStyle` (une seule source de vérité). `FALLBACK_TIMINGS` (TS) ne sert qu'en l'absence de feuille de style ; `tests/unit/ui/transitions-css.test.ts` vérifie qu'il reste égal aux tokens et que le CSS ne fige aucune durée en dur.
- **Branchement** : `beginScript` choisit `title-to-game` si le player est sur le titre, sinon `loading-to-scene` ; `returnToTitle` fait `game-to-title` (aucun fondu si l'on est déjà sur le titre) ; `load` fait `loading-to-scene` (le rollback, qui passe aussi par `restoreEntry`, reste sans fondu). Une transition en cours est interrompue par `start()` et `cancel()` est appelé si le chargement échoue : aucun minuteur orphelin, aucun rideau bloqué. Sous `prefers-reduced-motion`, le module n'ouvre pas de transition (tokens à 0 ms, aucun minuteur).
- **Écran de chargement** : `#ui-loading` (créé par `ui-manager`, visible quand les entrées sont bloquées) reste au-dessus du rideau ; pendant la transition son voile `rgba(0,0,0,.5)` devient transparent et son pseudo-élément `::before` dessine un anneau de 28 px (bordure `--mh-panel-border-light`, segment `--mh-cyan-glint`, lueur `color-mix`, rotation de 1,1 s) qui n'apparaît qu'après `--mh-loading-delay` (fin du fondu), donc pas de clignotement sur une scène déjà prête. Aucun libellé en dur (pas de clé i18n) ; sous `prefers-reduced-motion`, ni rotation ni apparition.
- **Tests** : `tests/unit/ui/transitions.test.ts` (horloge simulée : phases et durées exactes, noir ≤ 1 s quand les assets sont prêts, attente d'assets lents, `prefers-reduced-motion` sans minuteur, interruption, `dispose`), `transitions-css.test.ts` (tokens, phases, écran de chargement, absence d'asset et de `!important`), `player.test.ts` (types de transition choisis et ordre `reveal`/affichage), `tests/e2e/transitions.spec.ts` (rideau rendu dans `#ui-overlay`, durées effectives calculées par le navigateur et `prefers-reduced-motion` émulé).
- **Écarts connus** : le rôle `#ui-loading` est inchangé (il reste la couche qui bloque les entrées, pas un écran complet) ; le sous-menu Extra garde son propre fondu croisé de 1 s (HUD-08) ; les transitions d'écran internes (menu système 270 ms, confirmation 150 ms) ne passent pas par le rideau.
### 9.13 Accessibilité du flowchart (FLOW-07 / #206)

- **Clavier** : nœuds focalisables en `role="button"` avec roving tabindex (un seul arrêt de tabulation) ; flèches = nœud voisin par arête, `Home`/`End` = premier/dernier nœud, `Entrée`/`Espace` = volet de détails, `Échap` = retour (volet puis écran). Focus visible : anneau de 3 px `--mh-focus`, décalage 3 px, doublé d'un pointillé non coloré.
- **Lecteur d'écran** : équivalent liste `<ul>` imbriquée par chapitre (`.mh-flow-a11y`, masqué visuellement, présent dans l'arbre), `aria-label` par nœud, région `aria-live="polite"` annonçant la position. Anti-spoiler (décision 5) : un nœud masqué est annoncé « Scène non découverte », sans identifiant, titre ni nombre d'options, en mode par défaut.
- **Contraste** : libellés ≥ 4,5:1 ; les états ne reposent jamais sur la seule couleur (forme + pastille + texte accessible).
- **Portrait** (`orientation: portrait`) : une seule colonne, colonne latérale (compteurs et légende) masquée, zoom ajusté à la largeur et `scroll-snap` sur les groupes de chapitre (un chapitre à la fois en défilement).

### 9.14 CG mode (`src/ui/cg-mode.ts`, HUD-15 / #208)

`src/ui/cg-mode.ts` + `src/ui/cg-mode.css` (galerie et visionneuse), branchés dans `ui-manager.ts` (création du slot `#ui-cg`, action `cgMode` du sous-menu Extra, ouverture/fermeture) ; suivi des CG vues dans `src/player/cg-seen.ts`, persisté par `SettingsStore.loadSeenCg` / `saveSeenCg` (`src/player/settings-store.ts`, stockage `mahoyo.cg` de WEB-03) ; catalogue calculé à l'exécution par `AssetResolver.imageEntries()` (`src/core/asset-resolver.ts`, `listImages` dans `asset-manifest.ts`). Aucune image ni miniature n'est commitée : la grille ne contient que des clés du manifeste et des URL fournies par le résolveur. CSS pur, sans asset ni URL. Lecture des mesures : `ANALYSE_HUD_ORIGINAL.md` §2.11 et §8 (écart E18), `DESIGN.md` §2.4, §4 et §8.

- **Catalogue** (`buildCgCatalog`) : les images du manifeste sont classées par leur chemin source de pipeline — `image/` → CG « évènement », `bg/` → « arrière-plan » (la bascule Évènement / Arrière-plan de l'original) ; sont exclus les sprites (`fg/`), les rules de transition (`kind: "rule"`) et les ornements d'interface (`UI_ASSET_KEYS`). Tri stable (clé, comparaison numérique). Un manifeste sans image de CG (CI, installation vide) donne un catalogue vide : l'entrée Cgmode reste alors grisée, aucun écran fantôme.
- **Grille** : fond nuit bleue (`mh-ui-night`), titre et onglets, grille **responsive 4 → 3 → 2 colonnes** en container query sur la zone défilante (`container-type: inline-size`), tuiles au ratio 20:11 (200×110 px @720, `DESIGN §4`), largeur plafonnée à 848 px. Une tuile déverrouillée affiche l'image **calculée à l'exécution** (`<img>` du résolveur, `loading="lazy"`, `object-fit: cover`) ; une tuile verrouillée affiche le libellé « image non affichée » (clé i18n `cg.locked`), sans requête d'image. **Sélection sans couleur seule** : bord 3 px `#c0f790` (`--mh-cg-select`) **et** losange `◆` en pseudo-élément (`content`, non chromatique), plus contour de focus 2 px `--mh-focus` au clavier.
- **Clavier** : flèches (colonnes effectives lues dans `gridTemplateColumns`, repli 4), Début / Fin, Entrée active une CG vue ; onglets Évènement / Arrière-plan avec flèches et Début / Fin (`role="tablist"`) ; **Échap** ferme la visionneuse puis la galerie et rend le focus à l'entrée Cgmode du sous-menu Extra. Les tuiles verrouillées restent traversées par les flèches (`aria-disabled`, hors ordre de tabulation), comme dans Archive.
- **Visionneuse** : `role="dialog"` plein écran (dans le slot), image seule sur fond noir, navigation **précédent / suivant** en boucle parmi les CG **déverrouillées** de la catégorie active (`←` `→`, boutons), **zoom 1× à 4×** par pas de 0,5 (molette sur l'image, boutons `−` / `1:1` / `+`, touches `+` / `−` / `0`) via `transform: scale(var(--mh-cg-zoom))` ; compteur `n / total` en `aria-live="polite"`. `Échap` ferme la visionneuse sans quitter l'écran. Fermer la galerie (bouton Retour ou Échap) rend le focus à Cgmode.
- **Suivi des CG vues** : `trackCgImages` enveloppe le résolveur d'assets ; chaque image réellement demandée par le rendu (`background`, `image`) est marquée via `storageKey`, regroupée en écriture (débounce 250 ms) et persistée avec la progression (`loadSeenCg` / `saveSeenCg`, tolérant aux données corrompues). `flush()` au `pagehide`. Seules les clés vues sont déverrouillées ; le catalogue n'est jamais commité.
- **Mouvement** : aucune animation de grille ; le zoom de la visionneuse est une transition `--mh-dur-fast`, supprimée sous `prefers-reduced-motion` ; cibles de 44 px en pointeur grossier.
- **Tests** : `tests/unit/ui/cg-mode.test.ts` (catalogue, déverrouillage, grille, clavier, visionneuse, zoom, états), `cg-mode-css.test.ts` (responsive, sélection non chromatique, visionneuse, aucune ressource), `tests/unit/player/cg-seen.test.ts` (déverrouillage de bout en bout via le résolveur, débounce, persistance), `tests/unit/player/settings-store.test.ts` (stockage, données corrompues), `tests/unit/core/asset-*.test.ts` (énumération du manifeste), `tests/unit/ui/ui-manager.test.ts` (ouverture depuis Extra, focus, fermeture), `tests/e2e/cg-mode.spec.ts` (Chromium, manifeste et PNG mockés : galerie verrouillée, CG vue persistée, visionneuse).
- **Écarts connus** : le regroupement par chapitre de l'original (`cgmode.ks`, colonne de chapitres) n'est pas repris : le manifeste ne porte pas cette information ; la bascule Évènement / Arrière-plan remplace la colonne de chapitres. Le pincement tactile de la visionneuse n'est pas implémenté (molette et boutons seulement) ; le niveau de zoom n'est pas mémorisé ; aucune vignette n'est générée côté pipeline (l'image pleine résolution est affichée comme vignette, mise à l'échelle par le navigateur).

### 9.15 Intégration du flowchart (FLOW-08 / #207)

- **Trois points d'entrée** (décision 2 du propriétaire) : l'entrée *Flowchart* du menu de l'écran titre (sous *Load*, HUD-07),
  l'entrée du **menu système en jeu** (entre `backlog` et `graphic`, HUD-06) et la **route `#/flowchart`** (WEB-04), qui
  ouvre l'écran sans rechargement et reste refermable par précédent / `Échap`. L'écran **n'est pas** dans Extra ni dans
  l'historique. Les trois points passent par la même vue `screen: "flowchart"` (`FLOW-05/06/07`) ; l'ancien rendu en
  liste de chapitres a été supprimé en #197 (les champs `x`/`y` de `ScriptSummary` et le champ `progress` de la vue,
  devenus morts, sont retirés en #207).
- **Position courante** : en cours de partie, `Player.currentScript` est transmis à la vue ; le nœud courant porte
  `data-state="current"` + `aria-current="location"`, et la carte se centre dessus à l'ouverture (défilement animé,
  instantané sous `prefers-reduced-motion`). Au titre, aucun nœud courant.
- **Anti-spoiler configurable** (décision 5) : `flowchartRevealAll` (HUD-09) est relu à **chaque** ouverture de l'écran ;
  désactivé (défaut), les scènes non visitées restent des silhouettes ; activé, elles apparaissent en « non visitée » et
  les chapitres masqués sont nommés.
- **Preuves** : unités `player.test.ts` (réglage transmis), `ui-manager.test.ts` (entrées titre et menu système),
  `ui-manager-flowchart.test.ts` (tout révéler) ; e2e `tests/e2e/flowchart-integration.spec.ts` (titre, menu système,
  route, absent d'Extra et de l'historique, position courante, bascule tout révéler).


### 9.16 Sound mode (`src/ui/sound-mode.ts`, HUD-16 / #209)

`src/ui/sound-mode.ts` + `src/ui/sound-mode.css` (galerie et lecteur), branchés dans `ui-manager.ts` (slot `#ui-sound`, action `soundMode` du sous-menu Extra, ouverture/fermeture) ; lecture via `SoundEngine` (`createSoundEngine` dans `src/renderer/audio-manager.ts`, indépendant des canaux BGM/SE du jeu) ; pistes énumérées par `AssetResolver.audioEntries()` (`listAudio` dans `asset-manifest.ts`). Aucun fichier audio ni titre n'est versionné : la liste, les titres et les compositeurs viennent du **manifeste de l'utilisateur** (métadonnées facultatives `title`/`composer` des entrées audio). CSS pur, sans asset ni URL. Lecture des mesures : `ANALYSE_HUD_ORIGINAL.md` §2.10 (écart E17), `DESIGN.md` §8.

- **Pistes** : `listAudio` aplatit `manifest.audio` (tri stable par clé) ; `audioEntries()` résout les URL ; l'écran ne retient que `kind: "bgm"`. Un manifeste sans BGM (installation vide, CI) laisse l'entrée Soundmode **grisée** (aucun écran fantôme).
- **Liste** : fond nuit bleue (`mh-ui-night`), titre + sous-titre japonais décoratif (`aria-hidden`), **grille responsive 3 → 2 (→ 1) colonnes** en container query, boutons « sarcelle glossy » (titre sur la ligne 1, compositeur sur la ligne 2 — métadonnées utilisateur uniquement), hauteur ≥ 58 px. Sans métadonnée, libellé neutre `sound.track` (« Morceau N ») : aucun titre du jeu n'est utilisé comme repli. Le morceau courant est marqué par un fond plus clair, un **bord épais** et le marqueur `▶` (pas la couleur seule) ; `aria-current="true"` suit le focus, la sélection est sans effet tant que l'écran n'est pas validé.
- **Transport** : lecture/pause (▶ / ❚❚), stop (■), précédent (|◀), suivant (▶|), répétition d'un morceau (`1`), de tous (`∞`), aléatoire (`⤨`) — trois bascules `aria-pressed`, exclusives pour les deux modes de répétition. `Espace` = lecture/pause partout sauf dans un champ de formulaire ; flèches/Début/Fin dans la grille ; `Échap` ferme l'écran et rend le focus à l'entrée Soundmode. La fin d'une piste applique le mode : répétition 1 → même piste, répétition tous → bouclage, aléatoire → autre piste, sinon piste suivante puis arrêt en fin de liste.
- **Barre de progression** : `<input type="range">` (min 0, max = durée, pas 1) avec temps courant et total au format `m:ss` (chiffres tabulaires), remplissage `--mh-cyan-progress` (`#088888`), désactivée tant que la durée n'est pas connue ; la recherche est transmise au lecteur (`seek`). La position vient du `timeupdate` natif complété d'une cadence de 250 ms pendant la lecture.
- **Volume** : `<input type="range">` accessible (label visible « Volume », `aria-valuetext` en pourcentage, 10 pas comme les 10 pastilles d'origine) ; défaut `SOUND_DEFAULT_VOLUME` (0,7, = réglage BGM par défaut). La valeur est appliquée au lecteur de la galerie, pas aux réglages du jeu (le player reste maître de ses canaux).
- **Ligne d'information** : compositeur / titre du morceau courant en cyan (`#69c8c9`), filet supérieur pleine largeur, `aria-live="polite"` ; « Aucune métadonnée fournie. » si le manifeste n'en porte pas.
- **Lecteur indépendant** : un seul `<audio>` recyclé (`SoundElementLike` injectable en test), volume et recherche directs, aucune interférence avec les fondus BGM/SE du player ; `dispose()` sur fermeture de l'UI. `FakeAudioPlayer` (mock des tests) implémente aussi `SoundEngine` : lecture, suivant, répétition, aléatoire et volume sont testés sans audio réel ; `FakeSoundElement` couvre le lecteur (`sound-engine.test.ts`).
- **Accessibilité** : `role="dialog"` + `aria-modal`, vrais boutons nommés par le dictionnaire, `aria-pressed` sur les bascules, focus visible 2 px `--mh-focus`, cibles 44 px en pointeur grossier, `prefers-reduced-motion` sans transition.
- **Tests** : `tests/unit/ui/sound-mode.test.ts` (liste, métadonnées/neutralité, lecture, Espace, suivant/précédent, répétition, aléatoire, volume, progression, marqueurs, clavier, fermeture), `sound-mode-css.test.ts` (grille responsive, sélection non chromatique, absence d'asset, mouvement réduit), `tests/unit/renderer/sound-engine.test.ts` (lecteur injecté), `tests/unit/core/asset-*.test.ts` (énumération audio), `tests/unit/ui/ui-manager.test.ts` (ouverture depuis Extra, focus, fermeture), `tests/e2e/sound-mode.spec.ts` (Chromium, manifeste audio mocké).
- **Écarts connus** : la disposition « en escalier » sur 2 pages et les 10 pastilles de volume de l'original sont remplacées par une grille responsive défilante et un curseur (pagination remplacée par le défilement, décision de l'analyse §2.10) ; le niveau de volume n'est pas persisté (le réglage BGM du jeu l'est) ; les métadonnées `title`/`composer` du manifeste ne sont pas encore générées par le pipeline (facultatives, à ajouter par l'utilisateur ou dans une tâche ultérieure) ; pas de lecture gapless ni d'analyseur visuel.

## 10. Accessibilité minimale à conserver

- **Contraste** : texte clair sur fond sombre ≥ 7:1 (ex. `#a9c8cc` sur `#132337` ≈ 9:1). Le texte lu à 40 % d'opacité
  reste ≥ 4,5:1 sur les fonds sombres ; sur une scène claire, l'ombre doit rester active (le réglage d'opacité est
  laissé à l'utilisateur, avec un minimum recommandé de 30 %).
- **Taille** : corps de texte de jeu ≥ 24 px@720 ; mention légale ≥ 10 px réels ; libellés d'interface ≥ 16 px@720.
- **Cibles** : 44 px minimum sur écran tactile (le jeu d'origine est conçu pour la souris, avec des cibles de 28 à 36 px@720).
- **Clavier** : tout écran se parcourt sans souris (flèches, Entrée, Échap), focus **visible** (contour 2 px cyan
  `#5fcfc5`, décalage 2 px) ; `Échap` ferme toujours l'écran superposé. Un **filet de sécurité global**
  (`ui-manager.css`, `:where(...):focus-visible`) couvre tout contrôle sans règle dédiée ; seul l'écran titre, sur fond
  clair, garde son contour sombre `--mh-ink-hover` (docs §9.3).
- **Sémantique** : `role="dialog"` + `aria-modal` pour les écrans superposés (menu système, confirmation,
  sauvegarde/chargement, historique, configuration, CG/Sound), `role="tablist"` pour les onglets de config,
  `role="list"` pour les listes (historique, archive, son), `aria-live="polite"` pour les toasts et les statuts,
  `aria-label` sur toute icône sans texte.
- **Mouvement** : respecter `prefers-reduced-motion` — aucun fondu hors frappe du texte, et **aucune** animation de la
  scène (indicateur de clic et glyphes animés, brume, attente) ni fondu de la boîte de texte / du texte lu.
- **Preuves** : `tests/e2e/system-a11y.spec.ts` (audit axe-core par écran, clavier/focus visible de chaque arrêt,
  `Échap`, sémantique, mouvement réduit) et `tests/unit/ui/system-a11y-css.test.ts` (focus, contrastes, mouvement réduit).
- **Langue** : `lang` posé sur l'interface (`fr`, `ja`, `en`) ; les sous-titres japonais décoratifs sont `aria-hidden`.
- **Couleur seule** : un état ne dépend jamais de la seule couleur (survol = couleur + lueur ; sélection de grille =
  bord épais + marqueur).

## 11. Tokens CSS

Implémentés dans `src/ui/tokens.css` (tâche HUD-01 / #181), importés par `src/main.ts` ; préfixe `--mh-`.

```css
:root {
  /* Fonds */
  --mh-bg-night-top: #0c1924;
  --mh-bg-night-mid: #132337;
  --mh-bg-night-mid-right: #17273c;
  --mh-bg-night-bottom: #07111b;
  --mh-paper: #eee8de;

  /* Texte */
  --mh-ink: #1f1816;
  --mh-ink-hover: #2843ac;
  --mh-text: #ffffff;
  --mh-text-ui: #eef4f5;
  --mh-text-menu: #a9c8cc;
  --mh-text-menu-hover: #b1d6da;
  --mh-text-title: #f2fbff;
  --mh-text-read-opacity: 0.4;

  /* Panneaux */
  --mh-panel-fill: #151f2b;
  --mh-panel-border: #444c56;
  --mh-panel-border-light: #59616b;
  --mh-panel-border-dark: #333b45;
  --mh-panel-label: #c0d6d6;
  --mh-field-fill: #04080e;

  /* Accents */
  --mh-teal-on-top: #3d746f;
  --mh-teal-on-bottom: #133c39;
  --mh-teal-on-border: #447671;
  --mh-grey-off-top: #404342;
  --mh-grey-off-bottom: #171717;
  --mh-dialog-top: #083443;
  --mh-dialog-bottom: #285e69;
  --mh-dialog-border: #598f95;
  --mh-dialog-ornament: #376b74;
  --mh-pill-on: #33a9a9;
  --mh-pill-off: #2e7179;
  --mh-cyan-control: #08a8b8;
  --mh-cyan-progress: #088888;
  --mh-cyan-rail: #3f889c;
  --mh-cyan-glint: #5fcfc5;
  --mh-select: #c0f790;
  --mh-slot-button-top: #586888;
  --mh-slot-button-bottom: #283858;
  --mh-toast-fill: #587888;
  --mh-focus: #5fcfc5;

  /* Typo */
  --mh-font-text: "Hiragino Mincho ProN", "Yu Mincho", "Shippori Mincho", "Noto Serif JP", "EB Garamond", Georgia, serif;
  --mh-font-title: "Cormorant Garamond", "EB Garamond", Georgia, serif;
  --mh-font-ui: "Optima", "Avenir Next", "Segoe UI", system-ui, sans-serif;
  --mh-font-ja: "Noto Sans JP", "Hiragino Sans", sans-serif;
  --mh-text-size: 2.1rem;
  --mh-text-leading: 1.5;
  --mh-title-menu-size: 1.7rem;
  --mh-screen-title-size: 2.4rem;
  --mh-sysmenu-size: 1.55rem;
  --mh-control-size: 1.2rem;

  /* Mouvement */
  --mh-dur-fast: 150ms;
  --mh-dur-menu: 270ms;
  --mh-dur-fade-out: 400ms;
  --mh-dur-fade-in: 800ms;
  --mh-dur-scene-out: 1200ms;
  --mh-dur-scene-in: 850ms;
  --mh-ease: linear;

  /* Espacement (échelle de 8 px@720) */
  --mh-space-1: 8px;
  --mh-space-2: 16px;
  --mh-space-3: 24px;
  --mh-space-4: 32px;
  --mh-margin-screen: 15px; /* 22 px@1080 */
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --mh-dur-fast: 0ms;
    --mh-dur-menu: 0ms;
    --mh-dur-fade-out: 0ms;
    --mh-dur-fade-in: 0ms;
    --mh-dur-scene-out: 0ms;
    --mh-dur-scene-in: 0ms;
  }
}
```

## 12. Adaptations propres au web (à intégrer dès la conception)

- **Ratio** : `#viewport` reste 16:9 mis à l'échelle sur desktop. En portrait, les écrans système **reflowent**
  (voir `ANALYSE_HUD_ORIGINAL.md`, §3 pour la référence Tsukiweb) au lieu d'être réduits : un écran système ne doit
  pas dépendre d'un ratio fixe, seul le jeu (scène + texte) le garde.
- **Portrait — implémentation (#210, WEB-02 ; décision propriétaire 4)** : en portrait le viewport prend la taille
  réelle de la fenêtre (échelle 1, `computeViewportLayout`) au lieu du repère 1280×720 réduit. La scène 16:9 est
  affichée en **lettrebox en haut** (largeur de l'écran) et le texte de jeu passe dans une **zone dédiée sous la
  scène** (`#portrait-text-dock`, jamais superposé à l'image) : police ≥ 1,7 rem (≈ 27 px réels), défilement interne
  si la page est longue, indicateurs d'attente dans la zone. Les écrans système reflowent via
  `@media (orientation: portrait)` : titre en colonne, menu système centré sur ≈ 2/3 de la largeur (entrées ≥ 48 px),
  sauvegarde/chargement **1 colonne × 4 lignes par page** (30 pages, cibles ≥ 44 px), onglets de configuration
  défilables horizontalement, historique et confirmation pleine largeur ; `viewport-fit=cover` est activé pour les
  encoches (`env(safe-area-inset-*)`). Le paysage desktop reste **inchangé** (transform 1,25 de la scène, texte dans
  l'image). Les préréglages de taille et les modes plein écran ne s'appliquent qu'au paysage.
- **Unités** : `rem` rapportées à la taille de base du viewport (`docs/layout.md`), jamais `px` fixes.
- **Interactions tactiles** : le clic droit n'existe pas ; bouton de menu persistant discret, appui long, balayage et barre d'actions rapides (§9.8, WEB-01 / #203), actifs seulement sur appareil tactile.
- **Sauvegardes** : locales (navigateur), avec export/import ; la grille 15 pages × 8 emplacements du jeu d'origine
  représente 120 emplacements : prévoir le stockage en IndexedDB pour les vignettes.
- **Langues** : libellés d'interface séparés du code (FR/JA/EN) ; les sous-titres japonais d'origine sont décoratifs
  et facultatifs.
