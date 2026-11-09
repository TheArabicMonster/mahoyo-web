import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { Instruction } from "@/kag/types.js";
import type { RenderEvent } from "@/kag/events.js";
import { reduceStage } from "@/kag/stage-state.js";

/**
 * `@cm` / `@cm4pg` (#86, triage #276) : vidage de la fenêtre de texte.
 *
 * Sémantique : `@cm` (KAG3) vide les calques de message ; `@cm4pg` (tagex.tjs) appelle `cm` puis
 * `originalStoreFlags()` — copie de drapeaux de cache du moteur, sans effet visible. Le port émet
 * donc le même `clearText` explicite (`force: true`) pour les deux, indépendamment du réglage
 * « effacement du texte au changement de page » (#177).
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

/** Exécute la page jusqu'à la fin (les arrêts de ligne/click sont acquittés par les steps). */
function runPage(source: string): RenderEvent[] {
  const runtime = new Runtime(parse(lex(source)));
  const events: RenderEvent[] = [];
  for (let i = 0; i < 50; i++) {
    const step = runtime.step();
    events.push(...step.events);
    if (step.stop.kind === "end") break;
  }
  return events;
}

describe("@cm / @cm4pg — parse", () => {
  it("reconnaît les deux commandes (args ignorés)", () => {
    const [cm, cm4pg] = instructions("*page0|\n@cm\n@cm4pg\n@pg\n");
    expect(cm).toEqual({ kind: "cm" });
    expect(cm4pg).toEqual({ kind: "cm4pg" });
  });
});

describe("@cm / @cm4pg — runtime", () => {
  it("@cm vide le texte avec clearText explicite (force)", () => {
    const events = runPage(`
*page0|
Bonjour.[l]
@cm
@pg
    `);
    const clears = events.filter((event) => event.kind === "clearText");
    // Le premier clearText est celui du début de page (implicite), le second vient de @cm.
    expect(clears.length).toBeGreaterThanOrEqual(2);
    expect(clears[0]?.force).toBeUndefined();
    expect(clears.at(-1)).toEqual({ kind: "clearText", force: true });
  });

  it("@cm4pg est rendu comme @cm (effet visible identique)", () => {
    const events = runPage(`
*page0|
Texte.[l]
@cm4pg
@pg
    `);
    expect(events.at(-1) ?? events.find((event) => event.kind === "clearText" && event.force)).toMatchObject({
      kind: "clearText",
      force: true,
    });
    const clears = events.filter((event) => event.kind === "clearText");
    expect(clears.some((event) => event.force === true)).toBe(true);
  });

  it("le clearText implicite de début de page n'est pas forcé", () => {
    const events = runPage("*page0|\nUn texte.\n@pg\n");
    const clear = findEvent(events, "clearText");
    expect(clear).toEqual({ kind: "clearText" });
    expect(clear?.force).toBeUndefined();
  });
});

describe("@cm/@cm4pg — cohérence textoff/texton", () => {
  it("@cm ne ré-affiche pas la boîte masquée par @textoff et conserve l'état invisible", () => {
    const runtime = new Runtime(parse(lex(`
*page0|
@textoff time=2000
@cm
@pg
    `)));
    const events: RenderEvent[] = [];
    for (let i = 0; i < 10; i++) {
      const step = runtime.step();
      events.push(...step.events);
      if (step.stop.kind === "end") break;
    }
    const textboxes = events.filter((event): event is Extract<RenderEvent, { kind: "textbox" }> => event.kind === "textbox");
    // Un seul textbox : celui de @textoff (invisible). @cm n'en émet aucun.
    expect(textboxes).toHaveLength(1);
    expect(textboxes[0]?.state.visible).toBe(false);
    expect(events.some((event) => event.kind === "clearText" && event.force === true)).toBe(true);
    expect(runtime.getSaveData().state.textbox?.visible).toBe(false);
  });

  it("le texte suivant @textoff+@cm ré-affiche la boîte via revealTextboxForText", () => {
    const events = runPage(`
*page0|
@textoff time=2000
@cm
Texte suivant.[p]
@pg
    `);
    const textIndex = events.findIndex((event) => event.kind === "text");
    const revealIndex = events.findIndex(
      (event) => event.kind === "textbox" && event.state.visible === true,
    );
    expect(textIndex).toBeGreaterThanOrEqual(0);
    expect(revealIndex).toBeGreaterThanOrEqual(0);
    // La réapparition de la boîte précède le texte qui la justifie (#159), avec sa durée de fondu.
    expect(revealIndex).toBeLessThan(textIndex);
    expect(events[revealIndex]).toMatchObject({ kind: "textbox", state: { visible: true }, time: 300 });
  });

  it("@cm4pg avec @texton ultérieur : boîte vidée puis ré-affichée explicitement", () => {
    const runtime = new Runtime(parse(lex(`
*page0|
@textoff time=1000
@cm4pg
@texton
@pg
    `)));
    expect(runtime.step().events.some((event) => event.kind === "clearText" && event.force === true)).toBe(true);
    const save = runtime.getSaveData();
    expect(save.state.textbox?.visible).toBe(true);
  });
});

describe("@cm — état", () => {
  it("vide le texte persisté (reduceStage)", () => {
    const snapshot = reduceStage([
      { kind: "text", segments: [{ text: "Bonjour" }] },
      { kind: "text", segments: [{ text: " monde" }] },
      { kind: "clearText", force: true },
      { kind: "text", segments: [{ text: "Suite" }] },
    ]);
    expect(snapshot.text.map((segment) => ("text" in segment ? segment.text : ""))).toEqual(["Suite"]);
  });
});
