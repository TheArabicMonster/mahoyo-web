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
  FRAME_TEXT_AREA,
  FRAME_TEXT_LINE_HEIGHT,
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
  it("reprend les marges moteur exactes (`MessageLayer_config` : 142/1024, 69/576)", () => {
    expect(FRAME_TEXT_AREA.left).toBeCloseTo(142 / 1024, 9);
    expect(FRAME_TEXT_AREA.right).toBeCloseTo(142 / 1024, 9);
    expect(FRAME_TEXT_AREA.top).toBeCloseTo(69 / 576, 9);
    expect(FRAME_TEXT_AREA.bottom).toBeCloseTo(69 / 576, 9);
  });

  it("donne une hauteur de zone cohérente avec la scène", () => {
    expect(frameTextAreaHeight(576)).toBeCloseTo(576 * (1 - (2 * 69) / 576), 6);
  });
});

describe("police du cadre image dérivée du moteur (#314)", () => {
  it("corps 26 px du repère 1024×576 (`defaultFontSize`) → 1,625 rem", () => {
    expect(FRAME_TEXT_REM).toBeCloseTo(26 / 16, 9);
    const bodyPx = FRAME_TEXT_REM * 16 * 1.25; // écran 1280×720
    expect(bodyPx).toBeCloseTo(32.5, 6);
  });

  it("interligne = (fontSize + lineSpacing) / fontSize = 44/26 (`config.tjs`)", () => {
    expect(FRAME_TEXT_LINE_HEIGHT).toBeCloseTo(44 / 26, 9);
    const bodyPx = FRAME_TEXT_REM * 16 * 1.25;
    expect(bodyPx * FRAME_TEXT_LINE_HEIGHT).toBeCloseTo(55, 6);
  });
});

describe("dimmedUnitCount", () => {
  it("borne la limite du texte lu par le texte affiché", () => {
    expect(dimmedUnitCount(5, 10)).toBe(5);
    expect(dimmedUnitCount(10, 5)).toBe(5);
    expect(dimmedUnitCount(-1, 5)).toBe(0);
  });
});
