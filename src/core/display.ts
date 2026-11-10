/**
 * Échelle du viewport et préréglages de taille (#177).
 *
 * Le jeu travaille en 1280×720 logiques. Le navigateur ne peut pas redimensionner
 * la fenêtre du système : les préréglages « Mode fenêtré » plafonnent donc la taille
 * d'affichage, et les modes plein écran choisissent l'échelle interne.
 */
import type { FullscreenMode, WindowSize } from "@/renderer/types.js";

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const WINDOW_SIZE_OPTIONS: readonly { value: WindowSize; label: string }[] = [
  { value: "fit", label: "Adapter à l'écran" },
  { value: "1024x576", label: "1024 × 576" },
  { value: "1920x1080", label: "1920 × 1080" },
  { value: "1600x900", label: "1600 × 900" },
  { value: "1440x810", label: "1440 × 810" },
  { value: "1280x720", label: "1280 × 720" },
  { value: "800x450", label: "800 × 450" },
  { value: "640x360", label: "640 × 360" },
] as const;

export function parseWindowSize(size: WindowSize): { width: number; height: number } | null {
  if (size === "fit") return null;
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Calcule l'échelle à appliquer au viewport.
 * - plein écran : `fit` = tout visible, `fill` = tout l'écran (recadrage), `none` = 1:1 ;
 * - fenêtré : `fit` = ajusté à la fenêtre, sinon plafonné à la taille choisie.
 */
export function computeViewportScale(
  viewportWidth: number,
  viewportHeight: number,
  opts: { fullscreen: boolean; mode: FullscreenMode; windowSize: WindowSize },
): number {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const fit = Math.min(width / GAME_WIDTH, height / GAME_HEIGHT);
  if (opts.fullscreen) {
    if (opts.mode === "fill") return Math.max(width / GAME_WIDTH, height / GAME_HEIGHT);
    if (opts.mode === "none") return 1;
    return fit;
  }
  const target = parseWindowSize(opts.windowSize);
  if (!target) return fit;
  return Math.min(fit, target.width / GAME_WIDTH, target.height / GAME_HEIGHT);
}

/** Applique l'échelle au viewport (transform-origin est centré dans `main.css`). */
export function applyViewportScale(element: HTMLElement, scale: number): void {
  element.style.transform = `scale(${scale})`;
}

/**
 * Disposition du viewport (#210) : paysage = repère logique 1280×720 mis à l'échelle ;
 * portrait = **aucune mise à l'échelle** (1 px logique = 1 px CSS réel), le viewport prend la
 * taille réelle de la fenêtre pour que la scène 16:9 occupe la largeur et que le texte dispose
 * d'une zone dédiée sous la scène (décision propriétaire 4). Les préréglages de taille et les
 * modes plein écran ne s'appliquent qu'au paysage.
 */
export type ViewportLayout = {
  portrait: boolean;
  /** Échelle appliquée au viewport (`1` en portrait). */
  scale: number;
  /** Dimensions logiques du viewport (celles posées en style inline). */
  width: number;
  height: number;
};

export function computeViewportLayout(
  viewportWidth: number,
  viewportHeight: number,
  opts: { fullscreen: boolean; mode: FullscreenMode; windowSize: WindowSize },
): ViewportLayout {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  if (height > width) {
    // Portrait : le viewport épouse la fenêtre (pas de transformation), pour que les écrans
    // système et la zone de texte soient rendus à taille réelle (lisibilité, cibles tactiles).
    return { portrait: true, scale: 1, width, height };
  }
  return { portrait: false, scale: computeViewportScale(width, height, opts), width: GAME_WIDTH, height: GAME_HEIGHT };
}

/** Applique la disposition au viewport : taille logique, échelle et repère `data-layout`. */
export function applyViewportLayout(element: HTMLElement, layout: ViewportLayout): void {
  if (layout.portrait) {
    element.dataset.layout = "portrait";
  } else {
    delete element.dataset.layout;
  }
  element.style.width = `${layout.width}px`;
  element.style.height = `${layout.height}px`;
  applyViewportScale(element, layout.scale);
}
