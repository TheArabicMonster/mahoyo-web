# Roadmap

Découpage en épics. Chaque épic est une milestone GitHub, et chaque ligne est portée par une issue.

Les épics sont regroupés en deux jalons de livraison : **v1.0** et **v1.1** (voir la fin du document).

## État au 2026-11-09

- **v1.0 : 86/86 (100 %, 🟢 Terminé)** — release close le 2026-11-09 : lint ESLint 9 (#220), lecture
  complète des 221 scripts en CI sur un corpus de placeholders (#269, #273) et documentation de clôture
  (#270). La DoD de release est satisfaite ; voir [`PROGRESS.md`](PROGRESS.md).
- **v1.1 : 43/61 (70 %)** — 18 issues restantes, détaillées ci-dessous ; c'est l'**épic suivant, en cours**.
- **E1–E4** : livrés (extraction, parser KAG3, runtime/rendu, pipeline et traductions).
- **E7** : périmètre v1.0 livré — player complet, lecture du corpus, sauvegardes IndexedDB avec export/import
  JSON, écrans HUD refaits (titre, Extra/Archive, menu système, historique, chargement/sauvegarde,
  configuration, flowchart, CG mode, Sound mode), sélecteur de langue et parcours utilisateur du README.
- **E5** : en cours (v1.1) — analyse du HUD, design system et tokens CSS livrés (#179, #181). Les vagues 4
  (HUD-08/09/12, FLOW-06, WEB-01/04) et 5/6 sont mergées le 2026-11-09 : HUD-14 transitions (#205), HUD-15
  CG mode (#208), HUD-16 Sound mode (#209), FLOW-07 accessibilité du flowchart (#206) et FLOW-08 intégration
  au titre/menu/route (#207). Restent v1.1 : HUD-17/18, WEB-02/06, FLOW-09, accessibilité WCAG AA, mobile et
  responsive, PWA et thème complet.
- **E6** : en cours (v1.1) — **1939 tests unitaires** (112 fichiers), `npm run lint` (ESLint 9), build et
  `check:assets` verts ; e2e Playwright sur **Chromium et Firefox** en placeholders (15 fichiers de spec) ;
  CI à **3 jobs** (`build-and-test` avec lint, anti-assets, build, tests unitaires, tests d'intégration en
  skip sur checkout nu et lecture complète des 221 scripts sur placeholders ; matrice e2e). Restent : FLOW-09,
  mobile et objectifs de performance chiffrés (#100).

### Livré depuis la vague 4 (2026-11-09)

- **HUD-14** transitions plein écran (#205) ; **HUD-15** CG mode (#208) ; **HUD-16** Sound mode (#209).
- **FLOW-07** accessibilité du flowchart (#206) ; **FLOW-08** intégration titre, menu système et route (#207).
- **e2e** parcours complet sur Chromium et Firefox (#94), placeholders en CI (#243) ; **CI 3 jobs**.
- **Corrections de fidélité** : fonds et `partbg` du prologue avec outil de trace (#249), attributs d'apparence
  des calques (#252), effets d'ambiance `envcolor` (#260), garde-fou du dossier de travail du pipeline (#264).
- **Lint & CI** : ESLint 9 en flat config et `npm run lint` en CI (#220) ; lecture complète en placeholders et
  skip propre des tests d'intégration sans assets (#269, #273).
- **Clôture v1.0** : README (parcours #93, état #270), ROADMAP, PROGRESS et ARCHITECTURE à jour.

### Reste en v1.1 (18 issues ouvertes)

| Thème | Issues |
|---|---|
| UI/UX | #210 WEB-02 responsive portrait · #211 WEB-06 accessibilité des écrans système · #213 HUD-18 écran de choix · #187 HUD-17 captures complémentaires de l'original |
| Flowchart | #212 FLOW-09 test e2e du flowchart |
| Fidélité / rendu | #158 fidélité de l'ouverture (synchro musique) · #253 `@trans` exchange/backlay · #254 ouverture (flash blanc/panoramique) · #257 focus Firefox du menu système |
| Accessibilité / mobile | #97 WCAG AA · #98 mobile et tablette |
| Confort / plateforme | #99 thème complet et animations · #96 PWA hors ligne · #100 objectifs de performance chiffrés |
| Moteur KAG | #80 `@if`/`@macro` à plat et `@call` fiable · #85 commandes visuelles secondaires · #86 commandes KAG restantes |
| Outillage | #265 `.gitignore` du lien symbolique `node_modules` |


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
- Restent pour la v1.1 : écran de choix (HUD-18, #213), responsive portrait (WEB-02, #210), accessibilité des
  écrans système (WEB-06, #211), WCAG AA (#97), thème complet et animations (#99), PWA/offline (#96).

## E6 — QA & optimisation 🔄

- Tests de non-régression : **1939 tests unitaires** (112 fichiers) et suite e2e Playwright sur Chromium et
  Firefox en placeholders (15 fichiers de spec, dont le parcours complet #94 et l'accessibilité du flowchart).
- CI à **3 jobs** : `build-and-test` (lint, contrôle anti-assets, build, tests unitaires, tests d'intégration
  en skip propre sur checkout nu puis lecture complète des 221 scripts sur corpus de placeholders) et matrice
  `e2e (chromium)` / `e2e (firefox)` avec placeholders (#220, #243, #269, #273).
- Intégration : `npm run corpus:full-read` génère le corpus de placeholders (`MAHOYO_E2E_ASSETS`,
  `MAHOYO_FULL_READ_SCRIPTS`) ; `npm run test:full-read` le lit via `MAHOYO_ASSETS_DIR`. Vrais assets locaux
  et corpus de placeholders suivent la même logique de lecture.
- Restent pour la v1.1 : test e2e du flowchart (FLOW-09, #212), mobile/tablette (#98) et objectifs de
  performance chiffrés (#100).

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

- **État au 2026-11-09 : terminée, 86/86 (100 %).** Toutes les issues de la milestone sont fermées ; lint
  (#220) et lecture complète en CI sur placeholders (#269, #273) sont verts, la documentation de clôture est
  livrée (#270). Voir la section « DoD — v1.0 » de [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md) et
  [`PROGRESS.md`](PROGRESS.md).
- Épics concernés : E1 à E4, E7, et la part de E6 consacrée aux tests de non-régression et e2e.

### v1.1 — Confort, accessibilité et finitions

**En cours** (épic suivant), 43/61 (70 %). Reporté après la v1.0 :

- Mobile et tablette (interface tactile, responsive).
- PWA et mode hors ligne.
- Accessibilité conforme WCAG AA.
- Thème Mahoyo complet.
- Objectifs de performance chiffrés (temps de chargement, fluidité), à définir dans l'issue dédiée.
- Issues de priorité `p3`.
- Épics concernés : E5 et le reste de E6.
