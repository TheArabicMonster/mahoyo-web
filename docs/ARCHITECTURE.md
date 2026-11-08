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
6. **`stage-state.ts`** : réducteurs purs `reduceStage()` / `reduceAudio()` pour save/load/rollback.

### `src/renderer/` — rendu navigateur

- **`types.ts`** : interfaces `StageRenderer` et `AudioPlayer`, settings.
- **`audio-manager.ts`** : implémentation web de `AudioPlayer`.

### `src/ui/` — interface utilisateur

- **`types.ts`** : interfaces `UIManager`, `PlayerCommands`, `UIView`.
- **`player.ts`** : orchestrateur (stub temporaire).

### `src/player/` — persistance

- **`settings-store.ts`** : réglages (`mahoyo.settings`), « déjà lu » (`mahoyo.read`), progression par chapitre
  (`mahoyo.progress`) et progression par scène (`mahoyo.story-progress`). Lecture tolérante (absent, partiel,
  corrompu ou stockage inaccessible = valeurs vides/par défaut).
- **`story-progress.ts`** : fonctions pures de la progression par scène pour le flowchart (`StoryProgress` :
  `visited`, `finished`, `choices` = arêtes `{from, to}` en scripts, **jamais de libellé**, `endings`).
  `normalizeStoryProgress` sert aussi à l'import ; `mergeStoryProgress` à l'union de deux exports.
- Réglage `flowchartRevealAll` (défaut `false`) : anti-spoiler du flowchart actif tant qu'il est faux.

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

## Agents parallèles

Les prompts et contrats pour les agents sont dans `docs/agents/{A,B,C,D}.md` :

- **A** : `StageRenderer` DOM (`src/renderer/stage-renderer.ts`)
- **B** : `AudioPlayer` (`src/renderer/audio-manager.ts`)
- **C** : `UIManager` (`src/ui/ui-manager.ts`)
- **D** : orchestrateur `Player` (`src/ui/player.ts`)

Les contrats `src/kag/events.ts`, `src/renderer/types.ts` et `src/ui/types.ts` sont figés (`contracts-v1`). Toute modification doit passer par `docs/agents/*-QUESTIONS.md` et une revue humaine.

## Tests et fixtures

- `tests/unit/mocks/` : mocks partagés (`FakeAudioPlayer`, `FakeUIManager`, `FakeRuntime`).
- `tests/fixtures/*.json` : séquences de `Step` générées par le runtime à partir de samples.

## Principes

- Le moteur KAG est indépendant du DOM (testable en headless).
- Le renderer est passif : aucune décision de flux.
- Les assets originaux ne sont jamais versionnés.
