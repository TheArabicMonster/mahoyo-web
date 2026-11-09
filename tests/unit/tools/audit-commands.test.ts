/**
 * Tests des helpers de classification des commandes et de la baseline (#275).
 *
 * @vitest-environment node
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  compareWithBaseline,
  countOccurrences,
  loadBaseline,
  normalizeCommandCounts,
  normalizeCommandName,
  parseBaseline,
  serializeBaseline,
  splitUnknownCommands,
  subtractCommandCounts,
  type CommandBaseline,
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

describe("compareWithBaseline", () => {
  it("détecte les nouvelles inconnues, les hausses et les résolutions", () => {
    const comparison = compareWithBaseline(
      { chgpartbg: 3, nouvelle: 1, tickclock: 1 },
      { chgpartbg: 2, tickclock: 2, resolue: 4 },
    );
    expect(comparison.newCommands).toEqual(["nouvelle"]);
    expect(comparison.increased).toEqual([{ name: "chgpartbg", measured: 3, baseline: 2 }]);
    expect(comparison.resolved).toEqual(["resolue"]);
  });

  it("ne signale rien quand les inconnues baissent", () => {
    const comparison = compareWithBaseline({ chgpartbg: 1 }, { chgpartbg: 2 });
    expect(comparison.newCommands).toEqual([]);
    expect(comparison.increased).toEqual([]);
    expect(comparison.resolved).toEqual([]);
  });

  it("normalise la casse des deux côtés", () => {
    expect(compareWithBaseline({ ChgPartBg: 2 }, { chgpartbg: 2 }).increased).toEqual([]);
  });
});

describe("parseBaseline / loadBaseline / serializeBaseline", () => {
  const valid = {
    generatedAt: "2026-11-09",
    source: "npm run audit sur 221 scripts",
    note: "Ne peut que décroître.",
    triageIssue: "#276",
    commands: { chgpartbg: 2, tickclock: 1 },
  };

  it("accepte une baseline valide et normalise les noms", () => {
    const baseline = parseBaseline(valid);
    expect(baseline.commands).toEqual({ chgpartbg: 2, tickclock: 1 });
  });

  it("refuse une structure invalide", () => {
    expect(() => parseBaseline(null)).toThrow(/objet attendu/);
    expect(() => parseBaseline({ ...valid, commands: undefined })).toThrow(/commands/);
    expect(() => parseBaseline({ ...valid, commands: { a: 0 } })).toThrow(/occurrence/);
    expect(() => parseBaseline({ ...valid, triageIssue: "" })).toThrow(/triageIssue/);
  });

  it("sérialise de façon déterministe et triée, relisible", () => {
    const baseline: CommandBaseline = {
      generatedAt: "2026-11-09",
      source: "src",
      note: "note",
      triageIssue: "#276",
      commands: { zeta: 2, alpha: 1 },
    };
    const text = serializeBaseline(baseline);
    expect(text).toBe(serializeBaseline(baseline));
    expect(text.indexOf("@") /* pas de contenu */).toBe(-1);
    const reparsed = parseBaseline(JSON.parse(text));
    expect(Object.keys(reparsed.commands)).toEqual(["alpha", "zeta"]);
  });

  it("lit un fichier de baseline et échoue proprement s'il manque", () => {
    const path = join(TMP, "baseline.json");
    writeFileSync(path, serializeBaseline(parseBaseline(valid)), "utf-8");
    expect(loadBaseline(path).commands).toEqual({ chgpartbg: 2, tickclock: 1 });
    expect(() => loadBaseline(join(TMP, "absent.json"))).toThrow(/Baseline illisible/);
  });
});
