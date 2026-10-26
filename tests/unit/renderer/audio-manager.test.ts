import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAssetResolver } from "@/core/asset-resolver.js";
import { WebAudioPlayer, type AudioElementLike } from "@/renderer/audio-manager.js";
import type { AudioSettings } from "@/renderer/types.js";
import type { AudioEvent } from "@/kag/events.js";
import fixtures from "../../fixtures/audio.json";

class FakeAudio implements AudioElementLike {
  loop = false;
  volume = 1;
  paused = true;
  playCalls = 0;
  rejectPlay = false;
  private listeners = new Map<string, Set<() => void>>();
  constructor(public src: string) {}
  play(): Promise<void> {
    this.playCalls++;
    if (this.rejectPlay) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(type: string, l: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  removeEventListener(type: string, l: () => void): void {
    this.listeners.get(type)?.delete(l);
  }
  emit(type: "ended" | "error"): void {
    for (const l of Array.from(this.listeners.get(type) ?? [])) l();
  }
}

const settings = (o: Partial<AudioSettings> = {}): AudioSettings => ({
  master: 1, bgm: 1, se: 1, voice: 1, muted: false, ...o,
});

let created: FakeAudio[];
let player: WebAudioPlayer;
const live = new AbortController().signal;

beforeEach(() => {
  vi.useFakeTimers();
  created = [];
  player = new WebAudioPlayer({ resolver: createAssetResolver() }, (url) => {
    const a = new FakeAudio(url);
    created.push(a);
    return a;
  });
});
afterEach(() => vi.useRealTimers());

const play = (channel: "bgm" | "voice" | `se:${number}`, storage: string, loop: boolean, volume = 1, fadeIn?: number) =>
  ({ kind: "play", channel, storage, loop, volume, ...(fadeIn ? { fadeIn } : {}) }) as const;

describe("WebAudioPlayer", () => {
  it("joue un BGM en boucle avec master * canal * volume", () => {
    player.setSettings(settings({ master: 0.5, bgm: 0.4 }));
    player.apply(play("bgm", "m01", true, 0.5), { instant: false });
    expect(created[0]!.src).toBe("/assets/bgm/m01.ogg");
    expect(created[0]!.loop).toBe(true);
    expect(created[0]!.volume).toBeCloseTo(0.5 * 0.4 * 0.5);
    expect(created[0]!.paused).toBe(false);
  });

  it("ne relance pas le même BGM", () => {
    player.apply(play("bgm", "m01", true), { instant: false });
    player.apply(play("bgm", "m01", true), { instant: false });
    expect(created).toHaveLength(1);
  });

  it("crossfade vers un autre BGM", () => {
    player.apply(play("bgm", "m01", true), { instant: false });
    player.apply(play("bgm", "m02", true, 1, 1000), { instant: false });
    expect(created).toHaveLength(2);
    expect(created[1]!.volume).toBe(0);
    vi.advanceTimersByTime(500);
    expect(created[0]!.paused).toBe(false);
    expect(created[0]!.volume).toBeLessThan(1);
    expect(created[1]!.volume).toBeGreaterThan(0);
    vi.advanceTimersByTime(600);
    expect(created[0]!.paused).toBe(true);
    expect(created[1]!.volume).toBeCloseTo(1);
  });

  it("gère plusieurs SE simultanés et allSe", () => {
    player.apply(play("se:0", "a", true), { instant: false });
    player.apply(play("se:1", "b", true), { instant: false });
    expect(created.map((a) => a.paused)).toEqual([false, false]);
    player.apply({ kind: "stop", channel: "allSe" }, { instant: false });
    expect(created.map((a) => a.paused)).toEqual([true, true]);
  });

  it("fade ramène le volume vers la cible", () => {
    player.apply(play("bgm", "m01", true), { instant: false });
    player.apply({ kind: "fade", channel: "bgm", volume: 0, time: 2000 }, { instant: false });
    vi.advanceTimersByTime(1000);
    expect(created[0]!.volume).toBeCloseTo(0.5, 1);
    vi.advanceTimersByTime(1100);
    expect(created[0]!.volume).toBe(0);
  });

  it("mode instant : pas de fondu, SE non bouclés ignorés", () => {
    player.apply(play("se:0", "a", false), { instant: true });
    expect(created).toHaveLength(0);
    player.apply(play("bgm", "m01", true, 1, 1000), { instant: true });
    expect(created[0]!.volume).toBe(1);
    player.apply({ kind: "fade", channel: "bgm", volume: 0.2, time: 5000 }, { instant: true });
    expect(created[0]!.volume).toBeCloseTo(0.2);
    player.apply({ kind: "stop", channel: "bgm", fadeOut: 1000 }, { instant: true });
    expect(created[0]!.paused).toBe(true);
  });

  it("waitFor résout si canal vide ou en boucle", async () => {
    await player.waitFor("se:3", live);
    player.apply(play("se:0", "a", true), { instant: false });
    await player.waitFor("se:0", live);
  });

  it("waitFor attend la fin d'un son non bouclé", async () => {
    player.apply(play("se:0", "a", false), { instant: false });
    let done = false;
    const p = player.waitFor("se:0", live).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    created[0]!.emit("ended");
    await p;
    expect(done).toBe(true);
  });

  it("waitFor résout sur abort", async () => {
    player.apply(play("voice", "v", false), { instant: false });
    const ctrl = new AbortController();
    const p = player.waitFor("voice", ctrl.signal);
    ctrl.abort();
    await p;
  });

  it("restore remplace l'état par les boucles du snapshot", () => {
    player.apply(play("se:0", "old", true), { instant: false });
    player.restore({ loops: [{ channel: "bgm", storage: "m01", volume: 0.7 }, { channel: "se:1", storage: "rain", volume: 1 }] });
    expect(created[0]!.paused).toBe(true);
    expect(created[1]!.volume).toBeCloseTo(0.7);
    expect(created[2]!.src).toBe("/assets/se/rain.ogg");
    expect(created[2]!.loop).toBe(true);
  });

  it("setSettings met à jour les volumes et le mute", () => {
    player.apply(play("bgm", "m01", true, 0.5), { instant: false });
    player.setSettings(settings({ master: 0.5 }));
    expect(created[0]!.volume).toBeCloseTo(0.25);
    player.setSettings(settings({ muted: true }));
    expect(created[0]!.volume).toBe(0);
  });

  it("suspend/resume met en pause puis relance", () => {
    player.apply(play("bgm", "m01", true), { instant: false });
    player.suspend();
    expect(created[0]!.paused).toBe(true);
    player.resume();
    expect(created[0]!.paused).toBe(false);
  });

  it("unlock relance les lectures bloquées par l'autoplay", async () => {
    const blockedFactory = new WebAudioPlayer({ resolver: createAssetResolver() }, (url) => {
      const a = new FakeAudio(url);
      a.rejectPlay = true;
      created.push(a);
      return a;
    });
    blockedFactory.apply(play("bgm", "m01", true), { instant: false });
    await Promise.resolve();
    created[0]!.rejectPlay = false;
    await blockedFactory.unlock();
    expect(created[0]!.paused).toBe(false);
    expect(created[0]!.playCalls).toBe(2);
  });

  it("stopAll et dispose arrêtent tout", () => {
    player.apply(play("bgm", "m01", true), { instant: false });
    player.apply(play("se:0", "a", true), { instant: false });
    player.stopAll();
    expect(created.every((a) => a.paused)).toBe(true);
    player.dispose();
    player.apply(play("bgm", "m02", true), { instant: false });
    expect(created).toHaveLength(2);
  });

  it("joue les événements audio des fixtures sans erreur", () => {
    for (const step of fixtures) {
      for (const ev of step.events) {
        if (ev.kind === "audio") player.apply((ev as unknown as { event: AudioEvent }).event, { instant: false });
      }
    }
    vi.advanceTimersByTime(3000);
    expect(created.length).toBeGreaterThan(0);
  });
});
