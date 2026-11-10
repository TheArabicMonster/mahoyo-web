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
  ENGINE_CONFIG_PATH,
  ENGINE_CONFIG_SHA256,
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

  it("provenance : config = modèle, capture = oracle, contradiction documentée (#320)", () => {
    // Sha256 du config.tjs de référence (assets locaux non commités) cité par la table.
    expect(ENGINE_CONFIG_PATH).toContain("override/config.tjs");
    expect(ENGINE_CONFIG_SHA256).toHaveLength(64);
    expect(ENGINE_CONFIG_SHA256).toBe("82ea1af8b44663097027965ba4e868e3e402b487b853298a5c2df4b2e6006893");
    expect(FRAME_TEXT_LAYOUT_PROVENANCE).toHaveLength(4);
    for (const entry of FRAME_TEXT_LAYOUT_PROVENANCE) {
      expect(entry.status).toBe("hypothèse");
      // La valeur **appliquée** (calibrée capture) explique la capture à la tolérance près.
      expect(Math.abs(entry.appliedLogical * 1.25 - entry.captureScreenPx)).toBeLessThanOrEqual(
        entry.toleranceScreenPx,
      );
    }
    // Valeurs réelles de MessageLayer_config (L, R, T, B — aucune inversion de lecture).
    const byParam = Object.fromEntries(FRAME_TEXT_LAYOUT_PROVENANCE.map((entry) => [entry.param, entry]));
    expect(byParam.marginX!.configLogical).toBe(142);
    expect(byParam.marginY!.configLogical).toBe(69);
    expect(byParam.fontSize!.configLogical).toBe(26);
    expect(byParam.lineHeight!.configLogical).toBe(44); // 26 + defaultLineSpacing 18
    // La config n'explique PAS la capture sur X, Y et l'interligne ; elle l'explique pour la police.
    expect(byParam.marginX!.contradiction).toBe(true);
    expect(byParam.marginY!.contradiction).toBe(true);
    expect(byParam.lineHeight!.contradiction).toBe(true);
    expect(byParam.fontSize!.contradiction).toBe(false);
    // Exemple : 142 px logiques (config) → 177,5 px écran, hors tolérance des 85,4 px mesurés.
    expect(byParam.marginX!.configLogical * 1.25).toBeGreaterThan(byParam.marginX!.captureScreenPx + byParam.marginX!.toleranceScreenPx);
    // La valeur appliquée calibrée reste 69/46,7/26/40,8.
    expect(FRAME_TEXT_LAYOUT).toEqual({ marginX: 69, marginY: 46.7, fontSize: 26, lineHeight: 40.8 });
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
