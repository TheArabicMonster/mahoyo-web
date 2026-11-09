import type { AudioChannel, AudioEvent, AudioSnapshot } from "@/kag/events.js";
import type { SoundEngine, SoundPosition } from "@/renderer/audio-manager.js";
import type { AudioPlayer, AudioSettings } from "@/renderer/types.js";

/**
 * Mock d'AudioPlayer pour les tests d'orchestration du player. Il implémente aussi le contrat
 * `SoundEngine` de la galerie sonore (HUD-16, #209) : les tests de Sound mode utilisent ainsi
 * directement `FakeAudioPlayer`, comme demandé par l'issue.
 */
export class FakeAudioPlayer implements AudioPlayer, SoundEngine {
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

  /** Canaux dont la fin de fondu a été attendue (`@wb`). */
  fadeWaits: AudioChannel[] = [];

  async waitForFade(channel: AudioChannel, _signal: AbortSignal): Promise<void> {
    this.fadeWaits.push(channel);
  }

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
    this.soundPlaying = false;
    this.soundPosition = { current: 0, duration: 0 };
    this.soundPositionListeners.clear();
    this.soundEndedListeners.clear();
  }

  // ── Galerie sonore (HUD-16, #209) : contrat SoundEngine ──

  /** URLs demandées par la galerie sonore, dans l'ordre. */
  soundUrls: string[] = [];
  soundPlaying = false;
  soundVolume = 1;
  /** Valeurs de seek demandées, dans l'ordre. */
  soundSeek: number[] = [];
  soundPosition: SoundPosition = { current: 0, duration: 0 };
  private readonly soundPositionListeners = new Set<(position: SoundPosition) => void>();
  private readonly soundEndedListeners = new Set<() => void>();

  play(url: string): Promise<void> {
    this.soundUrls.push(url);
    this.soundPlaying = true;
    return Promise.resolve();
  }

  pause(): void {
    this.soundPlaying = false;
  }

  stop(): void {
    this.soundPlaying = false;
    this.soundPosition = { current: 0, duration: this.soundPosition.duration };
  }

  seek(seconds: number): void {
    this.soundSeek.push(seconds);
    this.soundPosition = { ...this.soundPosition, current: seconds };
  }

  setVolume(volume: number): void {
    this.soundVolume = volume;
  }

  position(): SoundPosition {
    return { ...this.soundPosition };
  }

  subscribe(listener: (position: SoundPosition) => void): () => void {
    this.soundPositionListeners.add(listener);
    return () => void this.soundPositionListeners.delete(listener);
  }

  onEnded(listener: () => void): () => void {
    this.soundEndedListeners.add(listener);
    return () => void this.soundEndedListeners.delete(listener);
  }

  /** Simule l'avancement de la lecture (timeupdate) dans les tests. */
  setSoundPosition(current: number, duration = this.soundPosition.duration): void {
    this.soundPosition = { current, duration };
    for (const listener of [...this.soundPositionListeners]) listener(this.position());
  }

  /** Simule la fin de la piste courante (événement `ended`). */
  emitSoundEnded(): void {
    for (const listener of [...this.soundEndedListeners]) listener();
  }
}
