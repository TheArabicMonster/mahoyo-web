// Tests d'avance #282 — registre des approximations du lot actions/effets (TDD, implémentation à venir).
import { describe, it, expect } from "vitest";
import {
  APPROXIMATIONS,
  compareApproximationsWithBaseline,
  loadApproximationsBaseline,
  validateApproximations,
} from "../../../tools/approximations.js";

const ROOT = process.cwd();

describe("Registre des approximations — lot #282", () => {
  it("déclare l'approximation des particules @fallnote (4 éléments, test figé)", () => {
    const entry = APPROXIMATIONS.find((a) => a.id === "fallnote-particles");
    expect(entry, "entrée fallnote-particles absente du registre").toBeDefined();
    expect(entry!.ecart.length).toBeGreaterThanOrEqual(40);
    expect(entry!.issue).toMatch(/^#\d+$/);
    expect(entry!.test).toBe("tests/unit/renderer/actions-renderer.test.ts");
    expect(entry!.compteur).toBeGreaterThan(0);
    expect(validateApproximations(APPROXIMATIONS, ROOT)).toEqual([]);
    expect(compareApproximationsWithBaseline(APPROXIMATIONS, loadApproximationsBaseline(ROOT))).toEqual([]);
  });
});
