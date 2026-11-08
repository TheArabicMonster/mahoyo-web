import type { AudioChannel, AudioEvent, AudioSnapshot } from "@/kag/events.js";
import type { AudioPlayer, AudioSettings } from "@/renderer/types.js";

/**
 * Mock d'AudioPlayer pour les tests d'orchestration du player.
 */
export class FakeAudioPlayer implements AudioPlayer {
  events: AudioEvent[] = [];
  settings: AudioSettings | null = null;
  unlocked = false;
  suspended = false;

  async unlock(): Promise<void> {
    this.unlocked = true;
  }

  apply(event: AudioEvent, _opts: { instant: boolean }): void {
    this.events.push(event);
  }

  async waitFor(_channel: AudioChannel, _signal: AbortSignal): Promise<void> {}

  restore(snapshot: AudioSnapshot): void {
    this.events = snapshot.loops.map((loop) => ({
      kind: "play",
      channel: loop.channel,
      storage: loop.storage,
      loop: true,
      volume: loop.volume,
    }));
  }

  stopAll(): void {
    this.events.push({ kind: "stop", channel: "allSe" });
  }

  testSe(): void {
    // Les tests vérifient seulement que le player relaie la commande.
  }

  setSettings(settings: Readonly<AudioSettings>): void {
    this.settings = { ...settings };
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
  }

  dispose(): void {
    this.events = [];
  }
}
