import type { AudioChannel, AudioEvent, AudioSnapshot } from "@/kag/events.js";
import type { AssetResolver } from "@/core/asset-resolver.js";
import type { AudioPlayer, AudioPlayerDeps, AudioSettings } from "./types.js";

export class WebAudioPlayer implements AudioPlayer {
  private resolver: AssetResolver;
  private bgmAudio: HTMLAudioElement | null = null;
  private currentBgm: string | null = null;
  private seAudios = new Map<AudioChannel, HTMLAudioElement>();
  private settings: AudioSettings = {
    master: 1,
    bgm: 0.6,
    se: 0.5,
    voice: 0.8,
    muted: false,
  };

  constructor(deps: AudioPlayerDeps) {
    this.resolver = deps.resolver;
  }

  async unlock(): Promise<void> {
    // L'élément Audio du navigateur se débloque via un geste utilisateur.
    // Cette méthode est un no-op explicite ; le premier play() après un clic utilisateur suffit.
  }

  apply(event: AudioEvent, _opts: { instant: boolean }): void {
    const volume = this.computeVolume(event.channel);
    switch (event.kind) {
      case "play": {
        if (event.channel === "bgm") {
          this.playBgm(event.storage, event.loop, event.volume * volume);
        } else if (event.channel.startsWith("se:")) {
          this.playSe(event.channel, event.storage, event.loop, event.volume * volume);
        }
        break;
      }
      case "stop": {
        if (event.channel === "bgm") {
          this.stopBgm(event.fadeOut ?? 0);
        } else if (event.channel === "allSe") {
          this.stopAllSe(event.fadeOut ?? 0);
        } else if ((event.channel as AudioChannel).startsWith("se:")) {
          this.stopSe(event.channel as AudioChannel, event.fadeOut ?? 0);
        }
        break;
      }
      case "fade": {
        if (event.channel === "bgm") {
          this.fadeBgm(event.time, event.volume * volume);
        } else if (event.channel.startsWith("se:")) {
          this.fadeSe(event.channel, event.time, event.volume * volume);
        }
        break;
      }
    }
  }

  async waitFor(channel: AudioChannel, _signal: AbortSignal): Promise<void> {
    // Pour l'instant, résout immédiatement.
    // À implémenter : attendre la fin du son non bouclé.
    if (channel === "bgm" || this.seAudios.has(channel)) return;
  }

  restore(_snapshot: AudioSnapshot): void {
    // TODO : restaurer l'état audio depuis une sauvegarde.
    this.stopAll();
  }

  stopAll(fadeOut = 0): void {
    this.stopBgm(fadeOut);
    this.stopAllSe(fadeOut);
  }

  setSettings(settings: Readonly<AudioSettings>): void {
    this.settings = { ...settings };
    if (this.bgmAudio) {
      this.bgmAudio.volume = this.settings.bgm * this.settings.master;
    }
    for (const [channel, audio] of this.seAudios) {
      if (channel.startsWith("se:")) {
        audio.volume = this.settings.se * this.settings.master;
      }
    }
  }

  suspend(): void {
    if (this.bgmAudio) this.bgmAudio.pause();
    for (const audio of this.seAudios.values()) {
      audio.pause();
    }
  }

  resume(): void {
    if (this.bgmAudio) this.bgmAudio.play().catch(() => {});
    for (const audio of this.seAudios.values()) {
      audio.play().catch(() => {});
    }
  }

  dispose(): void {
    this.stopAll();
    this.seAudios.clear();
  }

  private computeVolume(channel: AudioChannel | "allSe"): number {
    if (this.settings.muted) return 0;
    const master = this.settings.master;
    if (channel === "bgm") return master * this.settings.bgm;
    if (channel === "allSe" || channel.startsWith("se:")) return master * this.settings.se;
    if (channel === "voice") return master * this.settings.voice;
    return master;
  }

  private resolveUrl(channel: AudioChannel, storage: string): string {
    if (channel === "bgm") return this.resolver.bgm(storage);
    if (channel === "voice") return this.resolver.bgm(storage);
    return this.resolver.se(storage);
  }

  private playBgm(storage: string, loop: boolean, volume: number) {
    if (this.currentBgm === storage && this.bgmAudio) return;
    this.currentBgm = storage;
    this.stopBgm();
    this.bgmAudio = new Audio(this.resolveUrl("bgm", storage));
    this.bgmAudio.loop = loop;
    this.bgmAudio.volume = volume;
    this.bgmAudio.onerror = () => {
      console.warn(`BGM introuvable: ${storage}`);
      this.bgmAudio = null;
      this.currentBgm = null;
    };
    this.bgmAudio.play().catch(() => {
      console.warn(`BGM autoplay blocked: ${storage}`);
    });
  }

  private stopBgm(fadeTime = 0) {
    if (!this.bgmAudio) return;
    if (fadeTime > 0) {
      const audio = this.bgmAudio;
      const startVolume = audio.volume;
      const startTime = performance.now();
      const fade = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / fadeTime, 1);
        audio.volume = startVolume * (1 - progress);
        if (progress < 1) {
          requestAnimationFrame(fade);
        } else {
          audio.pause();
          if (this.bgmAudio === audio) {
            this.bgmAudio = null;
            this.currentBgm = null;
          }
        }
      };
      requestAnimationFrame(fade);
    } else {
      this.bgmAudio.pause();
      this.bgmAudio = null;
      this.currentBgm = null;
    }
  }

  private fadeBgm(time: number, targetVolume: number) {
    if (!this.bgmAudio) return;
    const startVolume = this.bgmAudio.volume;
    const startTime = performance.now();
    const fade = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / time, 1);
      if (this.bgmAudio) {
        this.bgmAudio.volume = startVolume + (targetVolume - startVolume) * progress;
      }
      if (progress < 1) {
        requestAnimationFrame(fade);
      }
    };
    requestAnimationFrame(fade);
  }

  private playSe(channel: AudioChannel, storage: string, loop: boolean, volume: number) {
    this.stopSe(channel, 0);
    const audio = new Audio(this.resolveUrl(channel, storage));
    audio.loop = loop;
    audio.volume = volume;
    audio.onerror = () => {
      console.warn(`SE introuvable: ${storage}`);
      this.seAudios.delete(channel);
    };
    audio.onended = () => {
      if (!loop) this.seAudios.delete(channel);
    };
    this.seAudios.set(channel, audio);
    audio.play().catch(() => {
      console.warn(`SE play failed: ${storage}`);
    });
  }

  private stopSe(channel: AudioChannel, fadeTime = 0) {
    const audio = this.seAudios.get(channel);
    if (!audio) return;
    if (fadeTime > 0) {
      const startVolume = audio.volume;
      const startTime = performance.now();
      const fade = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / fadeTime, 1);
        audio.volume = startVolume * (1 - progress);
        if (progress < 1) {
          requestAnimationFrame(fade);
        } else {
          audio.pause();
          this.seAudios.delete(channel);
        }
      };
      requestAnimationFrame(fade);
    } else {
      audio.pause();
      this.seAudios.delete(channel);
    }
  }

  private stopAllSe(fadeTime = 0) {
    for (const channel of Array.from(this.seAudios.keys())) {
      this.stopSe(channel, fadeTime);
    }
  }

  private fadeSe(channel: AudioChannel, time: number, targetVolume: number) {
    const audio = this.seAudios.get(channel);
    if (!audio) return;
    const startVolume = audio.volume;
    const startTime = performance.now();
    const fade = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / time, 1);
      audio.volume = startVolume + (targetVolume - startVolume) * progress;
      if (progress < 1) {
        requestAnimationFrame(fade);
      }
    };
    requestAnimationFrame(fade);
  }
}
