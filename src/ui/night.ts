import type { UIView } from "@/ui/types.js";
import "./night.css";

/** Classe du fond « nuit bleue » (HUD-02 / #188). À poser sur le conteneur d'un écran système. */
export const NIGHT_CLASS = "mh-ui-night";
/** Variante voile translucide (scène visible dessous, menu système). */
export const NIGHT_VEIL_CLASS = "mh-ui-night-veil";
/** Paramètre d'URL qui active la démonstration : `?night` (ou `?night=1`). */
export const NIGHT_DEMO_PARAM = "night";

/** Écrans du slot `menu` sur lesquels la démonstration pose le fond (les autres gardent leur habillage). */
const NIGHT_DEMO_SCREENS: ReadonlySet<UIView["screen"]> = new Set(["title", "save", "load", "backlog"]);

/** Vrai si la chaîne de requête active la démonstration (`?night`, `?night=1`, pas `?night=0`/`false`). */
export function isNightDemoRequested(search: string): boolean {
  const value = new URLSearchParams(search).get(NIGHT_DEMO_PARAM);
  return value !== null && value !== "0" && value !== "false";
}

/**
 * Écran de démonstration activable : pose (ou retire) `mh-ui-night` sur le conteneur de l'écran.
 * Sans `?night`, ne fait rien d'autre que retirer la classe : les écrans existants sont inchangés.
 */
export function syncNightDemo(
  el: HTMLElement,
  screen: UIView["screen"],
  search: string = typeof window === "undefined" ? "" : window.location.search,
): void {
  el.classList.toggle(NIGHT_CLASS, isNightDemoRequested(search) && NIGHT_DEMO_SCREENS.has(screen));
}
