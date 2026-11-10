/**
 * Registre des approximations (#295) : les 4 éléments obligatoires (écart, issue v1.1, test figé,
 * compteur non croissant) sont validés par le garde-fou, et un test négatif prouve que la CI
 * échoue si l'un manque ou si le compteur augmente.
 */
import { describe, it, expect } from "vitest";
import {
  APPROXIMATIONS,
  APPROXIMATIONS_ISSUE,
  TEST_MARKER_PREFIX,
  compareApproximationsWithBaseline,
  loadApproximationsBaseline,
  serializeApproximationsBaseline,
  validateApproximations,
  type Approximation,
} from "../../../tools/approximations.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Liste des approximations à couvrir au moment de la clôture DoD v1.0 (#295). */
const EXPECTED_IDS = [
  "action-modules-subset",
  "bindbg-not-persisted",
  "clock-runtime-vars",
  "focusline-canvas",
  "infg-outfg-fore-page",
  "fallnote-particles",
  "message-actions-non-swing",
  "pauseploy-font",
  "playtimeline-test-variant",
  "ruby-proportional",
  "s-click-wait",
  "shake-fullscreen",
  "staffrollsetting-bgcolor",
  "text-font-metrics",
  "text-overflow-clip",
  "xchgbgm-volume",
] as const;

const entry = (overrides: Partial<Approximation> = {}): Approximation => ({
  id: "test-approx",
  ecart: "Écart suffisamment détaillé pour décrire une déviation réelle du moteur d'origine.",
  issue: "#296",
  test: "tests/unit/tools/approximations.test.ts",
  compteur: 1,
  ...overrides,
});

describe("Registre des approximations (#295)", () => {
  it("le registre livré est valide (4 éléments + test figé avec marqueur)", () => {
    expect(validateApproximations(APPROXIMATIONS, ROOT)).toEqual([]);
  });

  it("couvre la liste initiale attendue à la clôture DoD", () => {
    expect(APPROXIMATIONS.map((a) => a.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("chaque entrée pointe l'issue de suivi v1.1", () => {
    for (const approximation of APPROXIMATIONS) {
      expect(approximation.issue).toMatch(/^#\d+$/);
    }
    expect(APPROXIMATIONS_ISSUE).toMatch(/^#\d+$/);
  });

  it("chaque test figé contient bien son marqueur approx:<id>", () => {
    for (const approximation of APPROXIMATIONS) {
      const path = join(ROOT, approximation.test);
      expect(existsSync(path), approximation.test).toBe(true);
      expect(readFileSync(path, "utf-8")).toContain(`${TEST_MARKER_PREFIX}${approximation.id}`);
    }
  });

  it("les compteurs sont conformes à la baseline versionnée (non croissants)", () => {
    const baseline = loadApproximationsBaseline(ROOT);
    expect(compareApproximationsWithBaseline(APPROXIMATIONS, baseline)).toEqual([]);
    expect(Object.keys(baseline).sort()).toEqual(APPROXIMATIONS.map((a) => a.id).sort());
  });

  it("la baseline sérialisée est déterministe et triée", () => {
    const serialized = serializeApproximationsBaseline(APPROXIMATIONS, "2026-01-01");
    expect(serialized).toBe(serializeApproximationsBaseline([...APPROXIMATIONS].reverse(), "2026-01-01"));
    const parsed = JSON.parse(serialized) as { counters: Record<string, number>; issue: string };
    expect(parsed.issue).toBe(APPROXIMATIONS_ISSUE);
    expect(Object.keys(parsed.counters)).toEqual([...Object.keys(parsed.counters)].sort());
  });
});

describe("Garde-fou des approximations — tests négatifs (#295)", () => {
  it("refuse une entrée sans écart détaillé", () => {
    expect(validateApproximations([entry({ ecart: "trop court" })], ROOT).join(" ")).toContain("écart");
  });

  it("refuse une issue non v1.1 / mal formée", () => {
    expect(validateApproximations([entry({ issue: "296" })], ROOT).join(" ")).toContain("issue invalide");
  });

  it("refuse un test introuvable ou sans marqueur", () => {
    expect(validateApproximations([entry({ test: "tests/unit/inexistant.test.ts" })], ROOT).join(" ")).toContain("introuvable");
    // Ce fichier existe mais ne contient pas le marqueur de l'id fabriqué.
    const missingMarker = validateApproximations([entry({ test: "tests/unit/kag/clock-state.test.ts", id: "id-absent" })], ROOT);
    expect(missingMarker.join(" ")).toContain("marqueur");
  });

  it("refuse un id en double ou invalide", () => {
    expect(validateApproximations([entry(), entry()], ROOT).join(" ")).toContain("en double");
    expect(validateApproximations([entry({ id: "Bad_ID" })], ROOT).join(" ")).toContain("id invalide");
  });

  it("échoue si un compteur dépasse la baseline (doit rester non croissant)", () => {
    const baseline = { "test-approx": 1 };
    expect(compareApproximationsWithBaseline([entry({ compteur: 2 })], baseline).join(" ")).toContain("ne peut pas augmenter");
  });

  it("échoue si un id manque dans la baseline ou dans le registre", () => {
    expect(compareApproximationsWithBaseline([entry()], {}).join(" ")).toContain("absente de la baseline");
    expect(compareApproximationsWithBaseline([], { "test-approx": 1 }).join(" ")).toContain("absente du registre");
  });

  it("un compteur réduit est admis (réduction d'approximation)", () => {
    expect(compareApproximationsWithBaseline([entry({ compteur: 1 })], { "test-approx": 3 })).toEqual([]);
  });
});
