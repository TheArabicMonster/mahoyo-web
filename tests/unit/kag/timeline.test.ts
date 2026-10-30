/**
 * @playtimeline, @seloop et kag.isplayingse. Données et scripts inventés.
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { AudioEvent, RenderEvent, Step } from "@/kag/events.js";
import type { Instruction } from "@/kag/types.js";
import type { TimelineData } from "@/core/timeline.js";

const DATA: TimelineData = {
  version: 1,
  scripts: {
    "demo.ks": {
      "4": {
        name: "avec pluie",
        duration: 9000,
        bg: [
          { at: 0, storage: "black" },
          { at: 0, storage: "black" },
          { at: 2000, storage: "img1", left: -10, top: -20 },
          { at: 6000, storage: "img2" },
        ],
        audio: [
          { at: 1000, channel: "bgm", storage: "m01", loop: false, volume: 1, action: "play" },
          { at: 7000, channel: "se", storage: "rain", loop: true, volume: 0, action: "play" },
          { at: 8000, channel: "se", loop: false, volume: 0.5, action: "volume" },
        ],
      },
    },
  },
};

function first(src: string): Instruction {
  const ins = parse(lex(src)).pages[0]?.instructions[0];
  if (!ins) throw new Error("aucune instruction");
  return ins;
}

function run(src: string, timelines: TimelineData | null = DATA, script = "demo.ks") {
  const runtime = new Runtime(parse(lex(src)), script);
  runtime.timelines = timelines;
  const warnings: string[] = [];
  runtime.onWarning = (m: string) => warnings.push(m);
  const steps: Step[] = [];
  for (let i = 0; i < 20; i++) {
    const step = runtime.step();
    steps.push(step);
    if (step.stop.kind === "end") break;
  }
  return { runtime, steps, warnings };
}

function timelineStop(steps: Step[]) {
  const stop = steps.map((s) => s.stop).find((s) => s.kind === "timeline");
  if (!stop || stop.kind !== "timeline") throw new Error("pas d'arrêt timeline");
  return stop;
}

describe("parse @playtimeline / @seloop", () => {
  it("@playtimeline : scène et durée ; les autres arguments sont ignorés", () => {
    expect(first("@playtimeline scene=4 canskip=&(sf.x>0) norapid=true next=197250")).toEqual({ kind: "playtimeline", scene: 4, next: 197250 });
    expect(first("@playtimeline scene=7")).toEqual({ kind: "playtimeline", scene: 7, next: undefined });
  });

  it("@playtimeline sans scène retombe en commande brute", () => {
    expect(first("@playtimeline next=10").kind).toBe("raw");
  });

  it("@seloop : SE en boucle avec fondu d'entrée, volume et condition", () => {
    expect(first("@seloop storage=rain time=5000 volume=60 loop=1 cond=!kag.isplayingse('rain')")).toEqual({
      kind: "seact",
      storage: "rain",
      delay: 0,
      fadeIn: 5000,
      volume: 60,
      loop: true,
      cond: "!kag.isplayingse('rain')",
    });
    expect(first("@seloop storage=rain")).toMatchObject({ fadeIn: 0, volume: 100, loop: true });
  });

  it("@seloop sans piste retombe en commande brute", () => {
    expect(first("@seloop volume=50").kind).toBe("raw");
  });
});

describe("Runtime — @playtimeline", () => {
  it("émet un arrêt timeline avec un calendrier trié, durée = durée de la scène", () => {
    const { steps } = run("@playtimeline scene=4\n@pg\n");
    const stop = timelineStop(steps);
    expect(stop.duration).toBe(9000);
    expect(stop.schedule.map((e) => e.at)).toEqual([0, 1000, 2000, 6000, 7000, 8000]);
  });

  it("`next` remplace la durée de la scène ; next=0 la conserve", () => {
    expect(timelineStop(run("@playtimeline scene=4 next=5000\n@pg\n").steps).duration).toBe(5000);
    expect(timelineStop(run("@playtimeline scene=4 next=0\n@pg\n").steps).duration).toBe(9000);
  });

  it("construit les fonds : pas de fondu au début, 1500 ms ensuite, deux fonds identiques fusionnés", () => {
    const stop = timelineStop(run("@playtimeline scene=4\n@pg\n").steps);
    const scenes = stop.schedule.flatMap((e) => e.events).filter((e): e is Extract<RenderEvent, { kind: "scene" }> => e.kind === "scene");
    expect(scenes.map((e) => e.scene.bg)).toEqual(["black", "img1", "img2"]);
    expect(scenes[0]!.transition).toMatchObject({ method: "none" });
    expect(scenes[1]!.transition).toMatchObject({ time: 1500 });
    expect(scenes[1]!.scene).toMatchObject({ bgLeft: -10, bgTop: -20 });
  });

  it("construit l'audio : lecture sans boucle, SE en boucle, changement de volume", () => {
    const stop = timelineStop(run("@playtimeline scene=4\n@pg\n").steps);
    const audio = stop.schedule.flatMap((e) => e.events).filter((e) => e.kind === "audio").map((e) => (e as Extract<RenderEvent, { kind: "audio" }>).event);
    expect(audio).toEqual<AudioEvent[]>([
      { kind: "play", channel: "bgm", storage: "m01", loop: false, volume: 1 },
      { kind: "play", channel: "se:0", storage: "rain", loop: true, volume: 0 },
      { kind: "fade", channel: "se:0", volume: 0.5, time: 0 },
    ]);
  });

  it("l'état du runtime reçoit tout de suite le résultat final", () => {
    const { runtime } = run("@playtimeline scene=4\n@pg\n");
    const state = runtime.getSaveData().state;
    expect(state.fore.background).toBe("img2");
    expect(state.bgm).toBe("m01");
    expect(state.se).toBe("rain");
  });

  it("retrouve la scène avec un nom de script insensible à la casse", () => {
    const { steps } = run("@playtimeline scene=4\n@pg\n", DATA, "DEMO.ks");
    expect(timelineStop(steps).schedule.length).toBeGreaterThan(0);
  });

  it("sans données, ou pour une scène inconnue : avertissement et aucun arrêt", () => {
    for (const [data, src] of [[null, "@playtimeline scene=4\n@pg\n"], [DATA, "@playtimeline scene=99\n@pg\n"]] as const) {
      const { steps, warnings } = run(src, data);
      expect(steps.some((s) => s.stop.kind === "timeline")).toBe(false);
      expect(warnings.some((w) => w.includes("timeline introuvable"))).toBe(true);
    }
  });

  it("n'est plus comptée comme commande inconnue", () => {
    const { warnings } = run("@playtimeline scene=4\n@pg\n");
    expect(warnings.filter((w) => w.includes("commande non gérée"))).toEqual([]);
  });

  it("la BGM lancée par la timeline peut être arrêtée ensuite par @playstop", () => {
    const { steps } = run("@playtimeline scene=4\n@playstop time=3000\n@pg\n");
    const stops = steps.flatMap((s) => s.events).filter((e) => e.kind === "audio" && e.event.kind === "stop");
    expect(stops).toHaveLength(1);
  });
});

describe("Runtime — @seloop et kag.isplayingse", () => {
  const plays = (steps: Step[]) =>
    steps.flatMap((s) => s.events).filter((e) => e.kind === "audio" && e.event.kind === "play").map((e) => (e as Extract<RenderEvent, { kind: "audio" }>).event);

  it("@seloop lance le SE en boucle avec son fondu d'entrée", () => {
    const { steps } = run("@seloop storage=rain time=5000 volume=60\n@pg\n");
    expect(plays(steps)).toEqual([{ kind: "play", channel: "se:0", storage: "rain", loop: true, volume: 0.6, fadeIn: 5000, delay: 0 }]);
  });

  it("cond=!kag.isplayingse n'ajoute pas un SE déjà en cours", () => {
    const { steps } = run("@seloop storage=rain\n@seloop storage=rain cond=!kag.isplayingse('rain')\n@pg\n");
    expect(plays(steps)).toHaveLength(1);
  });

  it("cond=!kag.isplayingse lance le SE s'il n'est pas en cours", () => {
    const { steps } = run("@seloop storage=rain cond=!kag.isplayingse('rain')\n@pg\n");
    expect(plays(steps)).toHaveLength(1);
  });

  it("après @sestop, le SE n'est plus considéré en cours", () => {
    const { steps } = run("@seloop storage=rain\n@sestop\n@seloop storage=rain cond=!kag.isplayingse('rain')\n@pg\n");
    expect(plays(steps)).toHaveLength(2);
  });

  it("ne produit plus de commande inconnue", () => {
    const { warnings } = run("@seloop storage=rain cond=!kag.isplayingse('rain')\n@pg\n");
    expect(warnings.filter((w) => w.includes("commande non gérée") || w.includes("eval failed"))).toEqual([]);
  });
});
