# Analyse du HUD du jeu d'origine et plan d'adaptation web

Issue : [#179](https://github.com/TheArabicMonster/mahoyo-web/issues/179). Document compagnon :
[`DESIGN.md`](DESIGN.md) (design system, tokens, états). Sources : walkthrough du jeu original fourni par l'utilisateur
et exploration de `tsukiweb.holofield.fr` comme référence d'adaptation web.

> Aucune image, capture, recadrage, dialogue ni traduction du jeu n'est dans ce dépôt. Tout est décrit en mots et en
> valeurs mesurées. Les libellés d'interface cités (noms d'entrées de menu) sont du vocabulaire fonctionnel.

## 1. Contexte et méthode

### 1.1 La vidéo

| Donnée | Valeur |
|---|---|
| Durée | 1 min 45 s (105 s) |
| Image | 1920×1080, 60 fps, H.264, jeu **plein cadre** (aucune bordure, aucune barre) |
| Zone de jeu | 1920×1080 entière ; échelle de la version PC : base 1024×576 agrandie ×1,875 |
| Contenu | écran titre, chargement depuis le titre, 3 séquences de lecture (texte, pages, scènes avec sprite), menu système, historique, chargement en jeu, config (4 onglets), sous-menu Extra, Sound mode, CG mode, dialogues de confirmation |
| Absent | écran de choix, sauvegarde (Save), cartes de titre de chapitre, indicateurs auto/skip actifs, Archive, fin/crédits (voir §6) |

Méthode : échantillonnage 1 image/s (105 images), planches-contacts pour repérer les états, puis mesure sur les images
d'origine par échantillonnage de pixels (couleurs) et détection de boîtes englobantes (positions). Les durées de
transition viennent d'une extraction à 15–30 images/s sur les fenêtres concernées. Les horodatages ci-dessous sont des
**secondes de la vidéo** (`t = 12 s`).

Conventions : positions en `px@1080` puis `px@720` (×2/3, résolution logique de `docs/layout.md`). Les pourcentages
sont relatifs à la scène. `docs/layout.md` fixe 1280×720 ; l'énoncé de la tâche évoquait 1024×576, qui est la base
des images d'origine : les deux se déduisent par proportion.

### 1.2 Référence web

Tsukiweb (adaptation web de *Tsukihime*) a été explorée dans un navigateur rendu (Chromium, Playwright) : titre,
fenêtre de jeu, menu contextuel, barre inférieure, historique, **flowchart**, sauvegarde, config, galerie, desktop
1280×720 et portrait 390×844. On relève agencement, styles calculés, interactions et sémantique ; on ne reprend ni
code, ni textes, ni assets (voir §3).

## 2. Inventaire du HUD écran par écran

Chaque écran est suivi de sa **transposition web** : équivalent navigateur, ce qu'on garde fidèle (F), adapte (A) ou
ajoute (+).

### 2.1 Écran titre — t = 0–4 s, 27 s, 36–37 s, 60–63 s

**Jeu d'origine.** Illustration plein écran (ciel nuageux, ville sous un voile crème, bas de l'écran presque blanc).
Logo japonais avec sous-titre latin large, centré dans le tiers supérieur (501–1411 × 184–443 @1080, soit
334–941 × 123–295 @720). Menu vertical de **5 entrées** centré horizontalement (x = 960) : *Start, Load, Config,
Extra, Exit*, en serif espacé (≈ 0,25 em), centres y = 622, 695, 765, 843, 916 @1080 (pas ≈ 73 px, 49 px @720),
corps ≈ 41 px (27 px @720). Couleur de repos `#1f1816`, survol **bleu roi `#2843ac`** (aucun fond, aucune bascule de
graisse) ; le curseur système reste la flèche Windows. Mention de droits centrée en bas (y 1026–1040, serif ≈ 14 px,
`#514b46`).
Entrée depuis un autre écran : fondu depuis le noir en ≈ 0,8 s (t = 26,3–27,1 s, rampe linéaire).

**Transposition web.**
- F : fond clair, logo, menu central vertical, survol bleu, mention de droits.
- A : le logo et l'illustration viennent du manifeste de l'utilisateur ; sans eux, repli CSS (dégradé crème + titre
  textuel). Le menu passe en `<nav>` de `<button>` (clavier : flèches/Entrée, focus visible), en portrait il reste
  centré avec cibles ≥ 44 px.
- A : « Exit » n'existe pas dans un navigateur : le retirer, ou le remplacer par « À propos / quitter » (retour à la page
  d'accueil du site).
- + : « Continuer » (autosave) et « Flowchart », absents de l'original, restent des ajouts du port ; les placer **après**
  *Load* et avant *Config* pour ne pas changer l'ordre des 4 entrées d'origine.
- + : route d'URL (`#/title`) pour pouvoir revenir/partager ; préchargement de l'illustration pendant le chargement
  des assets.
- i18n : libellés *Start/Load/Config/Extra* sont **en anglais dans l'original, même en patch FR** ; garder ces libellés
  comme valeur par défaut FR et fournir JA/EN dans le dictionnaire.

### 2.2 Sous-menu Extra — t = 38–39 s (entrée), 55–60 s (retour)

**Jeu d'origine.** Cliquer *Extra* **remplace sur place** les 5 entrées par 4 autres, sans quitter l'écran titre
(fondu croisé ≈ 1 s) : *Archive, Cgmode, Soundmode, Back*. *Archive* est grisé (≈ 30 % d'opacité) tant qu'il n'est pas
déverrouillé et s'allume ensuite ; même positions, même typographie, même survol bleu. *Back* ramène au menu principal
(t = 60–61 s). *Cgmode* ouvre l'écran CG (t = 59 s), *Soundmode* l'écran Sound (t = 40 s, fondu de ≈ 0,3 s).

**Transposition web.**
- F : sous-menu en place, *Archive* grisé tant que la progression ne l'autorise pas.
- A : **Archive = la liste de chapitres** que notre titre affiche aujourd'hui en grille de 31 boutons ; la déplacer ici.
  Les « livres » d'*Archive* (assets `archive_*`, un par chapitre) deviennent une grille de chapitres.
- + : l'entrée *Flowchart* peut vivre ici ou au titre (décision produit, §7.3).
- Clavier : `Échap` = *Back*. Portrait : même colonne centrée.

### 2.3 Écran de chargement depuis le titre — t = 5–7 s

**Jeu d'origine.** Plein écran sur le fond « nuit bleue » (§ DESIGN 2.2). En-tête : titre « Load » en serif de titrage
à lueur (37–169 × 40–81 @1080) + sous-titre japonais de 20 px. Grille de **2 colonnes × 4 lignes = 8 emplacements par
page** (colonnes x = 22–768 et 790–1537 ; lignes y = 118–320, 338–540, 557–759, 776–977 @1080). **15 pages**, sélecteur
de page en bas : 15 chiffres cursifs sur une ligne (x 172–1362, y 1012–1041), le chiffre actif en cyan.
Fiche d'un emplacement plein : vignette 16:9 de 244×136 (à gauche), trois zones à droite — titre de sauvegarde (nom de la
scène), date/heure au format `AAAA/MM/JJ hh:mm:ss`, zone de commentaire (vide) — case à cocher « Verr. » (verrouillage) en
bas à gauche, boutons *Supprimer* et *Charger* en bas à droite (112×36 chacun, dégradé `#586888 → #283858`).
Emplacement vide : cadre sombre `#18222d` avec une volute décorative en bas à gauche, rien d'autre.
En bas à droite : « Back » (blanc, serif sans, 1640–1745 × 1000–1035).
Cliquer *Charger* ouvre une **confirmation** (voir 2.8) ; *Oui* lance la partie (t = 7 → 8 s : écran noir ≈ 1 s, puis
apparition de la scène).

**Transposition web.**
- F : grille 2×4, pagination 1–15, fiche (vignette, titre, date, verrou, supprimer, charger), confirmation avant
  chargement.
- A : **sauvegardes locales navigateur**, pas des fichiers : stockage `localStorage` aujourd'hui (clés
  `mahoyo.save.<slot>`), mais 120 emplacements × une vignette en data-URL dépassent le quota de 5 Mo → déplacer les
  vignettes et enregistrements vers **IndexedDB** ; prévoir **export/import JSON** (équivalent des fichiers `.dat`).
- A : en portrait, 1 colonne × 4 lignes par page, pagination en défilement horizontal (cibles ≥ 44 px).
- + : emplacements spéciaux du port (auto, rapide) conservés **en tête de la page 1** avec une marque distincte.
- + : accès à l'écran par route (`#/load`) et par raccourci clavier (`L`/`F3`, déjà dans `CONFIG_PLAN.md`).
- Accessibilité : chaque fiche est un `<article>` avec bouton *Charger*/*Supprimer* nommés ; `aria-current` sur la page.

### 2.4 Fenêtre de message — t = 9–20 s, 66–67 s, 73 s, 81–83 s, 97–100 s

**Jeu d'origine.**
- **Pas de boîte.** Le texte est posé sur la scène ; un voile sombre fondu sur les bords et deux **arabesques
  claires** (haut : x ≈ 240–1100, y 0–60 ; bas : x ≈ 350–1700, y 1010–1075 @1080, très discrètes) forment le cadre
  (clés `txtwindow00`–`02`).
- **Texte** : blanc `#ffffff`, serif, interlettrage large, ombre noire diffuse sans contour dur. Pas d'interligne
  variable : **77 px @1080** (51 px @720) entre deux lignes, corps ≈ 51 px @1080 (34 px @720). Marge gauche 265 px
  (13,8 %), largeur ≈ 1380 px (72 %), retrait de première ligne de paragraphe ≈ 53 px (1 em).
- **Page précédente atténuée** : la page lue reste affichée au-dessus, à **opacité 40 %** (valeur par défaut de
  l'onglet Système, durée 1,5 s) ; la page courante est à 100 %. Séparation d'une ligne vide.
- **Indicateurs d'attente** collés au dernier caractère : *feuille* de 37×40 px (attente `[l]`, bleu-gris `#63829f`),
  *livre* de 48×30 px (fin de page, `#5b94ce`, reflet `#f9fefe`), tous deux animés.
- **Ancrage vertical** variable : tantôt en haut (première ligne vers y ≈ 100–130 @1080), tantôt centré (t = 72 s,
  bloc autour de y ≈ 540) ; sur l'écran noir d'ouverture, le bloc est en haut à gauche.
- **Frappe** caractère par caractère ; un clic termine la page (t = 66,6 s : la page complète apparaît en
  ≈ 50 ms).
- **Pas de nom de locuteur** observé : le nom n'est pas affiché dans cette version (les répliques sont entre crochets
  japonais dans le texte).
- **Narration vs dialogue** : même police, même couleur ; la distinction est typographique (crochets) seulement.
- **Sprites** : un personnage plein cadre, voile sombre à droite (t = 97–100 s), texte au-dessus sans boîte.

**Transposition web.**
- F : texte sans boîte, ornements du cadre, atténuation de la page lue, indicateurs d'attente, frappe réglable.
- A : **échelle de texte**. À 1280×720 le corps doit valoir ≈ 34 px (2,1 rem) avec interligne ≈ 1,5 ; le port affiche
  aujourd'hui 25,6 px/41 px (voir §4, écart E1). Garder `fontScale` et `text-fit.ts` pour les petites fenêtres.
- A : en **portrait**, la scène (16:9) reste en lettrebox en haut ; le **texte passe dans une zone dédiée sous la
  scène** (rem, 24 px mini) plutôt que dans l'image, sinon il devient illisible (< 14 px).
- A : tactile : un appui = avancer ; double appui/appui long = menu ; balayage haut = historique.
- + : taille de texte réglable (déjà `fontScale`) et contraste minimum du texte lu (≥ 30 %).
- + : i18n FR/JA : japonais en mode vertical non requis (le jeu est horizontal), mais veiller à l'interlettrage
  (`letter-spacing` 0 en japonais, déjà appliqué par `text-fit`).
- Accessibilité : le texte courant est une région `aria-live="off"` par défaut avec option « lecture d'écran » (sinon
  la frappe caractère par caractère est illisible pour un lecteur d'écran) : annoncer la page entière à la fin.

### 2.5 Menu système (clic droit) — t = 22–24 s, 68–72 s, 84–85 s, 92 s, 101–102 s

**Jeu d'origine.** Un clic droit pendant la lecture **n'ouvre pas une boîte** mais un écran plein cadre :
la scène reste visible sous un **voile bleu nuit `#152539` à 80–85 %** (apparition en **270 ms**, linéaire), avec
bandeaux de feuillage en haut et en bas et arabesques à droite. Une colonne d'entrées à droite (x ≥ 1638 @1080) :

| Ordre | Entrée | Centre y @1080 (@720) | Action observée |
|---|---|---|---|
| 1 | save | 172 (115) | Sauvegarde (non montrée) |
| 2 | load | 232 (155) | Ouvre l'écran de chargement (t = 92–94 s) |
| 3 | config | 290 (193) | Ouvre la config |
| 4 | auto | 347 (231) | Lecture automatique |
| 5 | skip | 408 (272) | Saut du texte |
| 6 | backlog | 472 (315) | Ouvre l'historique (t = 85–86 s) |
| 7 | graphic | 536 (357) | Probablement « masquer le texte » (non démontré) |
| 8 | title | 603 (402) | Confirmation puis retour au titre (t = 25 s) |
| 9 | exitgame | 667 (445) | Confirmation puis fermeture (t = 103 s) |

En-tête « SYSTÈME » en capitales serif très espacées (`#c2dee0`, 1631–1861 × 44–104) avec la ligne japonaise
dessous ; « Back » en bas à droite (1643–1741 × 999–1031). Texte des entrées : sans-serif humaniste de ≈ 38 px, `#a9c8cc`,
**sans fond ni cadre** ; le survol éclaircit (`#b1d6da`) et ajoute une lueur ; l'entrée survolée peut devenir plus vive
(`#e0e4ec`). Pas de marqueur de sélection, pas de soulignement. Le menu est refermé par *Back* ou un nouveau clic
droit (non montré).
`@lockquickmenu` désactive *save/load* (déjà géré par notre `quickMenuLocked`) : l'apparence « grisé » n'a pas été
observée.

**Transposition web.**
- F : colonne droite, 9 entrées dans le même ordre, voile bleu nuit, en-tête, « Back ».
- A : **clic droit → tactile** : bouton de menu persistant discret (coin haut-droit, apparaît au toucher), appui long,
  ou balayage depuis le bord droit. Clavier : `Échap` (déjà). Souris : clic droit conservé (réglage 1/2 clics).
- A : *exitgame* : `window.close()` souvent refusé → afficher la confirmation puis revenir au titre (déjà prévu).
- A : en portrait, la colonne occupe ≈ 2/3 de la largeur (référence Tsukiweb), entrées ≥ 48 px de haut.
- + : barre d'actions rapides (Q.save, Q.load, auto, skip, volume, plein écran) **tactile uniquement**, absente de
  l'original : sur desktop elle reste masquée (§7, tâche HUD-12).
- + : focus clavier visible et ordre de tabulation logique ; `role="menu"` n'est pas nécessaire (liste de boutons).
- Perf : le voile est un `<div>` avec dégradé ; **ne pas** re-rendre la scène (la scène reste dessous, assombrie).

### 2.6 Historique (backlog) — t = 85–90 s ; état vide t = 72–75 s

**Jeu d'origine.** Plein écran sur le fond nuit bleue. Titre « Back Log » (31–257 × 40–95 @1080) + sous-titre japonais ;
liste de pages dans la **même police et la même zone que le texte de jeu** (x 265–1595), séparées par des lignes vides ;
ascenseur vertical à droite (contour cyan, 59×850 px, x 1699–1758, y 127–977) avec pastille mobile 41×100 ; trois
boutons ronds de ≈ 50 px sous l'ascenseur (**bas**, **haut**, **fermer**, y 1000–1048). Défilement par pastille, boutons
et molette. Deux niveaux de luminosité sont visibles (entrées grises vs blanches) : probablement lu/non lu ou survol, non
tranché.
**État vide** : ouvrir l'historique avant toute page lue (t = 72 s) **ne l'ouvre pas** : un **toast** bas-droite
« l'historique n'existe pas encore » s'affiche (≈ 2,5 s ; cadre sarcelle gris `#587888` avec chevrons ornés, 510×90 @1080,
1370–1880 × 950–1040).

**Transposition web.**
- F : plein écran, ascenseur dédié, 3 boutons, toast si vide.
- A : barre de défilement **native stylée** (`::-webkit-scrollbar` + `scrollbar-color`) pour garder le défilement
  tactile et la molette ; les boutons ▲▼ restent comme raccourcis (`PageUp/PageDown`).
- + : retour à une page depuis l'historique (rollback au clic sur une entrée) ; déjà dans `rollback()` côté player.
- + : l'historique doit rester sélectionnable/copiable (`user-select: text`, déjà présent).
- A11y : liste `<ol>`, `aria-label` « Historique », position de défilement annoncée ; entrées navigables au clavier.
- i18n : JA/FR de la même scène ne sont pas mélangés dans l'historique.

### 2.7 Chargement en cours de jeu — t = 92–96 s

**Jeu d'origine.** Même écran qu'en 2.3 mais **avec la colonne du menu système à droite** (le chargement s'ouvre depuis
le menu : « SYSTÈME » + entrées + « Back » à x ≥ 1640 @1080), la grille s'étrécit en conséquence (2×3 emplacements visibles
dans la zone gauche). Un clic sur *Charger* → confirmation → fondu vers la scène chargée (t = 95 → 96 s, ≈ 1 s). Le
bouton *Charger* d'un emplacement survolé s'éclaircit en bleu vif (t = 94 s).

**Transposition web.** F : mêmes éléments. A : depuis le jeu, afficher la grille en **plein écran** sans la colonne
du menu (écran étroit) ; garder la colonne du menu en desktop. + : confirmation « les changements non sauvegardés seront
perdus » si la progression diffère de la dernière sauvegarde (aide à l'erreur de manipulation, absent de l'original).

### 2.8 Boîte de confirmation — t = 7 s (charger), 25 s (retour au titre), 95 s (charger), 103 s (quitter)

**Jeu d'origine.** Boîte sarcelle de **585×246 px @1080 (390×164 @720)**, centrée (x 668–1253, y 433–679), dégradé
`#083443 → #285e69`, bord clair 2 px `#598f95`, **quatre volutes d'angle** `#376b74`. Texte de question centré en sans
(≈ 30 px). Deux **pastilles elliptiques** (146×36) sous le texte : *Oui* à gauche (centre x ≈ 838), *Non* à droite
(≈ 1078). La pastille survolée devient `#33a9a9`, l'autre `#2e7179`. Ouverture par fondu de **150 ms** ; aucun fond
modal sombre autour (la scène reste visible mais inactive). Pour *quitter le jeu*, **Non est survolé/présélectionné** par
défaut (t = 103 s) ; pour *charger*, *Oui* l'est (t = 7 s).

**Transposition web.**
- F : boîte centrée, pastilles *Oui/Non*, fondu 150 ms, *Non* par défaut pour les actions destructrices.
- A : `role="dialog"` + `aria-modal` + piège de focus (déjà `aria-modal` dans `confirm()`), `Entrée` = bouton
  présélectionné, `Échap` = non, flèches gauche/droite.
- A : cibles ≥ 44 px ; sur tactile, fond modal discret pour éviter les appuis hors boîte.
- + : message court localisé par un dictionnaire ; plus de `window.confirm`.

### 2.9 Configuration — t = 28–35 s

Déjà couverte par [`CONFIG_PLAN.md`](CONFIG_PLAN.md) (4 onglets, réglages, défauts). Compléments **visuels** mesurés :

**Jeu d'origine.** En-tête « Config » (31–212 × 41–95 @1080) + sous-titre japonais ; **4 onglets** en serif étroit,
corps ≈ 52 px : Système (x 830–997), Message (1045–1220), Son/Effet (1300–1500), Raccourcis (1583–1810), y 57–107,
texte `#eef4f5` avec lueur sarcelle ; l'onglet actif est plus lumineux (lueur renforcée). Sous les onglets, un titre de
section japonais en gothique gras avec un filet blanc de ≈ 245 px. Panneaux à **bord gris-bleu 2 px**
(`#444c56`/`#59616b`/`#333b45`), fond `#151f2b`, libellé centré **sur** le bord haut (serif, `#c0d6d6`, lueur) ;
gauche x 75–762, droite x 810–1845, y 215–950. Contrôles : **boutons à bascule** (actif = sarcelle glossy
`#3d746f → #133c39`, inactif = gris `#404342 → #171717`), **radios** noires à anneau `#8c959a`, **curseurs** à piste
noire `#080808` avec 5 repères et pastille sphérique argent `#cbcbcb`, boutons `−`/`+` (spinners à 2 chiffres : durée
et opacité du fondu), **zone d'aperçu** noire où l'on tape du texte pour voir le fondu, bouton « test » avec icône haut-parleur
sur le volume des bruitages. Pied : *Retour* centré (897–1032 × 1016–1048) et *Réglages par défaut* en bas à droite
(cadre 1545–1845 × 995–1050).
**Raccourcis** : liste de 14 actions à deux colonnes, chaque action avec une case à cocher à gauche et une ou deux
touches dans des capsules à droite.

**Transposition web.** Voir §4 (E15) : l'implémentation actuelle (#177) a **volontairement** suivi Tsukiweb (bleu nuit,
lignes fines, cyan) plutôt que l'original. Pour l'objectif « même design que le HUD d'origine », prévoir une
**re-skin** (tâche HUD-09) qui adopte les panneaux bordés, boutons sarcelle/gris et sphères de curseur, **sans toucher
au modèle de réglages**. Web : sauvegarde automatique à chaque changement (pas de bouton « Appliquer »), « Réglages par
défaut » avec confirmation, onglets en `tablist` (déjà), curseurs `<input type="range">` stylés, clavier complet.
En portrait : onglets défilables en haut, panneaux empilés (référence Tsukiweb, §3).

### 2.10 Sound mode — t = 40–55 s

**Jeu d'origine.** Fond nuit bleue, titre « Sound mode » + sous-titre japonais. **Liste de morceaux** en boutons
sarcelle glossy de 385×≈58 px (titre sur la ligne 1, sous-titre sur la ligne 2), disposés **en escalier** (colonne
gauche haute, colonne droite basse) sur **2 pages** (boutons « 1P » / « 2P »). Rangée de commandes en bas (y 849–885) :
lecture (147–288), stop, précédent, suivant, trois bascules rondes (répétition d'un morceau, répétition de tous,
aléatoire), **volume à 10 pastilles** (8 allumées par défaut), pagination. Barre de progression (x 720–1200, y 933–961,
remplissage `#088888`) encadrée de la durée courante et totale (format `m:ss`). Pied : ligne d'information « compositeur /
titre / origine éventuelle » en cyan (`#69c8c9`) avec filet cyan pleine largeur en y = 1046. Le morceau en lecture est
survolé en cyan clair (`#08a8b8`) ; changer de morceau remet la barre à 0.

**Transposition web.** F : liste + lecteur + progression + volume ; A : lecteur HTML `<audio>`/WebAudio, liste en
**grille responsive**, pagination remplacée par défilement, boutons au clavier (`Espace` lecture), barre
`<input type="range">`. + : le contenu de la liste vient du manifeste audio de l'utilisateur ; titres/compositeurs
sont des **métadonnées de l'utilisateur**, non commitées. Hors périmètre audio pour l'instant (priorité p3).

### 2.11 CG mode — t = 59–60 s

**Jeu d'origine.** Fond nuit bleue ; titre « CG mode ». Grille de **4×4 vignettes** (≈ 300×165 @1080, pas 324×199,
x 357–1630, y 148–910) à cadre ornementé sarcelle ; une vignette verrouillée affiche le libellé « image non
affichée » ; la sélection est un **bord vert-jaune** `#c0f790` de 3 px. À gauche, un bouton ornemental de chapitre
(« Chap.1 », 143–312 × 507–563) ; à droite, **ascenseur** vertical à flèches (x 1685–1745) ; au centre-bas, une bascule
*Évènement / Arrière-plan* (y 970–1010) séparée par un ornement floral ; « Back » en bas à droite.

**Transposition web.** F : grille 4×4, chapitres, bascule événement/arrière-plan, sélection. A : grille **CSS grid
responsive** (2–4 colonnes), visionneuse plein écran avec zoom (molette/pincement), navigation précédent/suivant (assets
`cg_view_*`). + : le suivi des CG vus est une **donnée de progression** (à créer, voir HUD-14) ; aucune miniature
n'est commitée, elles sont recalculées à l'exécution. Priorité p3.

### 2.12 Transitions entre écrans

| Transition | t (s) | Mesure |
|---|---|---|
| Titre → jeu (Nouvelle partie) | 63,6–65,8 | fondu au noir 1,2 s (rampe linéaire), noir ≈ 0,2 s, apparition de la scène 0,85 s |
| Jeu → titre (confirmation) | 25,9–27,1 | fondu au noir 0,4 s, noir ≈ 0,1 s, apparition du titre 0,8 s |
| Titre ↔ sous-menu Extra | 38–39 | fondu croisé des entrées ≈ 1 s |
| Sous-menu → Sound mode | 39,8–40 | fondu ≈ 0,3 s |
| Ouverture du menu système | 22,3–22,6 | voile en 0,27 s |
| Boîte de confirmation | 6,8–7,0 | fondu 0,15 s |
| Toast | 72,5–72,8 / 75,3 | entrée 0,2 s ; maintien ≈ 2,5 s ; sortie à la prochaine action |
| Chargement → scène | 7,9–9 | noir ≈ 1 s puis fondu de la scène |
| Changement de scène (chargement) | 95–96 | fondu ≈ 1 s |

**Transposition web.** Respecter `prefers-reduced-motion` (durées à 0). Précharger la scène avant la fin du fondu pour
éviter le noir prolongé (> 1 s) en réseau lent ; masquer derrière un **écran de chargement** stylé si les assets
manquent (`#ui-loading` du `layout.md`).

### 2.13 Éléments transverses

- **Curseur** : flèche système, pas de curseur personnalisé observé (le réglage « curseur autoguidé » est dans la
  config). Web : conserver le curseur du navigateur ; masquage après 2 s d'inactivité (déjà fait).
- **Lecture auto / saut** : aucun indicateur à l'écran n'est visible dans la vidéo (modes non activés). Voir §6.
- **Plein écran** : l'enregistrement est en plein écran 1920×1080. Web : API Fullscreen (`F4`, déjà), bouton dans
  la barre rapide.
- **Raccourcis** : 14 actions listées dans l'onglet Raccourcis de la config ; les valeurs par défaut du port sont dans `CONFIG_PLAN.md` §2.

## 3. Référence web : Tsukiweb

Relevés sur `tsukiweb.holofield.fr` (aucun code ni texte copié ; décrit seulement).

| Domaine | Observation | Reprise ? |
|---|---|---|
| Routes | Titre sur `/`, jeu sur `/window` (retour au titre si aucune partie) | **Oui** : routes `#/title`, `#/game`, `#/load`… (tâche HUD-15) |
| Titre | Illustration + 4 boutons horizontaux, 3 boutons d'icône en haut à droite (volume, langue, infos) | **Partiellement** : la barre d'icônes (volume, langue, plein écran) utile ; on garde le menu **vertical** de l'original |
| Menu contextuel | Panneau latéral droit de 25 % de largeur (320 px @1280), dégradé incliné (−40°) bleu→violet, 7 entrées (≈ 23 px, interlettrage 1 px), animation de glissement 0,35 s `ease-out`, **barre inférieure de 60 px** (Q.save, Q.load, auto, skip, volume, plein écran, partage) avec ornements floraux en coins | **Structure oui** (panneau droit + barre rapide tactile), **style non** (on garde bleu nuit/sarcelle de l'original) |
| Flowchart | Écran à deux onglets *History / Flowchart* dans une barre inférieure avec *Back* ; arbre vertical de **vignettes 60×44** reliées par des **traits orthogonaux gris** ; nœuds non visités = placeholders sombres barrés ; nœud courant à bord bleu ; **rendu Canvas 2D (DPR 2) + couche de boutons DOM** (`button.fc-hit`, `aria-label` = id du nœud, `tabindex=0`) ; déplacement par glisser et molette ; échelle initiale ×1,9 | **Oui** pour : arbre à vignettes, états visité/non visité/courant, couche DOM pour l'accessibilité, pan par glisser/molette ; **non** pour la couleur et le placeholder barré |
| Sauvegarde | Liste verticale chronologique + bouton « New save » (**pas d'emplacements numérotés**), vignette, date en cyan, aperçu de texte ; volet latéral | **Idée oui** : liste libre + export, mais **on garde la grille 15×8** de l'original comme demandé |
| Config | Onglets en fil d'Ariane (◆ actif, `>` autres), lignes de 66 px à filets pointillés, segments sans cadre, curseurs à losange | **Déjà repris** (#177), à reconsidérer (§2.9) |
| Responsive | Pas de letterbox en portrait : les écrans **reflowent** ; titre d'écran déplacé en bas à droite, « Back » en bas à gauche, onglets défilables, contrôles empilés ; `viewport-fit=cover` | **Oui** (§7.2) |
| Accessibilité | Boutons nommés, `role=tablist` (sauvegarde, config), `aria-label` sur les icônes de la barre ; **contour de focus non visible** par défaut (`outline: none`) ; navigation spatiale (`nav-auto`) | **Reprendre** les rôles/labels ; **corriger** le focus visible |
| Stockage | `localStorage` : `savestates`, `settings`, `th_languages` | **Non** : on garde `mahoyo.*` ; on étend vers IndexedDB |
| Polices | Ubuntu (UI), Times New Roman (titres) | **Non** : on garde les piles de `DESIGN.md` |

**Volontairement écarté** : la palette bleu/violet de Tsukiweb, l'illustration de titre et la police Ubuntu ; le bouton
« Share scene » ; le placeholder barré des nœuds non visités ; l'absence d'emplacements numérotés ; le focus invisible.

## 4. Tableau d'écarts

Légende priorité : p0 = bloquant v1.0, p1 = important, p2 = utile, p3 = confort. « notre app » est vérifiée dans
`src/ui/`, `src/renderer/`, `src/player/` et en lançant l'application (1280×720).

| # | Élément | Jeu d'origine | Notre app | Écart | Prio |
|---|---|---|---|---|---|
| E1 | Taille du texte de jeu | corps ≈ 34 px @720, interligne ≈ 51 px (7,1 % de la hauteur) | 25,6 px, interligne 41 px (5,7 %) | texte ≈ 25 % trop petit | p1 |
| E2 | Fonds des écrans système | dégradé nuit bleue + feuillage + arabesques | voile `rgba(0,0,0,.75)` + panneau gris-bleu `rgba(20,20,30,.92)` | habillage absent | p1 |
| E3 | Écran titre | illustration claire, logo, 5 entrées serif centrées, survol bleu | panneau sombre « Mahoutsukai no Yoru » + 5 gros boutons + grille de 31 chapitres | refonte complète | p1 |
| E4 | Entrées du menu titre | *Start/Load/Config/Extra/Exit* | *Nouvelle partie/Continuer/Charger/Réglages/Flowchart* | *Extra*, *Exit* absents ; ajouts du port | p2 |
| E5 | Sélection de chapitre | via Extra → Archive (grisé au début) | grille de boutons au titre | mauvais emplacement, style debug | p2 |
| E6 | Sous-menu Extra | Archive, CG, Sound, Back | absent | fonction absente | p2 |
| E7 | Menu système (clic droit) | plein cadre, colonne droite de 9 entrées, voile bleu, en-tête, « Back » | panneau centré « Pause » de 7 boutons | présentation et entrées (auto, skip, graphic, exit manquent) | p1 |
| E8 | Confirmation | boîte sarcelle ornée, 2 pastilles, 150 ms | `.mh-ui-confirm-box` sombre avec 2 boutons | style absent | p1 |
| E9 | Écran Load | grille 2×4, 15 pages, fiches complètes, verrou | grille 3 colonnes d'emplacements (auto, rapide, 1…), pas de pagination, pas de verrou, panneau plus grand que la fenêtre | refonte | p1 |
| E10 | Écran Save | non vu dans la vidéo (même gabarit que Load, avec assets `save_*`) | même grille générique | à confirmer par capture | p1 |
| E11 | Titre et commentaire de sauvegarde | nom de scène + zone de commentaire | `previewText` seul | métadonnées manquantes | p2 |
| E12 | Verrouillage d'une sauvegarde | case « Verr. » | absent | fonction absente | p2 |
| E13 | Historique | plein écran, police de jeu, ascenseur dédié, 3 boutons, toast si vide | liste `<ul>` dans un panneau de 30 rem | présentation ; pas de toast d'état vide | p1 |
| E14 | Toast | cadre sarcelle ornementé, bas-droite, ≈ 2,5 s | boîte noire centrée en bas | style et position | p2 |
| E15 | Config : habillage | panneaux bordés, boutons sarcelle/gris, sphères | refonte « sobre » inspirée de Tsukiweb (#177) | divergence assumée à trancher | p2 |
| E16 | Config : contenu | 4 onglets, réglages, raccourcis | **conforme** (`CONFIG_PLAN.md`) | — | — |
| E17 | Sound mode | lecteur complet | absent | fonction absente | p3 |
| E18 | CG mode | grille 4×4 + visionneuse | absent ; aucun suivi des CG vus | fonction absente | p3 |
| E19 | Archive | grille de « livres » par chapitre | absent (grille de chapitres au titre) | voir E5 | p2 |
| E20 | Fenêtre de message : ornements et voile | image `txtwindow*` plein cadre | **conforme** (`text-frame.ts`) | — | — |
| E21 | Page lue atténuée | 40 %, 1,5 s | **conforme** (`READ_TEXT_OPACITY`, `readFadeDuration`) | — | — |
| E22 | Indicateurs feuille/livre | sprites animés | **conformes** (`CLICK_GLYPHS`) | — | — |
| E23 | Transitions plein écran | noir 1,2 s / 0,85 s (titre↔jeu) | à vérifier ; fondu de 0,3 s uniquement sur la config | non systématisé | p2 |
| E24 | Menu rapide tactile | n'existe pas (souris seulement) | aucun équivalent au clic droit sur tactile | fonction web absente | p1 |
| E25 | Barre d'actions rapides | n'existe pas | absente | ajout web | p2 |
| E26 | Responsive portrait | n/a | scène scalée seule, écrans système non adaptés | adaptation absente | p2 |
| E27 | Flowchart | n/a (propre au web) | liste verticale de 27 chapitres, aucune ramification, aucune position | refonte (§7) | p2 |
| E28 | Routes URL | n/a | aucune | adaptation absente | p3 |
| E29 | Sauvegardes locales | fichiers | `localStorage` + vignette en data-URL | quota, pas d'export | p2 |
| E30 | i18n de l'interface | FR (patch) + JA décoratif | libellés FR en dur dans `ui-manager.ts` | pas de dictionnaire | p2 |
| E31 | Accessibilité de l'interface | cibles souris | `aria-modal` (confirm), onglets de config ; pas de focus visible global, pas de rôles pour les autres écrans | partiel | p2 |
| E32 | Indicateurs auto / skip | non vus | badge texte en haut à droite | à confirmer | p2 |
| E33 | Choix | non vu | boutons génériques (`.mh-ui-choice`) ; curseur d'origine `selectcursor` non utilisé | à confirmer | p1 |
| E34 | Retour au titre / quitter | confirmation ornée, *Non* par défaut | `confirm()` générique, texte « La progression non sauvegardée sera perdue » | style ; *Non* par défaut | p2 |
| E35 | Nom du locuteur | absent du jeu | absent | — | — |
| E36 | Pagination des sauvegardes | 15 pages × 8 | 2 + N emplacements dans une grille unique | structure | p1 |

## 5. Fonctions de l'original absentes de notre app

1. Sous-menu **Extra** (Archive, CG mode, Sound mode).
2. **Archive** de chapitres déverrouillables.
3. **CG mode** et suivi des CG vus.
4. **Sound mode** (lecteur de BGM).
5. **Verrouillage** d'une sauvegarde, titre et commentaire par sauvegarde, 15 pages d'emplacements.
6. Entrée **graphic** du menu système (masquer le texte pour voir l'image) accessible depuis le menu.
7. Entrées **auto** et **skip** dans le menu système (existent par raccourcis).
8. **Toast « historique vide »** et jeu de toasts stylés.
9. Fondus plein écran standardisés (noir 1,2 s / 0,85 s).
10. Mention de droits au titre.

Fonctions de **notre app** absentes de l'original (à conserver) : *Continuer* (autosave), sauvegarde rapide, flowchart,
raccourcis configurables complets, sélection de langue, reprise à un chapitre.

## 6. Points non vérifiables avec cette vidéo

À confirmer par captures supplémentaires de l'utilisateur :

1. **Écran de choix** : apparence des options, curseur, survol, animation, position (aucun choix rencontré).
2. **Écran Save** (sauvegarde) : mêmes gabarit et assets présumés ; confirmation d'écrasement ; ordre des emplacements.
3. **Cartes de titre de chapitre** et transitions de chapitre.
4. **Indicateurs auto / skip** à l'écran (modes jamais activés).
5. **Écran *Archive* déverrouillé** (grille de livres).
6. **Écran de fin / crédits**.
7. **Entrée *graphic*** : comportement réel.
8. **Historique** : signification des deux niveaux de luminosité, comportement au clic d'une entrée, voix.
9. **États désactivés** des entrées du menu système (`@lockquickmenu`).
10. **Boutons survolés** (bascules de config, *Supprimer*/*Charger*) : couleurs exactes de survol.
11. **Position verticale du texte** : règle d'ancrage (haut vs centré) selon la scène.
12. **Vitesse de frappe réelle** (la page a été terminée par un clic ; la vidéo ne donne pas un débit fiable).
13. **Raccourcis réels** (non pressés pendant l'enregistrement) et animation des sprites d'attente (fréquence).
14. **Courbes** d'animation (rampes linéaires observées ; les courbes de menu à 270 ms sont à ± 1 image).
15. **Page *Message* de la config en jeu** (comportement des 4 onglets ouverts depuis le jeu, pas depuis le titre).

## 7. Fonctionnalité « Flowchart » (propre à la version web)

Le jeu d'origine n'a **pas** de flowchart. Le besoin : un **organigramme des routes, choix et chapitres lus**, avec le
**même design que le HUD d'origine**. Tsukiweb propose déjà un écran comparable ; la présente section spécifie la
version Mahoyo. **Aucune implémentation pour l'instant.**

### 7.1 Ce qu'il affiche

- **Chapitres** : chaque chapitre de `story-chain.json.chapters` (27 entrées, 16 « pages » d'arc) est un **regroupement**
  (bande verticale ou conteneur) portant son titre.
- **Scènes** : un **nœud par script** (200 scripts dans `next`, dont 175 cibles distinctes) ; nœud = pastille carrée (ou
  vignette 16:9 de 60×34 px@720) avec l'identifiant de script.
- **Embranchements de choix** : 24 scripts proposent un menu (tous les chemins sortants sont libellés) ; 72 arêtes
  portent un libellé de choix. Un nœud-choix est visuellement distinct (losange). Les libellés d'option ne sont
  affichés **que** si le chemin a été emprunté (anti-spoiler).
- **Scènes lues / non lues** : trois états de nœud — *non visité* (silhouette), *visité* (couleur pleine),
  *terminé* (script lu jusqu'à son `@return`).
- **Interludes partagés** (`teatime.ks`, 4 interludes, 15 arêtes `then`) : un seul nœud avec plusieurs arêtes entrantes,
  rendu comme **nœud d'interlude** (forme dédiée), pas dupliqué.
- **Arêtes conditionnelles** (2) : trait en pointillé ; condition affichée seulement si connue.
- **Position actuelle** : marqueur (halo sarcelle) sur le script en cours ; bouton « centrer sur ma position ».
- **Fins** : les 4 scripts sans successeur (`next` vide) sont des **nœuds terminaux** ; icône de fin, grisés tant que
  non atteints, comptés dans un compteur « n/4 ».
- **Légende** (visité, non visité, courant, choix, interlude, fin) et **compteurs** (scènes lues x/200, fins x/4).

### 7.2 D'où viennent les données

| Besoin | Source existante | Manque |
|---|---|---|
| Graphe de scripts, arêtes, choix, conditions, `then`, chapitres | `public/assets/story-chain.json` (généré par `npm run chain`, **non commité**, contient les libellés de choix) ; lecture `src/core/story-chain.ts` (`resolveNext`) | Types de nœuds explicites (choix, interlude, fin) ; arc/chapitre par script ; mise en page |
| Scène « lue » | `readSet` (clé de position `script:index`) dans `settingsStore.loadRead()/saveRead()` | Agrégat « script visité / terminé » |
| Chapitres terminés | `settingsStore.loadProgress().completed` (liste d'ids de **chapitre**) | Même chose au niveau **script** |
| Choix déjà faits | rien | Enregistrer le **script cible** choisi (pas le texte) à chaque menu |
| Position actuelle | `Player` (script courant, `chainQueue`) | Exposer l'id courant à l'UI |
| Fins atteintes | rien | Marquer les scripts terminaux atteints |
| Vignettes | assets utilisateur (premier `@bg`/`@image` du script) | Clé de la première image par script (nom seulement) |
| Sauvegarde | `SaveRecord` (script, position, `chainQueue`) | Inclure l'historique de choix dans les sauvegardes (reprise cohérente) |

Choix d'architecture :
- **Pipeline** : étendre `tools/` (`npm run chain`) pour produire **`story-graph.json`** (dérivé, non commité,
  gitignored comme `story-chain.json`) : `nodes[{id, file, chapter, arc, kind, thumb?}]`, `edges[{from, to, kind,
  choice?, condition?}]`. Les libellés de choix restent dans ce fichier local.
- **Mise en page** : fonction **pure** `layoutFlowchart(graph)` (`src/core/flow-layout.ts`) : niveaux par plus long chemin,
  ordre pour minimiser les croisements, arêtes orthogonales. Testable sans DOM.
- **Progression** : étendre `settings-store` avec `visited` (scripts), `finished` (scripts), `choices` (arête prise),
  `endings` (fins) ; **migration** des anciennes données (champs absents = vide) et import dans l'export de sauvegarde.
- **Rendu** : SVG pour les arêtes et DOM pour les nœuds (200 nœuds, accessibilité native), ou Canvas + couche de
  boutons DOM comme Tsukiweb si la perf l'impose ; choix par défaut : **SVG + DOM**.

### 7.3 Comment on y accède

- Titre : entrée **Flowchart** (aujourd'hui) conservée, placée sous *Load* ; dans le **sous-menu Extra** en alternative
  (décision produit : l'original range ses bonus dans Extra).
- Menu système : entrée dédiée **entre *backlog* et *graphic***, ou onglet **History / Flowchart** commun comme
  Tsukiweb (recommandé : réutilise l'écran plein cadre de l'historique).
- Route : `#/flowchart` (ouvrable depuis un lien), raccourci clavier configurable (non par défaut).
- Depuis un nœud visité : **« Relire depuis ici »** lance le script avec un état initial vide (limite connue de
  `ENCHAINEMENT_SCRIPTS.md` : `operate` non repris) avec **confirmation** explicite ; « Voir les détails » ouvre un volet
  (arc, chapitre, état, fins atteintes depuis ce nœud).

### 7.4 Intégration au design

Réutilise **uniquement** les tokens de `DESIGN.md` :
- fond d'écran système (`--mh-bg-night-*`, feuillage, arabesques) ; titre « Flowchart » en `--mh-font-title`,
  sous-titre japonais optionnel ;
- nœud non visité : `--mh-panel-fill` + bord `--mh-panel-border` ; visité : dégradé `--mh-teal-on-*` ; terminé :
  même teinte + coche ; courant : halo `--mh-cyan-glint` ; choix : bord `--mh-select` ; fin : bord `--mh-dialog-border` ;
- arêtes en `--mh-panel-border-light`, 2 px ; arêtes empruntées en `--mh-cyan-rail` ;
- pied d'écran « Back » à la position standard (§ DESIGN 4) ; boutons de zoom ronds comme ceux de l'historique ;
- ouverture avec le fondu `--mh-dur-menu` ; zéro animation si `prefers-reduced-motion`.

### 7.5 Interactions et accessibilité

- Pan : glisser (souris/tactile) et molette ; zoom : boutons `+`/`−`, `Ctrl`+molette, pincement ; « centrer ».
- Clavier : flèches = nœud voisin selon l'arête ; `Entrée` = actions du nœud ; `Home/End` = début/fin ; `Échap` = retour.
- Lecteur d'écran : le graphe a un **équivalent liste** (`<ul>` imbriquée par chapitre) ; chaque nœud est un bouton avec
  `aria-label` (« scène 12, visitée, choix de 2 options ») ; `aria-live` annonce la position.
- Contraste ≥ 4,5:1 pour les libellés ; ne jamais coder l'état par la seule couleur (forme + icône + texte).
- Portrait : orientation verticale native, un chapitre à la fois en défilement ; mini-carte facultative.
- Performances : 200 nœuds, rendu virtualisé hors écran seulement au-delà de 500 ; mise en page calculée une fois.

### 7.6 Tâches atomiques (voir §8, préfixe FLOW)

FLOW-01 extraction du graphe (pipeline) → FLOW-02 types et mise en page pures → FLOW-03 stockage de la progression →
FLOW-04 enregistrement des événements dans le player → FLOW-05 rendu statique → FLOW-06 interactions →
FLOW-07 accessibilité clavier/lecteur d'écran → FLOW-08 intégration (titre, menu, route) → FLOW-09 tests e2e.

## 8. Backlog proposé

Format : **titre** — description — critères d'acceptation — fichiers — dépend de — épic — priorité.
Épics = ceux de `ROADMAP.md` (E5 UI/UX, E7 Projet réel, E6 QA). Une tâche = une PR courte, réalisable par un seul agent.
Aucune ne nécessite d'asset commité. Les « critères » sont vérifiables par test, commande ou capture locale.

### 8.1 Fondations

**HUD-01 — Tokens CSS du design system** (E5, p1)
- Créer `src/ui/tokens.css` avec les variables de `DESIGN.md` §11 et l'importer dans `main.ts` / `ui-manager.css`.
- Critères : toutes les variables de §11 existent ; `prefers-reduced-motion` met les durées à 0 ; un test lit le CSS et
  vérifie la présence des noms ; `npm test` vert.
- Fichiers : `src/ui/tokens.css`, `src/ui/ui-manager.css`, `src/main.ts`, `tests/unit/ui/ui-manager-css.test.ts`.
- Dépend de : —.

**HUD-02 — Fond « nuit bleue » des écrans système** (E5, p1)
- Composant CSS `.mh-ui-night` (dégradé vertical, bandeaux de feuillage et arabesques en CSS ; surcouche optionnelle
  d'images `c_background` etc. via variables).
- Critères : appliqué à un écran de démo ; rendu sans asset identique en structure ; contraste texte/fond ≥ 7:1 ;
  capture locale jointe à la PR (hors dépôt).
- Fichiers : `src/ui/ui-manager.css`, `src/ui/ui-manager.ts` (classe), test CSS.
- Dépend de : HUD-01.

**HUD-03 — Résolveur d'images d'interface avec repli** (E5, p2)
- Fonction `uiAsset(key)` qui renvoie l'URL du manifeste ou `null`, et pose `--mh-asset-*` sur la racine.
- Critères : test unitaire avec manifeste factice ; aucune requête quand la clé manque ; documenté dans `DESIGN.md` §9.
- Fichiers : `src/core/asset-manifest.ts`, `src/core/asset-resolver.ts`, `src/ui/ui-assets.ts`, tests.
- Dépend de : HUD-01.

**HUD-04 — Échelle du texte de jeu** (E5, p1)
- Passer le corps à ≈ 2,1 rem et l'interligne à 1,5 à 1280×720, en conservant `fontScale` et `text-fit`.
- Critères : à 1280×720 le corps calculé vaut 33–35 px et le pas de ligne 50–52 px ; test e2e sur `getComputedStyle` ;
  le texte ne déborde pas de la zone (14 % / 9 %) ; `npm run test:unit` vert.
- Fichiers : `src/renderer/stage-renderer.ts` (`FRAME_TEXT_REM`, `FRAME_TEXT_LINE_HEIGHT`), `src/renderer/text-fit.ts`, tests.
- Dépend de : —.

### 8.2 Écrans

**HUD-05 — Dialogue de confirmation fidèle** (E5, p1)
- Habiller `confirm()` : boîte sarcelle, 4 volutes d'angle (CSS), pastilles *Oui/Non*, fondu 150 ms, *Non* par défaut pour
  les actions destructrices ; focus piégé, `Entrée`/`Échap`/flèches.
- Critères : tests jsdom (focus, clavier, valeurs retournées) ; `role=dialog` + `aria-modal` ; thème sans asset ;
  durée = `--mh-dur-fast`.
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/ui-manager.css`, `tests/unit/ui/ui-manager.test.ts`.
- Dépend de : HUD-01.

**HUD-06 — Menu système plein cadre (clic droit)** (E5, p1)
- Remplacer le panneau « Pause » par la colonne de 9 entrées (save, load, config, auto, skip, backlog, graphic, title,
  exitgame) + « Back », voile bleu nuit en 270 ms.
- Critères : l'ordre et les entrées correspondent à §2.5 ; *save/load* désactivés si `quickMenuLocked` ; *graphic* appelle
  `toggleUserHide` ; test e2e ouvre/ferme (clic droit, `Échap`) ; les libellés viennent du dictionnaire (WEB-05) ou, à défaut, sont centralisés dans une constante.
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/ui-manager.css`, `src/ui/types.ts` (si nouvelle commande), tests.
- Dépend de : HUD-01, HUD-02, HUD-05.

**HUD-07 — Écran titre fidèle** (E5, p1)
- Écran titre clair : illustration (assets), logo, menu vertical centré, survol `--mh-ink-hover`, mention de droits ; repli CSS.
- Critères : positions de §2.1 (±2 %) en 1280×720 ; clavier ; sans assets : fond crème + titre textuel ; le test
  `ui-manager.test.ts` existant est mis à jour ; la grille de chapitres **n'apparaît plus** au titre (voir HUD-08).
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/ui-manager.css`, `src/ui/chapter-list.ts`, tests.
- Dépend de : HUD-01, HUD-03.

**HUD-08 — Sous-menu Extra et Archive** (E5, p2)
- Sous-menu en place (Archive, CG mode, Sound mode, Back) ; Archive = liste de chapitres déplacée du titre.
- Critères : fondu croisé ≈ 1 s (désactivable) ; Archive grisé tant qu'aucun chapitre n'est déverrouillé ; tests de
  navigation ; CG/Sound sont désactivés tant que HUD-13/14 n'existent pas.
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/chapter-list.ts`, tests.
- Dépend de : HUD-07.

**HUD-09 — Re-skin de la configuration (panneaux d'origine)** (E5, p2)
- Adopter panneaux bordés, boutons sarcelle/gris, radios, curseurs à sphère, spinners ; **sans changer le modèle**.
- Critères : tous les tests de config restent verts ; rendu conforme à §2.9 ; décision « Tsukiweb vs original » consignée
  dans `CONFIG_PLAN.md` §6.
- Fichiers : `src/ui/ui-manager.css`, `src/ui/ui-manager.ts`, `docs/CONFIG_PLAN.md`.
- Dépend de : HUD-01, HUD-02.

**HUD-10 — Écran de chargement/sauvegarde 2×4 à 15 pages** (E5/E7, p1)
- Grille 2×4, pagination 15 pages, fiche (vignette, titre de scène, date, verrou, supprimer, charger/sauvegarder),
  emplacements auto/rapide en tête.
- Critères : 8 emplacements par page ; navigation clavier ; confirmations via HUD-05 ; tests unitaires + e2e aller-retour ;
  affichage correct à 1280×720 sans débordement.
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/ui-manager.css`, `src/ui/types.ts` (`SaveSlot.lock?`, `title?`).
- Dépend de : HUD-02, HUD-05, HUD-11.

**HUD-11 — Modèle de sauvegarde : titre, commentaire, verrou** (E7, p2)
- Étendre `SaveRecord` (titre de scène, commentaire, `locked`) avec migration des anciennes sauvegardes ; un
  emplacement verrouillé refuse l'écrasement et la suppression.
- Critères : tests unitaires de migration et de refus ; anciennes sauvegardes chargeables.
- Fichiers : `src/player/save-store.ts`, `src/ui/player.ts`, tests.
- Dépend de : —.

**HUD-12 — Historique fidèle + toast « vide »** (E5, p1)
- Plein écran, police de jeu, ascenseur dédié (scrollbar stylée) + 3 boutons (bas, haut, fermer) ; ouverture refusée avec
  toast si l'historique est vide.
- Critères : test d'ouverture vide ⇒ toast, pas d'écran ; `PageUp/PageDown` ; sélectionnable ; focus visible.
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/ui-manager.css`, `src/ui/player.ts`.
- Dépend de : HUD-02, HUD-13.

**HUD-13 — Toasts stylés** (E5, p2)
- Toast sarcelle ornementé, bas droite, 2,5 s, `aria-live=polite`.
- Critères : durée et position de §2.6 ; test jsdom ; empilement limité à 3.
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/ui-manager.css`.
- Dépend de : HUD-01.

**HUD-14 — Transitions plein écran standard** (E5, p2)
- Fondu au noir/depuis le noir pour titre↔jeu et chargement (1,2 s / 0,85 s ; 0,4 s / 0,8 s).
- Critères : durées lues dans les tokens ; test avec horloge simulée ; aucune transition sous `prefers-reduced-motion`.
- Fichiers : `src/ui/player.ts`, `src/ui/ui-manager.ts`, `src/ui/ui-manager.css`.
- Dépend de : HUD-01.

### 8.3 Adaptation web

**WEB-01 — Menu et gestes tactiles** (E5, p1) — #98
- Bouton de menu persistant discret, appui long = menu, balayage = historique ; barre d'actions rapides (Q.save, Q.load,
  auto, skip, volume, plein écran) visible **en tactile uniquement**.
- Critères : test Playwright en émulation tactile ; cibles ≥ 44 px ; absent sur desktop souris.
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/ui-manager.css`, `tests/e2e/`.
- Dépend de : HUD-06.

**WEB-02 — Responsive portrait des écrans système** (E5, p2) — #98
- Les écrans système reflowent en portrait ; texte de jeu dans une zone sous la scène ; viewport `viewport-fit=cover`.
- Critères : captures à 390×844 sans défilement horizontal ni texte < 14 px ; test Playwright d'orientation.
- Fichiers : `src/ui/ui-manager.css`, `src/main.css`, `index.html`, `src/core/display.ts`.
- Dépend de : HUD-02, HUD-10.

**WEB-03 — Sauvegardes en IndexedDB + export/import** (E7, p2)
- Magasin IndexedDB (enregistrements + vignettes), migration depuis `localStorage`, export/import JSON.
- Critères : migration testée ; 120 emplacements sans erreur de quota ; export/import aller-retour ; repli `localStorage`.
- Fichiers : `src/player/save-store.ts`, `src/main.ts`, tests.
- Dépend de : HUD-11.

**WEB-04 — Routes d'URL des écrans** (E5, p3)
- `#/title`, `#/game`, `#/load`, `#/save`, `#/config`, `#/backlog`, `#/flowchart` ; bouton précédent ferme l'écran.
- Critères : test e2e (lien direct, retour arrière) ; pas de rechargement de page.
- Fichiers : `src/main.ts`, `src/ui/player.ts`.
- Dépend de : HUD-06.

**WEB-05 — Dictionnaire d'interface FR/JA/EN** (E5/E7, p2)
- Extraire les libellés en dur de `ui-manager.ts` vers un dictionnaire par langue.
- Critères : aucune chaîne en dur dans les écrans refaits ; test qui échoue si une clé manque ; `lang` posé sur la racine.
- Fichiers : `src/core/language.ts`, `src/ui/i18n.ts`, `src/ui/ui-manager.ts`.
- Dépend de : —.

**WEB-06 — Accessibilité des écrans système** (E5, p2) — #97
- Focus visible, rôles (`dialog`, `tablist`, `list`), annonces, `prefers-reduced-motion`.
- Critères : audit axe-core sans violation sérieuse sur les écrans refaits ; navigation 100 % clavier (test).
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/ui-manager.css`, `tests/e2e/`.
- Dépend de : HUD-05, HUD-06, HUD-10, HUD-12.

### 8.4 Extra et vérification

**HUD-15 — CG mode** (E5, p3)
- Grille 4×4, chapitres, bascule événement/arrière-plan, visionneuse ; suivi des CG vus en stockage.
- Critères : verrouillées = « non affichée » ; tests de déverrouillage ; aucune miniature commitée.
- Fichiers : `src/ui/`, `src/player/settings-store.ts`.
- Dépend de : HUD-02, HUD-08, WEB-03.

**HUD-16 — Sound mode** (E5, p3)
- Lecteur de BGM (liste, lecture, stop, suivant, répétition, aléatoire, volume, progression).
- Critères : tests avec `FakeAudioPlayer` ; contrôles au clavier ; métadonnées issues du manifeste utilisateur.
- Fichiers : `src/ui/`, `src/renderer/audio-manager.ts`.
- Dépend de : HUD-02, HUD-08.

**HUD-17 — Captures complémentaires** (E5, p1)
- Demander à l'utilisateur les captures de §6 (choix, Save, titre de chapitre, auto/skip, fin) puis compléter
  `ANALYSE_HUD_ORIGINAL.md` et `DESIGN.md`.
- Critères : §6 vidé ou reclassé ; tokens ajoutés.
- Fichiers : `docs/ANALYSE_HUD_ORIGINAL.md`, `docs/DESIGN.md`.
- Dépend de : —.

**HUD-18 — Écran de choix fidèle** (E5, p1)
- À spécifier après HUD-17 ; utiliser `selectcursor` si présent.
- Dépend de : HUD-17, HUD-01.

### 8.5 Flowchart

**FLOW-01 — Extraction du graphe de scénario** (E4/E7, p2)
- `npm run chain` produit aussi `story-graph.json` : nœuds (id, chapitre, arc, type choix/interlude/fin/normal, clé de
  première image), arêtes (type, libellé de choix, condition). Dérivé, gitignoré.
- Critères : test sur `story-chain` factice (24 choix, 4 fins, 4 interludes sur le corpus de référence) ; `check:assets`
  vert ; documenté dans `ENCHAINEMENT_SCRIPTS.md`.
- Fichiers : `tools/` (outil chain), `.gitignore`, tests, doc.
- Dépend de : —.

**FLOW-02 — Types et mise en page pure** (E7, p2)
- `src/core/flow-graph.ts` (types) et `src/core/flow-layout.ts` (niveaux, ordre, arêtes orthogonales).
- Critères : tests sur graphes synthétiques (chaîne, choix, fusion, interlude partagé, cycle) ; déterministe ;
  200 nœuds en < 100 ms.
- Fichiers : `src/core/flow-graph.ts`, `src/core/flow-layout.ts`, `tests/unit/core/`.
- Dépend de : FLOW-01 (types seulement).

**FLOW-03 — Stockage de la progression par scène** (E7, p2)
- Étendre `settings-store` : `visited`, `finished`, `choices`, `endings`, avec migration et export.
- Critères : migration d'anciennes données ; tests de lecture/écriture ; aucun libellé de choix stocké (cible seulement).
- Fichiers : `src/player/settings-store.ts`, tests.
- Dépend de : —.

**FLOW-04 — Enregistrement des événements** (E7, p2)
- Le player alimente `visited/finished/choices/endings` à chaque script, choix, fin ; expose le script courant.
- Critères : tests avec `FakeRuntime` ; sauvegarde/chargement restent cohérents ; `story-play` intégration vert.
- Fichiers : `src/ui/player.ts`, `src/ui/types.ts`.
- Dépend de : FLOW-03.

**FLOW-05 — Rendu statique du flowchart** (E5, p2)
- Vue SVG + DOM selon §7.4 : nœuds par état, arêtes, regroupement par chapitre, légende, compteurs, marqueur courant.
- Critères : états visités/non visités/courant/choix/fin différenciés sans couleur seule ; sans assets ; capture locale.
- Fichiers : `src/ui/flowchart-view.ts`, `src/ui/ui-manager.css`, `src/ui/ui-manager.ts`.
- Dépend de : FLOW-02, HUD-01, HUD-02.

**FLOW-06 — Interactions** (E5, p2)
- Pan, zoom, centrer, volet de détails, « Relire depuis ici » avec confirmation.
- Critères : tests des handlers pointeur/molette ; relecture lance le bon script ; confirmation via HUD-05.
- Fichiers : `src/ui/flowchart-view.ts`, `src/ui/player.ts`.
- Dépend de : FLOW-05, FLOW-04, HUD-05.

**FLOW-07 — Accessibilité du flowchart** (E5, p2)
- Navigation clavier par arêtes, équivalent liste, `aria-label`, annonces, portrait.
- Critères : axe-core sans violation ; parcours clavier complet testé ; contraste ≥ 4,5:1.
- Fichiers : `src/ui/flowchart-view.ts`, tests.
- Dépend de : FLOW-05.

**FLOW-08 — Intégration** (E5, p2)
- Entrées titre, menu système (onglet Historique/Flowchart), route `#/flowchart`, anti-spoiler configurable.
- Critères : accès depuis trois points ; réglage « tout afficher » ; test e2e.
- Fichiers : `src/ui/ui-manager.ts`, `src/ui/player.ts`, `src/renderer/types.ts` (réglage).
- Dépend de : FLOW-06, HUD-06, WEB-04.

**FLOW-09 — Test e2e du flowchart** (E6, p2)
- Parcours : jouer un choix, ouvrir le flowchart, vérifier le nœud visité et la position, relire depuis un nœud.
- Critères : exécuté en CI avec placeholders ; Chrome et Firefox.
- Fichiers : `tests/e2e/`.
- Dépend de : FLOW-08.

### 8.6 Graphe de dépendances

```
HUD-01 ─┬─ HUD-02 ─┬─ HUD-06 ─┬─ WEB-01
        │          │          └─ WEB-04 ── FLOW-08
        │          ├─ HUD-09
        │          ├─ HUD-10 ── WEB-02
        │          ├─ HUD-12 (dépend aussi de HUD-13)
        │          └─ FLOW-05 ── FLOW-06 ── FLOW-08 ── FLOW-09
        ├─ HUD-03 ── HUD-07 ── HUD-08 ── HUD-15, HUD-16
        ├─ HUD-05 ── HUD-06, HUD-10
        ├─ HUD-13, HUD-14
HUD-04 (indépendant)       HUD-11 ── HUD-10, WEB-03
HUD-17 ── HUD-18           WEB-05, WEB-06
FLOW-01 ── FLOW-02 ── FLOW-05      FLOW-03 ── FLOW-04 ── FLOW-06
```

### 8.7 Ordre conseillé

1. **Gain immédiat** : HUD-04 (texte), HUD-17 (captures manquantes).
2. **Socle** : HUD-01, HUD-02, HUD-05, HUD-13.
3. **Écrans** : HUD-06, HUD-07, HUD-10 (avec HUD-11), HUD-12, HUD-14.
4. **Web** : WEB-01, WEB-02, WEB-05, WEB-06, WEB-03.
5. **Flowchart** : FLOW-01 → FLOW-09.
6. **Extra** : HUD-08, HUD-15, HUD-16, HUD-09, HUD-18, WEB-04.

## 9. Décisions à valider par le propriétaire

1. **Config** : conserver l'habillage Tsukiweb (#177) ou revenir au design d'origine (HUD-09) ?
2. **Flowchart** : entrée au titre, dans Extra, ou onglet de l'historique (§7.3) ?
3. **Exit** : retirer, ou remplacer par un lien externe ?
4. **Texte portrait** : zone dédiée sous la scène (recommandé) ou superposé ?
5. **Anti-spoiler** du flowchart : par défaut masqué (recommandé) ?
