import { describe, it, expect } from "vitest";
import {
  fitTextBox,
  frameTextAreaHeight,
  FRAME_TEXT_AREA,
  FRAME_TEXT_LINE_HEIGHT,
  FRAME_TEXT_REM,
  textBoxHeight,
  TEXT_FIT_DEFAULTS,
  type TextFitParams,
} from "@/renderer/text-fit.js";

const LINE = 38.4;
const PAD = 20;
const STAGE = 576;
const BOX = textBoxHeight(STAGE);

/** Hauteur d'un texte de `lines` lignes à l'échelle 1 ; les lignes se réduisent avec l'échelle, sans nouveau retour à la ligne. */
function heightOf(lines: number): (scale: number) => number {
  return (scale) => 2 * PAD + lines * LINE * scale;
}

function params(lines: number, over: Partial<TextFitParams> = {}): TextFitParams {
  return {
    ...TEXT_FIT_DEFAULTS,
    boxHeight: BOX,
    measureHeight: heightOf(lines),
    ...over,
  };
}

describe("textBoxHeight", () => {
  it("donne une hauteur fixe qui accueille 6 lignes à la taille nominale", () => {
    expect(BOX).toBeGreaterThanOrEqual(2 * PAD + 6 * LINE);
    // Mais pas beaucoup plus : la boîte ne doit pas envahir la scène.
    expect(BOX).toBeLessThan(STAGE * 0.5);
  });

  it("ne dépend que de la hauteur de scène", () => {
    expect(textBoxHeight(STAGE)).toBe(textBoxHeight(STAGE));
    expect(textBoxHeight(1000)).toBeGreaterThan(textBoxHeight(500));
  });
});

describe("fitTextBox", () => {
  it("garde la taille nominale jusqu'à la capacité de la boîte (6 lignes)", () => {
    for (const lines of [1, 2, 3, 4, 5, 6]) {
      const fit = fitTextBox(params(lines));
      expect(fit.scale).toBe(1);
      expect(fit.overflow).toBe(false);
      expect(fit.maxHeight).toBe(BOX);
    }
  });

  it("ne renvoie aucune notion de position : la boîte ne bouge jamais", () => {
    for (const lines of [1, 6, 9, 13, 40]) {
      const fit = fitTextBox(params(lines)) as unknown as Record<string, unknown>;
      expect(fit.bottom).toBeUndefined();
      expect(fit.raised).toBeUndefined();
      expect(fit.maxHeight).toBe(BOX);
    }
  });

  it("réduit la police par pas de 5 % dès que la page dépasse la capacité", () => {
    const fit = fitTextBox(params(8));
    expect(fit.scale).toBeLessThan(1);
    expect(fit.scale).toBeGreaterThanOrEqual(TEXT_FIT_DEFAULTS.minScale);
    expect(Math.abs(fit.scale * 20 - Math.round(fit.scale * 20))).toBeLessThan(1e-9);
    expect(heightOf(8)(fit.scale)).toBeLessThanOrEqual(BOX);
    // C'est la plus grande échelle qui convient.
    expect(heightOf(8)(fit.scale + 0.05)).toBeGreaterThan(BOX);
    expect(fit.overflow).toBe(false);
  });

  it("une page à peine plus longue ne perd qu'un pas", () => {
    const fit = fitTextBox(params(6.2));
    expect(fit.scale).toBe(0.95);
  });

  it("s'arrête au plancher et signale le débordement", () => {
    const fit = fitTextBox(params(40));
    expect(fit.scale).toBe(TEXT_FIT_DEFAULTS.minScale);
    expect(fit.overflow).toBe(true);
    expect(fit.maxHeight).toBe(BOX);
  });

  it("tient à l'échelle minimale sans déborder", () => {
    // Capacité à l'échelle minimale : (BOX - 40) / (LINE * minScale) lignes.
    const capacity = (BOX - 2 * PAD) / (LINE * TEXT_FIT_DEFAULTS.minScale);
    const fit = fitTextBox(params(capacity - 0.01));
    expect(fit.scale).toBe(TEXT_FIT_DEFAULTS.minScale);
    expect(fit.overflow).toBe(false);
  });

  it("la capacité suit la hauteur mesurée, donc fontScale (police agrandie)", () => {
    // Police à 140 % : 5 lignes à cette taille rendent 5 * 1,4 * LINE à l'échelle 1.
    const big = LINE * 1.4;
    const fit5 = fitTextBox(params(0, { measureHeight: (s) => 2 * PAD + 5 * big * s }));
    expect(fit5.scale).toBeLessThan(1);
    const fit4 = fitTextBox(params(0, { measureHeight: (s) => 2 * PAD + 4 * big * s }));
    expect(fit4.scale).toBe(1);
  });

  it("donne un résultat cohérent sur une boîte minuscule", () => {
    const fit = fitTextBox(params(10, { boxHeight: 40 }));
    expect(fit.maxHeight).toBe(40);
    expect(fit.overflow).toBe(true);
    expect(fit.scale).toBe(TEXT_FIT_DEFAULTS.minScale);
  });
});

describe("échelle du texte du cadre image (#182)", () => {
  // Stage 1024x576 agrandi à 1280x720 (facteur 1,25), voir stage-renderer.ts.
  const SCALE = 1.25;
  const STAGE_H = 576;
  const bodyPx = FRAME_TEXT_REM * 16 * SCALE;
  const linePx = bodyPx * FRAME_TEXT_LINE_HEIGHT;
  const AREA = frameTextAreaHeight(STAGE_H);
  /** Hauteur d'un texte de `lines` lignes à l'échelle de police `scale` (la zone du cadre image n'a pas de marge interne). */
  const heightOf = (lines: number) => (scale: number) => lines * FRAME_TEXT_REM * 16 * FRAME_TEXT_LINE_HEIGHT * scale;

  it("rend un corps de 33 à 35 px et un interligne de 50 à 52 px à 1280x720", () => {
    expect(bodyPx).toBeGreaterThanOrEqual(33);
    expect(bodyPx).toBeLessThanOrEqual(35);
    expect(linePx).toBeGreaterThanOrEqual(50);
    expect(linePx).toBeLessThanOrEqual(52);
  });

  it("garde les marges 14 % / 9 % et 8,1 % du jeu d'origine", () => {
    expect(FRAME_TEXT_AREA.left).toBe(0.14);
    expect(FRAME_TEXT_AREA.right).toBe(0.09);
    expect(AREA / STAGE_H).toBeCloseTo(1 - 2 * FRAME_TEXT_AREA.top, 6);
  });

  it("garde 11 lignes à la taille nominale", () => {
    const fit = fitTextBox({ ...TEXT_FIT_DEFAULTS, boxHeight: AREA, measureHeight: heightOf(11) });
    expect(fit.scale).toBe(1);
    expect(fit.overflow).toBe(false);
  });

  it("réduit une page longue pour la faire tenir dans la zone sans déborder", () => {
    for (const lines of [12, 13, 14, 15]) {
      const fit = fitTextBox({ ...TEXT_FIT_DEFAULTS, boxHeight: AREA, measureHeight: heightOf(lines) });
      expect(fit.overflow).toBe(false);
      expect(fit.scale).toBeLessThan(1);
      expect(heightOf(lines)(fit.scale)).toBeLessThanOrEqual(AREA);
    }
  });

  it("signale le débordement (zone défilable) quand même la police minimale ne suffit pas", () => {
    const fit = fitTextBox({ ...TEXT_FIT_DEFAULTS, boxHeight: AREA, measureHeight: heightOf(40) });
    expect(fit.overflow).toBe(true);
    expect(fit.scale).toBe(TEXT_FIT_DEFAULTS.minScale);
    expect(fit.maxHeight).toBe(AREA);
  });

  it("réduit aussi la police sur une petite zone plutôt que de déborder", () => {
    const small = frameTextAreaHeight(240);
    const fit = fitTextBox({ ...TEXT_FIT_DEFAULTS, boxHeight: small, measureHeight: heightOf(8) });
    expect(fit.scale).toBeLessThan(1);
  });
});
