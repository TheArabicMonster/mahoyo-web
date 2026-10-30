/**
 * Liste des chapitres affichée à l'écran titre et dans le flowchart.
 *
 * Fonction pure : transforme la table d'enchaînement (`story-chain.json`) en
 * `ScriptSummary`. Sans table, le jeu se limite à son prologue.
 */
import type { StoryChain } from "@/core/story-chain.js";
import type { ScriptSummary } from "./types.js";

/** Liste de repli quand la table d'enchaînement n'est pas disponible. */
export const DEFAULT_CHAPTERS: readonly ScriptSummary[] = [
  { id: "1-0", label: "Prologue", file: "1-0.ks", x: 512, y: 80, arc: "Prologue" },
];

/** Espacement vertical entre deux chapitres dans le flowchart (unités logiques). */
const ROW_HEIGHT = 70;

export function chaptersToScripts(chain: StoryChain | null | undefined): ScriptSummary[] {
  const chapters = chain?.chapters;
  if (!chapters || chapters.length === 0) return [...DEFAULT_CHAPTERS];
  return chapters.map((c, i) => ({ id: c.id, label: c.label, file: c.file, arc: c.arc, x: 512, y: 80 + i * ROW_HEIGHT }));
}
