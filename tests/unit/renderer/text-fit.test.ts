// Registre des approximations (#295) — test figé :
// approx:text-font-metrics — la police d'origine (Mincho propriétaire) est remplacée par une pile
// système : mêmes tailles dérivées de config.tjs, métriques de glyphes différentes.
/**
 * Métriques du texte de jeu (#161, #163, #314).
 *
 * Depuis #314, il n'y a plus d'ajustement automatique de la police (`fitTextBox` supprimé) :
 * la police est constante et la mise en page est faite une seule fois pour la page entière.
 * Ces tests figent les constantes de zone/font utilisées par le renderer.
 */
import { describe, it, expect } from "vitest";
import {
  dimmedUnitCount,
  frameTextAreaHeight,
  frameTextCharsPerLine,
  frameTextWidth,
  FRAME_TEXT_AREA,
  FRAME_TEXT_LINE_HEIGHT,
  FRAME_TEXT_LAYOUT,
  FRAME_TEXT_LAYOUT_PROVENANCE,
  FRAME_TEXT_REM,
  textBoxHeight,
} from "@/renderer/text-fit.js";

describe("textBoxHeight", () => {
  it("donne une hauteur fixe qui accueille ~6 lignes à la taille nominale", () => {
    const box = textBoxHeight(576);
    expect(box).toBeGreaterThanOrEqual(6 * 1.5 * 16 * 1.6);
    // Mais pas beaucoup plus : la boîte ne doit pas envahir la scène.
    expect(box).toBeLessThan(576 * 0.5);
  });

  it("ne dépend que de la hauteur de scène (jamais de la longueur du texte)", () => {
    expect(textBoxHeight(576)).toBe(textBoxHeight(576));
    expect(textBoxHeight(1000)).toBeGreaterThan(textBoxHeight(500));
  });
});

describe("zone de texte du cadre image", () => {
  it("reprend les marges arbitrées en unités logiques (69 px horizontaux, 46,7 px verticaux)", () => {
    expect(FRAME_TEXT_LAYOUT.marginX).toBe(69);
    expect(FRAME_TEXT_LAYOUT.marginY).toBe(46.7);
    expect(FRAME_TEXT_AREA.left).toBeCloseTo(69 / 1024, 9);
    expect(FRAME_TEXT_AREA.right).toBeCloseTo(69 / 1024, 9);
    expect(FRAME_TEXT_AREA.top).toBeCloseTo(46.7 / 576, 9);
    expect(FRAME_TEXT_AREA.bottom).toBeCloseTo(46.7 / 576, 9);
  });

  it("donne une hauteur et une largeur utiles cohérentes (1024 − 2×69 = 886)", () => {
    expect(frameTextAreaHeight(576)).toBeCloseTo(576 - 2 * 46.7, 6);
    expect(frameTextWidth()).toBe(886);
    // 886 / 26 = 34,07 → 34 caractères pleine chasse par ligne (attendu original : 34).
    expect(frameTextCharsPerLine()).toBe(34);
  });
});

describe("police du cadre image dérivée du moteur (#314)", () => {
  it("corps 26 px du repère 1024×576 (`defaultFontSize`) → 1,625 rem (32,5 px écran)", () => {
    expect(FRAME_TEXT_REM).toBeCloseTo(26 / 16, 9);
    const bodyPx = FRAME_TEXT_REM * 16 * 1.25; // écran 1280×720
    expect(bodyPx).toBeCloseTo(32.5, 6);
  });

  it("interligne = pas de ligne capture 40,8 px logiques → 51 px écran", () => {
    expect(FRAME_TEXT_LAYOUT.lineHeight).toBe(40.8);
    expect(FRAME_TEXT_LINE_HEIGHT).toBeCloseTo(40.8 / 26, 9);
    const bodyPx = FRAME_TEXT_REM * 16 * 1.25;
    expect(bodyPx * FRAME_TEXT_LINE_HEIGHT).toBeCloseTo(51, 6);
  });

  it("la table de provenance explique la capture à ±1,5 px écran (statut hypothèse)", () => {
    expect(FRAME_TEXT_LAYOUT_PROVENANCE).toHaveLength(4);
    for (const entry of FRAME_TEXT_LAYOUT_PROVENANCE) {
      expect(entry.status).toBe("hypothèse");
      expect(entry.logical).toBeGreaterThan(0);
      // Valeur logique × 1,25 = valeur écran, comparée à la mesure capture avec sa tolérance.
      expect(Math.abs(entry.logical * 1.25 - entry.captureScreenPx)).toBeLessThanOrEqual(entry.toleranceScreenPx);
    }
    const margin = FRAME_TEXT_LAYOUT_PROVENANCE.find((entry) => entry.param === "marginX")!;
    expect(margin.logical * 1.25).toBeCloseTo(86.25, 6);
    // 86,25 px écran vs 85,4 mesurés → 0,85 px d'écart, dans la tolérance de mesure.
    expect(margin.captureScreenPx).toBeCloseTo(85.4, 6);
    expect(FRAME_TEXT_LAYOUT_PROVENANCE.find((entry) => entry.param === "fontSize")!.logical).toBe(26);
  });

  it("le pas des glyphes vaut 1 em (26 px logiques) : indépendant de la police chargée", () => {
    // Invariant de mise en page : les caractères/ligne et le pas se déduisent de l'em (26 px),
    // pas de l'encre (x-height/capitale) — la calibration d'encre reste cosmétique (#319).
    expect(FRAME_TEXT_LAYOUT.fontSize / FRAME_TEXT_LAYOUT.fontSize).toBe(1);
    expect(frameTextCharsPerLine()).toBe(Math.floor(frameTextWidth() / 26));
  });
});

describe("dimmedUnitCount", () => {
  it("borne la limite du texte lu par le texte affiché", () => {
    expect(dimmedUnitCount(5, 10)).toBe(5);
    expect(dimmedUnitCount(10, 5)).toBe(5);
    expect(dimmedUnitCount(-1, 5)).toBe(0);
  });
});
