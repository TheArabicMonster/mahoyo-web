/**
 * Tests du garde-fou « mode zéro strict » (#275, #302).
 *
 * Depuis la clôture v1.0, **aucune commande inconnue n'est tolérée** : le mécanisme de
 * décroissance (baseline non vide, `npm run audit:baseline`, comparaison à origin/main) a été
 * supprimé. Le CLI complet est couvert par `npm run audit:guard` (CI) ; ici on teste les
 * évaluateurs purs, dont le cas de régression « une inconnue → échec ».
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  evaluateBaselineShape,
  evaluateCorpusAudit,
  formatFindings,
  type CorpusCommandAudit,
} from "../../../tools/audit-guard.js";
import { parseBaseline } from "../../../tools/audit-commands.js";

function audit(unknown: Record<string, number>): Pick<CorpusCommandAudit, "unknown"> {
  return { unknown };
}

const EMPTY_BASELINE = parseBaseline({
  generatedAt: "2026-11-09",
  source: "audit final avant clôture v1.0",
  note: "Mode zéro strict (#302) : aucune inconnue tolérée.",
  triageIssue: "#302",
  commands: {},
});

const LEGACY_BASELINE = parseBaseline({
  generatedAt: "2026-11-09",
  source: "ancienne baseline",
  note: "obsolète",
  triageIssue: "#276",
  commands: { chgpartbg: 2, tickclock: 1 },
});

describe("evaluateCorpusAudit — zéro strict", () => {
  it("accepte un audit sans aucune inconnue", () => {
    expect(evaluateCorpusAudit(audit({}))).toEqual([]);
  });

  it("échoue sur UNE SEULE inconnue, même anciennement en baseline (plus de décroissance)", () => {
    const problems = evaluateCorpusAudit(audit({ nouvelle: 1 }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("commande inconnue « @nouvelle » (1 occurrence(s))");
    expect(problems[0]).toContain("zéro strict");
  });

  it("échoue sur chaque inconnue mesurée, triées par nom, avec le nombre d'occurrences", () => {
    const problems = evaluateCorpusAudit(audit({ zeta: 2, alpha: 3 }));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("@alpha");
    expect(problems[0]).toContain("3 occurrence(s)");
    expect(problems[1]).toContain("@zeta");
  });
});

describe("evaluateBaselineShape — baseline vide obligatoire", () => {
  it("accepte la baseline vide (métadonnées seules)", () => {
    expect(evaluateBaselineShape(EMPTY_BASELINE)).toEqual([]);
  });

  it("échoue si la baseline contient encore une inconnue (même une seule)", () => {
    const problems = evaluateBaselineShape(LEGACY_BASELINE);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("baseline non vide (2 commande(s)");
    expect(problems[0]).toContain("zéro strict");
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
