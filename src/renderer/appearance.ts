/**
 * Apparence des calques KAG (`type=`, `effect=`, `blur`, `brightness`, `contrast`) : traduction
 * vers CSS (`filter`, `mix-blend-mode`) et vers de petits filtres SVG pour ce que le CSS ne sait
 * pas exprimer exactement.
 *
 * Sémantique vérifiée dans les sources du moteur installé (non commité) :
 * - constantes de `type` : `data/scenario/noiseplugin.tjs` (commentaires numériques) ;
 * - application des effets : `data/override/animationlayer.override.tjs`
 *   (`applyColorCorrection_in_onPaint`, `getLayerEffect`) ;
 * - effets nommés : `data/others/envcolor.ksc` (données du jeu, non installées par le pipeline) ;
 * - `type` : `Layer.type` (docs KiriKiri), masque ignoré pour les modes non alpha.
 */

/** Apparence d'un calque, telle que lue par le parser / le runtime. */
export type Appearance = {
  type?: number;
  effect?: string;
  brightness?: number;
  contrast?: number;
  blurx?: number;
  blury?: number;
};

/**
 * Modes de fusion KiriKiri (`Layer.type`) → `mix-blend-mode` CSS.
 *
 * `null` = pas d'équivalent CSS raisonnable (documenté) ; on n'applique alors rien.
 * Valeurs numériques : `data/scenario/noiseplugin.tjs` (commentaires « = N ») ; les modes `ltPs*`
 * (13-28) sont les modes Photoshop du moteur.
 */
export const LAYER_TYPE_BLEND_MODES: Readonly<Record<number, string | null>> = {
  1: null, // ltOpaque : rectangle opaque, masque ignoré → traité comme normal (approx.)
  2: "normal", // ltAlpha
  3: "plus-lighter", // ltAdditive (addition saturée)
  4: null, // ltSubtractive : pas d'équivalent CSS
  5: "multiply", // ltMultiplicative
  8: "color-dodge", // ltDodge
  9: "darken", // ltDarken
  10: "lighten", // ltLighten
  11: "screen", // ltScreen
  12: "plus-lighter", // ltAddAlpha (approx.)
  13: "normal", // ltPsNormal
  14: "plus-lighter", // ltPsAdditive = « éclaircir linéaire » (addition)
  15: "color-burn", // ltPsSubtractive = « brûler linéaire » (approx.)
  16: "multiply", // ltPsMultiplicative
  17: "screen", // ltPsScreen
  18: "overlay", // ltPsOverlay
  19: "hard-light", // ltPsHardLight
  20: "soft-light", // ltPsSoftLight
  21: "color-dodge", // ltPsColorDodge
  22: "color-dodge", // ltPsColorDodge5 (formule ≤5, approx.)
  23: "color-burn", // ltPsColorBurn
  24: "lighten", // ltPsLighten
  25: "darken", // ltPsDarken
  26: "difference", // ltPsDifference
  27: "difference", // ltPsDifference5 (approx.)
  28: "exclusion", // ltPsExclusion
};

/** Modes connus mais sans équivalent CSS exact (documentés dans la PR / le suivi). */
export const UNMAPPED_LAYER_TYPES = new Set([1, 4]);

/**
 * Effets intrinsèques au moteur (`AnimationLayer.override.tjs`, liste par défaut) : filtre CSS
 * direct. `mono<rrggbb>` et `red`/`green`/`blue` passent par un filtre SVG.
 */
const CSS_EFFECTS: Readonly<Record<string, string>> = {
  monocro: "grayscale(1)",
  monochrome: "grayscale(1)",
  sepia: "sepia(1)", // approx. : le moteur fait niveaux de gris puis gamma par canal
  nega: "invert(1)",
};

/** Effets nommés du jeu (`envcolor.ksc`) : reconnus mais non appliqués (données non installées). */
const ENV_EFFECT_RE = /[\u3040-\u30ff\u3005\u4e00-\u9fff]|^mh/;

/** Fabrique de filtres SVG (mis en cache par le renderer, un par valeur). */
export interface SvgFilterRegistry {
  /** Aplat de couleur conservant l'alpha de la source (`effect=mono<rrggbb>`). */
  monoFilter(color: string): string;
  /** Teinte d'un canal à partir de la luminance (effets `red`, `green`, `blue`, approx.). */
  channelFilter(channel: "red" | "green" | "blue"): string;
  /** Luminosité (décalage) et contraste (facteur) : `feComponentTransfer` linéaire. */
  brightnessContrastFilter(brightness: number, contrastFactor: number): string;
  /** Flou gaussien anisotrope (`stdDeviation` X Y), approximation du double box blur du moteur. */
  blurFilter(sigmaX: number, sigmaY: number): string;
}

/** Retourne le filtre CSS d'un effet intrinsèque, ou `null` si l'effet n'est pas appliqué. */
export function effectFilter(effect: string | undefined, svg: SvgFilterRegistry): string | null {
  if (!effect) return null;
  const css = CSS_EFFECTS[effect];
  if (css) return css;
  const mono = /^mono([0-9a-f]{6})$/i.exec(effect);
  if (mono) return svg.monoFilter(`#${mono[1]!}`);
  if (effect === "red" || effect === "green" || effect === "blue") return svg.channelFilter(effect);
  if (effect.startsWith("0x")) return null; // gamma direct : pas d'équivalent CSS (documenté)
  if (ENV_EFFECT_RE.test(effect)) return null; // effet d'ambiance envcolor.ksc (non installé)
  return null;
}

/** Vrai si l'effet est un effet d'ambiance du jeu (non appliqué, à signaler une fois). */
export function isEnvironmentEffect(effect: string | undefined): boolean {
  if (!effect || CSS_EFFECTS[effect]) return false;
  if (/^mono[0-9a-f]{6}$/i.test(effect)) return false;
  if (effect === "red" || effect === "green" || effect === "blue") return false;
  return ENV_EFFECT_RE.test(effect);
}

/** Facteur de contraste CSS équivalent à `contrast` (−127..127) : `(c + 255) / 255`. */
export function contrastFactor(contrast: number): number {
  return Math.max(0, (contrast + 255) / 255);
}

/**
 * Sigma gaussien équivalent au double box blur du moteur (rayon r, appliqué deux fois) :
 * variance d'une boîte de largeur 2r+1 = (r²+r)/3, doublée → sigma = sqrt(2r(r+1)/3).
 */
export function boxBlurSigma(radius: number): number {
  if (radius <= 0) return 0;
  return Math.sqrt((2 * radius * (radius + 1)) / 3);
}

/**
 * Construit la valeur CSS `filter` complète dans l'ordre du moteur : effet → luminosité/contraste
 * → flou. Retourne `""` si aucun filtre ne s'applique.
 */
export function appearanceFilter(appearance: Appearance, svg: SvgFilterRegistry): string {
  const parts: string[] = [];
  const effect = effectFilter(appearance.effect, svg);
  if (effect) parts.push(effect);

  const brightness = appearance.brightness ?? 0;
  const contrast = appearance.contrast ?? 0;
  const factor = contrast !== 0 ? contrastFactor(contrast) : 1;
  // Le moteur fait `_image.light(brightness, 0)` puis `_image.doContrast(contrast)`.
  if (brightness !== 0 || contrast !== 0) {
    parts.push(svg.brightnessContrastFilter(brightness, factor));
  }

  const blurx = appearance.blurx ?? 0;
  const blury = appearance.blury ?? 0;
  if (blurx !== 0 || blury !== 0) {
    const sx = boxBlurSigma(blurx);
    const sy = boxBlurSigma(blury);
    // Flou isotrope : la fonction CSS `blur()` (plus légère) suffit et suit bien les transitions.
    if (Math.abs(sx - sy) < 0.01) parts.push(`blur(${Math.max(sx, sy).toFixed(2)}px)`);
    else parts.push(svg.blurFilter(sx, sy));
  }
  return parts.join(" ");
}

/** `mix-blend-mode` CSS pour un `type=` KiriKiri ; `""` si non mappé (aucun blend). */
export function appearanceBlendMode(type: number | undefined): string {
  if (type === undefined) return "";
  const mode = LAYER_TYPE_BLEND_MODES[type];
  return mode ?? "";
}

/**
 * Applique apparence + mode de fusion à un élément (idempotent : retire les valeurs quand
 * l'apparence est vide). Utilisé pour les sprites, les partbg, les fonds et les changements
 * discrets des animations.
 */
export function applyAppearance(
  el: HTMLElement,
  appearance: Appearance | undefined,
  svg: SvgFilterRegistry,
): void {
  const filter = appearance ? appearanceFilter(appearance, svg) : "";
  if (filter) el.style.filter = filter;
  else el.style.removeProperty("filter");
  const blend = appearance ? appearanceBlendMode(appearance.type) : "";
  if (blend) el.style.mixBlendMode = blend;
  else el.style.removeProperty("mix-blend-mode");
}
