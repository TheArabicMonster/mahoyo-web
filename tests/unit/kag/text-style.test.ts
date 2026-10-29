/**
 * Commandes de style de texte (@font, @italic, @rf, @resetfont) et bulle « ploy »
 * (@beginploy, @ploysay, @endploy). Les textes sont des exemples inventés.
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";
import type { Instruction, TextSegment } from "@/kag/types.js";

function firstInstruction(src: string): Instruction {
  const page = parse(lex(src)).pages[0];
  const ins = page?.instructions[0];
  if (!ins) throw new Error("aucune instruction");
  return ins;
}

/** Exécute le script jusqu'à la fin et renvoie tous les événements. */
function runAll(src: string): { events: RenderEvent[]; runtime: Runtime } {
  const runtime = new Runtime(parse(lex(src)), "test.ks");
  const events: RenderEvent[] = [];
  for (let i = 0; i < 50; i++) {
    const step = runtime.step();
    events.push(...step.events);
    if (step.stop.kind === "end") break;
  }
  return { events, runtime };
}

function textSegments(events: readonly RenderEvent[]): TextSegment[] {
  return events.flatMap((e) => (e.kind === "text" ? [...e.segments] : []));
}

describe("parse @font / @italic / @rf / @resetfont", () => {
  it("@font : couleur 0xRRGGBB (casse ignorée) et contour", () => {
    expect(firstInstruction("@font color=0xFF0000 edgecolor=0x003366")).toEqual({
      kind: "font",
      style: { color: "#ff0000", edgeColor: "#003366" },
    });
  });

  it("@font : booléens true/false/1/0, taille et ombre", () => {
    expect(firstInstruction("@font italic=true bold=0 edge=false shadow=1 size=10")).toEqual({
      kind: "font",
      style: { italic: true, bold: false, edge: false, shadow: true, size: 10 },
    });
  });

  it("@font : une valeur invalide est ignorée sans invalider le reste", () => {
    expect(firstInstruction("@font color=rouge size=abc italic=peutetre bold=1")).toEqual({
      kind: "font",
      style: { bold: true },
    });
  });

  it("@font sans attribut donne un style vide", () => {
    expect(firstInstruction("@font")).toEqual({ kind: "font", style: {} });
  });

  it("@italic équivaut à @font italic=true", () => {
    expect(firstInstruction("@italic")).toEqual({ kind: "font", style: { italic: true } });
  });

  it("@rf et @resetfont donnent resetfont", () => {
    expect(firstInstruction("@rf")).toEqual({ kind: "resetfont" });
    expect(firstInstruction("@resetfont")).toEqual({ kind: "resetfont" });
  });

  it("les balises en ligne [font] et [rf] sont routées comme les commandes", () => {
    const page = parse(lex("a[font color=0xff0000]b[rf]c")).pages[0];
    const kinds = page?.instructions.map((i) => i.kind);
    expect(kinds).toEqual(["text", "font", "text", "resetfont", "text"]);
  });
});

describe("parse @ploysay / @endploy", () => {
  it("@ploysay conserve mode et décalages", () => {
    expect(firstInstruction("@ploysay mode=lu13 ox=50 oy=-30")).toEqual({
      kind: "ploysay",
      mode: "lu13",
      ox: 50,
      oy: -30,
    });
  });

  it("@ploysay : décalages absents = 0", () => {
    expect(firstInstruction("@ploysay mode=ru19")).toEqual({
      kind: "ploysay",
      mode: "ru19",
      ox: 0,
      oy: 0,
    });
  });

  it("@ploysay sans mode retombe en commande brute (tolérance)", () => {
    expect(firstInstruction("@ploysay ox=5").kind).toBe("raw");
  });

  it("@endploy est reconnu", () => {
    expect(firstInstruction("@endploy")).toEqual({ kind: "endploy" });
  });
});

describe("Runtime — style du texte", () => {
  it("applique le style courant au texte qui suit, pas à celui d'avant", () => {
    const { events } = runAll("avant\n@font color=0xff0000 italic=true\naprès\n@pg\n");
    const segs = textSegments(events);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ text: "avant" });
    expect(segs[1]).toMatchObject({ text: "après", style: { color: "#ff0000", italic: true } });
  });

  it("les @font successifs fusionnent leurs attributs", () => {
    const { events } = runAll("@font color=0xff0000\n@font italic=true\nx\n@pg\n");
    expect(textSegments(events)[0]).toMatchObject({
      style: { color: "#ff0000", italic: true },
    });
  });

  it("@rf rétablit le style par défaut", () => {
    const { events } = runAll("@font color=0xff0000\nrouge\n@rf\nnormal\n@pg\n");
    const segs = textSegments(events);
    expect(segs[0]).toMatchObject({ style: { color: "#ff0000" } });
    expect(segs[1]).toEqual({ text: "normal" });
  });

  it("@resetfont sans @font préalable est sans effet", () => {
    const { events } = runAll("@resetfont\ntexte\n@pg\n");
    expect(textSegments(events)).toEqual([{ text: "texte" }]);
  });

  it("[italic] en ligne : le style s'applique au texte suivant, [rf] le retire", () => {
    const { events } = runAll("a[italic]b[rf]c\n@pg\n");
    const segs = textSegments(events);
    expect(segs[0]).toEqual({ text: "a" });
    expect(segs[1]).toMatchObject({ text: "b", style: { italic: true } });
    expect(segs[2]).toEqual({ text: "c" });
  });

  it("le style est enregistré dans la sauvegarde et restauré au chargement", async () => {
    const src = "@font color=0x00ff00 bold=1\n@pg\nsuite\n@pg\n";
    const script = parse(lex(src));
    const runtime = new Runtime(script, "test.ks");
    runtime.step();
    const save = runtime.getSaveData();
    expect(save.state.textStyle).toEqual({ color: "#00ff00", bold: true });

    const restored = new Runtime(script, "test.ks");
    await restored.loadSaveData(save, new Map([["test.ks", script]]));
    const step = restored.step();
    expect(textSegments(step.events)[0]).toMatchObject({
      text: "suite",
      style: { color: "#00ff00", bold: true },
    });
  });

  it("ne renvoie plus @italic/@rf/@font/@resetfont comme commandes inconnues", () => {
    const warnings: string[] = [];
    const runtime = new Runtime(parse(lex("@font color=0xff0000\n@italic\n@rf\n@resetfont\n@pg\n")), "t.ks");
    runtime.onWarning = (m: string) => warnings.push(m);
    runtime.step();
    expect(warnings.filter((w) => w.includes("commande non gérée"))).toEqual([]);
    expect(runtime.rawCount).toBe(0);
  });
});

describe("Runtime — bulle ploy", () => {
  it("@ploysay émet un événement ploy et mémorise l'état", () => {
    const { events, runtime } = runAll("@beginploy\n@ploysay mode=lu13 ox=20 oy=-30\n@pg\n");
    const ploy = events.find((e) => e.kind === "ploy");
    expect(ploy).toEqual({ kind: "ploy", ploy: { mode: "lu13", ox: 20, oy: -30 } });
    expect(runtime.getSaveData().state.ploy).toEqual({ mode: "lu13", ox: 20, oy: -30 });
  });

  it("@endploy retire la bulle", () => {
    const { events, runtime } = runAll("@ploysay mode=ru19\n@endploy\n@pg\n");
    const ploys = events.filter((e) => e.kind === "ploy");
    expect(ploys).toHaveLength(2);
    expect(ploys[1]).toEqual({ kind: "ploy", ploy: null });
    expect(runtime.getSaveData().state.ploy).toBeNull();
  });

  it("@ploysay ne rend pas de texte (ce n'est pas une commande texte)", () => {
    const { events } = runAll("@ploysay mode=lu13\n@pg\n");
    expect(textSegments(events)).toEqual([]);
  });
});
