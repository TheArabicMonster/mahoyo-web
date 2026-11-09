# Roadmap

Découpage en épics. Chaque épic est une milestone GitHub, et chaque ligne est portée par une issue.

Les épics sont regroupés en deux jalons de livraison : **v1.0** et **v1.1** (voir la fin du document).

## État au 2026-11-09

- **v1.0 : 75/82 (91 %)** — 7 issues restantes ; **v1.1 : 32/54 (59 %)**.
- **E1–E4** : livrés (extraction, parser KAG3, runtime/rendu, pipeline et traductions).
- **E7** : avancé — player complet, lecture du corpus, sauvegardes IndexedDB avec export/import JSON, historique,
  configuration au design d'origine, sélecteur de langue et contrôle du viewport.
- **E5** : en cours — analyse du HUD d'origine, design system et tokens CSS livrés (#179, #181). La vague 4 est
  mergée le 2026-11-09 : HUD-08 Extra/Archive (#199), HUD-09 configuration (#200), HUD-12 historique (#201),
  FLOW-06 interactions du flowchart (#202), WEB-01 gestes tactiles (#203) et WEB-04 routes d'URL (#204).
  Restent HUD-14/15/16/17/18, FLOW-07/08/09, WEB-02/06, PWA, accessibilité et thème complet.
- **E6** : en cours — 1939 tests unitaires et 27 tests d'intégration, `lint` (ESLint 9, #220), build et
  `check:assets` verts ; e2e Chrome/Firefox tourne en CI, mobile encore ouvert.
- Dernières briques : sauvegardes en IndexedDB (#198), progression par scène (#193), graphe de scénario (#192),
  historique plein cadre (#201), gestes tactiles (#203), Extra/Archive (#199), configuration (#200),
  interactions du flowchart (#202) et routes d'URL (#204).

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
- Extraction `.xp3` (wrapper, extracteur externe requis).
- Conversion `.tlg` → WebP (wrapper, convertisseur externe requis).
- Copie/re-encodage audio OGG.
- Normalisation des scripts `.ks` : Shift_JIS → UTF-8, BOM, fins de ligne, commandes non supportées, noms de storage.
- CLI orchestrator (`npm run pipeline`).
- Documentation (`docs/PIPELINE.md`).

## E5 — UI/UX

- Analyse du HUD d'origine et design system : [`ANALYSE_HUD_ORIGINAL.md`](ANALYSE_HUD_ORIGINAL.md), [`DESIGN.md`](DESIGN.md) (backlog atomique HUD-xx, WEB-xx, FLOW-xx).
- Thème Mahoyo, animations fluides.
- Accessibilité.
- PWA / offline.

## E6 — QA & optimisation

- Tests de non-régression.
- Optimisation du chargement.
- Test mobile/tablette.

## E7 — Projet réel (production) 🔄

- Refactor de l'architecture : séparation moteur KAG / renderer web.
- Abstraction `Renderer` et événements de rendu.
- Modules dédiés : audio, UI, input, rendering.
- Sauvegardes robustes avec thumbnails.
- Support de traductions fan (patch français Moon-Trad) : installation, vérification de compatibilité et sélecteur de langue.
- Packaging et déploiement.

## Jalons de livraison

### v1.0 — Jeu complet jouable sur desktop

Objectif : lecture complète des 221 scripts narratifs, du prologue à la dernière scène, sur Chrome et Firefox récents (desktop).

- Complétude, commandes KAG, navigation par chapitres, persistance, pipeline, légal, qualité : voir la section « DoD — v1.0 » de [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md).
- Épics concernés : E1 à E4, E7, et la part de E6 consacrée aux tests de non-régression et e2e.

### v1.1 — Confort, accessibilité et finitions

Reporté après la v1.0 :

- Mobile et tablette (interface tactile, responsive).
- PWA et mode hors ligne.
- Accessibilité conforme WCAG AA.
- Thème Mahoyo complet.
- Objectifs de performance chiffrés (temps de chargement, fluidité), à définir dans l'issue dédiée.
- Issues de priorité `p3`.
- Épics concernés : E5 et le reste de E6.
