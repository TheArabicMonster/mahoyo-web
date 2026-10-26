# Agent D — Orchestrateur Player

## Objectif

Réécrire `src/ui/player.ts` pour connecter `Runtime`, `StageRenderer`, `AudioPlayer` et `UIManager`.

## Interface à implémenter

```ts
export interface PlayerCommands {
  advance(): void;
  setMode(mode: PlayMode): void;
  toggleUserHide(): void;
  rollback(): void;
  choose(index: number): void;
  startScript(file: string, label?: string): void;
  openScreen(screen: OverlayScreen): void;
  closeScreen(): void;
  returnToTitle(): void;
  save(slot: SlotId): Promise<void>;
  load(slot: SlotId): Promise<void>;
  deleteSave(slot: SlotId): Promise<void>;
  updateSettings(patch: Partial<GameSettings>): void;
  toggleFullscreen(): void;
}
```

## Fichiers que tu possèdes

- `src/ui/player.ts`
- `tests/unit/ui/player.test.ts`
- Modules de persistance : `src/player/save-store.ts`, `src/player/settings-store.ts` (optionnels, recommandés)

## Fichiers interdits

- `src/kag/**` (sauf appels à l'API publique de `Runtime`)
- `src/renderer/types.ts`, `src/ui/types.ts`
- `src/main.ts` (sauf import/export de `Player`)
- `index.html`
- `package.json`, `vite.config.ts`, `tsconfig.json`

## Décisions déjà tranchées

- Le Player est le seul orchestrateur.
- Il instancie `StageRenderer`, `AudioPlayer`, `UIManager` via leurs factories.
- Il route les events : visuels/texte → StageRenderer, audio → AudioPlayer.
- Il appelle `audio.unlock()` de façon synchrone dans `advance`, `startScript` et `load`.
- Il gère `visibilitychange` pour appeler `audio.suspend()` / `audio.resume()`.
- Il maintient l'historique de rollback (sauvegardes temporaires à chaque point de clic).
- `apply()` des renderers n'est jamais appelé en concurrence.

## Automate d'états suggéré

```
title -> loading -> playing -> waiting-click
                             -> waiting-choice
                             -> waiting-wait
                             -> paused
```

## Points de vigilance

- **Load/rollback** : utiliser `reduceStage()` et `reduceAudio()` pour reconstruire les snapshots, puis `stageRenderer.restore()` et `audioPlayer.restore()`.
- **Skip** : en mode skip, passer `instant: true` aux renderers et ignorer les pauses [l].
- **Auto** : après affichage du texte, attendre `autoDelay` puis avancer.
- **Sauvegardes** : thumbnail via `stageRenderer.captureThumbnail()`, prévisualisation via le texte courant.
- **Concurrence** : un `AbortController` par `apply()` pour pouvoir annuler en cas de load/rollback.

## Trous connus

Si le contrat est insuffisant, choisis l'hypothèse la plus simple, documente-la dans `docs/agents/D-QUESTIONS.md`, et continue.

## Références

- Contrats : `src/renderer/types.ts`, `src/ui/types.ts`, `src/kag/events.ts`
- Réducteurs : `src/kag/stage-state.ts`
- Résolveur : `src/core/asset-resolver.ts`
- Layout : `docs/layout.md`
- Mocks : `tests/unit/mocks/*`
- Fixtures : `tests/fixtures/*.json`

## Non-objectifs

- Parser/lexer KAG.
- Rendu DOM direct (delegué à StageRenderer et UIManager).
- Lecture audio directe (déléguée à AudioPlayer).

## Definition of Done

- [ ] `npx tsc --noEmit` passe.
- [ ] `npm test` passe (au moins les tests du module).
- [ ] Le Player peut rejouer une fixture JSON de bout en bout.
- [ ] Save/load/delete fonctionnent avec les mocks.
- [ ] Aucune dépendance npm ajoutée sans justification.
- [ ] Aucun asset sous copyright n'est commité.
