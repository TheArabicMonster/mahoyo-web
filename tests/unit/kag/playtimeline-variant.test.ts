// Registre des approximations (#295) — test figé :
// approx:playtimeline-test-variant — @playtimeline frame= sans scene= est toléré sans effet.
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";

describe("Approximation — @playtimeline variante de test (#295)", () => {
  it("frame= sans scene= (menutest.ks) est toléré sans effet ni animation", () => {
    // Variante de test de `menutest.ks` ; l'usage narratif (`scene=`) est couvert ailleurs.
    const parsed = parse(lex("*page0|\n@playtimeline frame=0\n@pg\n"));
    const first = parsed.pages[0]!.instructions[0]!;
    expect(first).toMatchObject({ kind: "raw", command: "playtimeline" });
    const warnings: string[] = [];
    const runtime = new Runtime(parsed, "menutest.ks");
    runtime.onWarning = (message) => warnings.push(message);
    const step = runtime.step();
    // Aucune animation/scène : la variante de test reste un no-op toléré (comportement figé).
    expect(step.events.some((e) => e.kind === "animate")).toBe(false);
    expect(warnings.join(" ")).toContain("commande non gérée: @playtimeline");
  });
});
