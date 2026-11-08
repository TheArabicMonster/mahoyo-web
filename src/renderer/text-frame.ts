/**
 * Style de la fenêtre de message (#173).
 *
 * Dans le jeu d'origine, `@position frame=txtwindowNN` pose une image 1024x576 sur toute la
 * scène : un voile noir fondu sur les côtés (alpha 153, 128 ou 102 pour 00, 01 et 02) et deux
 * ornements en arabesque, en haut et en bas. Le texte est écrit par-dessus, sans autre boîte.
 * Voir `docs/KAG_MAHOYO_SEMANTICS.md` §6.
 *
 * Fonctions pures, testées sans DOM.
 */
import type { TextboxState } from "@/kag/events.js";

/**
 * Cadre appliqué tant qu'aucun `@position frame=` n'a été lu (début de partie, script lancé
 * directement). Hypothèse : le défaut du moteur (fixé hors des scripts) n'est pas connu ;
 * `txtwindow02` est le cadre le plus employé du corpus, le premier posé par l'histoire (`1-1.ks`)
 * et le seul vérifié sur une capture.
 */
export const DEFAULT_FRAME_IMAGE = "txtwindow02";

export type FrameStyle =
  /** Image de cadre plein écran, texte posé sur la scène. `image` vaut `null` sans cadre visible. */
  | { mode: "image"; image: string | null }
  /** Ancienne boîte arrondie du port (#163) : repli quand l'image de cadre manque. */
  | { mode: "box" };

/**
 * Choisit le style de la fenêtre de message.
 * - cadre masqué (`@invisibleframe`) : texte seul sur la scène ;
 * - `frame=""` : texte seul ;
 * - image absente des assets (`failed`) : repli sur l'ancienne boîte, pour garder le texte lisible.
 */
export function resolveFrameStyle(textbox: TextboxState, failed: ReadonlySet<string>): FrameStyle {
  const image = textbox.frameImage ?? DEFAULT_FRAME_IMAGE;
  if (image !== "" && failed.has(image)) return { mode: "box" };
  if (!textbox.frame || image === "") return { mode: "image", image: null };
  return { mode: "image", image };
}

/**
 * Opacité de l'image de cadre selon le réglage « opacité de la boîte » (0 à 1, défaut 0,8).
 * Le défaut rend l'image telle quelle (le voile d'origine est déjà dans son alpha) ; une valeur
 * plus basse l'éclaircit proportionnellement.
 */
export const DEFAULT_TEXTBOX_OPACITY = 0.8;
export function frameImageOpacity(setting: number): number {
  if (!Number.isFinite(setting)) return 1;
  return Math.max(0, Math.min(1, setting / DEFAULT_TEXTBOX_OPACITY));
}

/**
 * Indicateurs d'attente (`linebreak_a`, `pagebreak_a`) : bandes horizontales de 40 vignettes.
 * La feuille qui tourne marque une attente de ligne `[l]`, le livre qui se feuillette une fin de
 * page (capture d'origine : livre collé au dernier mot avant `@pg`).
 */
export const CLICK_GLYPHS = {
  line: { storage: "linebreak_a", width: 24, height: 24, frames: 40 },
  page: { storage: "pagebreak_a", width: 32, height: 24, frames: 40 },
} as const;
