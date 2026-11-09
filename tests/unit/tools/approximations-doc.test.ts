/**
 * Tests de la génération de `docs/APPROXIMATIONS.md` (#296).
 *
 * La doc est générée depuis le registre (`tools/approximations.ts`) et la baseline. Les tests
 * couvrent le rendu (pur), la cohérence des libellés, la détection d'un document obsolète et
 * l'écriture sur disque.
 *
 * @vitest-environment node
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  APPROXIMATION_LABELS,
  baselineGeneratedAt,
  checkApproximationsDoc,
  labelProblems,
  renderApproximationsDoc,
  writeApproximationsDoc,
} from "../../../tools/approximations-doc.js";
import { APPROXIMATIONS, type Approximation } from "../../../tools/approximations.js";

const TMP = mkdtempSync(join(tmpdir(), "mahoyo-approximations-doc-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const ENTRIES: Approximation[] = [
  {
    id: "b-approx",
    ecart: "Écart B suffisamment détaillé pour décrire une déviation réelle du moteur d'origine.",
    issue: "#296",
    test: "tests/unit/tools/approximations-doc.test.ts",
    compteur: 1,
  },
  {
    id: "a-approx",
    ecart: "Écart A suffisamment détaillé pour décrire une déviation réelle du moteur d'origine.",
    issue: "#296",
    test: "tests/unit/tools/approximations-doc.test.ts",
    compteur: 2,
  },
];

const LABELS = {
  "a-approx": "`@a` (commande A)",
  "b-approx": "`@b` (commande B)",
} as const;

const BASELINE = { "a-approx": 2, "b-approx": 1 };
const GENERATED_AT = "2026-11-09";

const tempPath = (name: string): string => join(TMP, name);

describe("renderApproximationsDoc", () => {
  it("décrit le registre complet (ids, labels, écarts, issues, tests, compteurs)", () => {
    const doc = renderApproximationsDoc(ENTRIES, BASELINE, LABELS, GENERATED_AT);

    expect(doc).toContain("# Approximations documentées du port");
    expect(doc).toContain("**généré** par `npm run approximations:doc`");
    expect(doc).toContain("2 approximations");
    expect(doc).toContain("compteur cumulé : **3**");
    expect(doc).toContain("| # | Id | Commande / fonctionnalité | Écart assumé | Issue | Test figé | Compteur |");
    expect(doc).toContain("`a-approx`");
    expect(doc).toContain("`@a` (commande A)");
    expect(doc).toContain("`b-approx`");
    expect(doc).toContain("`@b` (commande B)");
    expect(doc).toContain("Écart A suffisamment détaillé");
    expect(doc).toContain("Écart B suffisamment détaillé");
    expect(doc).toContain("| [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) |");
    expect(doc).toContain("`tests/unit/tools/approximations-doc.test.ts`");
    expect(doc).toContain("Baseline versionnée : `tools/approximations-baseline.json` (générée le 2026-11-09).");
  });

  it("est déterministe : tri par id, ordre des entrées indifférent", () => {
    const normal = renderApproximationsDoc(ENTRIES, BASELINE, LABELS, GENERATED_AT);
    const reversed = renderApproximationsDoc([...ENTRIES].reverse(), BASELINE, LABELS, GENERATED_AT);
    expect(reversed).toBe(normal);
    expect(normal.indexOf("`a-approx`")).toBeLessThan(normal.indexOf("`b-approx`"));
  });

  it("signale un id du registre absent de la baseline", () => {
    const doc = renderApproximationsDoc(ENTRIES, { "a-approx": 2 }, LABELS, GENERATED_AT);
    expect(doc).toContain("Id(s) sans compteur dans la baseline");
    expect(doc).toContain("`b-approx`");
  });

  it("documente la procédure et les commandes de régénération/vérification", () => {
    const doc = renderApproximationsDoc(ENTRIES, BASELINE, LABELS, GENERATED_AT);
    expect(doc).toContain("## Procédure — ajouter une approximation");
    expect(doc).toContain("Écart précis");
    expect(doc).toContain("Issue v1.1");
    expect(doc).toContain("Test figé");
    expect(doc).toContain("Compteur");
    expect(doc).toContain("npm run approximations:baseline");
    expect(doc).toContain("npm run approximations:doc");
    expect(doc).toContain("npm run approximations:check");
    expect(doc).toContain("npm run check:generated");
    expect(doc).toContain("## Retirer ou réduire une approximation");
    expect(doc).toContain("## Voir aussi");
  });
});

describe("labelProblems", () => {
  it("accepte un registre et des libellés alignés", () => {
    expect(labelProblems(ENTRIES, LABELS)).toEqual([]);
  });

  it("refuse un libellé manquant et un libellé orphelin", () => {
    const missing = labelProblems(ENTRIES, { "a-approx": "`@a`" });
    expect(missing.join(" ")).toContain("libellé manquant");
    expect(missing.join(" ")).toContain("b-approx");

    const orphan = labelProblems(ENTRIES, { ...LABELS, "c-approx": "`@c`" });
    expect(orphan.join(" ")).toContain("libellé orphelin");
    expect(orphan.join(" ")).toContain("c-approx");
  });
});

describe("checkApproximationsDoc / writeApproximationsDoc", () => {
  it("écrit le document puis le valide", () => {
    const path = tempPath("APPROXIMATIONS.md");
    writeApproximationsDoc(path, ENTRIES, BASELINE, LABELS, GENERATED_AT);
    expect(checkApproximationsDoc(path, ENTRIES, BASELINE, LABELS, GENERATED_AT)).toBeNull();
  });

  it("détecte un document obsolète", () => {
    const path = tempPath("obsolete.md");
    writeApproximationsDoc(path, ENTRIES, BASELINE, LABELS, GENERATED_AT);
    writeFileSync(path, `${readFileSync(path, "utf-8")}\nAjout manuel.\n`, "utf-8");
    const error = checkApproximationsDoc(path, ENTRIES, BASELINE, LABELS, GENERATED_AT);
    expect(error).toContain("obsolète");
    expect(error).toContain("npm run approximations:doc");
  });

  it("détecte un fichier absent", () => {
    const error = checkApproximationsDoc(tempPath("absent.md"), ENTRIES, BASELINE, LABELS, GENERATED_AT);
    expect(error).toContain("absent");
    expect(error).toContain("npm run approximations:doc");
  });

  it("refuse d'écrire si les libellés sont incohérents", () => {
    expect(() => writeApproximationsDoc(tempPath("bad.md"), ENTRIES, BASELINE, { "a-approx": "`@a`" }, GENERATED_AT)).toThrow(
      /libellé manquant/,
    );
  });
});

describe("Document livré (#296)", () => {
  it("couvre les 14 approximations du registre", () => {
    expect(APPROXIMATIONS).toHaveLength(14);
    expect(Object.keys(APPROXIMATION_LABELS).sort()).toEqual(APPROXIMATIONS.map((entry) => entry.id).sort());
    expect(labelProblems()).toEqual([]);
  });

  it("est à jour par rapport au registre et à la baseline", () => {
    expect(checkApproximationsDoc()).toBeNull();
  });

  it("expose une date de baseline lisible", () => {
    expect(baselineGeneratedAt()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
