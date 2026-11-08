import type { UIView } from "@/ui/types.js";
import "./night.css";

/** Classe du fond « nuit bleue » (HUD-02 / #188). À poser sur le conteneur d'un écran système. */
export const NIGHT_CLASS = "mh-ui-night";
/** Variante voile translucide (scène visible dessous, menu système). */
export const NIGHT_VEIL_CLASS = "mh-ui-night-veil";
/** Paramètre d'URL qui active la démonstration : `?night` (ou `?night=1`). */
export const NIGHT_DEMO_PARAM = "night";

/** Écrans du slot `menu` sur lesquels la démonstration pose le fond (les autres gardent leur habillage). */
const NIGHT_DEMO_SCREENS: ReadonlySet<UIView["screen"]> = new Set(["backlog"]);

/** Écrans qui portent toujours la nuit bleue, sans `?night` (HUD-10 / #196 : sauvegarde et chargement). */
const NIGHT_FIXED_SCREENS: ReadonlySet<UIView["screen"]> = new Set(["save", "load"]);

/** Vrai si la chaîne de requête active la démonstration (`?night`, `?night=1`, pas `?night=0`/`false`). */
export function isNightDemoRequested(search: string): boolean {
  const value = new URLSearchParams(search).get(NIGHT_DEMO_PARAM);
  return value !== null && value !== "0" && value !== "false";
}

/**
 * Pose (ou retire) `mh-ui-night` sur le conteneur de l'écran : toujours pour les écrans de `NIGHT_FIXED_SCREENS`,
 * sur demande (`?night`) pour les écrans de démonstration. Sinon la classe est retirée : les autres écrans sont inchangés.
 */
export function syncNightDemo(
  el: HTMLElement,
  screen: UIView["screen"],
  search: string = typeof window === "undefined" ? "" : window.location.search,
): void {
  el.classList.toggle(
    NIGHT_CLASS,
    NIGHT_FIXED_SCREENS.has(screen) || (isNightDemoRequested(search) && NIGHT_DEMO_SCREENS.has(screen)),
  );
}
