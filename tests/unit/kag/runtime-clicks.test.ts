/**
 * Régressions #136 : arrêts sur clic du runtime.
 *
 * - B7 : un texte suivi d'une attente (`@wait`) en dernière instruction de la
 *   page ne doit pas être effacé avant le clic de fin de page.
 * - B8 : une pause `[l]` qui n'a rien de nouveau à faire lire (aucun texte ni
 *   contenu visible depuis le dernier clic) ne doit pas bloquer le joueur.
 *
 * Les scripts ci-dessous sont inventés (texte bidon).
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent, StopReason } from "@/kag/events.js";

type Trace = { stop: StopReason; events: readonly RenderEvent[] }[];

/** Joue un script en franchissant chaque arrêt, et renvoie la trace des steps. */
function play(source: string): Trace {
  const runtime = new Runtime(parse(lex(source)), "test.ks");
  runtime.onWarning = () => {};
  const trace: Trace = [];
  for (let i = 0; i < 100; i++) {
    const step = runtime.step();
    trace.push({ stop: step.stop, events: step.events });
    if (step.stop.kind === "end") break;
  }
  return trace;
}

const clicks = (trace: Trace, style?: "line" | "page") =>
  trace.filter((s) => s.stop.kind === "click" && (!style || s.stop.style === style)).length;

/** Vrai si un clearText est émis alors que du texte n'a pas encore été acquitté par un clic. */
function clearsUnreadText(trace: Trace): boolean {
  let unread = false;
  for (const { stop, events } of trace) {
    for (const ev of events) {
      if (ev.kind === "clearText" && unread) return true;
      if (ev.kind === "text") unread = true;
    }
    if (stop.kind === "click") unread = false;
  }
  return false;
}

describe("B7 : texte suivi d'une attente en fin de page", () => {
  it("attend un clic avant d'effacer le texte (@wait en dernière instruction)", () => {
    const trace = play(`
Texte bidon A.
@wait time=100
@pg
Texte bidon B.[p]
`);
    expect(clearsUnreadText(trace)).toBe(false);
    // Le texte A est suivi de l'attente, puis d'un clic de fin de page.
    expect(trace[0].stop.kind).toBe("wait");
    expect(trace[1].stop).toEqual({ kind: "click", style: "page" });
    expect(trace[1].events.some((e) => e.kind === "clearText")).toBe(false);
    // L'effacement n'a lieu qu'au step suivant, avec le texte B.
    expect(trace[2].events.some((e) => e.kind === "clearText")).toBe(true);
  });

  it("garde le comportement sans attente : un clic de page suffit", () => {
    const trace = play(`
Texte bidon A.
@pg
Texte bidon B.
@pg
`);
    expect(clearsUnreadText(trace)).toBe(false);
    expect(clicks(trace, "page")).toBe(2);
  });

  it("n'ajoute pas de clic quand l'attente n'est pas la dernière instruction", () => {
    const trace = play(`
Texte bidon A.
@wait time=100
Texte bidon B.
@pg
`);
    expect(clearsUnreadText(trace)).toBe(false);
    expect(clicks(trace)).toBe(1);
  });
});

describe("B8 : pauses [l] sans rien à lire", () => {
  it("ignore un [l] qui ne suit que des commandes audio", () => {
    const trace = play(`
Texte bidon A.[l]
@sestop
@se storage=bruit
[l]
Texte bidon B.[p]
`);
    // [l] après le texte A, puis [p] après le texte B : le [l] audio-seul est sauté.
    expect(clicks(trace, "line")).toBe(1);
    expect(clicks(trace, "page")).toBe(1);
  });

  it("ignore aussi ce [l] dans une branche @if", () => {
    const trace = play(`
Texte bidon A.[l]
@if exp="1"
@sestop
@se storage=bruit
[l]
@endif
Texte bidon B.[p]
`);
    expect(clicks(trace, "line")).toBe(1);
    expect(clicks(trace, "page")).toBe(1);
  });

  it("conserve un [l] qui suit du texte, même séparé par de l'audio", () => {
    const trace = play(`
Texte bidon A.
@sestop
@se storage=bruit
[l]
Texte bidon B.[p]
`);
    expect(clicks(trace, "line")).toBe(1);
    expect(clicks(trace, "page")).toBe(1);
  });

  it("conserve un [l] posé après un changement d'image (attente voulue)", () => {
    const trace = play(`
@bg storage=fond_bidon time=0 page=fore
[l]
Texte bidon.[p]
`);
    expect(clicks(trace, "line")).toBe(1);
  });

  it("conserve un [l] posé après du texte et une attente", () => {
    const trace = play(`
Texte bidon A.
@wait time=100
[l]
Texte bidon B.[p]
`);
    expect(clicks(trace, "line")).toBe(1);
  });

  it("ne touche pas aux clics de page [p]", () => {
    const trace = play(`
@sestop
@se storage=bruit
@pg
Texte bidon.[p]
`);
    expect(clicks(trace, "page")).toBe(2);
  });
});
