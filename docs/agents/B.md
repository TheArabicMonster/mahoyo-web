# Agent B — AudioPlayer

## Objectif

Finaliser `src/renderer/audio-manager.ts` pour implémenter proprement l'interface `AudioPlayer` définie dans `src/renderer/types.ts`.

## Interface à implémenter

```ts
export interface AudioPlayer {
  unlock(): Promise<void>;
  apply(event: AudioEvent, opts: { instant: boolean }): void;
  waitFor(channel: AudioChannel, signal: AbortSignal): Promise<void>;
  restore(snapshot: AudioSnapshot): void;
  stopAll(fadeOut?: Ms): void;
  setSettings(settings: Readonly<AudioSettings>): void;
  suspend(): void;
  resume(): void;
  dispose(): void;
}
```

## Fichiers que tu possèdes

- `src/renderer/audio-manager.ts`
- `tests/unit/renderer/audio-manager.test.ts`

## Fichiers interdits

- `src/kag/**`
- `src/renderer/types.ts`
- `src/ui/**`
- `src/main.ts`
- `index.html`
- CSS global
- `package.json`, `vite.config.ts`, `tsconfig.json`

## Décisions déjà tranchées

- `AssetResolver` est injecté via `AudioPlayerDeps`.
- Volumes en 0..1, appliqués comme `master * channelVolume`.
- Les canaux sont `"bgm"`, `"voice"`, `"se:${n}"`.
- `apply()` reçoit un seul `AudioEvent` à la fois.
- Mode `instant`: fondus réduits à 0, SE non loopés ignorés.
- `waitFor(channel)` résout immédiatement si le canal est vide ou boucle.
- `suspend()`/`resume()` sont appelés par le Player sur `visibilitychange`.

## Points de vigilance

- **Crossfade BGM** : ne pas relancer le même morceau s'il est déjà en cours.
- **Canaux SE multiples** : autoriser plusieurs SE simultanés via `se:0`, `se:1`, etc.
- **Autoplay** : `unlock()` doit pouvoir être appelée de façon synchrone après un geste utilisateur.
- **Tests** : jsdom n'a pas Web Audio. Abstrais `AudioContext`/HTMLAudioElement si nécessaire, ou teste les appels sans jouer de son.

## Trous connus

Si le contrat est insuffisant, choisis l'hypothèse la plus simple, documente-la dans `docs/agents/B-QUESTIONS.md`, et continue.

## Références

- Contrats : `src/renderer/types.ts`, `src/kag/events.ts`
- Résolveur : `src/core/asset-resolver.ts`
- Fixtures : `tests/fixtures/audio.json`

## Non-objectifs

- Rendu visuel.
- UI.
- Sauvegardes (la restauration du snapshot audio est dans le contrat, pas la persistance).

## Definition of Done

- [ ] `npx tsc --noEmit` passe.
- [ ] `npm test` passe (au moins les tests du module).
- [ ] Les événements audio des fixtures sont joués sans erreur.
- [ ] Aucune dépendance npm ajoutée sans justification.
- [ ] Aucun asset sous copyright n'est commité.
