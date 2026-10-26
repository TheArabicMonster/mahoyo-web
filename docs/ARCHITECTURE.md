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
   │  → Step { events, stop }
   ▼
src/ui/player.ts  ── orchestrateur
   │  → StageRenderer + AudioPlayer + UIManager
   ▼
src/renderer/ + src/ui/  ── rendu navigateur
```

## Composants

### `src/kag/` — moteur KAG

1. **`lexer.ts`** : découpe des lignes, parsing des arguments, tags inline.
2. **`parser.ts`** : produit une liste d'instructions + table des labels.
3. **`runtime.ts`** : exécute instruction par instruction et produit des `Step { events, stop }`.
4. **`types.ts`** : types partagés (Token, Instruction, Page, TextSegment).
5. **`events.ts`** : contrat de sortie du runtime (`RenderEvent`, `StopReason`, `Step`, snapshots).

### `src/renderer/` — rendu navigateur

- **`types.ts`** : interfaces `StageRenderer` et `AudioPlayer`, settings.
- **`audio-manager.ts`** : implémentation web de `AudioPlayer`.

### `src/ui/` — interface utilisateur

- **`types.ts`** : interfaces `UIManager`, `PlayerCommands`, `UIView`.
- **`player.ts`** : orchestrateur (stub temporaire).

### `src/core/` — utilitaires

- **`asset-resolver.ts`** : résolution des URLs d'assets.

### `tools/` — pipeline d'assets (hors dépôt pour les assets)

- Extraction `.xp3`.
- Conversion `.tlg` → WebP.
- Préparation des assets par script.

## Flux de lecture

1. Le **player** charge un script `.ks`, le parse et crée un `Runtime`.
2. Le **player** appelle `runtime.step()` de manière répétée.
3. Chaque `Step` contient :
   - `events` : événements de rendu purs (scène, texte, audio, effets…)
   - `stop` : raison d'arrêt (`click`, `wait`, `loadScript`, `end`…)
4. Le **player** route les events :
   - visuels/texte vers `StageRenderer.apply()`
   - audio vers `AudioPlayer.apply()`
   - menus/flowchart via `UIManager`
5. Le **player** attend l'interaction utilisateur selon `stop`, puis rappelle `runtime.step()`.

## Principes

- Le moteur KAG est indépendant du DOM (testable en headless).
- Le renderer est passif : aucune décision de flux.
- Les assets originaux ne sont jamais versionnés.
