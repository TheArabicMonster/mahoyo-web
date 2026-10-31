/**
 * @lockquickmenu / @unlockquickmenu (menu rapide) et @pauseautomode / @resumeautomode (mode auto).
 * Tous les scripts de ce fichier sont inventés.
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent, Step } from "@/kag/events.js";
import type { Instruction } from "@/kag/types.js";

function firstInstruction(src: string): Instruction {
  const ins = parse(lex(src)).pages[0]?.instructions[0];
  if (!ins) throw new Error("aucune instruction");
  return ins;
}

function makeRuntime(src: string, warnings: string[] = []): Runtime {
  const runtime = new Runtime(parse(lex(src)), "test.ks");
  runtime.onWarning = (m) => warnings.push(m);
  return runtime;
}

/** Exécute jusqu'à la fin et renvoie tous les pas. */
function runAll(runtime: Runtime): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < 50; i++) {
    const step = runtime.step();
    steps.push(step);
    if (step.stop.kind === "end") break;
  }
  return steps;
}

const gates = (steps: readonly Step[]) =>
  steps.flatMap((s) => s.events).filter((e): e is Extract<RenderEvent, { kind: "quickMenu" | "autoMode" }> =>
    e.kind === "quickMenu" || e.kind === "autoMode",
  );

describe("parse des commandes de menu rapide et d'auto", () => {
  it.each([
    ["@lockquickmenu", "lockquickmenu"],
    ["@unlockquickmenu", "unlockquickmenu"],
    ["@pauseautomode", "pauseautomode"],
    ["@resumeautomode", "resumeautomode"],
  ])("%s est reconnue (plus de commande brute)", (src, kind) => {
    expect(firstInstruction(src)).toEqual({ kind });
  });
});

describe("Runtime — menu rapide", () => {
  it("@lockquickmenu verrouille, @unlockquickmenu déverrouille, avec un événement chacun", () => {
    const runtime = makeRuntime("@lockquickmenu\nbonjour[p]\n@unlockquickmenu\nsuite[p]\n");
    expect(runtime.quickMenuLocked).toBe(false);

    const first = runtime.step();
    expect(first.events).toContainEqual({ kind: "quickMenu", locked: true });
    expect(runtime.quickMenuLocked).toBe(true);

    const second = runtime.step();
    expect(second.events).toContainEqual({ kind: "quickMenu", locked: false });
    expect(runtime.quickMenuLocked).toBe(false);
  });

  it("n'émet aucun avertissement : la commande est connue", () => {
    const warnings: string[] = [];
    runAll(makeRuntime("@lockquickmenu\n@pauseautomode\n@resumeautomode\nfin[p]\n", warnings));
    expect(warnings.filter((w) => w.includes("non gérée"))).toEqual([]);
  });

  it("le verrou est levé à la fin du script qui l'a posé", () => {
    const runtime = makeRuntime("@lockquickmenu\nbonjour[p]\n");
    const steps = runAll(runtime);
    const last = steps.at(-1)!;
    expect(last.stop.kind).toBe("end");
    expect(last.events).toContainEqual({ kind: "quickMenu", locked: false });
    expect(runtime.quickMenuLocked).toBe(false);
  });

  it("un @return sans appelant termine aussi le script et lève le verrou", () => {
    const runtime = makeRuntime("@lockquickmenu\nbonjour[p]\n@return\napres[p]\n");
    const steps = runAll(runtime);
    expect(steps.at(-1)!.stop.kind).toBe("end");
    expect(runtime.quickMenuLocked).toBe(false);
  });

  it("un script sans verrou n'émet aucun événement de fin superflu", () => {
    const steps = runAll(makeRuntime("bonjour[p]\n"));
    expect(gates(steps)).toEqual([]);
  });

  it("le verrou n'est pas un contenu à lire : il ne crée pas de pause [l] à attendre", () => {
    // Un [l] qui ne suit que ces commandes est « mort » (comme pour l'audio) : le joueur
    // ne doit pas avoir à cliquer pour rien.
    const runtime = makeRuntime("Texte bidon A.[l]\n@lockquickmenu\n@pauseautomode\n[l]\nTexte bidon B.[p]\n");
    const steps = runAll(runtime);
    const clicks = steps.filter((s) => s.stop.kind === "click");
    expect(clicks.map((s) => (s.stop.kind === "click" ? s.stop.style : ""))).toEqual(["line", "page"]);
    expect(gates(steps).map((g) => g.kind)).toContain("quickMenu");
  });
});

describe("Runtime — mode auto", () => {
  it("@pauseautomode suspend, @resumeautomode reprend", () => {
    const runtime = makeRuntime("@pauseautomode\nbonjour[p]\n@resumeautomode\nsuite[p]\n");
    expect(runtime.autoModePaused).toBe(false);

    const first = runtime.step();
    expect(first.events).toContainEqual({ kind: "autoMode", paused: true });
    expect(runtime.autoModePaused).toBe(true);

    const second = runtime.step();
    expect(second.events).toContainEqual({ kind: "autoMode", paused: false });
    expect(runtime.autoModePaused).toBe(false);
  });

  it("la suspension oubliée est levée à la fin du script", () => {
    const runtime = makeRuntime("@pauseautomode\nbonjour[p]\n");
    const steps = runAll(runtime);
    expect(steps.at(-1)!.events).toContainEqual({ kind: "autoMode", paused: false });
    expect(runtime.autoModePaused).toBe(false);
  });

  it("verrou et suspension sont indépendants", () => {
    const runtime = makeRuntime("@lockquickmenu\nbonjour[p]\n@pauseautomode\nsuite[p]\n@resumeautomode\nfin[p]\n");
    runtime.step();
    expect([runtime.quickMenuLocked, runtime.autoModePaused]).toEqual([true, false]);
    runtime.step();
    expect([runtime.quickMenuLocked, runtime.autoModePaused]).toEqual([true, true]);
    runtime.step();
    expect([runtime.quickMenuLocked, runtime.autoModePaused]).toEqual([true, false]);
  });
});

describe("Runtime — sauvegarde de l'état", () => {
  it("le verrou et la suspension font partie de l'état sauvegardé", async () => {
    const src = "@lockquickmenu\n@pauseautomode\nbonjour[p]\nsuite[p]\n";
    const script = parse(lex(src));
    const runtime = new Runtime(script, "test.ks");
    runtime.onWarning = () => {};
    runtime.step();

    const data = runtime.getSaveData();
    expect(data.state.quickMenuLocked).toBe(true);
    expect(data.state.autoModePaused).toBe(true);

    const restored = new Runtime(script, "test.ks");
    restored.onWarning = () => {};
    await restored.loadSaveData(data, new Map([["test.ks", script]]));
    expect(restored.quickMenuLocked).toBe(true);
    expect(restored.autoModePaused).toBe(true);
  });

  it("une ancienne sauvegarde sans ces champs se restaure déverrouillée", async () => {
    const script = parse(lex("bonjour[p]\n"));
    const runtime = new Runtime(script, "test.ks");
    runtime.step();
    const data = runtime.getSaveData();
    delete data.state.quickMenuLocked;
    delete data.state.autoModePaused;

    const restored = new Runtime(script, "test.ks");
    await restored.loadSaveData(data, new Map([["test.ks", script]]));
    expect(restored.quickMenuLocked).toBe(false);
    expect(restored.autoModePaused).toBe(false);
  });
});
