/**
 * Liste des chapitres affichée dans Extra > Archive (écran titre, HUD-08).
 *
 * Fonction pure : transforme la table d'enchaînement (`story-chain.json`) en
 * `ScriptSummary`. Sans table, le jeu se limite à son prologue.
 */
import type { StoryChain } from "@/core/story-chain.js";
import type { ScriptSummary } from "./types.js";

/** Liste de repli quand la table d'enchaînement n'est pas disponible. */
export const DEFAULT_CHAPTERS: readonly ScriptSummary[] = [
  { id: "1-0", label: "Prologue", file: "1-0.ks", arc: "Prologue" },
];

export function chaptersToScripts(chain: StoryChain | null | undefined): ScriptSummary[] {
  const chapters = chain?.chapters;
  if (!chapters || chapters.length === 0) return [...DEFAULT_CHAPTERS];
  return chapters.map((c) => ({ id: c.id, label: c.label, file: c.file, arc: c.arc }));
}

/** Ce que le player sait de la progression du joueur au moment d'afficher le titre. */
export type ChapterUnlockInput = {
  /** Scripts ouverts au moins une fois (`StoryProgress.visited`). */
  visited: readonly string[];
  /** Scripts lus jusqu'au `@return` (`StoryProgress.finished`). */
  finished?: readonly string[];
  /** Chapitres terminés (réglage historique `mahoyo.progress`). */
  completed?: readonly string[];
  /** Une autosave existe : le joueur a déjà commencé une partie. */
  hasContinue?: boolean;
};

/**
 * Règle de déverrouillage de l'Archive (HUD-08, #199 ; docs/DESIGN.md §9.9).
 *
 * Un chapitre est déverrouillé quand le joueur en a **atteint le script d'entrée** (`visited`), l'a
 * terminé (`finished` / `completed`). Une autosave déverrouille le premier chapitre (la progression
 * par scène a pu être créée après la partie). Rien d'autre : aucun chapitre « suivant » n'est offert,
 * pour ne pas révéler ce que le joueur n'a pas encore vu. Sans progression ni autosave, la liste est
 * vide et l'entrée Archive est grisée. L'ordre de `chapters` est conservé.
 */
export function unlockedChapterIds(chapters: readonly ScriptSummary[], input: ChapterUnlockInput): string[] {
  const seen = new Set<string>([...input.visited, ...(input.finished ?? []), ...(input.completed ?? [])]);
  const unlocked = chapters.filter((c) => seen.has(c.id)).map((c) => c.id);
  const first = chapters[0];
  if (input.hasContinue && first && !unlocked.includes(first.id)) unlocked.unshift(first.id);
  return unlocked;
}
