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

Tokens proposés : `--mh-dur-fast: 150ms`, `--mh-dur-menu: 270ms`, `--mh-dur-fade-out: 400ms`, `--mh-dur-fade-in: 800ms`,
`--mh-dur-scene-out: 1200ms`, `--mh-dur-scene-in: 850ms`, `--mh-ease: linear`. Avec `prefers-reduced-motion`,
toutes ces durées tombent à 0 sauf la frappe du texte.

## 8. États des composants

| Composant | Repos | Survol | Actif / sélectionné | Désactivé | Focus clavier |
|---|---|---|---|---|---|
| Entrée du menu titre | `#1f1816` | `#2843ac` | idem survol | non vu | à ajouter : souligné ou contour |
| Entrée du menu système | `#a9c8cc` | plus clair + lueur cyan | idem | non vu (« auto »/« skip » grisés si le script verrouille) | à ajouter |
| Bouton de config | dégradé gris | non vu | dégradé sarcelle | non vu | à ajouter |
| Onglet de config | blanc | lueur cyan | lueur cyan renforcée, libellé `#cfeff0` | | à ajouter |
| Radio | disque noir, anneau `#8c959a` | non vu | point intérieur gris clair | | |
| Case à cocher (« Verr. ») | carré clair vide | | cochée = verrouille la sauvegarde | | |
| Pastille de dialogue | `#2e7179` | `#33a9a9` | | | |
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

## 10. Accessibilité minimale à conserver

- **Contraste** : texte clair sur fond sombre ≥ 7:1 (ex. `#a9c8cc` sur `#132337` ≈ 9:1). Le texte lu à 40 % d'opacité
  reste ≥ 4,5:1 sur les fonds sombres ; sur une scène claire, l'ombre doit rester active (le réglage d'opacité est
  laissé à l'utilisateur, avec un minimum recommandé de 30 %).
- **Taille** : corps de texte de jeu ≥ 24 px@720 ; mention légale ≥ 10 px réels ; libellés d'interface ≥ 16 px@720.
- **Cibles** : 44 px minimum sur écran tactile (le jeu d'origine est conçu pour la souris, avec des cibles de 28 à 36 px@720).
- **Clavier** : tout écran se parcourt sans souris (flèches, Entrée, Échap), focus **visible** (contour 2 px cyan
  `#5fcfc5`, décalage 2 px) ; `Échap` ferme toujours l'écran superposé.
- **Sémantique** : `role="dialog"` + `aria-modal` pour les confirmations, `role="tablist"` pour les onglets de config,
  `aria-live="polite"` pour les toasts, `aria-label` sur toute icône sans texte.
- **Mouvement** : respecter `prefers-reduced-motion` (aucun fondu hors frappe du texte).
- **Langue** : `lang` posé sur l'interface (`fr`, `ja`, `en`) ; les sous-titres japonais décoratifs sont `aria-hidden`.
- **Couleur seule** : un état ne dépend jamais de la seule couleur (survol = couleur + lueur ; sélection de grille =
  bord épais + marqueur).

## 11. Tokens CSS proposés

À regrouper dans `src/ui/tokens.css` (tâche HUD-01), préfixe `--mh-`.

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
- **Unités** : `rem` rapportées à la taille de base du viewport (`docs/layout.md`), jamais `px` fixes.
- **Interactions tactiles** : le clic droit n'existe pas ; prévoir un bouton de menu persistant discret et un geste.
- **Sauvegardes** : locales (navigateur), avec export/import ; la grille 15 pages × 8 emplacements du jeu d'origine
  représente 120 emplacements : prévoir le stockage en IndexedDB pour les vignettes.
- **Langues** : libellés d'interface séparés du code (FR/JA/EN) ; les sous-titres japonais d'origine sont décoratifs
  et facultatifs.
