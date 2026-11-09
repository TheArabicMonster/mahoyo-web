// Registre des approximations (#295) — tests figés :
// approx:focusline-canvas — rendu canvas approximé (tests @focusline ci-dessous).
// approx:shake-fullscreen — secousse approximée à l'écran entier (tests @shake/@swing ci-dessous).
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { Instruction } from "@/kag/types.js";
import type { RenderEvent } from "@/kag/events.js";

/**
 * Effets d'écran plugin (#281, triage #276) : `@shake`, `@swing`, `@stopswing`, `@noiseact`,
 * `@focusline`, `@stopfocusline`, `@clearfocusline`.
 *
 * Sources de la sémantique (non commitées) : `data/override/tagex.tjs` (`.shake`, `.swing`,
 * `.stopswing`, `shakePropInfo`, `swingPropInfo`), `data/scenario/noiseplugin.tjs`
 * (`kt.noiseact`), `data/scenario/focuslineplugin.tjs` (handlers `focusline*`) ; args réels
 * relevés dans les scripts (`8.5.ks`, `1.5-4.ks`, `wik_x-2.ks`, `wik_q-a.ks`, `call.ks`).
 */

function instructions(source: string): Instruction[] {
  const script = parse(lex(source));
  return script.pages.flatMap((page) => page.instructions);
}

function findEvent<T extends RenderEvent["kind"]>(
  events: readonly RenderEvent[],
  kind: T,
): Extract<RenderEvent, { kind: T }> | undefined {
  return events.find((event): event is Extract<RenderEvent, { kind: T }> => event.kind === kind);
}

/** Exécute le runtime jusqu'à la fin de la page (ou 50 steps). */
function runPage(source: string): RenderEvent[] {
  const runtime = new Runtime(parse(lex(source)));
  const events: RenderEvent[] = [];
  for (let i = 0; i < 50; i++) {
    const step = runtime.step();
    events.push(...step.events);
    if (step.stop.kind === "end" || step.stop.kind === "click") break;
  }
  return events;
}

describe("@shake — parse et runtime", () => {
  it("parse les paramètres réels (vmax, hmax, cycle, time) avec les défauts du moteur", () => {
    const [shake, shakeDefaults] = instructions(`
*page0|
@shake vmax=1 time=3000 storage=有珠制服04b(近)|c cycle=150
@shake
@pg
    `);
    expect(shake).toEqual({ kind: "shake", vmax: 1, hmax: 0, cycle: 150, time: 3000 });
    // Défauts de `shakePropInfo` : vmax=10, hmax=0, cycle=300, time absent (= continu).
    expect(shakeDefaults).toEqual({ kind: "shake", vmax: 10, hmax: 0, cycle: 300 });
  });

  it("émet un événement screenShake sinusoïdal (approximation écran entier)", () => {
    const events = runPage(`
*page0|
@shake vmax=2 hmax=1 cycle=100 time=500
@pg
    `);
    const shake = findEvent(events, "screenShake");
    expect(shake?.shake).toEqual({ mode: "shake", vmax: 2, hmax: 1, cycle: 100, time: 500 });
  });
});

describe("@swing / @stopswing — parse et runtime", () => {
  it("parse les paramètres (défauts swingPropInfo) et la secousse réelle de nz3.ks", () => {
    const [corpus, custom] = instructions(`
*page0|
@swing storage=im18ハンプティ vmax=10 hmax=10 cycle=300 nowait=1
@swing page=back minCycle=150 maxCycle=1000 minVibration=0 maxVibration=1 rate=2
@pg
    `);
    // `vmax`/`hmax`/`cycle` ne sont pas des paramètres de swing : ignorés, défauts du moteur.
    expect(corpus).toEqual({
      kind: "swing",
      minCycle: 1000,
      maxCycle: 2000,
      minVibration: 5,
      maxVibration: 10,
      rate: 1,
    });
    expect(custom).toEqual({
      kind: "swing",
      minCycle: 150,
      maxCycle: 1000,
      minVibration: 0,
      maxVibration: 1,
      rate: 2,
    });
  });

  it("émet screenShake puis l'arrêt (null) sur @stopswing", () => {
    const events = runPage(`
*page0|
@swing page=back minCycle=150 maxCycle=1000 minVibration=0 maxVibration=1
@stopswing
@pg
    `);
    const shakes = events.filter((event) => event.kind === "screenShake");
    expect(shakes).toHaveLength(2);
    expect(shakes[0]).toMatchObject({ kind: "screenShake", shake: { mode: "swing", time: null } });
    expect(shakes[1]).toEqual({ kind: "screenShake", shake: null });
  });
});

describe("@noiseact — parse et runtime", () => {
  const REAL_NOISEACT =
    "@noiseact targetpage=back props=-monocro,absolute,opacity,-status,-visible " +
    "keys=(0,0,l,0,1900,50,play,1)(500,,n,,,,,)";

  it("parse l'exemple réel de wik_x-2.ks (props discrètes + continues, carry)", () => {
    const [instruction] = instructions(`*page0|\n${REAL_NOISEACT}\n@pg\n`);
    expect(instruction?.kind).toBe("noiseact");
    if (instruction?.kind !== "noiseact") return;
    expect(instruction.keyframes).toHaveLength(2);
    expect(instruction.keyframes[0]).toEqual({
      time: 0,
      duration: 0,
      interp: "l",
      opacity: 50,
      monocro: false,
      visible: true,
      status: "play",
      absolute: 1900,
    });
    // 2e keyframe : cellules vides → carry complet, interp "n" (palier).
    expect(instruction.keyframes[1]).toEqual({
      time: 500,
      duration: 500,
      interp: "n",
      opacity: 50,
      monocro: false,
      visible: true,
      status: "play",
      absolute: 1900,
    });
  });

  it("émet noiseAct instantané quand l'opacité n'a qu'une valeur (corpus réel)", () => {
    const events = runPage(`*page0|\n${REAL_NOISEACT}\n@pg\n`);
    const noiseAct = findEvent(events, "noiseAct");
    expect(noiseAct).toBeDefined();
    expect(noiseAct).toMatchObject({ kind: "noiseAct", opacity: 50, monocro: false, from: 0, time: 0 });
  });

  it("anime l'opacité quand plusieurs keyframes la définissent", () => {
    const events = runPage(`
*page0|
@noiseact props=opacity keys=(0,0,l,0)(800,,l,128)
@pg
    `);
    expect(findEvent(events, "noiseAct")).toMatchObject({ opacity: 128, from: 0, time: 800 });
  });

  it("status=stop ou visible=0 retire le bruit", () => {
    const stop = runPage(`*page0|
@noiseact props=-status keys=(0,0,l,stop)
@pg
    `);
    expect(findEvent(stop, "effect")).toEqual({ kind: "effect", effect: null });
    const hidden = runPage(`*page0|
@noiseact props=-visible keys=(0,0,l,0)
@pg
    `);
    expect(findEvent(hidden, "effect")).toEqual({ kind: "effect", effect: null });
  });
});

describe("@focusline / @stopfocusline / @clearfocusline — parse et runtime", () => {
  it("parse l'exemple réel de wik_q-a.ks (couleur décimale, bornes ordonnées, opacité 0..1)", () => {
    const [instruction] = instructions(`*page0|
@focusline cmin=421 cmax=200 emax=1800 color=16777215 opacity=80 interval=80 status=play page=back
@pg
    `);
    expect(instruction).toEqual({
      kind: "focusline",
      cx: 512,
      cy: 288,
      minLength: 200,
      maxLength: 421,
      minLines: 25,
      maxLines: 50,
      appear: 2000, // emax=1800, emin par défaut 2000 → max
      color: "#ffffff",
      opacity: 80 / 255,
      status: "play",
    });
  });

  it("émet un effet focusline persistant, puis stop/clear retirent l'effet", () => {
    const start = runPage(`
*page0|
@focusline cmin=200 cmax=421 emax=1800 color=16777215 opacity=80 status=play
@pg
    `);
    const effect = findEvent(start, "effect");
    expect(effect?.effect?.kind).toBe("focusline");
    if (effect?.effect?.kind !== "focusline") return;
    expect(effect.effect).toMatchObject({ cx: 512, cy: 288, minLength: 200, maxLength: 421, opacity: 80 / 255 });
    expect(effect.effect.appear).toBe(2000);

    const runtime = new Runtime(parse(lex(`*page0|
@focusline status=play
@stopfocusline
@clearfocusline
@pg
    `)));
    const events: RenderEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const step = runtime.step();
      events.push(...step.events);
      if (step.stop.kind === "end" || step.stop.kind === "click") break;
    }
    const effectEvents = events.filter((event) => event.kind === "effect");
    expect(effectEvents[0]).toMatchObject({ kind: "effect", effect: { kind: "focusline" } });
    expect(effectEvents.at(-1)).toEqual({ kind: "effect", effect: null });
  });
});
