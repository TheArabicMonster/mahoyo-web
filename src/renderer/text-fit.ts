/**
 * Métriques du texte de jeu, **en unités logiques du stage 1024×576** (#314, arbitrage #319/#320).
 *
 * ## Provenance (`FRAME_TEXT_LAYOUT`)
 *
 * | Paramètre | Valeur logique | Source | Mesure capture | Statut |
 * |---|---|---|---|---|
 * | Marge horizontale (gauche/droite) | 69 | `MessageLayer_config` (extraction locale, non commitée) ; valeur 69 expliquant la capture (les libellés 142/142/69/69 ayant probablement été lus dans un ordre L/T/R/B) | 85,4 px écran / 1,25 = 68,3 ≈ 69 | hypothèse |
 * | Marge verticale (haut/bas) | 46,7 | capture #173 : 8,1 % de 576 = 46,7 | 8,1 % × 576 | hypothèse |
 * | Taille de police | 26 | `MessageLayer_config` (`defaultFontSize = 26`) | pas des glyphes = 1 em | hypothèse |
 * | Interligne (pas de ligne) | 40,8 | capture #173 : 51 px écran / 1,25 | 77/1080 × 576 | hypothèse |
 *
 * Les valeurs restent des **hypothèses** sourcées (capture = oracle) tant que le TJS de config
 * n'est pas extractible du dépôt : aucune valeur n'est spécifique à une scène, et elles sont
 * toutes exprimées en px du repère logique 1024×576, converties à l'écran par `STAGE_SCALE` (×1,25).
 *
 * Le port n'ajuste **pas** la police pour faire tenir une page (#314) : la pagination est scriptée
 * (`[p]`/`@pg`). Une page plus longue que la zone est découpée, jamais réduite.
 */

/** Disposition logique du texte (px du repère 1024×576). */
export const FRAME_TEXT_LAYOUT = {
  /** Marges horizontales (gauche et droite) : 69 px logiques. */
  marginX: 69,
  /** Marges verticales (haut et bas) : 46,7 px logiques (capture 8,1 % × 576). */
  marginY: 46.7,
  /** Taille de police : 26 px logiques (`defaultFontSize`). */
  fontSize: 26,
  /** Pas de ligne : 40,8 px logiques (51 px écran / 1,25). */
  lineHeight: 40.8,
} as const;

/**
 * Table de provenance de la mise en page (#320) : chaque valeur reste une **hypothèse** tant que le
 * TJS de configuration n'est pas extractible du dépôt. `capture` = mesure oracle normalisée en px
 * écran 1280×720 (stage ×1,25) ; `tolerance` = écart admis en px écran.
 */
export const FRAME_TEXT_LAYOUT_PROVENANCE = [
  {
    param: "marginX",
    logical: 69,
    source: "MessageLayer_config (extraction locale non commitée), valeur 69 expliquant la capture",
    captureScreenPx: 85.4,
    toleranceScreenPx: 1.5,
    status: "hypothèse",
  },
  {
    param: "marginY",
    logical: 46.7,
    source: "capture #173 : 8,1 % × 576",
    captureScreenPx: 46.7 * 1.25,
    toleranceScreenPx: 1.5,
    status: "hypothèse",
  },
  {
    param: "fontSize",
    logical: 26,
    source: "MessageLayer_config (defaultFontSize = 26) ; pas des glyphes = 1 em",
    captureScreenPx: 26 * 1.25,
    toleranceScreenPx: 0.65, // 2 % de 32,5 px
    status: "hypothèse",
  },
  {
    param: "lineHeight",
    logical: 40.8,
    source: "capture #173 : 51 px écran / 1,25",
    captureScreenPx: 51,
    toleranceScreenPx: 1,
    status: "hypothèse",
  },
] as const;

/** Taille de police par défaut (px du repère 1024×576). */
export const FRAME_TEXT_FONT_SIZE = FRAME_TEXT_LAYOUT.fontSize;
/** Taille de police en rem CSS pour `1rem = 16px` dans le repère du stage. */
export const FRAME_TEXT_REM = FRAME_TEXT_FONT_SIZE / 16;
/** Interligne CSS = pas de ligne / taille de police. */
export const FRAME_TEXT_LINE_HEIGHT = FRAME_TEXT_LAYOUT.lineHeight / FRAME_TEXT_LAYOUT.fontSize;

/** Marges de la couche message, en fractions de la scène (69/1024, 46,7/576). */
export const FRAME_TEXT_AREA = {
  left: FRAME_TEXT_LAYOUT.marginX / 1024,
  right: FRAME_TEXT_LAYOUT.marginX / 1024,
  top: FRAME_TEXT_LAYOUT.marginY / 576,
  bottom: FRAME_TEXT_LAYOUT.marginY / 576,
} as const;

/** Hauteur de la boîte de texte en fraction de la hauteur de scène (style « boîte » de repli). */
const TEXT_BOX_HEIGHT_RATIO = 0.47;

/** Hauteur fixe de la boîte de texte pour une scène de `stageHeight` (même valeur à toutes les pages). */
export function textBoxHeight(stageHeight: number): number {
  return stageHeight * TEXT_BOX_HEIGHT_RATIO;
}

/** Hauteur de la zone de texte du style « cadre image » pour une scène de `stageHeight`. */
export function frameTextAreaHeight(stageHeight: number): number {
  return stageHeight * (1 - FRAME_TEXT_AREA.top - FRAME_TEXT_AREA.bottom);
}

/** Largeur utile du texte dans le repère logique (1024 − 2 × marge horizontale). */
export function frameTextWidth(stageWidth = 1024): number {
  return stageWidth - 2 * FRAME_TEXT_LAYOUT.marginX;
}

/** Nombre de caractères pleine chasse par ligne (dérivé de l'em et de la largeur utile). */
export function frameTextCharsPerLine(stageWidth = 1024): number {
  return Math.floor(frameTextWidth(stageWidth) / FRAME_TEXT_LAYOUT.fontSize);
}

/**
 * Nombre d'unités de texte à atténuer : le texte déjà lu de la page (avant le dernier clic sur une
 * attente `[l]`) reste affiché, atténué (capture d'origine, #173).
 */
export function dimmedUnitCount(readUnits: number, shownUnits: number): number {
  return Math.max(0, Math.min(readUnits, shownUnits));
}
