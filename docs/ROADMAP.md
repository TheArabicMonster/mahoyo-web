# Roadmap

Découpage en épics. Chaque épic est une milestone GitHub, et chaque ligne est portée par une issue.

Les épics sont regroupés en deux jalons de livraison : **v1.0** et **v1.1** (voir la fin du document).

## État au 2026-11-10 — v1.1 en cours

- **v1.0 : 101/101 (100 %, 🟢 Terminé)** — clôture DoD le 2026-11-09 (#302) : audit KAG sans inconnue
  (125 implémentées, 5 no-ops justifiés), lecture complète 221/221, mode zéro strict. Notes de version
  prêtes mais **non publiées** ([`RELEASE_NOTES_V1.0.md`](RELEASE_NOTES_V1.0.md)) ; **aucun tag ni release**
  avant validation du propriétaire.
- **v1.1 : 67/74 (91 %, 🟡 En cours)** — 7 issues ouvertes : **6 restantes** (#315, #316, #254, #213, #187,
  #158) + **#347**, nouvelle tâche de validation visuelle automatisée #315/#316. Notes de version
  **brouillon** : [`RELEASE_NOTES_V1_1.md`](RELEASE_NOTES_V1_1.md) (**non publiées**, aucun tag).
- **E1–E4, E7** : livrés (extraction, parser KAG3, runtime/rendu, pipeline, player et projet réel).
- **E5** : livré pour la vague v1.1, hors HUD-18 — WCAG AA (#97), focus Firefox (#257), accessibilité des
  écrans système (#211), mobile/tactile (#98, #210), thème et animations (#99) ; les écrans HUD de la v1.0
  restent livrés. Restent : écran de choix **HUD-18** (#213, bloqué par #187) et captures complémentaires
  **HUD-17** ([guide](GUIDE_CAPTURES.md), action propriétaire).
- **E6** : en cours (v1.1) — **2 382 tests unitaires** (164 fichiers), e2e **254 tests / 26 fichiers**
  (Chromium + Firefox), **CI 4 jobs** (`build-and-test`, `pwa`, `e2e (chromium)`, `e2e (firefox)`) ;
  garde-fous `check:conflict-markers`, `audit:guard`, `check:generated`, `oracle:state`. Audit WCAG AA
  **0 violation** axe-core (Chromium + Firefox). Restent : validation visuelle #315/#316/#254 (#347 +
  enregistrements), #158, #213.

### Livré cette vague (v1.1, 2026-11-10)

- **KAG à plat (#80)** : `@if`/`@macro` linéarisés, `@call` fiable au milieu d'un bloc, `@return` au bon endroit.
- **Accessibilité WCAG AA (#97)** : audit axe-core **0 violation** (Chromium + Firefox) sur les vues
  atteignables, zoom navigateur autorisé, sémantique/ARIA, `prefers-reduced-motion` ; **focus Firefox**
  programmatique réparé (#257) ; écrans système accessibles (#211).
- **Mobile et tablette (#98, #210)** : gestes tactiles (appui long, balayages, retour arrière), dock portrait
  avec zone de texte dédiée, safe-areas, e2e mobile (Chromium) ; corrections de mise en page #325/#326/#332.
- **Thème et animations (#99)** : tokens de surfaces/focus/mouvement, animations d'interface et **option de
  réduction** des animations dans la configuration.
- **Pistes et transitions (#317)** : `@bgact` à keyframes multiples, calques de `@playtimeline` sur le modèle
  de pistes, nettoyage des types legacy ; **oracle d'état : 0 hash différent** (251 scripts, 49 436 steps,
  23 209 événements `text`, 15 746 = 15 746 scènes). Correctifs **#315** (sprite professeur) et **#316**
  (transitions) mergés — **validation visuelle en attente**.
- **Qualité / CI** : garde-fou anti-marqueurs de conflit Git (#342), correction portrait (#332), correctif
  PWA/service worker (#337), **CI 4 jobs** ; guides de recette ([`TEST_VISUEL_V1_1.md`](TEST_VISUEL_V1_1.md))
  et de captures ([`GUIDE_CAPTURES.md`](GUIDE_CAPTURES.md), #187).

### Reste en v1.1 (7 issues ouvertes)

Les **6 issues restantes** hors #347 : #315, #316, #254, #213, #187, #158. **#347** est une nouvelle tâche
de validation ajoutée à la vague (d'où **74** issues au total dans la milestone).

| Blocage | Issues |
|---|---|
| **Validation visuelle / enregistrements propriétaire** | [#315](https://github.com/TheArabicMonster/mahoyo-web/issues/315) sprite du professeur (correctif mergé, validation en attente) · [#316](https://github.com/TheArabicMonster/mahoyo-web/issues/316) transitions trop courtes/cuts (correctif mergé, validation en attente) · [#254](https://github.com/TheArabicMonster/mahoyo-web/issues/254) ouverture : flash blanc / panoramique final |
| **Captures propriétaire** | [#187](https://github.com/TheArabicMonster/mahoyo-web/issues/187) HUD-17 captures complémentaires (action utilisateur, [guide](GUIDE_CAPTURES.md)) ; [#213](https://github.com/TheArabicMonster/mahoyo-web/issues/213) HUD-18 écran de choix **bloqué par #187** |
| **Validation automatisée** | [#347](https://github.com/TheArabicMonster/mahoyo-web/issues/347) validation visuelle #315/#316 sur assets réels, sans nouvel enregistrement |
| **Fidélité** | [#158](https://github.com/TheArabicMonster/mahoyo-web/issues/158) fidélité de l'ouverture (p3) |

## E0 — Gouvernance & socle 🔄

- Structure du repo, docs, templates, Project GitHub, backlog initial.

## E1 — Extraction

- Extraire et inventorier les `.xp3` de la version PC 2012.
- Convertir les `.tlg` → PNG/WebP.
- Vérifier l'état des scripts `.ks` (déchiffrés et lisibles après normalisation UTF-8).

## E2 — Parser KAG3

- Lexer : découpe des lignes, arguments de commande, tags inline.
- Parser : regroupement en pages, table des labels.
- Support des furigana.
- Tolérance aux commandes inconnues.

## E3 — Runtime & rendu web

- Runtime minimal : variables, sauts, conditions.
- Modèle fore/back.
- Rendu web : background, sprites, texte, audio.

## E4 — Pipeline d'assets

- Scripts TypeScript d'extraction et conversion (outils dans `tools/`).
- Extraction `.xp3` automatisée par gabarit d'outil externe, rapport d'exécution et garde-fous de sortie (#95).
- Conversion `.tlg` → PNG (décodeur intégré TLG0.0/TLG5.0) ou WebP (convertisseur externe).
- Copie ou re-encodage audio OGG, normalisation des scripts `.ks` (Shift_JIS → UTF-8, BOM, fins de ligne,
  commandes non supportées, noms de storage).
- Manifeste d'assets, vérification des références, CLI orchestrator (`npm run pipeline`) avec `--dry-run`.
- Documentation ([`PIPELINE.md`](PIPELINE.md)) et parcours utilisateur du README (#93).

## E5 — UI/UX 🔄

- Analyse du HUD d'origine et design system : [`ANALYSE_HUD_ORIGINAL.md`](ANALYSE_HUD_ORIGINAL.md), [`DESIGN.md`](DESIGN.md) (backlog atomique HUD-xx, WEB-xx, FLOW-xx).
- Écrans refaits au design d'origine : titre, Extra/Archive, menu système, historique, chargement/sauvegarde,
  configuration, flowchart, CG mode et Sound mode (HUD-02 à HUD-16), transitions plein écran (HUD-14).
- Livré pour la vague v1.1 : WCAG AA (#97), focus Firefox (#257), responsive portrait (#210) et accessibilité
  des écrans système (#211), mobile et tablette tactile (#98), thème et animations (#99).
- Restent : **écran de choix fidèle (HUD-18, #213)**, bloqué par les **captures complémentaires HUD-17
  (#187)** — voir [`GUIDE_CAPTURES.md`](GUIDE_CAPTURES.md).

## E6 — QA & optimisation 🔄

- Tests de non-régression : **2 382 tests unitaires** (164 fichiers) et suite e2e Playwright
  **254 tests / 26 fichiers** sur Chromium et Firefox (placeholders, dont parcours complet #94, accessibilité
  WCAG AA #97 et mobile #98).
- **CI 4 jobs** : `build-and-test` (lint, anti-assets, build, tests unitaires, tests d'intégration en skip
  propre, lecture complète des 221 scripts sur placeholders) ; `pwa` (manifeste + e2e hors-ligne) ; matrice
  `e2e (chromium)` / `e2e (firefox)` (#220, #243, #269, #273, #342).
- Garde-fous : `check:conflict-markers` (marqueurs de conflit Git), `audit:guard` (zéro strict),
  `check:generated` (docs générées), `oracle:state` (preuve de non-régression des pistes).
- Preuves de la vague : **oracle d'état 0 hash différent** (251 scripts, 49 436 steps, 23 209 événements
  `text`, 15 746 = 15 746 scènes) ; **WCAG AA 0 violation** axe-core (Chromium + Firefox) ; e2e mobile.
- Restent : validation visuelle #315/#316/#254 (#347 et enregistrements propriétaire), #158, et le test e2e
  du flowchart (FLOW-09, #212) pour la suite v1.1.

## E7 — Projet réel (production) ✅ — périmètre v1.0

- Refactor de l'architecture : séparation moteur KAG / renderer web.
- Abstraction `Renderer` et événements de rendu.
- Modules dédiés : audio, UI, input, rendering.
- Sauvegardes robustes avec vignettes (IndexedDB, export/import JSON).
- Support de traductions fan (patch français Moon-Trad) : installation, vérification de compatibilité et sélecteur de langue.
- Build de production (`npm run build`) et CI ; le déploiement hébergé reste hors périmètre v1.0.

## Jalons de livraison

### v1.0 — Jeu complet jouable sur desktop

Objectif : lecture complète des 221 scripts narratifs, du prologue à la dernière scène, sur Chrome et Firefox récents (desktop).

- **Terminée le 2026-11-09 (101/101), prête pour le test manuel du propriétaire.** Audit KAG sans
  inconnue (**125 implémentées**, **5 no-ops justifiés**, baseline vide), lecture complète
  **221/221 scripts**, mode **zéro strict**, docs régénérées et notes de version prêtes mais **non
  publiées** ([`RELEASE_NOTES_V1.0.md`](RELEASE_NOTES_V1.0.md)). **Aucun tag ni release** avant
  validation. Voir la section « DoD — v1.0 » de [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md) et
  [`PROGRESS.md`](PROGRESS.md).
- Épics concernés : E1 à E4, E7, et la part de E6 consacrée aux tests de non-régression et e2e.

### v1.1 — Confort, accessibilité et finitions

**En cours**, **67/74 (91 %)**, 7 issues ouvertes (6 restantes + #347 validation) :

- **Livré** : mobile et tablette (tactile, portrait, safe-areas), PWA/hors-ligne, **WCAG AA** (0 violation
  axe-core, focus Firefox), thème et animations, pistes/transitions unifiées, garde-fou CI marqueurs de
  conflit, KAG à plat (`@if`/`@macro`/`@call`).
- **Reste** : validation visuelle #315/#316/#254 (#347 + enregistrements propriétaire), **écran de choix
  #213** (bloqué par **#187**, captures à fournir — [`GUIDE_CAPTURES.md`](GUIDE_CAPTURES.md)), fidélité de
  l'ouverture #158, test e2e du flowchart (#212) pour la suite.
- Recette manuelle : [`TEST_VISUEL_V1_1.md`](TEST_VISUEL_V1_1.md) ; notes de version **brouillon** :
  [`RELEASE_NOTES_V1_1.md`](RELEASE_NOTES_V1_1.md) (**non publiées, aucun tag ni release**).
- Épics concernés : E5 et le reste de E6.
