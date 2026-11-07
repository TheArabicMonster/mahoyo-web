import { describe, it, expect } from "vitest";
import { fitTextBox, textBoxHeight, TEXT_FIT_DEFAULTS, type TextFitParams } from "@/renderer/text-fit.js";

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
