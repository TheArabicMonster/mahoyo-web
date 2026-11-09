/**
 * Tests des helpers de classification des commandes et de la baseline vide (#275, #302).
 *
 * @vitest-environment node
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  countOccurrences,
  loadBaseline,
  normalizeCommandCounts,
  normalizeCommandName,
  parseBaseline,
  splitUnknownCommands,
  subtractCommandCounts,
} from "../../../tools/audit-commands.js";

const TMP = mkdtempSync(join(tmpdir(), "mahoyo-audit-commands-"));

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("normalizeCommandName / normalizeCommandCounts", () => {
  it("retire le @, la casse et les espaces", () => {
    expect(normalizeCommandName("@ChgPartBg")).toBe("chgpartbg");
    expect(normalizeCommandName("  @TICKCLOCK ")).toBe("tickclock");
    expect(normalizeCommandCounts({ "@Bg": 1, bg: 2, "": 9 })).toEqual({ bg: 3 });
  });
});

describe("countOccurrences", () => {
  it("somme les occurrences", () => {
    expect(countOccurrences({ a: 2, b: 3 })).toBe(5);
    expect(countOccurrences({})).toBe(0);
  });
});

describe("splitUnknownCommands", () => {
  it("sépare les no-ops déclarés des inconnues", () => {
    const { ignored, unknown } = splitUnknownCommands(
      { tickclock: 2, ChgPartBg: 1, "@ruby": 1 },
      new Set(["tickclock"]),
    );
    expect(ignored).toEqual({ tickclock: 2 });
    expect(unknown).toEqual({ chgpartbg: 1, ruby: 1 });
  });
});

describe("subtractCommandCounts", () => {
  it("retranche les occurrences non gérées pour obtenir les commandes implémentées", () => {
    expect(
      subtractCommandCounts({ bg: 3, chgpartbg: 2, tickclock: 1 }, { chgpartbg: 2 }, { tickclock: 1 }),
    ).toEqual({ bg: 3 });
  });

  it("ne produit pas de compteur négatif", () => {
    expect(subtractCommandCounts({ bg: 1 }, { bg: 2 })).toEqual({});
  });
});

describe("parseBaseline / loadBaseline (baseline vide)", () => {
  const valid = {
    generatedAt: "2026-11-09",
    source: "audit final avant clôture v1.0",
    note: "Mode zéro strict (#302).",
    triageIssue: "#302",
    commands: {},
  };
  const legacy = { ...valid, commands: { chgpartbg: 2, tickclock: 1 } };

  it("accepte la baseline vide (mode zéro strict)", () => {
    const baseline = parseBaseline(valid);
    expect(baseline.commands).toEqual({});
  });

  it("sait encore relire une ancienne baseline non vide (compatibilité schéma)", () => {
    expect(parseBaseline(legacy).commands).toEqual({ chgpartbg: 2, tickclock: 1 });
  });

  it("refuse une structure invalide", () => {
    expect(() => parseBaseline(null)).toThrow(/objet attendu/);
    expect(() => parseBaseline({ ...valid, commands: undefined })).toThrow(/commands/);
    expect(() => parseBaseline({ ...valid, commands: { a: 0 } })).toThrow(/occurrence/);
    expect(() => parseBaseline({ ...valid, triageIssue: "" })).toThrow(/triageIssue/);
  });

  it("lit un fichier de baseline vide et échoue proprement s'il manque", () => {
    const path = join(TMP, "baseline.json");
    writeFileSync(path, JSON.stringify(valid), "utf-8");
    expect(loadBaseline(path).commands).toEqual({});
    expect(() => loadBaseline(join(TMP, "absent.json"))).toThrow(/Baseline illisible/);
  });
});
