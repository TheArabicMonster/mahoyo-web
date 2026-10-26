# Architecture

Vue technique du projet `mahoyo-web`.

## Pipeline global

```
Jeu original (PC 2012)
   │  .xp3 / .tlg / .ogg / .ks
   ▼
tools/  ── extraction + conversion
   │  → public/assets/... (WebP, OGG, scripts normalisés)
   ▼
src/kag/  ── lexer → parser → runtime
   │  → séquence d'instructions / snapshots
   ▼
src/renderer/ + src/ui/  ── rendu navigateur
```

## Composants

### `src/kag/` — moteur KAG

1. **`lexer.ts`** : découpe des lignes, parsing des arguments, tags inline.
2. **`parser.ts`** : produit une liste d'instructions + table des labels.
3. **`runtime.ts`** : machine à états qui exécute les instructions.
4. **`types.ts`** : types partagés.

### `src/renderer/` — rendu navigateur

- **`types.ts`** : interface `Renderer` et type `RenderEvent`.
- **`audio-manager.ts`** : gestion du BGM et des SE.

### `src/ui/` — interface utilisateur

- **`player.ts`** : orchestration du player (menu, rendu, input, sauvegardes).

### `src/core/` — utilitaires

- **`asset-resolver.ts`** : résolution des URLs d'assets.

### `tools/` — pipeline d'assets (hors dépôt pour les assets)

- Extraction `.xp3`.
- Conversion `.tlg` → WebP.
- Préparation des assets par script.

## Principes

- Le moteur KAG est indépendant du DOM (testable en headless).
- Le renderer consomme des événements/snapshots émis par le runtime.
- Les assets originaux ne sont jamais versionnés.
