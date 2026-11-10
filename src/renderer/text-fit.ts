/**
 * Métriques du texte de jeu, **dérivées du moteur** (#161, #163, #314).
 *
 * Sources : `data/override/config.tjs`, fonction `MessageLayer_config` (valeurs injectées dans
 * `data/override/messagelayer.tjs`) :
 * - marges de la couche message : `marginL = marginR = 142`, `marginT = marginB = 69`, pour une
 *   scène `mw × mh = 1024 × 576` (repère logique du stage) ;
 * - taille de police par défaut : `defaultFontSize = 26` (px du repère logique) ;
 * - interligne : `defaultLineSpacing = 18` → pas de ligne = `fontSize + lineSpacing` = 44 px.
 *
 * Le port n'ajuste plus la police pour faire tenir le texte (#314) : police constante et zone
 * découpée comme la couche de message du moteur (la pagination est scriptée via `[p]`/`@pg`).
 */

/** Fonte par défaut du message (px du repère 1024×576, `config.tjs`). */
export const FRAME_TEXT_FONT_SIZE = 26;
/** Espace entre deux lignes (`config.tjs` `defaultLineSpacing`). */
export const FRAME_TEXT_LINE_SPACING = 18;
/** Taille de police en rem CSS pour `1rem = 16px` dans le repère du stage. */
export const FRAME_TEXT_REM = FRAME_TEXT_FONT_SIZE / 16;
/** Interligne CSS = pas de ligne moteur / taille de police. */
export const FRAME_TEXT_LINE_HEIGHT = (FRAME_TEXT_FONT_SIZE + FRAME_TEXT_LINE_SPACING) / FRAME_TEXT_FONT_SIZE;

/** Marges de la couche message, en fractions de la scène (142/1024, 69/576). */
export const FRAME_TEXT_AREA = {
  left: 142 / 1024,
  right: 142 / 1024,
  top: 69 / 576,
  bottom: 69 / 576,
} as const;

/** Hauteur de la boîte de texte en fraction de la hauteur de scène : ~6 lignes à la taille nominale. */
const TEXT_BOX_HEIGHT_RATIO = 0.47;

/** Hauteur fixe de la boîte de texte pour une scène de `stageHeight` (même valeur à toutes les pages). */
export function textBoxHeight(stageHeight: number): number {
  return stageHeight * TEXT_BOX_HEIGHT_RATIO;
}

/** Hauteur de la zone de texte du style « cadre image » pour une scène de `stageHeight`. */
export function frameTextAreaHeight(stageHeight: number): number {
  return stageHeight * (1 - FRAME_TEXT_AREA.top - FRAME_TEXT_AREA.bottom);
}

/**
 * Nombre d'unités de texte à atténuer : le texte déjà lu de la page (avant le dernier clic sur une
 * attente `[l]`) reste affiché, atténué (capture d'origine, #173).
 */
export function dimmedUnitCount(readUnits: number, shownUnits: number): number {
  return Math.max(0, Math.min(readUnits, shownUnits));
}
