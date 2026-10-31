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
| B4 | L'animation d'ouverture ne se joue pas comme prévu : les fonds panoramiques apparaissent figés et recadrés (maison, chats en gros plan), sans le mouvement | ja, fr | `opening.ks`, `timelines.json` | Lecteur TLA incomplet : panoramiques, calques et effets non rejoués (issue #125, v1.1) | Grave | Observé, lié à #125 |
| B5 | Les scènes de l'ouverture ne suivent pas l'ordre du film | ja, fr | `opening.ks` | `opening.ks` joue la scène 7 et non la 4 car `cf` n'existe pas dans la sandbox (déjà noté) ; ordre des calques à vérifier | Grave | Cause probable |
| B6 | Au tout début, une image de nuages s'affiche petite (~640×360) et décalée vers la droite au lieu de remplir l'écran | ja, fr | `stage-renderer.ts` (sprite/partbg) | Dimensionnement ou position d'un sprite hors repère 1280×720 ; à isoler | Gênant | Observé (capture `fr-00`) |
| B7 | Quelques textes sont effacés avant d'être lus (`clearText` sans clic) | ja, fr | `3-1`, `5a-3`, `5a-11`, `a-8`, `c-12`, `nz1`, `nz5`, `wik_o` | 10 occurrences en fr contre 11 en ja : défaut du moteur, pas de la traduction | Gênant | **Vérifié** (trace) |
| B8 | 21 clics sans texte en français contre 2 en japonais | fr | `1.5-1`, `1.5-2`, `1.5-4`, `2-2`, `5a-7`, `5a-11`, `5a-12`, `5b-10`, `5b-14`, `wik_*` | La traduction ajoute des commandes (`@se`, `@sestop`…) qui créent des pauses sans texte | Gênant | **Vérifié** (trace) ; les 12 clics restants après #138 sont neutralisés à l'installation (#141) |
| B9 | Voix et sons manquants : 3 « Audio introuvable » dans `1-0` en fr ; ~9 000 références à des assets Steam absents en tout | fr | assets | Fichiers de la version Steam, absents du manifest (limite documentée) | Mineur | Connu |

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
