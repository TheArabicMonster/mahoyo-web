/**
 * Tests pour @eval avec portées {f, sf, tf} et structuredClone.
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime, createRuntimeState } from "@/kag/runtime.js";

describe("Runtime @eval — portées f/sf/tf", () => {
  it("expose f, sf, tf à l'expression eval", () => {
    const SCRIPT = `
*page0|
@eval exp=f.x=42
@eval exp=sf.y="hello"
@eval exp=tf.z=[1,2,3]
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    runtime.step();

    expect(runtime.getSaveData().state.variables.f.x).toBe(42);
    expect(runtime.getSaveData().state.variables.sf.y).toBe("hello");
    expect(runtime.getSaveData().state.variables.tf.z).toEqual([1, 2, 3]);
  });

  it("permet de lire une variable f dans une expression suivante", () => {
    const SCRIPT = `
*page0|
@eval exp=f.x=10
@eval exp=f.y=f.x+5
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    runtime.step();

    expect(runtime.getSaveData().state.variables.f.x).toBe(10);
    expect(runtime.getSaveData().state.variables.f.y).toBe(15);
  });

  it("produit un warning pour une expression invalide sans planter", () => {
    const SCRIPT = `
*page0|
@eval exp=void.invalid.syntax
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const warnings: string[] = [];
    const runtime = new Runtime(parsed);
    runtime.onWarning = (msg) => warnings.push(msg);

    runtime.step();

    // Le runtime ne plante pas et émet un warning.
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("eval failed");
  });

  it("structuredClone : un eval après getSaveData ne mute pas le snapshot", () => {
    const SCRIPT = `
*page0|
@eval exp=f.x=1
@pg
*page1|
@eval exp=f.x=999
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    runtime.step(); // f.x = 1
    const save = runtime.getSaveData();
    expect(save.state.variables.f.x).toBe(1);

    runtime.step(); // f.x = 999
    expect(runtime.getSaveData().state.variables.f.x).toBe(999);

    // Le snapshot de sauvegarde ne doit pas avoir été muté.
    expect(save.state.variables.f.x).toBe(1);
  });

  it("structuredClone : les objets imbriqués sont clonés", () => {
    const SCRIPT = `
*page0|
@eval exp=f.data={a:1,b:{c:2}}
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    runtime.step();
    const save = runtime.getSaveData();

    // Modifier l'original ne doit pas affecter le snapshot.
    const vars = runtime.getSaveData().state.variables;
    (vars.f.data as { b: { c: number } }).b.c = 999;

    expect((save.state.variables.f.data as { b: { c: number } }).b.c).toBe(2);
  });
});

describe("Runtime save/load — compatibilité ancien format", () => {
  it("accepte l'ancien format plat de variables", async () => {
    const SCRIPT = `
*page0|
Texte.
@pg
`;
    const parsed = parse(lex(SCRIPT));
    const runtime = new Runtime(parsed);

    // Simuler une sauvegarde avec l'ancien format plat.
    const oldSave = {
      scriptName: "main",
      pc: 0,
      instructionIndex: 0,
      segmentIndex: 0,
      state: {
        fore: { background: "", layers: [] },
        back: { background: "", layers: [] },
        bgm: null,
        se: null,
        // Ancien format : Record<string, unknown> au lieu de {f, sf, tf}
        variables: { x: 42, y: "hello" },
        effect: null,
      },
      callStack: [],
    };

    const ok = await runtime.loadSaveData(oldSave as any, new Map([["main", parsed]]));
    expect(ok).toBe(true);

    const restored = runtime.getSaveData();
    // L'ancien format est migré vers {f: {...}, sf: {}, tf: {}}.
    expect(restored.state.variables.f.x).toBe(42);
    expect(restored.state.variables.f.y).toBe("hello");
    expect(restored.state.variables.sf).toEqual({});
    expect(restored.state.variables.tf).toEqual({});
  });
});
