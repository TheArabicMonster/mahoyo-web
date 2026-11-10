// Registre des approximations (#295) — tests figés :
// approx:bindbg-not-persisted — liaison visuelle non persistée (tests @bindbg ci-dessous).
// approx:infg-outfg-fore-page — page fore directe sans transition (tests @infg/@outfg ci-dessous).
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { Instruction } from "@/kag/types.js";
import type { RenderEvent } from "@/kag/events.js";
import { IGNORED_COMMANDS_BY_NAME } from "../../../tools/ignored-commands.js";

/**
 * Calques image (#283, triage #276) : `@infg`, `@outfg`, `@layopt`, `@bindbg`, `@autocache`.
 *
 * Sémantique vérifiée dans `data/scenario/fgplugin.tjs` (`kt.infg`/`fg_object.infg`,
 * `kt.outfg`/`fg_object.outfg`), `data/override/tagex.tjs` (`.bindbg`, `.autocache`) et KAG3
 * (`mainwindow.tjs`, `.layopt`) ; args réels : `nz2.ks`, `nz4.ks`, `8.5.ks`, `wik_k.ks`,
 * `6-6.ks`, `call.ks`.
 */

function instructions(source: string): Instruction[] {
  return parse(lex(source)).pages.flatMap((page) => page.instructions);
}

function findEvent<T extends RenderEvent["kind"]>(
  events: readonly RenderEvent[],
  kind: T,
): Extract<RenderEvent, { kind: T }> | undefined {
  return events.find((event): event is Extract<RenderEvent, { kind: T }> => event.kind === kind);
}

/** Exécute le runtime jusqu'au premier point d'arrêt (page/clic) ou 50 steps. */
function runPage(source: string): { events: RenderEvent[]; runtime: Runtime } {
  const runtime = new Runtime(parse(lex(source)));
  const events: RenderEvent[] = [];
  for (let i = 0; i < 50; i++) {
    const step = runtime.step();
    events.push(...step.events);
    if (step.stop.kind === "end" || step.stop.kind === "click") break;
  }
  return { events, runtime };
}

describe("@infg — parse et runtime", () => {
  it("parse nz2.ks : position finale, offsets mx/my, temps, zoom et index", () => {
    const [instruction] = instructions(`
*page0|
@infg time=800 storage=im18なぜなに有珠園児普2 center=977 vcenter=89 index=1700 zoom=40 mx=-50 my=-20 id=a
@pg
    `);
    expect(instruction).toMatchObject({
      kind: "infg",
      storage: "im18なぜなに有珠園児普2",
      id: "a",
      center: 977,
      vcenter: 89,
      index: 1700,
      zoomx: 40,
      zoomy: 40,
      mx: -50,
      my: -20,
      time: 800,
      accel: 0,
      opacity: 1,
    });
  });

  it("applique les défauts du moteur (mx=24, my=0, time=300, accel=0)", () => {
    const [instruction] = instructions("*page0|\n@infg storage=x center=100 vcenter=200\n@pg\n");
    expect(instruction).toMatchObject({ kind: "infg", mx: 24, my: 0, time: 300, accel: 0, opacity: 1 });
  });

  it("émet un animate depuis (final − offsets, opacité 0) vers la position finale", () => {
    const { events, runtime } = runPage(`
*page0|
@infg storage=sprite center=500 vcenter=300 mx=-50 my=-20 time=800 id=a
@pg
    `);
    // (#317) une animation de calque sur fore n'émet plus de scène : elle ne coupe pas les fondus.
    expect(findEvent(events, "scene")).toBeUndefined();
    const animate = findEvent(events, "animate");
    expect(animate).toBeDefined();
    if (!animate) return;
    expect(animate.target).toBe("a");
    const frames = animate.def.keyframes;
    expect(frames[0]).toMatchObject({ center: 550, vcenter: 320, opacity: 0 });
    expect(frames[1]).toMatchObject({ center: 500, vcenter: 300, opacity: 1, time: 800 });
    // État final : le calque est à sa position finale (comme après l'animation).
    const sprite = runtime.getSaveData().state.fore!.layers.find((layer) => layer.id === "a");
    expect(sprite).toMatchObject({ center: 500, vcenter: 300, opacity: 1 });
  });
});

describe("@outfg — parse et runtime", () => {
  it("parse 8.5.ks : temps, offset mx", () => {
    const [instruction] = instructions("*page0|\n@outfg storage=鳶丸私服01(近)|d5 time=300 mx=-100\n@pg\n");
    expect(instruction).toMatchObject({ kind: "outfg", time: 300, mx: -100, my: 0 });
  });

  it("émet un animate du calque courant vers (position + offsets, opacité 0)", () => {
    const { events } = runPage(`
*page0|
@fg page=fore storage=sprite center=100 vcenter=200 opacity=128 id=a
@outfg id=a time=1000 mx=200
@pg
    `);
    const animate = findEvent(events, "animate");
    expect(animate).toBeDefined();
    if (!animate) return;
    expect(animate.target).toBe("a");
    expect(animate.def.keyframes[0]).toMatchObject({ center: 100, vcenter: 200, opacity: 128 / 255 });
    expect(animate.def.keyframes[1]).toMatchObject({ center: 300, vcenter: 200, opacity: 0, time: 1000 });
  });

  it("calque introuvable : avertissement, aucun événement d'animation", () => {
    const warnings: string[] = [];
    const runtime = new Runtime(parse(lex("*page0|\n@outfg id=absent\n@pg\n")));
    runtime.onWarning = (message) => warnings.push(message);
    const step = runtime.step();
    expect(warnings.some((w) => w.includes("outfg"))).toBe(true);
    expect(step.events.some((e) => e.kind === "animate")).toBe(false);
  });
});

describe("@layopt — parse et runtime", () => {
  it("parse wik_k.ks (page=back, id, center) et l'usage message de macro.ks", () => {
    const [layerOpt, messageOpt] = instructions(`
*page0|
@layopt page=back id=pb1 center=516
@layopt page=%page|fore layer=message0 visible=false
@pg
    `);
    expect(layerOpt).toEqual({ kind: "layopt", page: "back", id: "pb1", center: 516, vcenter: undefined, opacity: undefined, visible: undefined, storage: undefined, layer: undefined });
    expect(messageOpt).toMatchObject({ kind: "layopt", layer: "message0", visible: false });
  });

  it("met à jour center/opacity/visible d'un calque existant (page affichée)", () => {
    const { events } = runPage(`
*page0|
@fg page=fore storage=sprite center=100 vcenter=200 id=a
@layopt page=fore id=a center=516 opacity=51 visible=0
@pg
    `);
    const sceneEvents = events.filter((event) => event.kind === "scene");
    const sprite = sceneEvents.at(-1);
    expect(sprite).toBeDefined();
    const layers = sprite!.scene.sprites;
    expect(layers[0]).toMatchObject({ id: "a", x: 516, y: 200, opacity: 51 / 255, visible: false });
  });

  it("page=back : état mis à jour sans rendu immédiat (révélé par @trans)", () => {
    const { runtime } = runPage(`
*page0|
@partbg page=back storage=bg01l久遠寺邸01外観 srcleft=48 srctop=71 index=1100 width=1024 height=446 id=pb1
@layopt page=back id=pb1 center=516
@pg
    `);
    const save = runtime.getSaveData();
    const back = save.state.back.layers.find((layer) => layer.id === "pb1");
    expect(back?.center).toBe(516);
  });

  it("calque de message non modélisé : no-op silencieux", () => {
    const { events, runtime } = runPage(`
*page0|
@layopt page=fore layer=message0 visible=false
@pg
    `);
    expect(events.some((event) => event.kind === "scene")).toBe(false);
    void runtime;
  });
});

describe("@bindbg — parse et runtime", () => {
  it("parse 6-6.ks et propage le drapeau dans la scène", () => {
    const on = instructions("*page0|\n@bindbg page=back enabled=1\n@pg\n")[0];
    expect(on).toEqual({ kind: "bindbg", enabled: true, page: "back" });

    const { events } = runPage("*page0|\n@bindbg enabled=1\n@pg\n");
    const scene = findEvent(events, "scene");
    expect(scene?.scene.bindChildren).toBe(true);
  });

  it("enabled=0 désactive le suivi des calques", () => {
    const { events } = runPage("*page0|\n@bindbg enabled=0\n@pg\n");
    const scene = findEvent(events, "scene");
    expect(scene?.scene.bindChildren).toBe(false);
  });
});

describe("@autocache — no-op justifié (#275/#283)", () => {
  it("est reconnu par le parseur comme commande brute et déclaré no-op sans effet", () => {
    const [instruction] = instructions("*page0|\n@autocache enabled=true\n@pg\n");
    expect(instruction).toEqual({ kind: "raw", command: "autocache", args: { enabled: "true" } });
    const entry = IGNORED_COMMANDS_BY_NAME.get("autocache");
    expect(entry).toBeDefined();
    expect(entry?.effet).toBe("aucun");
    expect(entry?.issue).toContain("#283");
  });
});
