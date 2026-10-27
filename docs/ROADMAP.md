# Roadmap

Découpage en épics. Chaque épic est une milestone GitHub, et chaque ligne est portée par une issue.

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
- Packaging et déploiement.
