/**
 * Métriques du texte de jeu, **en unités logiques du stage 1024×576** (#314, arbitrage #319/#320).
 *
 * ## Modèle moteur : `config.tjs` (non commité, assets locaux)
 *
 * Fichier lu : `/Users/nomade/github/mahoyo-web-poc/tools/output/decrypted/data/override/config.tjs`,
 * **sha256 `82ea1af8b44663097027965ba4e868e3e402b487b853298a5c2df4b2e6006893`**. Dans
 * `MessageLayer_config` (ordre L, R, T, B — **aucune inversion de lecture**) :
 * `marginL = marginR = 142`, `marginT = marginB = 69`, `mw = 1024`, `mh = 576`,
 * `defaultFontSize = 26`, `defaultLineSpacing = 18` (→ pas de ligne 44), `defaultPitch = 1`,
 * `frameGraphic = "txtwindow01"`.
 *
 * ## Capture = oracle
 *
 * La capture vidéo du jeu original (référence visuelle du propriétaire) donne un texte à ≈6,7 % de
 * largeur (≈69 px logiques), une marge verticale de 8,1 % (46,7 px) et un pas de ligne de 40,8 px
 * (51 px écran). Elle **contredit donc la config** sur l'axe horizontal (69 vs 142), vertical
 * (46,7 vs 69) et l'interligne (40,8 vs 44). Cause probable : version localisée/override,
 * `@position frame=` ou graphique de cadre — **non tranchée**. Le port applique les valeurs
 * calibrées sur la capture, pas celles de la config, pour ressembler au jeu du propriétaire.
 *
 * ## Valeurs appliquées (aucune constante par scène)
 *
 * | Paramètre | Appliqué (logique) | Config (logique) | Capture | Statut |
 * |---|---|---|---|---|
 * | Marge horizontale g/d | 69 | 142 | 85,4 px écran / 1,25 ≈ 68,3 | hypothèse (contredit la config) |
 * | Marge verticale h/b | 46,7 | 69 | 8,1 % × 576 | hypothèse (contredit la config) |
 * | Police | 26 | 26 | pas des glyphes = 1 em | hypothèse (confirmée) |
 * | Pas de ligne | 40,8 | 44 (26 + 18) | 51 px écran / 1,25 | hypothèse (contredit la config) |
 *
 * `defaultPitch = 1` confirme l'absence de `letter-spacing`. Tant que la cause de l'écart
 * config/capture n'est pas tranchée, ces valeurs restent des **hypothèses sourcées**, exprimées en
 * px du repère logique 1024×576 (converties à l'écran par `STAGE_SCALE` ×1,25).
 *
 * Le port n'ajuste **pas** la police pour faire tenir une page (#314) : la pagination est scriptée
 * (`[p]`/`@pg`). Une page plus longue que la zone est découpée, jamais réduite.
 */

/** Empreinte du `config.tjs` de référence (assets locaux, non commité). */
export const ENGINE_CONFIG_SHA256 = "82ea1af8b44663097027965ba4e868e3e402b487b853298a5c2df4b2e6006893";
/** Chemin du `config.tjs` de référence (hors dépôt). */
export const ENGINE_CONFIG_PATH =
  "/Users/nomade/github/mahoyo-web-poc/tools/output/decrypted/data/override/config.tjs";

/** Disposition logique du texte (px du repère 1024×576), calibrée sur la capture (oracle). */
export const FRAME_TEXT_LAYOUT = {
  /** Marges horizontales (gauche et droite) : 69 px logiques (config : 142). */
  marginX: 69,
  /** Marges verticales (haut et bas) : 46,7 px logiques (config : 69). */
  marginY: 46.7,
  /** Taille de police : 26 px logiques (`defaultFontSize`, confirmé par la capture). */
  fontSize: 26,
  /** Pas de ligne : 40,8 px logiques (config : 44). */
  lineHeight: 40.8,
} as const;

/**
 * Table de provenance de la mise en page (#320) : **config = modèle, capture = oracle**. Chaque
 * entrée donne la valeur appliquée (calibrée capture), la valeur de config, la mesure capture et le
 * statut. `contradiction` documente les axes où la capture contredit la config.
 */
export const FRAME_TEXT_LAYOUT_PROVENANCE = [
  {
    param: "marginX",
    appliedLogical: 69,
    configLogical: 142,
    configSource: "MessageLayer_config marginL = marginR = 142 (ordre L,R,T,B ; lecture confirmée)",
    captureScreenPx: 85.4,
    toleranceScreenPx: 1.5,
    status: "hypothèse",
    contradiction: true,
    note: "capture ≈6,7 % de largeur → 68,3 px logiques ; config non explicative (cause non tranchée)",
  },
  {
    param: "marginY",
    appliedLogical: 46.7,
    configLogical: 69,
    configSource: "MessageLayer_config marginT = marginB = 69 (ordre L,R,T,B ; lecture confirmée)",
    captureScreenPx: 46.7 * 1.25,
    toleranceScreenPx: 1.5,
    status: "hypothèse",
    contradiction: true,
    note: "capture #173 : 8,1 % × 576 = 46,7 px logiques ; config non explicative",
  },
  {
    param: "fontSize",
    appliedLogical: 26,
    configLogical: 26,
    configSource: "MessageLayer_config defaultFontSize = 26",
    captureScreenPx: 26 * 1.25,
    toleranceScreenPx: 0.65, // 2 % de 32,5 px
    status: "hypothèse",
    contradiction: false,
    note: "pas des glyphes = 1 em ; confirmé par la capture",
  },
  {
    param: "lineHeight",
    appliedLogical: 40.8,
    configLogical: 44, // defaultFontSize 26 + defaultLineSpacing 18
    configSource: "MessageLayer_config defaultFontSize = 26, defaultLineSpacing = 18 → 44",
    captureScreenPx: 51,
    toleranceScreenPx: 1,
    status: "hypothèse",
    contradiction: true,
    note: "capture #173 : 51 px écran / 1,25 = 40,8 px logiques ; config non explicative",
  },
] as const;

/** Taille de police par défaut (px du repère 1024×576). *//** Taille de police par défaut (px du repère 1024×576). */
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
