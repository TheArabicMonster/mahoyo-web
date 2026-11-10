/**
 * Comparaison alignée par événement (#318) : alignement (commande, n-ième occurrence), deltas de
 * durée, déplacements, événements orphelins et rendu Markdown.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import {
  compareEvents,
  eventsFromAnnotations,
  eventsFromJournal,
  eventsFromSource,
  renderComparisonMarkdown,
  type JournalEvent,
} from "../../../tools/journal-compare-lib.js";
import type { RuntimeJournalEntry } from "@/kag/journal.js";

function event(command: string, occurrence: number, durationMs: number | null, x = 0, y = 0): JournalEvent {
  return {
    command,
    occurrence,
    durationMs,
    effectiveDurationMs: durationMs,
    displacement: { x, y },
    source: "journal",
  };
}

describe("eventsFromAnnotations / eventsFromJournal", () => {
  it("numérote les occurrences par commande quand elles sont omises", () => {
    const events = eventsFromAnnotations([
      { command: "trans", durationMs: 1000 },
      { command: "bg", durationMs: 0 },
      { command: "trans", durationMs: 500 },
    ]);
    expect(events.map((event) => [event.command, event.occurrence])).toEqual([
      ["trans", 1],
      ["bg", 1],
      ["trans", 2],
    ]);
  });

  it("déduit durée effective et position depuis un journal complet", () => {
    const entry = {
      occurrence: 1,
      command: "trans",
      position: { scriptName: "t.ks", page: 0, instruction: 0 },
      params: {},
      page: "fore",
      durationMs: 800,
      speedFactor: 2,
      effectiveDurationMs: 400,
      transition: null,
      fore: { background: "bg", bgLeft: 10, bgTop: 20, layers: [] },
      back: { background: "bg", layers: [] },
    } as unknown as RuntimeJournalEntry;
    const events = eventsFromJournal({ entries: [entry] });
    expect(events[0]).toMatchObject({ command: "trans", occurrence: 1, durationMs: 800, effectiveDurationMs: 400 });
    expect(events[0]!.displacement).toEqual({ x: 10, y: 20 });
  });

  it("refuse une source invalide", () => {
    expect(() => eventsFromSource({ foo: 1 })).toThrow(/source de journal invalide/);
  });
});

describe("compareEvents", () => {
  const left = [
    event("trans", 1, 1200, 0, 0),
    event("trans", 2, 500, 0, 0),
    event("bg", 1, 0, 10, 20),
    event("fg", 1, 300, 100, 100),
  ];
  const right = [
    event("trans", 1, 1000, 0, 0),
    event("bg", 1, 0, 15, 25),
    event("fg", 1, 300, 106, 108),
  ];

  it("aligne sur le n-ième événement de chaque commande et calcule les deltas", () => {
    const comparison = compareEvents(left, right);
    expect(comparison.summary.matched).toBe(3);
    expect(comparison.summary.leftOnly).toBe(1);
    expect(comparison.summary.rightOnly).toBe(0);
    const trans1 = comparison.rows.find((row) => row.command === "trans" && row.occurrence === 1)!;
    expect(trans1.status).toBe("matched");
    expect(trans1.durationDeltaMs).toBe(-200);
    const trans2 = comparison.rows.find((row) => row.command === "trans" && row.occurrence === 2)!;
    expect(trans2.status).toBe("left-only");
    expect(trans2.right).toBeNull();
  });

  it("calcule le déplacement (fond et sprite) et sa borne maximale", () => {
    const comparison = compareEvents(left, right);
    const bg = comparison.rows.find((row) => row.command === "bg")!;
    expect(bg.displacementDelta).toBeCloseTo(Math.hypot(5, 5), 6);
    const fg = comparison.rows.find((row) => row.command === "fg")!;
    expect(fg.displacementDelta).toBeCloseTo(10, 6);
    expect(comparison.summary.maxDisplacementDelta).toBeCloseTo(10, 6);
    expect(comparison.summary.medianAbsEffectiveDurationDeltaMs).toBe(0);
  });

  it("compte les événements orphelins par commande", () => {
    const comparison = compareEvents(left, right);
    expect(comparison.perCommand.trans).toEqual({ matched: 1, leftOnly: 1, rightOnly: 0 });
    expect(comparison.perCommand.bg).toEqual({ matched: 1, leftOnly: 0, rightOnly: 0 });
  });
});

describe("renderComparisonMarkdown", () => {
  it("produit un rapport lisible sans texte du jeu", () => {
    const comparison = compareEvents([event("trans", 1, 1200)], [event("trans", 1, 1000)]);
    const markdown = renderComparisonMarkdown(comparison, {
      left: "port",
      right: "original",
      generatedAt: "2026-11-10T00:00:00.000Z",
    });
    expect(markdown).toContain("# Comparaison de journaux");
    expect(markdown).toContain("| `@trans` | 1 | 1200 | 1000 |");
    expect(markdown).toContain("Aucun texte du jeu n'est reproduit");
  });
});
