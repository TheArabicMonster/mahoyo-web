import { describe, it, expect } from "vitest";
import { fitTextBox, TEXT_FIT_DEFAULTS, type TextFitParams } from "@/renderer/text-fit.js";

const LINE = 38.4;
const PAD = 20;

/** Hauteur d'un texte de `lines` lignes à l'échelle 1 ; les lignes se réduisent avec l'échelle, sans nouveau retour à la ligne. */
function heightOf(lines: number): (scale: number) => number {
  return (scale) => 2 * PAD + lines * LINE * scale;
}

function params(lines: number, over: Partial<TextFitParams> = {}): TextFitParams {
  return {
    ...TEXT_FIT_DEFAULTS,
    stageHeight: 576,
    nominalBottom: 28.8,
    paddingY: PAD,
    lineHeight: LINE,
    measureHeight: heightOf(lines),
    ...over,
  };
}

describe("fitTextBox", () => {
  it("garde la position et la taille nominales jusqu'à 5 lignes", () => {
    for (const lines of [1, 2, 3, 4, 5]) {
      const fit = fitTextBox(params(lines));
      expect(fit.raised).toBe(false);
      expect(fit.scale).toBe(1);
      expect(fit.bottom).toBe(28.8);
      expect(fit.overflow).toBe(false);
    }
  });

  it("remonte le texte au-delà de 5 lignes sans réduire la police quand il tient", () => {
    const fit = fitTextBox(params(7));
    expect(fit.raised).toBe(true);
    expect(fit.scale).toBe(1);
    expect(fit.overflow).toBe(false);
    // Le bas des lignes (boîte moins la marge) reste au-dessus de 76 % de la hauteur.
    const textBottomY = 576 - fit.bottom - PAD;
    expect(textBottomY).toBeLessThanOrEqual(576 * 0.76 + 1e-9);
    // Et la boîte tient dans la scène.
    expect(fit.bottom + heightOf(7)(fit.scale)).toBeLessThanOrEqual(576 - 12);
  });

  it("ne remonte jamais la boîte plus bas que la position nominale", () => {
    const fit = fitTextBox(params(7, { safeBottomRatio: 0.99 }));
    expect(fit.bottom).toBe(28.8);
  });

  it("réduit la police par pas de 5 % quand le texte est trop long", () => {
    const fit = fitTextBox(params(13));
    expect(fit.raised).toBe(true);
    expect(fit.scale).toBeLessThan(1);
    expect(fit.scale).toBeGreaterThanOrEqual(0.75);
    expect(Math.abs(fit.scale * 20 - Math.round(fit.scale * 20))).toBeLessThan(1e-9);
    expect(heightOf(13)(fit.scale)).toBeLessThanOrEqual(fit.maxHeight);
    // C'est la plus grande échelle qui convient.
    expect(heightOf(13)(fit.scale + 0.05)).toBeGreaterThan(fit.maxHeight);
    expect(fit.overflow).toBe(false);
  });

  it("s'arrête au plancher de 75 % et signale le débordement", () => {
    const fit = fitTextBox(params(40));
    expect(fit.scale).toBe(0.75);
    expect(fit.overflow).toBe(true);
    expect(fit.maxHeight).toBeGreaterThan(0);
  });

  it("le seuil de 5 lignes suit la hauteur de ligne (fontScale agrandi)", () => {
    // Police à 130 % : la même hauteur mesurée correspond à moins de lignes.
    const bigLine = LINE * 1.3;
    const fit = fitTextBox(params(0, { lineHeight: bigLine, measureHeight: () => 2 * PAD + 5 * bigLine }));
    expect(fit.raised).toBe(false);
    const fit6 = fitTextBox(params(0, { lineHeight: bigLine, measureHeight: (s) => 2 * PAD + 6 * bigLine * s }));
    expect(fit6.raised).toBe(true);
  });

  it("donne une zone de hauteur positive même sur une scène minuscule", () => {
    const fit = fitTextBox(params(10, { stageHeight: 40 }));
    expect(fit.maxHeight).toBeGreaterThanOrEqual(0);
    expect(fit.overflow).toBe(true);
  });
});
