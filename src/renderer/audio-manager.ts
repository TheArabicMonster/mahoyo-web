import type { AudioChannel, AudioEvent, AudioSnapshot, Ms } from "@/kag/events.js";
import type { AssetResolver } from "@/core/asset-resolver.js";
import { getPerfProbe } from "@/core/perf-probe.js";
import { DEFAULT_AUDIO_SETTINGS, type AudioPlayer, type AudioPlayerDeps, type AudioSettings } from "./types.js";

/** Sous-ensemble de HTMLAudioElement utilisé ici (permet de le simuler en test). */
export type AudioElementLike = {
  src: string;
  loop: boolean;
  volume: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended" | "error", listener: () => void): void;
  removeEventListener(type: "ended" | "error", listener: () => void): void;
};

export type AudioElementFactory = (url: string) => AudioElementLike;

const defaultFactory: AudioElementFactory = (url) => new Audio(url);

/** Seuil de préchargement `auto` des SE (#394) : au-delà, `metadata` seulement. */
export const AUDIO_PRELOAD_AUTO_MAX_BYTES = 300 * 1024;

/**
 * Politique `preload` (#394) : BGM = streaming (`metadata`), SE ≤ 300 Ko = `auto`, au-dessus =
 * `metadata`. Sans taille connue (ancien manifeste), un `.wav` est supposé lourd.
 */
export function audioPreloadPolicy(kind: "bgm" | "se", size: number | null, storage: string): "auto" | "metadata" {
  if (kind === "bgm") return "metadata";
  if (size !== null) return size <= AUDIO_PRELOAD_AUTO_MAX_BYTES ? "auto" : "metadata";
  return /\.wav$/i.test(storage) ? "metadata" : "auto";
}

/**
 * Sous-ensemble de `HTMLAudioElement` utilisé par la galerie sonore (HUD-16, #209) : position et
 * durée en plus, pour la barre de progression. Permet de simuler l'élément en test.
 */
export type SoundElementLike = {
  src: string;
  volume: number;
  currentTime: number;
  readonly duration: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended" | "timeupdate" | "loadedmetadata", listener: () => void): void;
  removeEventListener(type: "ended" | "timeupdate" | "loadedmetadata", listener: () => void): void;
};

export type SoundElementFactory = (url: string) => SoundElementLike;

const defaultSoundFactory: SoundElementFactory = (url) => new Audio(url) as unknown as SoundElementLike;

/** Position d'une piste, en secondes (durée `0` tant que les métadonnées ne sont pas chargées). */
export type SoundPosition = { current: number; duration: number };

/**
 * Lecteur de la galerie sonore (Sound mode, HUD-16 / #209), indépendant des canaux BGM/SE du jeu :
 * lecture, pause, arrêt, recherche, volume et notification de position. Implémenté avec un seul
 * `HTMLAudioElement` recyclé, comme `WebAudioPlayer` (mais hors chaîne de canaux et de fondus).
 */
export type SoundEngine = {
  play(url: string): Promise<void> | void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  position(): SoundPosition;
  /** Abonnement aux positions (timeupdate + cadence de 250 ms pendant la lecture). */
  subscribe(listener: (position: SoundPosition) => void): () => void;
  /** Abonnement à la fin d'une piste (lecture naturelle ou erreur). */
  onEnded(listener: () => void): () => void;
  dispose(): void;
};

/** Cadence de rafraîchissement de la position pendant la lecture (ms). */
const SOUND_TICK_MS = 250;

/**
 * Crée le lecteur de la galerie sonore. `createElement` est injectable pour les tests (aucun
 * `HTMLAudioElement` réel) ; en production, `new Audio(url)`.
 */
export function createSoundEngine(createElement: SoundElementFactory = defaultSoundFactory): SoundEngine {
  let element: SoundElementLike | null = null;
  let volume = 1;
  let disposed = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  const positionListeners = new Set<(position: SoundPosition) => void>();
  const endedListeners = new Set<() => void>();

  const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

  const readPosition = (): SoundPosition => {
    if (!element) return { current: 0, duration: 0 };
    const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;
    const current = Number.isFinite(element.currentTime) && element.currentTime > 0 ? element.currentTime : 0;
    return { current: duration > 0 ? Math.min(current, duration) : current, duration };
  };

  const emitPosition = (): void => {
    if (disposed) return;
    const position = readPosition();
    for (const listener of [...positionListeners]) listener(position);
  };

  const stopTicker = (): void => {
    if (ticker !== undefined) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };

  const startTicker = (): void => {
    if (ticker !== undefined || disposed) return;
    ticker = setInterval(emitPosition, SOUND_TICK_MS);
  };

  const ensureElement = (url: string): SoundElementLike => {
    if (!element) {
      element = createElement(url);
      element.addEventListener("timeupdate", emitPosition);
      element.addEventListener("loadedmetadata", emitPosition);
      element.addEventListener("ended", () => {
        stopTicker();
        emitPosition();
        for (const listener of [...endedListeners]) listener();
      });
    }
    return element;
  };

  return {
    play(url: string): Promise<void> | void {
      if (disposed) return;
      const audio = ensureElement(url);
      if (audio.src !== url) {
        audio.src = url;
        audio.currentTime = 0;
      }
      audio.volume = clamp01(volume);
      const started = audio.play();
      startTicker();
      emitPosition();
      if (started && typeof started.catch === "function") {
        // Autoplay refusé ou piste illisible : on ne casse pas l'écran, la position reste à 0.
        return started.catch(() => undefined);
      }
      return started;
    },
    pause(): void {
      element?.pause();
      stopTicker();
      emitPosition();
    },
    stop(): void {
      if (element) {
        element.pause();
        element.currentTime = 0;
      }
      stopTicker();
      emitPosition();
    },
    seek(seconds: number): void {
      if (!element) return;
      const { duration } = readPosition();
      const target = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      element.currentTime = duration > 0 ? Math.min(target, duration) : target;
      emitPosition();
    },
    setVolume(next: number): void {
      volume = clamp01(next);
      if (element) element.volume = volume;
    },
    position(): SoundPosition {
      return readPosition();
    },
    subscribe(listener: (position: SoundPosition) => void): () => void {
      positionListeners.add(listener);
      return () => void positionListeners.delete(listener);
    },
    onEnded(listener: () => void): () => void {
      endedListeners.add(listener);
      return () => void endedListeners.delete(listener);
    },
    dispose(): void {
      disposed = true;
      stopTicker();
      positionListeners.clear();
      endedListeners.clear();
      if (element) {
        element.pause();
        element = null;
      }
    },
  };
}

const FADE_STEP_MS = 16;

/** État d'un canal actif. */
type Voice = {
  audio: AudioElementLike;
  storage: string;
  loop: boolean;
  /** Volume demandé par le script (0..1), animé par les fondus. */
  level: number;
  /** Fondu en cours (annulation). */
  cancelRamp: (() => void) | null;
  /** Le play() a été refusé (autoplay) : à retenter dans unlock(). */
  blocked: boolean;
  /** Pausé par suspend() (onglet masqué). */
  suspended: boolean;
  /** Mis en pause par le script (@playpause) : ne repart qu'avec @playresume. */
  paused: boolean;
  /** Appelé à la fin du son (naturelle, erreur ou arrêt). */
  waiters: Set<() => void>;
  /** Attentes de fin de fondu (`@wb`), résolues à la fin du fondu ou à son interruption. */
  fadeWaiters: Set<() => void>;
  /** Canal d'origine quand la voix est détachée pour un fondu de sortie (`fading`). */
  fadingChannel?: AudioChannel;
  onEnded: () => void;
  onError: () => void;
};

// Valeurs neutres avant que le player n'applique ses réglages (les tests et le premier
// rendu ne doivent pas subir un changement de volume transitoire).
const DEFAULT_SETTINGS: AudioSettings = {
  ...DEFAULT_AUDIO_SETTINGS,
  master: 1,
  bgm: 1,
  se: 1,
  system: 1,
  voice: 1,
};

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export class WebAudioPlayer implements AudioPlayer {
  private readonly resolver: AssetResolver;
  private readonly createAudio: AudioElementFactory;
  /** Médias préchargés par le lookahead, réutilisés à la lecture (#394). */
  private readonly audioPreloads?: Map<string, HTMLAudioElement>;
  private readonly voices = new Map<AudioChannel, Voice>();
  /** Voix détachées de leur canal, en fondu de sortie. */
  private readonly fading = new Set<Voice>();
  /** Auditeurs de fin de canal (libération du pool SE du runtime, #358). */
  private readonly endedListeners = new Set<(channel: AudioChannel) => void>();
  /** Timers de délai avant lecture (paramètre delay des events play). */
  private readonly delayTimers = new Map<AudioChannel, ReturnType<typeof setTimeout>>();
  private settings: AudioSettings = { ...DEFAULT_SETTINGS };
  private suspended = false;
  private disposed = false;

  constructor(deps: AudioPlayerDeps, createAudio: AudioElementFactory = defaultFactory) {
    this.resolver = deps.resolver;
    this.createAudio = createAudio;
    this.audioPreloads = deps.audioPreloads;
  }

  unlock(): Promise<void> {
    // Corps synchrone : on retente immédiatement les lectures bloquées par l'autoplay,
    // tant que l'on est encore dans le handler du geste utilisateur.
    for (const [channel, voice] of this.voices) {
      if (voice.blocked && !voice.suspended && !voice.paused) this.startPlayback(channel, voice);
    }
    return Promise.resolve();
  }

  apply(event: AudioEvent, opts: { instant: boolean }): void {
    if (this.disposed) return;
    const { instant } = opts;
    switch (event.kind) {
      case "play": {
        const delay = instant ? 0 : (event.delay ?? 0);
        if (delay > 0) {
          this.clearDelayTimer(event.channel);
          const timer = setTimeout(() => {
            this.delayTimers.delete(event.channel);
            this.play(event.channel, event.storage, event.loop, clamp01(event.volume), instant ? 0 : (event.fadeIn ?? 0), instant);
          }, delay);
          this.delayTimers.set(event.channel, timer);
        } else {
          this.play(event.channel, event.storage, event.loop, clamp01(event.volume), instant ? 0 : (event.fadeIn ?? 0), instant);
        }
        break;
      }
      case "stop":
        if (event.channel === "allSe") {
          for (const channel of Array.from(this.voices.keys())) {
            // Les voix Steam passent par des @se (routées `voice`) : le « tous les SE » du moteur
            // les arrête aussi.
            if (channel.startsWith("se:") || channel === "voice") this.stop(channel, instant ? 0 : (event.fadeOut ?? 0));
          }
        } else {
          this.stop(event.channel, instant ? 0 : (event.fadeOut ?? 0));
        }
        break;
      case "fade": {
        const voice = this.voices.get(event.channel);
        if (voice) this.ramp(voice, clamp01(event.volume), instant ? 0 : event.time);
        break;
      }
      case "pause":
        this.pause(event.channel, instant ? 0 : (event.fadeOut ?? 0));
        break;
      case "resume":
        this.resumeChannel(event.channel, clamp01(event.volume), instant ? 0 : (event.fadeIn ?? 0));
        break;
    }
  }

  waitFor(channel: AudioChannel, signal: AbortSignal): Promise<void> {
    const voice = this.voices.get(channel);
    if (!voice || voice.loop || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        voice.waiters.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      voice.waiters.add(done);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  /**
   * [wb] : résout à la fin du fondu BGM en cours (sortie ou changement de volume).
   * Résout immédiatement si aucun fondu n'est actif. Une interruption (abort) libère l'attente.
   */
  waitForFade(channel: AudioChannel, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    const candidates: Voice[] = [];
    const current = this.voices.get(channel);
    if (current?.cancelRamp) candidates.push(current);
    for (const voice of this.fading) {
      if (voice.fadingChannel === channel) candidates.push(voice);
    }
    if (candidates.length === 0) return Promise.resolve();
    return Promise.all(candidates.map((voice) => this.waitVoiceFade(voice, signal))).then(() => {});
  }

  private waitVoiceFade(voice: Voice, signal: AbortSignal): Promise<void> {
    if (!voice.cancelRamp) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        voice.fadeWaiters.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      voice.fadeWaiters.add(done);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  private wakeFadeWaiters(voice: Voice): void {
    for (const wake of Array.from(voice.fadeWaiters)) wake();
    voice.fadeWaiters.clear();
  }

  onChannelEnded(listener: (channel: AudioChannel) => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  restore(snapshot: AudioSnapshot): void {
    if (this.disposed) return;
    this.stopAll(0);
    for (const loop of snapshot.loops) {
      this.play(loop.channel, loop.storage, true, clamp01(loop.volume), 0, true);
    }
  }

  stopAll(fadeOut: Ms = 0): void {
    for (const channel of Array.from(this.voices.keys())) this.stop(channel, fadeOut);
    for (const channel of Array.from(this.delayTimers.keys())) this.clearDelayTimer(channel);
  }

  setSettings(settings: Readonly<AudioSettings>): void {
    this.settings = { ...settings };
    for (const [channel, voice] of this.voices) this.applyVolume(channel, voice);
  }

  suspend(): void {
    this.suspended = true;
    for (const voice of [...this.voices.values(), ...this.fading]) {
      voice.suspended = true;
      voice.audio.pause();
    }
  }

  resume(): void {
    this.suspended = false;
    for (const [channel, voice] of this.voices) {
      voice.suspended = false;
      if (!voice.paused) this.startPlayback(channel, voice);
    }
  }

  dispose(): void {
    this.stopAll(0);
    for (const voice of Array.from(this.fading)) this.release(voice);
    this.fading.clear();
    for (const channel of Array.from(this.delayTimers.keys())) this.clearDelayTimer(channel);
    this.disposed = true;
  }

  // ── Interne ──

  private channelGain(channel: AudioChannel): number {
    if (this.settings.muted) return 0;
    if (channel === "bgm" && this.settings.bgmMuted) return 0;
    if (channel !== "bgm" && channel !== "voice" && this.settings.seMuted) return 0;
    const kind = channel === "bgm" ? this.settings.bgm : channel === "voice" ? this.settings.voice : this.settings.se;
    return clamp01(this.settings.master) * clamp01(kind);
  }

  /** Test du volume SE : courte sinusoïde, sans dépendre d'un asset du jeu. */
  testSe(): void {
    if (this.disposed) return;
    const gain = this.channelGain("se:0");
    if (gain <= 0) return;
    try {
      const Ctor =
        (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const context = new Ctor();
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      envelope.gain.setValueAtTime(0, context.currentTime);
      envelope.gain.linearRampToValueAtTime(0.12 * gain, context.currentTime + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(envelope).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
      oscillator.addEventListener("ended", () => void context.close());
    } catch {
      // AudioContext indisponible (navigation privée, navigateur sans Web Audio) : silencieux.
    }
  }

  private applyVolume(channel: AudioChannel, voice: Voice): void {
    voice.audio.volume = clamp01(this.channelGain(channel) * voice.level);
  }

  private channelOf(voice: Voice): AudioChannel | undefined {
    for (const [channel, v] of this.voices) if (v === voice) return channel;
    return undefined;
  }

  private resolveUrl(channel: AudioChannel, storage: string): string {
    // Le résolveur n'a pas de méthode `voice` : les voix sont résolues comme des SE.
    return channel === "bgm" ? this.resolver.bgm(storage) : this.resolver.se(storage);
  }

  private play(
    channel: AudioChannel,
    storage: string,
    loop: boolean,
    volume: number,
    fadeIn: Ms,
    instant: boolean,
  ): void {
    // Mode instant : les sons non bouclés (SE, voix) sont ignorés.
    if (instant && !loop && channel !== "bgm") return;

    const existing = this.voices.get(channel);
    // Même BGM déjà en cours : ne pas redémarrer, on ajuste seulement boucle et volume.
    if (channel === "bgm" && existing && existing.storage === storage) {
      existing.loop = loop;
      existing.audio.loop = loop;
      if (existing.paused) {
        existing.paused = false;
        if (!existing.suspended) this.startPlayback(channel, existing);
      }
      this.ramp(existing, volume, fadeIn);
      return;
    }

    if (existing) {
      // Crossfade du BGM : l'ancien se fond pendant que le nouveau monte.
      this.stop(channel, channel === "bgm" ? fadeIn : 0);
    }

    const url = this.resolveUrl(channel, storage);
    // #385 : marqueurs mh:audio:* (demande, arrivée, lecture, rejet) — no-op sans ?perf=1.
    const audioKind = channel === "bgm" ? ("bgm" as const) : ("se" as const);
    const perf = getPerfProbe();
    perf.markAudio(audioKind, "request", { url });
    // #394 : un seul média par URL ; réutiliser l'élément préchargé par le lookahead.
    const preloaded = this.audioPreloads?.get(url);
    if (preloaded) this.audioPreloads!.delete(url);
    const audio = (preloaded as unknown as AudioElementLike | undefined) ?? this.createAudio(url);
    audio.loop = loop;
    (audio as unknown as { addEventListener(type: string, cb: () => void): void }).addEventListener("loadeddata", () => {
      perf.markAudio(audioKind, "fetched", { url });
    });
    const voice: Voice = {
      audio,
      storage,
      loop,
      level: fadeIn > 0 ? 0 : volume,
      cancelRamp: null,
      blocked: false,
      suspended: this.suspended,
      paused: false,
      waiters: new Set(),
      fadeWaiters: new Set(),
      onEnded: () => this.finish(channel, voice),
      onError: () => {
        // Dédoublonné par le résolveur : un seul avertissement par asset (#143).
        perf.markAudio(audioKind, "rejected", { url });
        this.resolver.reportMissing("audio", storage);
        this.finish(channel, voice);
      },
    };
    audio.addEventListener("ended", voice.onEnded);
    audio.addEventListener("error", voice.onError);
    this.voices.set(channel, voice);
    this.applyVolume(channel, voice);
    if (!voice.suspended) this.startPlayback(channel, voice);
    if (fadeIn > 0) this.ramp(voice, volume, fadeIn);
  }

  private startPlayback(channel: AudioChannel, voice: Voice): void {
    voice.blocked = false;
    const audioKind = channel === "bgm" ? ("bgm" as const) : ("se" as const);
    const perf = getPerfProbe();
    let result: Promise<void> | undefined;
    try {
      result = voice.audio.play();
    } catch {
      result = undefined;
    }
    result?.then(
      () => perf.markAudio(audioKind, "played", { url: voice.audio.src }),
      () => {
        // Autoplay refusé : sera retenté par unlock() ou resume().
        perf.markAudio(audioKind, "rejected", { url: voice.audio.src });
        if (this.voices.get(channel) === voice) voice.blocked = true;
      },
    );
  }

  /** Fin naturelle ou erreur : libère le canal et réveille les waitFor. */
  private finish(channel: AudioChannel, voice: Voice): void {
    this.release(voice);
    if (this.voices.get(channel) === voice) this.voices.delete(channel);
    // Libération du pool SE côté runtime (uniquement les canaux SE/voix ; le BGM n'est pas poolé).
    if (channel.startsWith("se:") || channel === "voice") {
      for (const listener of [...this.endedListeners]) listener(channel);
    }
  }

  private release(voice: Voice): void {
    voice.cancelRamp?.();
    voice.cancelRamp = null;
    this.wakeFadeWaiters(voice);
    voice.fadingChannel = undefined;
    voice.audio.removeEventListener("ended", voice.onEnded);
    voice.audio.removeEventListener("error", voice.onError);
    voice.audio.pause();
    for (const wake of Array.from(voice.waiters)) wake();
    voice.waiters.clear();
  }

  private clearDelayTimer(channel: AudioChannel): void {
    const timer = this.delayTimers.get(channel);
    if (timer) {
      clearTimeout(timer);
      this.delayTimers.delete(channel);
    }
  }

  private stop(channel: AudioChannel, fadeOut: Ms): void {
    this.clearDelayTimer(channel);
    const voice = this.voices.get(channel);
    if (!voice) return;
    // Le canal est libéré tout de suite : un nouveau play() peut démarrer pendant le fondu.
    this.voices.delete(channel);
    if (fadeOut <= 0) {
      this.release(voice);
      return;
    }
    // Les waitFor sont réveillés dès l'arrêt demandé ; le fondu se termine en arrière-plan.
    for (const wake of Array.from(voice.waiters)) wake();
    voice.waiters.clear();
    const gain = this.channelGain(channel);
    voice.fadingChannel = channel;
    this.fading.add(voice);
    this.rampWith(
      voice,
      0,
      fadeOut,
      (level) => {
        voice.audio.volume = clamp01(gain * level);
      },
      () => {
        this.fading.delete(voice);
        this.release(voice);
      },
    );
  }

  /** Pause scriptée : fondu vers le silence, puis la lecture est suspendue en gardant sa position. */
  private pause(channel: AudioChannel, fadeOut: Ms): void {
    const voice = this.voices.get(channel);
    if (!voice || voice.paused) return;
    voice.paused = true;
    this.rampWith(
      voice,
      0,
      fadeOut,
      (level) => {
        voice.level = level;
        this.applyVolume(channel, voice);
      },
      () => {
        if (voice.paused) voice.audio.pause();
      },
    );
  }

  /** Reprise scriptée : repart de la position de la pause, avec un fondu d'entrée vers `volume`. */
  private resumeChannel(channel: AudioChannel, volume: number, fadeIn: Ms): void {
    const voice = this.voices.get(channel);
    if (!voice) return;
    if (voice.paused) {
      voice.paused = false;
      if (!voice.suspended) this.startPlayback(channel, voice);
    }
    this.ramp(voice, volume, fadeIn);
  }

  private ramp(voice: Voice, target: number, time: Ms): void {
    const channel = this.channelOf(voice);
    if (!channel) return;
    this.rampWith(voice, target, time, (level) => {
      voice.level = level;
      this.applyVolume(channel, voice);
    });
  }

  private rampWith(
    voice: Voice,
    target: number,
    time: Ms,
    apply: (level: number) => void,
    onDone?: () => void,
  ): void {
    voice.cancelRamp?.();
    voice.cancelRamp = null;
    // Un nouveau fondu remplace l'ancien : les attentes de fin de fondu sont libérées.
    this.wakeFadeWaiters(voice);

    if (time <= 0) {
      apply(target);
      this.wakeFadeWaiters(voice);
      onDone?.();
      return;
    }
    const from = voice.level;
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const progress = Math.min((Date.now() - start) / time, 1);
      const level = from + (target - from) * progress;
      voice.level = level;
      apply(level);
      if (progress < 1) {
        timer = setTimeout(tick, FADE_STEP_MS);
      } else {
        voice.cancelRamp = null;
        this.wakeFadeWaiters(voice);
        onDone?.();
      }
    };
    voice.cancelRamp = () => {
      if (timer !== undefined) clearTimeout(timer);
    };
    tick();
  }
}

export function createAudioPlayer(deps: AudioPlayerDeps): AudioPlayer {
  return new WebAudioPlayer(deps);
}
