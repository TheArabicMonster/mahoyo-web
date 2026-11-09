/**
 * Tests de régression pour les bugs identifiés par la review Opus 5.5.
 *
 * Bug 1: processText mute instruction.segments
 * Bug 2: @jump storage=x.ks perd la cible
 * Bug 3: Retour de @call saute la page
 * Bug 4: loadSaveData vide la callStack, getSaveData oublie effect/staffroll
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent } from "@/kag/events.js";

function textOf(events: readonly RenderEvent[]): string {
  return events
    .filter((e): e is Extract<RenderEvent, { kind: "text" }> => e.kind === "text")
    .flatMap((e) => e.segments)
    .filter((s): s is { text: string } => "text" in s && typeof s.text === "string")
    .map((s) => s.text)
    .join("");
}

// ──────────────────────────────────────────────────────────────────
// Bug 1: processText ne doit pas muter instruction.segments
// ──────────────────────────────────────────────────────────────────
describe("Bug 1: processText immutabilité", () => {
  it("préserve instruction.segments après step (re-lecture du même script)", () => {
    const SCRIPT = `
*page0|
Ligne A.[l]
Ligne B.
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const firstInstr = parsed.pages[0].instructions[0];
    if (firstInstr.kind !== "text") throw new Error("expected text instruction");
    const originalSegments = [...firstInstr.segments];

    const runtime = new Runtime(parsed);

    // First step: stops at [l], should emit "Ligne A."
    const step1 = runtime.step();
    expect(step1.stop.kind).toBe("click");
    expect(textOf(step1.events)).toContain("Ligne A.");

    // Second step: consumes remaining text, stops at page end
    const step2 = runtime.step();
    expect(textOf(step2.events)).toContain("Ligne B.");

    // Verify the original instruction was NOT mutated
    if (firstInstr.kind !== "text") throw new Error("expected text instruction");
    expect(firstInstr.segments).toEqual(originalSegments);
    expect(firstInstr.segments).toHaveLength(originalSegments.length);
  });

  it("permet de rejouer le script avec un nouveau runtime", () => {
    const SCRIPT = `
*page0|
Texte 1.[l]
Texte 2.
@pg
`;
    const parsed = parse(lex(SCRIPT));

    // First playthrough
    const runtime1 = new Runtime(parsed);
    const s1 = runtime1.step();
    const s2 = runtime1.step();
    expect(textOf(s1.events)).toContain("Texte 1.");
    expect(textOf(s2.events)).toContain("Texte 2.");

    // Second playthrough with a fresh runtime using the SAME parsed script
    const runtime2 = new Runtime(parsed);
    const s1b = runtime2.step();
    const s2b = runtime2.step();
    expect(textOf(s1b.events)).toContain("Texte 1.");
    expect(textOf(s2b.events)).toContain("Texte 2.");
  });

  it("gère les pauses multiples [l] dans une même instruction texte", () => {
    const SCRIPT = `
*page0|
A.[l]B.[l]C.
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    const step1 = runtime.step();
    expect(textOf(step1.events)).toBe("A.");

    const step2 = runtime.step();
    expect(textOf(step2.events)).toBe("B.");

    const step3 = runtime.step();
    expect(textOf(step3.events)).toBe("C.");
  });
});

// ──────────────────────────────────────────────────────────────────
// Bug 2: @jump storage=x.ks doit émettre loadScript
// ──────────────────────────────────────────────────────────────────
describe("Bug 2: @jump storage inter-script", () => {
  it("@jump storage=other.ks émet loadScript sans pushCallStack", () => {
    const MAIN = `
*page0|
Texte main.[l]
@jump storage=other.ks
@pg
`;
    const OTHER = `
*page0|
Texte other.
@pg
`;
    const mainScript = parse(lex(MAIN));
    const otherScript = parse(lex(OTHER));
    const runtime = new Runtime(mainScript, "main.ks");
    runtime.scriptLoader = async (s) => (s === "other.ks" ? otherScript : null);

    // Step 1: text up to [l]
    const step1 = runtime.step();
    expect(step1.stop.kind).toBe("click");
    expect(textOf(step1.events)).toContain("Texte main.");

    // Step 2: @jump triggers loadScript
    const step2 = runtime.step();
    expect(step2.stop.kind).toBe("loadScript");
    if (step2.stop.kind !== "loadScript") throw new Error("unexpected");
    expect(step2.stop.file).toBe("other.ks");
    expect(step2.stop.pushCallStack).toBe(false);
  });

  it("@jump target=*label reste intra-script", () => {
    const SCRIPT = `
*page0|
Texte A.
@pg
*page1|
Texte B.
@pg
*target_page|
Texte C.
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    runtime.jump("target_page");

    const step = runtime.step();
    expect(textOf(step.events)).toContain("Texte C.");
  });

  it("@jump storage=other.ks target=*label charge et saute au label", async () => {
    const MAIN = `
*page0|
Main.[l]
@jump storage=other.ks target=*skip
@pg
`;
    const OTHER = `
*page0|
À sauter.
@pg
*skip|
Sauté ici.
@pg
`;
    const mainScript = parse(lex(MAIN));
    const otherScript = parse(lex(OTHER));
    const runtime = new Runtime(mainScript, "main.ks");
    runtime.scriptLoader = async (s) => (s === "other.ks" ? otherScript : null);

    // Step 1: text up to [l]
    const step1 = runtime.step();
    expect(step1.stop.kind).toBe("click");
    expect(textOf(step1.events)).toContain("Main.");

    // Step 2: @jump triggers loadScript
    const step2 = runtime.step();
    expect(step2.stop.kind).toBe("loadScript");
    if (step2.stop.kind !== "loadScript") throw new Error("unexpected");
    expect(step2.stop.file).toBe("other.ks");
    expect(step2.stop.label).toBe("skip");
    expect(step2.stop.pushCallStack).toBe(false);

    // Execute the jump
    const ok = await runtime.loadScript(step2.stop.file, step2.stop.label, step2.stop.pushCallStack !== false);
    expect(ok).toBe(true);

    // Should land at the *skip label, NOT the beginning of other.ks
    const step3 = runtime.step();
    expect(textOf(step3.events)).toContain("Sauté ici.");
    expect(textOf(step3.events)).not.toContain("À sauter");
  });
});

// ──────────────────────────────────────────────────────────────────
// Bug 3: Retour de @call reprend à l'instruction suivante, pas page suivante
// ──────────────────────────────────────────────────────────────────
describe("Bug 3: retour @call reprend correctement", () => {
  it("ne saute pas les instructions après @call (même page)", async () => {
    const MAIN = `
*page0|
Avant appel.[l]
@call target=*sub
Après appel.
@pg
*sub|
Dans le sub.
@return
`;
    const parsed = parse(lex(MAIN));
    const runtime = new Runtime(parsed, "main.ks");

    // Step 1: text up to [l]
    const step1 = runtime.step();
    expect(textOf(step1.events)).toContain("Avant appel.");

    // Step 2: @call *sub (intra-script), then text in sub, then @return, then "Après appel."
    const step2 = runtime.step();
    const allText = textOf(step2.events);
    expect(allText).toContain("Dans le sub.");
    expect(allText).toContain("Après appel.");
  });

  it("ne saute pas les instructions après @call storage (inter-script)", async () => {
    const MAIN = `
*page0|
Avant.[l]
@call storage=sub.ks
Après l'appel inter-script.
@pg
`;
    const SUB = `
*page0|
Dans sub.
@return
`;
    const mainScript = parse(lex(MAIN));
    const subScript = parse(lex(SUB));
    const runtime = new Runtime(mainScript, "main.ks");
    runtime.scriptLoader = async (s) => (s === "sub.ks" ? subScript : null);

    const step1 = runtime.step();
    expect(textOf(step1.events)).toContain("Avant.");

    const step2 = runtime.step();
    expect(step2.stop.kind).toBe("loadScript");
    if (step2.stop.kind !== "loadScript") throw new Error("unexpected");
    expect(step2.stop.pushCallStack).toBe(true);

    const ok = await runtime.loadScript("sub.ks");
    expect(ok).toBe(true);

    // Step 3: should contain sub text + "Après l'appel inter-script."
    const step3 = runtime.step();
    const allText = textOf(step3.events);
    expect(allText).toContain("Dans sub.");
    expect(allText).toContain("Après l'appel inter-script.");
  });

  it("gère plusieurs @call imbriqués", async () => {
    const MAIN = `
*page0|
Main.[l]
@call storage=a.ks
Fin main.
@pg
`;
    const A = `
*page0|
Dans A.[l]
@call storage=b.ks
Après B.
@pg
@return
`;
    const B = `
*page0|
Dans B.
@return
`;
    const mainScript = parse(lex(MAIN));
    const aScript = parse(lex(A));
    const bScript = parse(lex(B));
    const runtime = new Runtime(mainScript, "main.ks");
    runtime.scriptLoader = async (s) => {
      if (s === "a.ks") return aScript;
      if (s === "b.ks") return bScript;
      return null;
    };

    runtime.step(); // "Main." → [l]

    // @call a.ks
    const callA = runtime.step();
    expect(callA.stop.kind).toBe("loadScript");
    await runtime.loadScript("a.ks");

    // "Dans A." → [l]
    const inA = runtime.step();
    expect(textOf(inA.events)).toContain("Dans A.");

    // @call b.ks
    const callB = runtime.step();
    expect(callB.stop.kind).toBe("loadScript");
    await runtime.loadScript("b.ks");

    // Should contain "Dans B." + "Après B." (return from B, continue in A)
    const stepBack = runtime.step();
    const textBack = textOf(stepBack.events);
    expect(textBack).toContain("Dans B.");
    expect(textBack).toContain("Après B.");

    // Then @return from A, continue in main: "Fin main."
    const stepMain = runtime.step();
    const textMain = textOf(stepMain.events);
    expect(textMain).toContain("Fin main.");
  });
});

// ──────────────────────────────────────────────────────────────────
// Bug 4: save/load préserve callStack, effect, staffroll
// ──────────────────────────────────────────────────────────────────
describe("Bug 4: save/load préserve l'état complet", () => {
  it("getSaveData inclut effect", () => {
    const SCRIPT = `
*page0|
@haze power=10 delta=5 omega=3
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    runtime.step(); // Process the haze effect

    const save = runtime.getSaveData();
    expect(save.state.effect).not.toBeNull();
    expect(save.state.effect?.kind).toBe("haze");
    if (save.state.effect?.kind === "haze") {
      expect(save.state.effect.power).toBe(10);
    }
  });

  it("getSaveData inclut staffroll", () => {
    const SCRIPT = `
*page0|
@staffrollinit
@staffrolltext text="Staff line" y=100 size=20
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    runtime.step();

    const save = runtime.getSaveData();
    expect(save.state.staffroll).toBeDefined();
    expect(save.state.staffroll?.lines.length).toBeGreaterThan(0);
    expect(save.state.staffroll?.lines[0]?.text).toBe("Staff line");
  });

  it("loadSaveData restaure la callStack (save dans un script appelé)", async () => {
    const MAIN = `
*page0|
Main.[l]
@call storage=sub.ks
Fin.
@pg
`;
    const SUB = `
*page0|
Dans sub.[l]
@return
`;
    const mainScript = parse(lex(MAIN));
    const subScript = parse(lex(SUB));
    const runtime = new Runtime(mainScript, "main.ks");
    runtime.scriptLoader = async (s) => (s === "sub.ks" ? subScript : null);

    runtime.step(); // "Main." → [l]
    const callStep = runtime.step(); // @call storage=sub.ks
    expect(callStep.stop.kind).toBe("loadScript");
    await runtime.loadScript("sub.ks");

    runtime.step(); // "Dans sub." → [l]

    // Now we're inside sub.ks, callStack should have main.ks
    const save = runtime.getSaveData();
    expect(save.scriptName).toBe("sub.ks");
    expect(save.callStack).toHaveLength(1);
    expect(save.callStack[0]?.scriptName).toBe("main.ks");

    // Load into a new runtime
    const scripts = new Map([
      ["main.ks", mainScript],
      ["sub.ks", subScript],
    ]);
    const restored = new Runtime(mainScript, "main.ks");
    const ok = await restored.loadSaveData(save, scripts);
    expect(ok).toBe(true);

    // The restored runtime should be in sub.ks with the callStack pointing to main.ks
    expect(restored.currentScriptName).toBe("sub.ks");

    // When sub finishes, it should return to main.ks
    // (We can't easily test the full flow without more steps, but the callStack is restored)
    const restoredSave = restored.getSaveData();
    expect(restoredSave.callStack).toHaveLength(1);
    expect(restoredSave.callStack[0]?.scriptName).toBe("main.ks");
  });

  it("loadSaveData restaure effect", async () => {
    const SCRIPT = `
*page0|
@haze power=15 delta=8 omega=4
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);
    runtime.step();

    const save = runtime.getSaveData();

    const restored = new Runtime(parsed);
    const ok = await restored.loadSaveData(save, new Map([["main", parsed]]));
    expect(ok).toBe(true);

    const restoredSave = restored.getSaveData();
    expect(restoredSave.state.effect?.kind).toBe("haze");
    if (restoredSave.state.effect?.kind === "haze") {
      expect(restoredSave.state.effect.power).toBe(15);
      expect(restoredSave.state.effect.delta).toBe(8);
    }
  });

  it("segmentIndex est sérialisé et restauré", async () => {
    const SCRIPT = `
*page0|
A.[l]B.[l]C.
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    runtime.step(); // "A." → [l]
    // Now segmentIndex should point to the segment after first [l]

    const save = runtime.getSaveData();
    expect(save.segmentIndex).toBeGreaterThan(0);

    const restored = new Runtime(parsed);
    const ok = await restored.loadSaveData(save, new Map([["main", parsed]]));
    expect(ok).toBe(true);

    // The restored runtime should continue from where we left off
    const step = restored.step();
    expect(textOf(step.events)).toContain("B.");
  });
});
