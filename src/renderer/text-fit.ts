/**
 * Ajustement de la zone de texte pour les pages longues (#161).
 *
 * Fonction pure, séparée du renderer pour être testée sans DOM : les mesures
 * (hauteur du texte à une échelle de police donnée) sont fournies par l'appelant.
 *
 * Règle :
 * - un texte de `longLines` lignes ou moins garde la position nominale (ancré à
 *   `nominalBottom` du bas) et sa taille ;
 * - un texte plus long remonte : le bas de ses lignes reste au-dessus de
 *   `safeBottomRatio` de la hauteur de scène, bande basse réservée aux calques
 *   posés par les scripts (cartes de titre, indicateurs) ;
 * - s'il ne tient pas dans la place restante, la police diminue par pas de
 *   `step` jusqu'à `minScale` (fraction de la taille nominale) ; en dessous,
 *   `overflow` vaut vrai et la boîte défile.
 */

export interface TextFitParams {
  /** Hauteur de la scène (repère logique de la boîte, 576 pour le stage 1024x576). */
  stageHeight: number;
  /** Distance du bas de la boîte au bas de la scène pour un texte court. */
  nominalBottom: number;
  /** Marge intérieure verticale de la zone de texte (haut = bas). */
  paddingY: number;
  /** Hauteur d'une ligne à l'échelle 1. */
  lineHeight: number;
  /** Nombre de lignes au-delà duquel le texte est « long ». */
  longLines: number;
  /** Fraction de la hauteur de scène sous laquelle les lignes de texte ne descendent pas. */
  safeBottomRatio: number;
  /** Marge à conserver en haut de la scène. */
  topMargin: number;
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
  /** Distance du bas de la boîte au bas de la scène. */
  bottom: number;
  /** Hauteur maximale de la boîte (au-delà, elle défile). */
  maxHeight: number;
  /** Vrai si le texte a été remonté (plus de `longLines` lignes). */
  raised: boolean;
  /** Vrai si le texte ne tient pas même à l'échelle minimale. */
  overflow: boolean;
}

export const TEXT_FIT_DEFAULTS = {
  longLines: 5,
  safeBottomRatio: 0.76,
  topMargin: 12,
  minScale: 0.75,
  step: 0.05,
} as const;

export function fitTextBox(p: TextFitParams): TextFit {
  const nominalMax = Math.max(0, p.stageHeight - p.nominalBottom - p.topMargin);
  const lines = (p.measureHeight(1) - 2 * p.paddingY) / p.lineHeight;
  if (lines <= p.longLines) {
    return { scale: 1, bottom: p.nominalBottom, maxHeight: nominalMax, raised: false, overflow: false };
  }

  // Le bas des lignes (hors marge) tombe sur la limite basse de la zone sûre.
  const bottom = Math.max(p.nominalBottom, p.stageHeight - p.stageHeight * p.safeBottomRatio - p.paddingY);
  const maxHeight = Math.max(0, p.stageHeight - bottom - p.topMargin);

  const steps = Math.round((1 - p.minScale) / p.step);
  for (let i = 0; i <= steps; i++) {
    const scale = Math.round((1 - i * p.step) * 1000) / 1000;
    if (p.measureHeight(scale) <= maxHeight) return { scale, bottom, maxHeight, raised: true, overflow: false };
  }
  return { scale: p.minScale, bottom, maxHeight, raised: true, overflow: true };
}
