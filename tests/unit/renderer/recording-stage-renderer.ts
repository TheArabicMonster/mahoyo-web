import type { AssetRef, Awaitable, RenderEvent, StageSnapshot } from "@/kag/events.js";
import type { DisplaySettings, RunOptions, StageRenderer } from "@/renderer/types.js";

/**
 * Mock de StageRenderer pour les tests de contrat.
 *
 * Il enregistre les événements appliqués et résout immédiatement.
 * Utile pour tester le runtime KAG sans DOM.
 */
export class RecordingStageRenderer implements StageRenderer {
  events: RenderEvent[] = [];
  lastOptions: RunOptions | null = null;

  mount(_root: HTMLElement): void {}

  async apply(events: readonly RenderEvent[], opts: RunOptions): Promise<void> {
    // Le StageRenderer ignore les événements audio : ils sont routés vers AudioPlayer.
    this.events.push(...events.filter((e) => e.kind !== "audio"));
    this.lastOptions = opts;
  }

  async waitFor(_what: Exclude<Awaitable, "audio">, _target: string | undefined, _signal: AbortSignal): Promise<void> {}

  hurry(): void {}
  setClickIndicator(): void {}
  setWaitIndicator(_active: boolean): void {}
  nudgeWaitIndicator(): void {}
  setUserHidden(): void {}

  async restore(_snapshot: StageSnapshot, _signal: AbortSignal): Promise<void> {
    this.events.push({ kind: "scene", scene: _snapshot.scene, transition: { method: "none" } });
  }

  async preload(_assets: readonly AssetRef[], _signal?: AbortSignal): Promise<void> {}

  async captureThumbnail(): Promise<Blob | null> {
    return null;
  }

  setSettings(_settings: Readonly<DisplaySettings>): void {}
  clear(): void {}
  dispose(): void {}
}
