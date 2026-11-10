import { describe, it, expect } from "vitest";
import { FRAME_TEXT_AREA, FRAME_TEXT_REM } from "../../../src/renderer/text-fit.js";
import {
  STAGE_SCALE,
  STAGE_SIZE,
  buildMarkdownReport,
  classifyMeasurement,
  compareFontSize,
  currentLeftMarginScreenPx,
  currentPortFontCssPx,
  extractTextPages,
  lineHeightStagePx,
  pageMeta,
  percentile,
  scriptFontSizeToStageCssPx,
  stageToScreenPx,
  summarizeVerdicts,
  textAreaHeightStagePx,
  type PageVerdict,
  type TextPage,
  type TextOverflowReport,
  type FontSizeComparison,
} from "../../../tools/text-overflow-lib.js";

describe("conversions de repères (#319)", () => {
  it("convertit px du stage (1024×576) vers l'écran (1280×720) avec le facteur 1,25", () => {
    expect(STAGE_SCALE).toBeCloseTo(1.25, 10);
    expect(stageToScreenPx(FRAME_TEXT_REM * 16)).toBeCloseTo(34, 5);
    expect(stageToScreenPx(FRAME_TEXT_AREA.left * STAGE_SIZE.width)).toBeCloseTo(179.2, 5);
    expect(currentLeftMarginScreenPx()).toBeCloseTo(179.2, 5);
  });

  it("applique la formule ×(1024/1280)=×0,8 à une taille @font size=", () => {
    expect(scriptFontSizeToStageCssPx(24)).toBeCloseTo(19.2, 10);
    expect(scriptFontSizeToStageCssPx(10)).toBeCloseTo(8, 10);
    // Comportement actuel du port : la taille est posée telle quelle dans le stage.
    expect(currentPortFontCssPx(24)).toBe(24);
  });

  it("compare taille script / taille actuelle / taille proposée, sans constante par scène", () => {
    const c: FontSizeComparison = compareFontSize(24);
    expect(c.scriptPx).toBe(24);
    expect(c.expectedScreenPx).toBe(24);
    expect(c.currentStageCssPx).toBe(24);
    expect(c.currentScreenPx).toBeCloseTo(30, 10); // ×1,25
    expect(c.proposedStageCssPx).toBeCloseTo(19.2, 10);
    expect(c.proposedScreenPx).toBeCloseTo(24, 10);
    expect(c.currentRatio).toBeCloseTo(1.25, 10);
  });

  it("calcule la hauteur de zone et l'interligne du cadre image", () => {
    expect(textAreaHeightStagePx()).toBeCloseTo(576 * (1 - 0.081 - 0.081), 5);
    expect(lineHeightStagePx()).toBeCloseTo(FRAME_TEXT_REM * 16 * 1.5, 10);
  });
});

describe("extractTextPages", () => {
  it("regroupe le texte par page et conserve les sauts [l]", () => {
    const pages = extractTextPages("*start|\nBonjour[l]\nle monde.[p]\nDeuxième page.[p]\n@return\n", "t.ks");
    expect(pages).toHaveLength(2);
    expect(pages[0]!.page).toBe(0);
    expect(pages[0]!.text).toContain("Bonjour");
    expect(pages[0]!.text).toContain("\n");
    expect(pages[0]!.text).toContain("le monde.");
    expect(pages[1]!.text).toContain("Deuxième page.");
    expect(pages[0]!.scriptSizes).toEqual([]);
    expect(pages[0]!.nonSpaceChars).toBeGreaterThan(0);
  });

  it("ne conserve que les tailles @font size= des fragments stylés", () => {
    const pages = extractTextPages("*start|\n@font size=24\nTexte stylé.[p]\n@return\n", "t.ks");
    expect(pages).toHaveLength(1);
    expect(pages[0]!.scriptSizes).toContain(24);
    expect(pages[0]!.runs.some((r) => r.scriptSize === 24)).toBe(true);
  });

  it("termine proprement sans page vide et respecte les bornes", () => {
    expect(extractTextPages("*start|\n@return\n", "t.ks")).toEqual([]);
    const pages = extractTextPages("*start|\nA.[p]\nB.[p]\nC.[p]\n@return\n", "t.ks", { maxPagesPerScript: 2 });
    expect(pages).toHaveLength(2);
  });

  it("n'inclut pas le texte dans les métadonnées de rapport", () => {
    const pages = extractTextPages("*start|\nTexte confidentiel.[p]\n@return\n", "t.ks");
    const meta = pageMeta(pages[0]!);
    expect(meta).not.toHaveProperty("text");
    expect(meta).not.toHaveProperty("runs");
    expect(meta.script).toBe("t.ks");
  });
});

describe("classifyMeasurement / summarizeVerdicts", () => {
  const page: TextPage = { script: "a.ks", page: 0, instruction: 0, text: "x", runs: [], scriptSizes: [], nonSpaceChars: 1 };
  const areaHeightPx = 480;

  it("classe tient / déborde en hauteur / en largeur / les deux", () => {
    expect(classifyMeasurement(page, { nominalHeightPx: 400, areaHeightPx, widthOverflow: false }).cause).toBe("ok");
    const high = classifyMeasurement(page, { nominalHeightPx: 500, areaHeightPx, widthOverflow: false });
    expect(high.cause).toBe("hauteur");
    expect(high.overflow).toBe(true);
    expect(high.safetyPx).toBe(-20);
    expect(high.fillRatio).toBeCloseTo(500 / 480, 5);
    expect(classifyMeasurement(page, { nominalHeightPx: 400, areaHeightPx, widthOverflow: true }).cause).toBe("largeur");
    expect(classifyMeasurement(page, { nominalHeightPx: 500, areaHeightPx, widthOverflow: true }).cause).toBe("les-deux");
  });

  it("tolère le demi-pixel d'arrondi du navigateur", () => {
    expect(classifyMeasurement(page, { nominalHeightPx: 480.4, areaHeightPx, widthOverflow: false }).overflow).toBe(false);
  });

  it("agrège le résumé, les causes, la p95 et les pires pages", () => {
    const verdicts: PageVerdict[] = [0.2, 1.5, 0.4].map((ratio, index) =>
      classifyMeasurement(
        { ...page, page: index },
        { nominalHeightPx: areaHeightPx * ratio, areaHeightPx, widthOverflow: false },
      ),
    );
    const summary = summarizeVerdicts(verdicts, 2);
    expect(summary.pages).toBe(3);
    expect(summary.overflowing).toBe(1);
    expect(summary.byCause.hauteur).toBe(1);
    expect(summary.byCause.ok).toBe(2);
    expect(summary.p95FillRatio).toBeCloseTo(1.39, 5);
    expect(summary.worstSafetyPx).toBeCloseTo(480 * (1 - 1.5), 5);
    expect(summary.worstPages).toHaveLength(2);
    expect(summary.worstPages[0]!.fillRatio).toBeCloseTo(1.5, 5);
  });

  it("interpole le percentile", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 10);
  });
});

describe("buildMarkdownReport", () => {
  it("rend un rapport chiffré sans aucun texte de page", () => {
    const page: TextPage = {
      script: "scene.ks",
      page: 3,
      instruction: 7,
      text: "TEXTE-ORIGINAL-A-NE-PAS-FUITER",
      runs: [],
      scriptSizes: [],
      nonSpaceChars: 30,
    };
    const verdict = classifyMeasurement(page, { nominalHeightPx: 500, areaHeightPx: 480, widthOverflow: false });
    const report: TextOverflowReport = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      mode: "assets",
      assetsDir: "/assets",
      scenarioDir: "/assets/scenario",
      scripts: 1,
      pages: 1,
      measuredPages: 1,
      browsers: [{ browser: "chromium", verdicts: [verdict], summary: summarizeVerdicts([verdict]) }],
      nominal: [{ script: "scene.ks", page: 3, scriptSizes: [], comparisons: [compareFontSize(24)] }],
      glyphProbes: [],
      box: { nominalFontPx: 27.2, lineHeight: 40.8, areaHeightPx: 480, leftMarginStagePx: FRAME_TEXT_AREA.left * STAGE_SIZE.width },
      originalMarginScreenPx: 85.4,
      marginDeltaScreenPx: 93.8,
      recommended: { nominalRem: 1.43, nominalScreenPx: 28.6, leftFraction: 0.0667, scriptSizeFactor: 0.8 },
      warnings: ["rapport partiel"],
    };
    const markdown = buildMarkdownReport(report);
    expect(markdown).toContain("Débordement du texte");
    expect(markdown).toContain("scene.ks");
    expect(markdown).toContain("1.43");
    expect(markdown).not.toContain("TEXTE-ORIGINAL-A-NE-PAS-FUITER");
    expect(markdown).toContain("rapport partiel");
  });
});
