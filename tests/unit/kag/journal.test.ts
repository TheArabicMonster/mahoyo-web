/**
 * Journal d'exécution (#318) : entrées produites par le runtime quand `onJournal` est défini,
 * avec paramètres, état résolu, durées déclarée/effective et keyframes normalisés.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RuntimeJournalEntry } from "@/kag/journal.js";

const SCRIPT = `
*page0|
@bg page=back storage=bgA time=0
@trans time=300 rule=crossfade
@bgact page=fore props=-storage,left,top keys=(0,0,l,bgA,0,0)(1000,1,,,100,50) storage=bgA
@fg page=fore storage=perso center=500 vcenter=300 index=1600 time=200 id=p1
@pg
`;

function capture(speedFactor = 1): RuntimeJournalEntry[] {
  const entries: RuntimeJournalEntry[] = [];
  const runtime = new Runtime(parse(lex(SCRIPT)), "t.ks");
  runtime.onJournal = (entry) => entries.push(entry);
  runtime.journalSpeedFactor = speedFactor;
  for (let i = 0; i < 10; i++) {
    const step = runtime.step();
    if (step.stop.kind === "end" || step.stop.kind === "click") break;
  }
  return entries;
}

describe("Runtime — journal d'exécution (#318)", () => {
  it("n'émet rien sans callback (aucun surcoût en production)", () => {
    const runtime = new Runtime(parse(lex(SCRIPT)), "t.ks");
    for (let i = 0; i < 10; i++) {
      const step = runtime.step();
      if (step.stop.kind === "end" || step.stop.kind === "click") break;
    }
    expect(runtime.onJournal).toBeNull();
  });

  it("journalise les commandes visuelles avec occurrence et paramètres du script", () => {
    const entries = capture();
    const commands = entries.map((entry) => entry.command);
    expect(commands).toContain("bg");
    expect(commands).toContain("trans");
    expect(commands).toContain("bgact");
    expect(commands).toContain("fg");
    const trans = entries.find((entry) => entry.command === "trans")!;
    expect(trans.occurrence).toBe(1);
    expect(trans.params).toMatchObject({ rule: "crossfade", time: 300 });
    expect(trans.durationMs).toBe(300);
    expect(trans.transition).toMatchObject({ method: "crossfade", time: 300 });
    const fg = entries.find((entry) => entry.command === "fg")!;
    expect(fg.params).toMatchObject({ storage: "perso", center: 500, vcenter: 300, id: "p1" });
    expect(fg.durationMs).toBe(200);
    expect(fg.page).toBe("fore");
  });

  it("applique le facteur de vitesse à la durée effective (journal seulement)", () => {
    const entries = capture(2.5);
    const trans = entries.find((entry) => entry.command === "trans")!;
    expect(trans.durationMs).toBe(300);
    expect(trans.speedFactor).toBe(2.5);
    expect(trans.effectiveDurationMs).toBe(120);
  });

  it("normalise les keyframes de @bgact (temps absolus + propriétés)", () => {
    const entries = capture();
    const bgact = entries.find((entry) => entry.command === "bgact")!;
    expect(bgact.keyframes).toBeDefined();
    expect(bgact.keyframes!.map((frame) => frame.time)).toEqual([0, 1000]);
    expect(bgact.keyframes![1]!.props).toMatchObject({ left: 100, top: 50 });
    expect(bgact.durationMs).toBe(1000);
  });

  it("joint l'état résolu fore/back après chaque commande", () => {
    const entries = capture();
    const trans = entries.find((entry) => entry.command === "trans")!;
    expect(trans.fore.background).toBe("bga");
    expect(trans.back.background).toBe("bga");
    const fg = entries.find((entry) => entry.command === "fg")!;
    expect(fg.fore.layers.find((layer) => layer.id === "p1")).toMatchObject({ storage: "perso", x: 500, y: 300 });
  });
});
