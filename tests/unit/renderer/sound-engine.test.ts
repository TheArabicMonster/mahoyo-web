import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSoundEngine,
  type SoundElementLike,
  type SoundEngine,
  type SoundPosition,
} from "@/renderer/audio-manager.js";

/**
 * HUD-16 (#209) : lecteur de la galerie sonore (`createSoundEngine`), hors canaux du jeu.
 * L'élément audio est simulé (aucun `HTMLAudioElement` réel) : on contrôle chargement, volume,
 * position/durée, recherche, arrêt, fin de piste et cadence de rafraîchissement.
 */
class FakeSoundElement implements SoundElementLike {
  src = "";
  volume = 1;
  currentTime = 0;
  duration = 0;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  rejectPlay = false;
  private readonly listeners = new Map<string, Set<() => void>>();

  play(): Promise<void> {
    this.playCalls++;
    if (this.rejectPlay) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls++;
    this.paused = true;
  }

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "ended" | "timeupdate" | "loadedmetadata"): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

describe("SoundEngine — lecteur de la galerie sonore (HUD-16)", () => {
  let element: FakeSoundElement;
  let engine: SoundEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    element = new FakeSoundElement();
    engine = createSoundEngine(() => element);
  });
  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  it("play charge l'URL, applique le volume, lance la lecture et notifie la position", async () => {
    engine.setVolume(0.4);
    element.duration = 90;
    const positions: SoundPosition[] = [];
    engine.subscribe((position) => positions.push(position));
    await engine.play("/assets/bgm/a.ogg");
    expect(element.src).toBe("/assets/bgm/a.ogg");
    expect(element.volume).toBe(0.4);
    expect(element.playCalls).toBe(1);
    expect(element.paused).toBe(false);
    expect(positions.at(-1)).toEqual({ current: 0, duration: 90 });
  });

  it("la position suit timeupdate puis la cadence de 250 ms pendant la lecture", () => {
    const positions: SoundPosition[] = [];
    engine.subscribe((position) => positions.push(position));
    void engine.play("/assets/bgm/a.ogg");
    element.duration = 60;
    element.currentTime = 12;
    element.emit("loadedmetadata");
    expect(positions.at(-1)).toEqual({ current: 12, duration: 60 });
    const before = positions.length;
    vi.advanceTimersByTime(250);
    element.currentTime = 12.5;
    vi.advanceTimersByTime(250);
    expect(positions.length).toBeGreaterThan(before + 1);
  });

  it("seek borne la position à [0, durée], stop remet à 0 et met en pause", () => {
    void engine.play("/assets/bgm/a.ogg");
    element.duration = 30;
    engine.seek(100);
    expect(element.currentTime).toBe(30);
    engine.seek(-5);
    expect(element.currentTime).toBe(0);
    engine.seek(12.5);
    expect(engine.position()).toEqual({ current: 12.5, duration: 30 });
    engine.stop();
    expect(element.currentTime).toBe(0);
    expect(element.paused).toBe(true);
    expect(engine.position()).toEqual({ current: 0, duration: 30 });
  });

  it("pause interrompt la cadence de position", () => {
    void engine.play("/assets/bgm/a.ogg");
    element.duration = 60;
    engine.pause();
    const positions: SoundPosition[] = [];
    engine.subscribe((position) => positions.push(position));
    const count = positions.length;
    vi.advanceTimersByTime(1000);
    expect(positions.length).toBe(count);
    expect(element.paused).toBe(true);
  });

  it("rejouer une autre piste repart de 0 ; rejouer la même reprend au début demandé", () => {
    void engine.play("/assets/bgm/a.ogg");
    element.currentTime = 10;
    void engine.play("/assets/bgm/a.ogg");
    expect(element.currentTime).toBe(10); // même URL : reprise de la position
    void engine.play("/assets/bgm/b.ogg");
    expect(element.src).toBe("/assets/bgm/b.ogg");
    expect(element.currentTime).toBe(0);
  });

  it("fin de piste : notifie les abonnés et arrête la cadence", () => {
    void engine.play("/assets/bgm/a.ogg");
    element.duration = 30;
    let ended = 0;
    engine.onEnded(() => ended++);
    element.currentTime = 30;
    element.emit("ended");
    expect(ended).toBe(1);
    const positions: SoundPosition[] = [];
    engine.subscribe((position) => positions.push(position));
    vi.advanceTimersByTime(1000);
    expect(positions).toHaveLength(0); // la cadence est arrêtée après `ended`
  });

  it("autoplay refusé : play ne rejette pas et l'écran n'est pas cassé", async () => {
    element.rejectPlay = true;
    await expect(engine.play("/assets/bgm/a.ogg")).resolves.toBeUndefined();
    expect(engine.position()).toEqual({ current: 0, duration: 0 });
  });

  it("dispose arrête la lecture, retire les abonnés et n'émet plus", () => {
    let positions = 0;
    let ended = 0;
    engine.subscribe(() => positions++);
    engine.onEnded(() => ended++);
    void engine.play("/assets/bgm/a.ogg");
    engine.dispose();
    expect(element.paused).toBe(true);
    const before = positions;
    vi.advanceTimersByTime(1000);
    element.emit("ended");
    expect(positions).toBe(before);
    expect(ended).toBe(0);
    expect(engine.play("/assets/bgm/b.ogg")).toBeUndefined();
  });
});
