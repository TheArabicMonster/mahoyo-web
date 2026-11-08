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

/**
 * Zone de texte du style « cadre image » (#173), en fractions de la scène, mesurée sur une capture
 * du jeu d'origine (1920x1080, `1-2.ks`, cadre `txtwindow02`) :
 * - bord gauche des lignes à x = 268/1920 (14 %) ;
 * - bord droit : la coupure des lignes le place entre 1713 et ~1790/1920 (89 % à 93 %), 91 % retenu ;
 * - première ligne de la page centrée à y = 126/1080, interligne 77/1080 : haut de la zone à
 *   126 - 77/2 = 87,5/1080 (8,1 %) ;
 * - bas : non visible sur la capture, pris symétrique du haut (hypothèse).
 */
export const FRAME_TEXT_AREA = {
  left: 0.14,
  right: 0.09,
  top: 0.081,
  bottom: 0.081,
} as const;

/**
 * Échelle du texte du style « cadre image » (#182, docs/ANALYSE_HUD_ORIGINAL.md §2.4 et docs/DESIGN.md §3).
 *
 * Jeu d'origine à 1280x720 : corps ≈ 34 px, interligne ≈ 51 px (77/1080 de la hauteur). Le stage est
 * dessiné en 1024x576 puis agrandi par `STAGE_SCALE` (1,25, voir stage-renderer.ts) : les valeurs CSS
 * ci-dessous sont donc exprimées dans le repère du stage, et c'est le rendu à l'écran qui doit valoir
 * 34 px / 51 px. 1,7 rem x 16 px x 1,25 = 34 px ; interligne 1,5 : 34 x 1,5 = 51 px.
 */
export const FRAME_TEXT_REM = 1.7;
export const FRAME_TEXT_LINE_HEIGHT = 1.5;

/** Hauteur de la zone de texte du style « cadre image » pour une scène de `stageHeight`. */
export function frameTextAreaHeight(stageHeight: number): number {
  return stageHeight * (1 - FRAME_TEXT_AREA.top - FRAME_TEXT_AREA.bottom);
}

/**
 * Nombre d'unités de texte à atténuer : le texte déjà lu de la page (avant le dernier clic sur une
 * attente `[l]`) reste affiché, atténué (capture d'origine, #173). `readUnits` est la longueur du
 * texte au moment de ce clic ; on ne dépasse jamais le texte affiché.
 */
export function dimmedUnitCount(readUnits: number, shownUnits: number): number {
  return Math.max(0, Math.min(readUnits, shownUnits));
}

export function fitTextBox(p: TextFitParams): TextFit {
  const steps = Math.round((1 - p.minScale) / p.step);
  for (let i = 0; i <= steps; i++) {
    const scale = Math.round((1 - i * p.step) * 1000) / 1000;
    if (p.measureHeight(scale) <= p.boxHeight) return { scale, maxHeight: p.boxHeight, overflow: false };
  }
  return { scale: p.minScale, maxHeight: p.boxHeight, overflow: true };
}
