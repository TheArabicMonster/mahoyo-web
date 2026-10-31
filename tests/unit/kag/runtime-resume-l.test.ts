/**
 * Régression #142 : reprise après un `[l]` quand le texte est la première
 * instruction de la page.
 *
 * Dans ce cas `instructionIndex` vaut encore 0 à la reprise, et `step()`
 * ré-émettait `clearText` : la ligne déjà lue était effacée au milieu de la page.
 *
 * Les scripts ci-dessous sont inventés (texte bidon).
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent, StopReason } from "@/kag/events.js";

type Trace = { stop: StopReason; events: readonly RenderEvent[] }[];

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

const clearCount = (events: readonly RenderEvent[]) =>
  events.filter((e) => e.kind === "clearText").length;

describe("#142 : reprise d'un [l] en première instruction de page", () => {
  it("n'émet clearText qu'une fois par page (texte seul, deux [l])", () => {
    const trace = play(`Ligne bidon A.[l]Ligne bidon B.[l]Ligne bidon C.[p]\n`);
    expect(trace[0].stop).toEqual({ kind: "click", style: "line" });
    expect(clearCount(trace[0].events)).toBe(1);
    // Les reprises après [l] ne doivent rien effacer.
    expect(clearCount(trace[1].events)).toBe(0);
    expect(clearCount(trace[2].events)).toBe(0);
  });

  it("efface bien au début de la page suivante", () => {
    const trace = play(`Ligne bidon A.[l]Ligne bidon B.[p]\nLigne bidon C.[p]\n`);
    const pageClicks = trace.map((t, i) => [t, i] as const).filter(([t]) => t.stop.kind === "click" && t.stop.style === "page");
    expect(pageClicks.length).toBe(2);
    const firstPageEnd = pageClicks[0][1];
    // Pas d'effacement entre le [l] et la fin de la première page.
    for (let i = 1; i <= firstPageEnd; i++) expect(clearCount(trace[i].events)).toBe(0);
    // La page suivante efface.
    expect(clearCount(trace[firstPageEnd + 1].events)).toBe(1);
  });

  it("ne change rien quand le texte n'est pas la première instruction", () => {
    const trace = play(`@sestop\nLigne bidon A.[l]Ligne bidon B.[p]\n`);
    expect(clearCount(trace[0].events)).toBe(1);
    expect(clearCount(trace[1].events)).toBe(0);
  });
});
