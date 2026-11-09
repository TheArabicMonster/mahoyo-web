// Registre des approximations (#295) — test figé :
// approx:clock-runtime-vars — l'horloge utilise clockHour/clockMinute runtime, pas f.lastHour/f.lastMinute.
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";

describe("Décision — horloge et variables moteur f.last* (#295)", () => {
  it("l'heure est dans l'état runtime sauvegardé, pas dans f.lastHour/f.lastMinute", () => {
    const parsed = parse(lex("*page0|\n@dispclock h=6 m=55 left=-800 top=-600 time=300\n@pg\n"));
    const runtime = new Runtime(parsed, "t.ks");
    for (let i = 0; i < 4; i++) {
      const step = runtime.step();
      if (step.stop.kind === "click" || step.stop.kind === "end") break;
    }
    const save = runtime.getSaveData();
    expect(save.state.clockHour).toBe(6);
    expect(save.state.clockMinute).toBe(55);
    // Décision #295 : le port ne recopie pas dans les variables de jeu (aucun script ne les lit).
    expect(save.state.variables.f.lastHour).toBeUndefined();
    expect(save.state.variables.f.lastMinute).toBeUndefined();
  });
});
