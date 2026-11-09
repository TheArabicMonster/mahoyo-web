/**
 * Tests de la génération de la section « commandes KAG » (#275).
 *
 * @vitest-environment node
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DOC_BEGIN_MARKER,
  DOC_END_MARKER,
  checkGeneratedBlock,
  extractGeneratedBlock,
  renderGeneratedBlock,
  replaceGeneratedBlock,
} from "../../../tools/audit-commands-doc.js";
import { parseBaseline, type CommandBaseline } from "../../../tools/audit-commands.js";
import type { IgnoredCommand } from "../../../tools/ignored-commands.js";

const TMP = mkdtempSync(join(tmpdir(), "mahoyo-audit-doc-"));

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const BASELINE: CommandBaseline = parseBaseline({
  generatedAt: "2026-11-09",
  source: "npm run audit sur 221 scripts",
  note: "Ne peut que décroître.",
  triageIssue: "#276",
  commands: { chgpartbg: 2, tickclock: 1 },
});

const REGISTRY: IgnoredCommand[] = [
  {
    name: "tickclock",
    raison: "Horloge du HUD non portée : aucun effet sans interface dédiée.",
    effet: "aucun",
    issue: "#276",
  },
];

describe("renderGeneratedBlock", () => {
  it("génère les trois catégories et le tableau des inconnues", () => {
    const block = renderGeneratedBlock(REGISTRY, BASELINE);
    expect(block).toContain("| **Implémentée** |");
    expect(block).toContain("| **Ignorée volontairement** |");
    expect(block).toContain("| **Inconnue** |");
    expect(block).toContain("2 commande(s) distincte(s), 3 occurrence(s)");
    expect(block).toContain("| `@tickclock` | aucun |");
    expect(block).toContain("| `@chgpartbg` | 2 |");
  });

  it("signale explicitement l'absence de no-op quand le registre est vide", () => {
    const block = renderGeneratedBlock([], BASELINE);
    expect(block).toContain("Aucune commande n'est déclarée no-op");
    expect(block).toContain("0 commande(s)");
  });
});

describe("replaceGeneratedBlock / extractGeneratedBlock", () => {
  it("ajoute les marqueurs si absents, puis remplace le bloc", () => {
    const doc = "# Doc\n\nTexte initial.\n";
    const first = replaceGeneratedBlock(doc, renderGeneratedBlock([], BASELINE));
    expect(first).toContain(DOC_BEGIN_MARKER);
    expect(first).toContain(DOC_END_MARKER);
    expect(extractGeneratedBlock(first)).toContain("Commandes KAG");

    const second = replaceGeneratedBlock(first, renderGeneratedBlock(REGISTRY, BASELINE));
    expect(second.startsWith("# Doc\n\nTexte initial.")).toBe(true);
    expect(extractGeneratedBlock(second)).toContain("`@tickclock`");
    expect(second.split(DOC_BEGIN_MARKER)).toHaveLength(2);
  });

  it("extrait null sans marqueurs", () => {
    expect(extractGeneratedBlock("# rien")).toBeNull();
  });
});

describe("checkGeneratedBlock", () => {
  it("accepte un document à jour et signale un document obsolète", () => {
    const path = join(TMP, "doc.md");
    const fresh = replaceGeneratedBlock("# Doc\n", renderGeneratedBlock(REGISTRY, BASELINE));
    writeFileSync(path, fresh, "utf-8");
    expect(checkGeneratedBlock(path, REGISTRY, BASELINE)).toBeNull();

    writeFileSync(path, replaceGeneratedBlock("# Doc\n", "bloc périmé"), "utf-8");
    expect(checkGeneratedBlock(path, REGISTRY, BASELINE)).toContain("obsolète");

    const missing = join(TMP, "sans-marqueurs.md");
    writeFileSync(missing, "# Doc\n", "utf-8");
    expect(checkGeneratedBlock(missing, REGISTRY, BASELINE)).toContain("Bloc généré absent");
  });

  it("le document du dépôt est à jour (généré depuis le registre/baseline réels)", () => {
    const path = join(import.meta.dirname, "../../../docs/LECTURE_COMPLETE.md");
    const text = readFileSync(path, "utf-8");
    expect(text).toContain(DOC_BEGIN_MARKER);
    expect(text).toContain(DOC_END_MARKER);
  });
});
