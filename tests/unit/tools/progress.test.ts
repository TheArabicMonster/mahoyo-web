/**
 * Tests unitaires de la logique pure de génération de PROGRESS.md.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { computePercent, renderBar, renderProgress } from "../../../tools/progress-lib.js";

const DATE = new Date("2026-10-29T12:00:00Z");

describe("computePercent", () => {
  it("retourne 0 pour 0 issue", () => expect(computePercent(0, 0)).toBe(0));
  it("retourne 100 si tout est fermé", () => expect(computePercent(0, 8)).toBe(100));
  it("calcule un pourcentage partiel", () => expect(computePercent(3, 1)).toBe(25));
});

describe("renderBar", () => {
  it("barre vide et pleine", () => {
    expect(renderBar(0)).toBe(`[${"░".repeat(20)}] 0 %`);
    expect(renderBar(100)).toBe(`[${"█".repeat(20)}] 100 %`);
  });
  it("barre partielle", () => {
    expect(renderBar(50)).toBe(`[${"█".repeat(10)}${"░".repeat(10)}] 50 %`);
  });
});

describe("renderProgress", () => {
  it("rend le cas partiel avec détail, note et date", () => {
    const md = renderProgress(
      [
        { title: "v1.1", open_issues: 2, closed_issues: 0 },
        { title: "v1.0", open_issues: 1, closed_issues: 3 },
      ],
      DATE,
    );
    expect(md).toContain("npm run progress");
    expect(md).toContain("Ne pas l'éditer à la main");
    expect(md).toContain("75 %");
    expect(md).toContain("| v1.0 | 3 | 1 | 4 |");
    expect(md).toContain("| v1.1 | 0 | 2 | 2 |");
    expect(md.indexOf("| v1.0 |")).toBeLessThan(md.indexOf("| v1.1 |"));
    expect(md).toContain("## Légende");
    expect(md).toContain("2026-10-29");
  });

  it("gère une milestone sans issue", () => {
    const md = renderProgress([{ title: "v1.0", open_issues: 0, closed_issues: 0 }], DATE);
    expect(md).toContain("0 %");
    expect(md).toContain("0 issue(s) fermée(s) sur 0");
  });

  it("gère tout fermé", () => {
    const md = renderProgress([{ title: "v1.0", open_issues: 0, closed_issues: 5 }], DATE);
    expect(md).toContain("100 %");
    expect(md).toContain("🟢 Terminé");
  });
});
