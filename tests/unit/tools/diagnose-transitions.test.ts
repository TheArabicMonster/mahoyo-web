/**
 * Analyse de trace du diagnostic des transitions (#316) : détection des `@trans nowait=1`
 * interrompus par un changement de scène immédiat, et des cuts hors `@trans`.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { analyzeTrace, type TraceRecord } from "../../../tools/diagnose-transitions.js";

const crossfade = { method: "crossfade" as const, time: 1200 };
const none = { method: "none" as const };

function record(partial: Partial<TraceRecord> & Pick<TraceRecord, "kind">): TraceRecord {
  return { step: 0, line: 1, parameters: {}, transition: null, eventKinds: [], ...partial };
}

describe("analyzeTrace (#316)", () => {
  it("détecte un fondu nowait interrompu par un changement de scène immédiat du même pas", () => {
    const { transitions, cuts } = analyzeTrace([
      record({ kind: "trans", line: 10, parameters: { time: 1200, nowait: true }, transition: crossfade, eventKinds: ["scene"] }),
      record({ kind: "bgact", line: 11, parameters: { page: "fore" }, transition: none, eventKinds: ["scene"] }),
    ]);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ line: 10, time: 1200, nowait: true, cutBy: "bgact", durationMs: 1200 });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ line: 11, command: "bgact" });
  });

  it("ne signale pas un fondu bloquant (waitFor) comme interrompu", () => {
    const { transitions, cuts } = analyzeTrace([
      record({ kind: "trans", line: 20, parameters: { time: 1200, nowait: false }, transition: crossfade, eventKinds: ["scene"] }),
      record({ kind: "bgact", step: 1, line: 21, parameters: { page: "fore" }, transition: none, eventKinds: ["scene"] }),
    ]);
    expect(transitions[0]!.cutBy).toBeNull();
    expect(cuts).toHaveLength(1); // le bgact reste un changement de scène immédiat
  });

  it("ne signale pas un changement de scène d'un autre pas comme interruption", () => {
    const { transitions } = analyzeTrace([
      record({ kind: "trans", line: 30, parameters: { time: 200 }, transition: { method: "crossfade", time: 200 } }),
      record({ kind: "bgact", step: 1, line: 31, transition: none }),
    ]);
    expect(transitions[0]!.cutBy).toBeNull();
  });

  it("conserve les paramètres du script (time/rule/nowait) et la durée résolue", () => {
    const { transitions } = analyzeTrace([
      record({ kind: "trans", line: 40, parameters: { time: 600, rule: "crossfade", nowait: false }, transition: { method: "crossfade", time: 600 } }),
      record({ kind: "trans", line: 41, parameters: { nowait: false }, transition: none }),
    ]);
    expect(transitions[0]).toMatchObject({ time: 600, rule: "crossfade", nowait: false, method: "crossfade", durationMs: 600 });
    // @trans sans time = transition « none » immédiate (durée 0), pas un fondu implicite.
    expect(transitions[1]).toMatchObject({ time: 0, method: "none", durationMs: 0 });
  });
});
