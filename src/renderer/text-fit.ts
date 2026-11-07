/**
 * Ajustement de la police pour les pages longues (#161, #163).
 *
 * Fonction pure, séparée du renderer pour être testée sans DOM : les mesures
 * (hauteur du texte à une échelle de police donnée) sont fournies par l'appelant.
 *
 * Règle (#163) : la boîte de texte est **fixe** (position et hauteur constantes à toutes
 * les pages, voir `textBoxHeight`) ; seul change la taille de la police.
 * - une page qui tient à la taille nominale la garde ;
 * - sinon la police diminue par pas de `step` jusqu'à `minScale` (fraction de la taille
 *   nominale) ;
 * - en dessous, `overflow` vaut vrai et la zone de texte défile.
 */

export interface TextFitParams {
  /** Hauteur de la boîte de texte, constante (marges comprises). */
  boxHeight: number;
  /** Échelle minimale de la police (fraction de la taille nominale). */
  minScale: number;
  /** Pas de réduction de l'échelle. */
  step: number;
  /** Hauteur de la zone de texte (marges comprises) à l'échelle donnée. */
  measureHeight: (scale: number) => number;
}

export interface TextFit {
  /** Échelle de police à appliquer (1 = taille nominale). */
  scale: number;
  /** Hauteur maximale de la zone de texte : celle de la boîte (au-delà, elle défile). */
  maxHeight: number;
  /** Vrai si le texte ne tient pas même à l'échelle minimale. */
  overflow: boolean;
}

export const TEXT_FIT_DEFAULTS = {
  /** Hauteur de la boîte en fraction de la hauteur de scène : ~6 lignes à la taille nominale. */
  boxHeightRatio: 0.47,
  minScale: 0.7,
  step: 0.05,
} as const;

/** Hauteur fixe de la boîte de texte pour une scène de `stageHeight` (même valeur à toutes les pages). */
export function textBoxHeight(stageHeight: number): number {
  return stageHeight * TEXT_FIT_DEFAULTS.boxHeightRatio;
}

export function fitTextBox(p: TextFitParams): TextFit {
  const steps = Math.round((1 - p.minScale) / p.step);
  for (let i = 0; i <= steps; i++) {
    const scale = Math.round((1 - i * p.step) * 1000) / 1000;
    if (p.measureHeight(scale) <= p.boxHeight) return { scale, maxHeight: p.boxHeight, overflow: false };
  }
  return { scale: p.minScale, maxHeight: p.boxHeight, overflow: true };
}
