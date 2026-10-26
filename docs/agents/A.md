# Agent A — StageRenderer DOM

## Objectif

Implémenter `src/renderer/stage-renderer.ts`, une implémentation DOM de l'interface `StageRenderer` définie dans `src/renderer/types.ts`.

## Interface à implémenter

```ts
export interface StageRenderer {
  mount(root: HTMLElement): void;
  apply(events: readonly RenderEvent[], opts: RunOptions): Promise<void>;
  waitFor(what: Exclude<Awaitable, "audio">, target: string | undefined, signal: AbortSignal): Promise<void>;
  hurry(): void;
  setClickIndicator(style: "line" | "page" | null): void;
  setUserHidden(hidden: boolean): void;
  restore(snapshot: StageSnapshot, signal: AbortSignal): Promise<void>;
  preload(assets: readonly AssetRef[], signal?: AbortSignal): Promise<void>;
  captureThumbnail(maxWidth: number): Promise<Blob | null>;
  setSettings(settings: Readonly<DisplaySettings>): void;
  clear(): void;
  dispose(): void;
}
```

## Fichiers que tu possèdes

- `src/renderer/stage-renderer.ts`
- `tests/unit/renderer/stage-renderer.test.ts`
- `tests/unit/renderer/stage-renderer-demo.html` (optionnel, recommandé)

## Fichiers interdits

- `src/kag/**`
- `src/renderer/types.ts`
- `src/ui/**`
- `src/main.ts`
- `index.html`
- CSS global (`src/main.css`)
- `package.json`, `vite.config.ts`, `tsconfig.json`

## Décisions déjà tranchées

- Résolution logique : **1280×720**. Les coordonnées sont dans cette résolution.
- Scaling géré par `#viewport` (le Player). Le StageRenderer travaille en pixels logiques.
- Layout DOM : voir `docs/layout.md`.
- Les events `audio` sont ignorés par `apply()` (routés vers AudioPlayer par le Player).
- `effect: null` signifie "aucun effet".
- `apply()` n'est jamais appelé en concurrence.
- `hurry()` termine le typewriter en cours et accélère les effets actifs.
- Les promesses résolvent après un abort, ne rejettent pas.

## Trous connus

Si le contrat est insuffisant, choisis l'hypothèse la plus simple, documente-la dans `docs/agents/A-QUESTIONS.md`, et continue.

## Références

- Contrats : `src/renderer/types.ts`, `src/kag/events.ts`
- Layout : `docs/layout.md`
- Fixtures : `tests/fixtures/*.json`
- Mock de référence : `tests/unit/renderer/recording-stage-renderer.ts`

## Non-objectifs

- Gestion des entrées utilisateur (clic, clavier).
- Menus, flowchart, pause.
- Audio.
- Sauvegardes.

## Definition of Done

- [ ] `npx tsc --noEmit` passe.
- [ ] `npm test` passe (au moins les tests du module).
- [ ] Les fixtures `tests/fixtures/*.json` peuvent être rejouées.
- [ ] (Recommandé) Une page de démo `stage-renderer-demo.html` affiche une fixture.
- [ ] Aucune dépendance npm ajoutée sans justification.
- [ ] Aucun asset sous copyright n'est commité.
