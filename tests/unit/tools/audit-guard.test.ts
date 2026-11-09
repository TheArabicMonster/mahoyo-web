/**
 * Tests du garde-fou du registre de commandes KAG (#275).
 *
 * Le CLI complet est couvert par `npm run audit:guard` (CI + vérifications) ;
 * ici on teste les évaluateurs purs utilisés par le garde-fou, dont le cas de
 * régression « ajout d'une inconnue → échec » et « no-op déclaré → OK ».
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  buildBaseline,
  evaluateBaselineGrowth,
  evaluateCorpusAudit,
  formatFindings,
  type CorpusCommandAudit,
} from "../../../tools/audit-guard.js";

function audit(unknown: Record<string, number>): Pick<CorpusCommandAudit, "unknown"> {
  return { unknown };
}

const BASELINE = { chgpartbg: 2, tickclock: 1 };

describe("evaluateCorpusAudit", () => {
  it("échoue sur une commande inconnue absente de la baseline (régression)", () => {
    const problems = evaluateCorpusAudit(audit({ chgpartbg: 2, nouvelle: 1 }), BASELINE, {
      strict: false,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("nouvelle commande inconnue « @nouvelle »");
  });

  it("accepte une inconnue déjà figée dans la baseline", () => {
    expect(
      evaluateCorpusAudit(audit({ chgpartbg: 1, tickclock: 1 }), BASELINE, { strict: false }),
    ).toEqual([]);
  });

  it("échoue si le nombre d'occurrences augmente", () => {
    const problems = evaluateCorpusAudit(audit({ chgpartbg: 3, tickclock: 1 }), BASELINE, {
      strict: false,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ne peut que baisser");
  });

  it("en mode strict, exige la mise à jour de la baseline quand une inconnue est résolue", () => {
    expect(
      evaluateCorpusAudit(audit({ chgpartbg: 2 }), BASELINE, { strict: true }),
    ).toEqual([expect.stringContaining("retirer de la baseline")]);
    // En mode non strict, une résolution est permise (la PR met à jour la baseline).
    expect(evaluateCorpusAudit(audit({ chgpartbg: 2 }), BASELINE, { strict: false })).toEqual([]);
  });
});

describe("evaluateBaselineGrowth", () => {
  it("échoue si la baseline ajoute une inconnue ou augmente un compteur", () => {
    const added = evaluateBaselineGrowth({ ...BASELINE, nouveau: 1 }, BASELINE);
    expect(added.some((p) => p.includes("ajoute « @nouveau »"))).toBe(true);

    const increased = evaluateBaselineGrowth({ chgpartbg: 5, tickclock: 1 }, BASELINE);
    expect(increased.some((p) => p.includes("augmente « @chgpartbg »"))).toBe(true);
  });

  it("accepte une baseline qui ne fait que décroître", () => {
    expect(evaluateBaselineGrowth({ chgpartbg: 1 }, BASELINE)).toEqual([]);
    expect(evaluateBaselineGrowth({}, BASELINE)).toEqual([]);
  });
});

describe("buildBaseline", () => {
  it("construit une baseline datée et normalisée depuis l'audit", () => {
    const baseline = buildBaseline(
      {
        assetsDir: "/tmp/assets",
        scriptsAudited: 221,
        unknown: { ChgPartBg: 2, tickclock: 1 },
        ignored: {},
        implemented: {},
      },
      "2026-11-09",
    );
    expect(baseline.generatedAt).toBe("2026-11-09");
    expect(baseline.triageIssue).toBe("#276");
    expect(baseline.source).toContain("221 scripts");
    expect(baseline.commands).toEqual({ chgpartbg: 2, tickclock: 1 });
  });
});

describe("formatFindings", () => {
  it("préfixe les constats par leur niveau", () => {
    const text = formatFindings([
      { level: "error", message: " erreur" },
      { level: "warning", message: " avertissement" },
      { level: "info", message: " info" },
    ]);
    expect(text.split("\n")[0]).toContain("❌");
    expect(text.split("\n")[1]).toContain("⚠️");
    expect(text.split("\n")[2]).toContain("ℹ️");
  });
});
