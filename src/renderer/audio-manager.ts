import type { PendingAudioAction } from "@/kag/runtime.js";

export class AudioManager {
  private bgmAudio: HTMLAudioElement | null = null;
  private currentBgm: string | null = null;
  private seAudio: HTMLAudioElement | null = null;
  private currentSe: string | null = null;

  constructor(
    private bgmVolume = 0.6,
    private seVolume = 0.5,
  ) {}

  setBgmVolume(volume: number) {
    this.bgmVolume = volume;
    if (this.bgmAudio) this.bgmAudio.volume = volume;
  }

  setSeVolume(volume: number) {
    this.seVolume = volume;
    if (this.seAudio) this.seAudio.volume = volume;
  }

  getBgmVolume() {
    return this.bgmVolume;
  }

  getSeVolume() {
    return this.seVolume;
  }

  getCurrentBgm() {
    return this.currentBgm;
  }

  getCurrentSe() {
    return this.currentSe;
  }

  playBgm(storage: string, resolve: (s: string) => string) {
    if (this.currentBgm === storage) return;
    this.currentBgm = storage;
    const url = resolve(storage);
    this.stopBgm();
    this.bgmAudio = new Audio(url);
    this.bgmAudio.loop = true;
    this.bgmAudio.volume = this.bgmVolume;
    this.bgmAudio.onerror = () => {
      console.warn(`BGM introuvable: ${storage}`);
      this.bgmAudio = null;
      this.currentBgm = null;
    };
    this.bgmAudio.play().catch(() => {
      console.warn(`BGM autoplay blocked: ${storage}`);
    });
  }

  stopBgm(fadeTime = 0) {
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

  playSe(storage: string, resolve: (s: string) => string) {
    const url = resolve(storage);
    if (this.seAudio) {
      this.seAudio.pause();
    }
    this.currentSe = storage;
    this.seAudio = new Audio(url);
    this.seAudio.volume = this.seVolume;
    this.seAudio.onerror = () => {
      console.warn(`SE introuvable: ${storage}`);
      this.seAudio = null;
      this.currentSe = null;
    };
    this.seAudio.play().catch(() => {
      console.warn(`SE play failed: ${storage}`);
    });
  }

  stopSe(fadeTime = 0) {
    if (!this.seAudio) return;
    if (fadeTime > 0) {
      const audio = this.seAudio;
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
          if (this.seAudio === audio) {
            this.seAudio = null;
            this.currentSe = null;
          }
        }
      };
      requestAnimationFrame(fade);
    } else {
      this.seAudio.pause();
      this.seAudio = null;
      this.currentSe = null;
    }
  }

  fadeSe(time: number, targetVolume: number) {
    if (!this.seAudio) return;
    const startVolume = this.seAudio.volume;
    const startTime = performance.now();
    const fade = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / time, 1);
      if (this.seAudio) {
        this.seAudio.volume = startVolume + (targetVolume - startVolume) * progress;
      }
      if (progress < 1) {
        requestAnimationFrame(fade);
      }
    };
    requestAnimationFrame(fade);
  }

  handleAudioAction(action: PendingAudioAction, resolveBgm: (s: string) => string, resolveSe: (s: string) => string) {
    switch (action.action) {
      case "stopBgm":
        this.stopBgm();
        break;
      case "fadeBgm":
        this.stopBgm(action.time);
        break;
      case "stopSe":
        this.stopSe(action.time ?? 0);
        break;
      case "fadeSe":
        if (!action.storage || action.storage === this.currentSe) {
          this.fadeSe(action.time, action.volume / 100);
        }
        break;
    }
  }

  reset() {
    this.stopBgm();
    this.stopSe();
  }
}
