/**
 * @playpause / @playresume : pause et reprise de la BGM avec fondu.
 * Les scripts sont des exemples inventés.
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import { reduceAudio } from "@/kag/stage-state.js";
import type { AudioEvent, RenderEvent } from "@/kag/events.js";
import type { Instruction } from "@/kag/types.js";

function first(src: string): Instruction {
  const ins = parse(lex(src)).pages[0]?.instructions[0];
  if (!ins) throw new Error("aucune instruction");
  return ins;
}

function audioEvents(src: string): { events: AudioEvent[]; runtime: Runtime } {
  const runtime = new Runtime(parse(lex(src)), "t.ks");
  const out: AudioEvent[] = [];
  for (let i = 0; i < 20; i++) {
    const step = runtime.step();
    for (const e of step.events) if (e.kind === "audio") out.push(e.event);
    if (step.stop.kind === "end") break;
  }
  return { events: out, runtime };
}

describe("parse @playpause / @playresume", () => {
  it("@playpause : durée et piste facultative", () => {
    expect(first("@playpause time=1000")).toEqual({ kind: "playpause", time: 1000, storage: undefined });
    expect(first("@playpause storage=m40 time=500")).toEqual({ kind: "playpause", time: 500, storage: "m40" });
  });

  it("@playpause sans durée = 0", () => {
    expect(first("@playpause")).toMatchObject({ kind: "playpause", time: 0 });
  });

  it("@playresume : volume par défaut 100", () => {
    expect(first("@playresume time=3000")).toEqual({ kind: "playresume", time: 3000, volume: 100, storage: undefined });
    expect(first("@playresume storage=m40 time=10000 volume=80")).toEqual({
      kind: "playresume",
      time: 10000,
      volume: 80,
      storage: "m40",
    });
  });
});

describe("Runtime — pause et reprise de la BGM", () => {
  it("@playpause émet une pause avec fondu et mémorise l'état", () => {
    const { events, runtime } = audioEvents("@play storage=m19\n@playpause time=1000\n@pg\n");
    expect(events[1]).toEqual({ kind: "pause", channel: "bgm", fadeOut: 1000 });
    expect(runtime.getSaveData().state.bgmPaused).toBe(true);
    expect(runtime.getSaveData().state.bgm).toBe("m19");
  });

  it("@playresume reprend la BGM avec fondu d'entrée vers le volume demandé", () => {
    const { events, runtime } = audioEvents("@play storage=m19\n@playpause time=500\n@playresume time=1500 volume=80\n@pg\n");
    expect(events[2]).toEqual({ kind: "resume", channel: "bgm", volume: 0.8, fadeIn: 1500 });
    expect(runtime.getSaveData().state.bgmPaused).toBe(false);
  });

  it("une pause sans BGM ou déjà en pause est sans effet", () => {
    expect(audioEvents("@playpause time=500\n@pg\n").events).toEqual([]);
    const { events } = audioEvents("@play storage=m19\n@playpause time=100\n@playpause time=100\n@pg\n");
    expect(events.filter((e) => e.kind === "pause")).toHaveLength(1);
  });

  it("une reprise sans BGM ni piste nommée est sans effet", () => {
    expect(audioEvents("@playresume time=1000\n@pg\n").events).toEqual([]);
  });

  it("une reprise sans BGM mais avec une piste nommée la lance en fondu", () => {
    const { events, runtime } = audioEvents("@playresume storage=m29 time=2000 volume=100\n@pg\n");
    expect(events[0]).toEqual({ kind: "play", channel: "bgm", storage: "m29", loop: true, volume: 1, fadeIn: 2000 });
    expect(runtime.getSaveData().state.bgm).toBe("m29");
  });

  it("@play et @playstop remettent la pause à zéro", () => {
    const a = audioEvents("@play storage=m19\n@playpause time=100\n@play storage=m20\n@pg\n");
    expect(a.runtime.getSaveData().state.bgmPaused).toBe(false);
    const b = audioEvents("@play storage=m19\n@playpause time=100\n@playstop time=100\n@pg\n");
    expect(b.runtime.getSaveData().state.bgmPaused).toBe(false);
    expect(b.runtime.getSaveData().state.bgm).toBeNull();
  });

  it("ne produit plus de commande inconnue", () => {
    const warnings: string[] = [];
    const runtime = new Runtime(parse(lex("@play storage=m19\n@playpause time=100\n@playresume time=100\n@pg\n")), "t.ks");
    runtime.onWarning = (m: string) => warnings.push(m);
    runtime.step();
    expect(warnings.filter((w) => w.includes("commande non gérée"))).toEqual([]);
  });

  it("l'état de pause est sauvegardé et restauré", async () => {
    const script = parse(lex("@play storage=m19\n@playpause time=100\n@pg\n@playresume time=100\n@pg\n"));
    const runtime = new Runtime(script, "t.ks");
    runtime.step();
    const save = runtime.getSaveData();
    expect(save.state.bgmPaused).toBe(true);

    const restored = new Runtime(script, "t.ks");
    await restored.loadSaveData(save, new Map([["t.ks", script]]));
    const evs: AudioEvent[] = [];
    for (const e of restored.step().events) if (e.kind === "audio") evs.push(e.event);
    expect(evs).toEqual([{ kind: "resume", channel: "bgm", volume: 1, fadeIn: 100 }]);
  });
});

describe("reduceAudio — pause et reprise", () => {
  const ev = (event: AudioEvent): RenderEvent => ({ kind: "audio", event });
  const play = ev({ kind: "play", channel: "bgm", storage: "m19", loop: true, volume: 1 });

  it("une piste en pause reste dans l'instantané, silencieuse", () => {
    const snap = reduceAudio([play, ev({ kind: "pause", channel: "bgm", fadeOut: 500 })]);
    expect(snap.loops).toEqual([{ channel: "bgm", storage: "m19", volume: 0 }]);
  });

  it("la reprise rend le volume demandé", () => {
    const snap = reduceAudio([play, ev({ kind: "pause", channel: "bgm" }), ev({ kind: "resume", channel: "bgm", volume: 0.8, fadeIn: 1000 })]);
    expect(snap.loops).toEqual([{ channel: "bgm", storage: "m19", volume: 0.8 }]);
  });

  it("une pause ou une reprise sans piste ne crée rien", () => {
    expect(reduceAudio([ev({ kind: "pause", channel: "bgm" }), ev({ kind: "resume", channel: "bgm", volume: 1 })]).loops).toEqual([]);
  });
});
