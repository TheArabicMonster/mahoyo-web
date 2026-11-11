/**
 * Pool de canaux SE (#358) : ambiances bouclées non coupées, one-shots parallèles, voix routées,
 * `@sestop` par storage, sauvegarde/chargement multi-canaux. Scripts inventés.
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import { reduceAudio } from "@/kag/stage-state.js";
import type { AudioEvent, RenderEvent, Step } from "@/kag/events.js";

type Audio = Extract<RenderEvent, { kind: "audio" }>;

function make(src: string): Runtime {
  return new Runtime(parse(lex(src)));
}

function steps(runtime: Runtime, max = 40): Step[] {
  const out: Step[] = [];
  for (let i = 0; i < max; i++) {
    const step = runtime.step();
    out.push(step);
    if (step.stop.kind === "end") break;
  }
  return out;
}

function audioEvents(list: readonly Step[]): Audio[] {
  return list.flatMap((step) => step.events.filter((event): event is Audio => event.kind === "audio"));
}

function plays(list: readonly Step[]): AudioEvent[] {
  return audioEvents(list)
    .map((event) => event.event)
    .filter((event): event is Extract<AudioEvent, { kind: "play" }> => event.kind === "play");
}

describe("Runtime — pool de canaux SE (#358)", () => {
  it("deux one-shots simultanés occupent des canaux distincts", () => {
    const events = audioEvents(steps(make("@se storage=se01\n@se storage=se02\n@pg\n")));
    expect(plays(steps(make("@se storage=se01\n@se storage=se02\n@pg\n"))).map((e) => e.channel)).toEqual(["se:0", "se:1"]);
    expect(events).toHaveLength(2);
  });

  it("une boucle d'ambiance garde son canal et ne coupe pas un one-shot", () => {
    const runtime = make("@seloop storage=rain\n@se storage=se01\n@pg\n");
    const actual = steps(runtime).flatMap((step) => step.events.filter((event): event is Audio => event.kind === "audio"));
    expect(actual.map((event) => (event.event.kind === "play" ? event.event.channel : null))).toEqual(["se:0", "se:1"]);
    expect(runtime.evaluateCondition("kag.isplayingse('rain')")).toBe(true);
    expect(runtime.evaluateCondition("kag.isplayingse('se01')")).toBe(true);
  });

  it("relancer la même boucle réutilise son canal dédié", () => {
    const actual = audioEvents(steps(make("@seloop storage=rain\n@se storage=se01\n@seloop storage=rain\n@pg\n")));
    const channels = actual.map((event) => (event.event.kind === "play" ? event.event.channel : null));
    expect(channels).toEqual(["se:0", "se:1", "se:0"]);
    expect(channels.filter((c) => c === "se:0")).toHaveLength(2);
  });

  it("pool saturé : le plus ancien one-shot est réutilisé, jamais une boucle", () => {
    // Boucle se:0, puis 7 one-shots se:1..se:7, puis un 8e one-shot.
    const src =
      "@seloop storage=rain\n" +
      Array.from({ length: 7 }, (_, i) => `@se storage=se0${i + 1}`).join("\n") +
      "\n@se storage=se99\n@pg\n";
    const runtime = make(src);
    const actual = audioEvents(steps(runtime));
    const channels = actual.map((event) => (event.event.kind === "play" ? event.event.channel : null));
    // Le 8e one-shot réutilise se:1 (le plus ancien), pas se:0 (boucle).
    expect(channels[0]).toBe("se:0");
    expect(channels[8]).toBe("se:1");
    expect(runtime.evaluateCondition("kag.isplayingse('rain')")).toBe(true);
    expect(runtime.evaluateCondition("kag.isplayingse('se01')")).toBe(false); // canal se:1 réutilisé
  });

  it("@sestop storage ne stoppe que le canal correspondant ; tous sans storage", () => {
    const runtime = make("@se storage=se01\n@se storage=se02\n@sestop storage=se01\n@pg\n");
    const actual = audioEvents(steps(runtime));
    const stop = actual.find((event) => event.event.kind === "stop");
    expect(stop?.event).toMatchObject({ kind: "stop", channel: "se:0" });
    expect(runtime.evaluateCondition("kag.isplayingse('se02')")).toBe(true);

    const all = audioEvents(steps(make("@se storage=se01\n@se storage=se02\n@sestop\n@pg\n")));
    const stops = all.filter((event) => event.event.kind === "stop").map((event) => event.event);
    expect(stops).toEqual([{ kind: "stop", channel: "allSe", fadeOut: undefined }]);
  });

  it("@sestop storage inconnu ne produit aucun arrêt (moteur : buffer introuvable)", () => {
    const runtime = make("@se storage=se01\n@sestop storage=absent\n@pg\n");
    const actual = audioEvents(steps(runtime));
    expect(actual.some((event) => event.event.kind === "stop")).toBe(false);
    expect(runtime.evaluateCondition("kag.isplayingse('se01')")).toBe(true);
  });

  it("@sestop sans storage libère tous les canaux du slot", () => {
    const runtime = make("@se storage=se01\n@sestop\n@pg\n");
    steps(runtime);
    expect(runtime.evaluateCondition("kag.isplayingse('se01')")).toBe(false);
    expect(runtime.getSaveData().state.seChannels).toEqual([]);
  });

  it("la fin de lecture libère le canal (releaseSeChannel idempotent)", () => {
    const runtime = make("@se storage=se01\n@pg\n");
    steps(runtime);
    expect(runtime.getSaveData().state.seChannels).toHaveLength(1);
    runtime.releaseSeChannel("se:0");
    runtime.releaseSeChannel("se:0");
    expect(runtime.getSaveData().state.seChannels).toEqual([]);
    expect(runtime.evaluateCondition("kag.isplayingse('se01')")).toBe(false);
  });

  it("les voix Steam passent par `voice` sans couper l'ambiance", () => {
    const runtime = make("@seloop storage=rain\n@se storage=A10_5A_8_0002\n@pg\n");
    const actual = audioEvents(steps(runtime));
    expect(plays(steps(make("@seloop storage=rain\n@se storage=A10_5A_8_0002\n@pg\n"))).map((e) => e.channel)).toEqual([
      "se:0",
      "voice",
    ]);
    expect(actual.filter((event) => event.event.kind === "play")).toHaveLength(2);
    expect(runtime.evaluateCondition("kag.isplayingse('rain')")).toBe(true);
    expect(runtime.evaluateCondition("kag.isplayingse('a10_5a_8_0002')")).toBe(true);

    const stopped = make("@seloop storage=rain\n@se storage=F70_1_0_0000\n@sestop storage=F70_1_0_0000\n@pg\n");
    const stopEvent = audioEvents(steps(stopped)).find((event) => event.event.kind === "stop");
    expect(stopEvent?.event).toMatchObject({ kind: "stop", channel: "voice" });
    expect(stopped.evaluateCondition("kag.isplayingse('rain')")).toBe(true);
  });

  it("sauvegarde/chargement conserve les boucles multi-canaux", async () => {
    const runtime = make("@seloop storage=rain\n@seloop storage=wind\n@pg\n");
    const first = steps(runtime);
    const save = runtime.getSaveData();
    expect(save.state.seChannels?.map((entry) => entry.storage)).toEqual(["rain", "wind"]);

    const script = parse(lex("@seloop storage=rain\n@seloop storage=wind\n@pg\n"));
    const restored = new Runtime(script);
    const loaded = await restored.loadSaveData(save, new Map([[save.scriptName, script]]));
    expect(loaded).toBe(true);
    expect(restored.evaluateCondition("kag.isplayingse('rain')")).toBe(true);
    expect(restored.evaluateCondition("kag.isplayingse('wind')")).toBe(true);
    expect(restored.getSaveData().state.seChannels?.map((entry) => entry.channel)).toEqual(["se:0", "se:1"]);

    // La restauration audio (snapshot de scène) rejoue les deux boucles sur leurs canaux.
    const loops = reduceAudio(first.flatMap((step) => step.events)).loops;
    expect(loops.map((loop) => [loop.channel, loop.storage])).toEqual([
      ["se:0", "rain"],
      ["se:1", "wind"],
    ]);
  });

  it("volume/fondu/délai restent par canal (@fadese, @seact)", () => {
    const src = "@seloop storage=rain volume=60\n@fadese storage=rain time=500 volume=30\n@seact keys=(100,play,se02,200,50,,0)\n@pg\n";
    const runtime = make(src);
    const actual = audioEvents(steps(runtime)).map((event) => event.event);
    expect(actual[0]).toMatchObject({ kind: "play", channel: "se:0", storage: "rain", volume: 0.6 });
    expect(actual[1]).toMatchObject({ kind: "fade", channel: "se:0", volume: 0.3, time: 500 });
    expect(actual[2]).toMatchObject({ kind: "play", channel: "se:1", storage: "se02", delay: 100, fadeIn: 200, volume: 0.5 });
    const save = runtime.getSaveData();
    expect(save.state.seChannels?.find((entry) => entry.channel === "se:0")?.volume).toBe(0.3);
  });

  it("un canal libéré redevient le premier libre", () => {
    const runtime = make("@se storage=se01\n@pg\n");
    steps(runtime);
    runtime.releaseSeChannel("se:0");
    const next = make("@se storage=se02\n@pg\n");
    expect(plays(steps(next)).map((event) => event.channel)).toEqual(["se:0"]);
  });

  it("la BGM reste sur bgm et n'utilise pas le pool SE", () => {
    const runtime = make("@play storage=m01\n@se storage=se01\n@pg\n");
    const channels = plays(steps(runtime)).map((event) => event.channel);
    expect(channels).toEqual(["bgm", "se:0"]);
  });
});
