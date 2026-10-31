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
- Console : `@lockquickmenu`, `@pauseautomode` et `@resumeautomode` sont ignorées avec un avertissement (sans effet voulu, la commande n'a pas de sens dans le player).
- Les voix et sons manquants de la version Steam restent muets (B9) ; dans `1-0` et `1-1`, trois images `im家絵02a/b/c` sont aussi absentes des assets installés (avertissement « Asset introuvable »).
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
