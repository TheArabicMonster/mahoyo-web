/**
 * Progression par scène (script) pour le flowchart : fonctions pures, sans stockage.
 *
 * Ne contient que des identifiants de scripts. Aucun libellé de choix n'est jamais conservé :
 * `normalizeStoryProgress` écarte tout champ inconnu, ce qui protège aussi les données importées.
 */
import type { StoryProgress, TakenChoice } from "@/ui/types.js";

export function emptyStoryProgress(): StoryProgress {
  return { visited: [], finished: [], choices: [], endings: [] };
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) if (typeof v === "string" && v !== "") out.add(v);
  return [...out];
}

function choiceList(value: unknown): TakenChoice[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: TakenChoice[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const { from, to } = v as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string" || from === "" || to === "") continue;
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}

/**
 * Normalise une valeur lue (stockage, import) : tolère `null`, un type inattendu, des champs
 * manquants ou en trop. Le résultat ne contient que les quatre champs connus.
 */
export function normalizeStoryProgress(raw: unknown): StoryProgress {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return emptyStoryProgress();
  const r = raw as Record<string, unknown>;
  return {
    visited: idList(r.visited),
    finished: idList(r.finished),
    choices: choiceList(r.choices),
    endings: idList(r.endings),
  };
}

function withId(list: readonly string[], id: string): readonly string[] {
  return id === "" || list.includes(id) ? list : [...list, id];
}

/** Marque un script comme visité. Renvoie le même objet s'il l'était déjà. */
export function markVisited(p: StoryProgress, scriptId: string): StoryProgress {
  const visited = withId(p.visited, scriptId);
  return visited === p.visited ? p : { ...p, visited };
}

/** Marque un script comme terminé (lu jusqu'au `@return`) ; il compte aussi comme visité. */
export function markFinished(p: StoryProgress, scriptId: string): StoryProgress {
  const visited = withId(p.visited, scriptId);
  const finished = withId(p.finished, scriptId);
  return visited === p.visited && finished === p.finished ? p : { ...p, visited, finished };
}

/** Enregistre l'arête prise `from -> to` (scripts uniquement, jamais le libellé). */
export function recordChoice(p: StoryProgress, from: string, to: string): StoryProgress {
  if (from === "" || to === "" || p.choices.some((c) => c.from === from && c.to === to)) return p;
  return { ...p, choices: [...p.choices, { from, to }] };
}

/** Marque une fin atteinte ; le script de fin compte aussi comme visité. */
export function recordEnding(p: StoryProgress, scriptId: string): StoryProgress {
  const visited = withId(p.visited, scriptId);
  const endings = withId(p.endings, scriptId);
  return visited === p.visited && endings === p.endings ? p : { ...p, visited, endings };
}

/** Union de deux progressions (import de sauvegarde, fusion entre appareils). */
export function mergeStoryProgress(a: StoryProgress, b: StoryProgress): StoryProgress {
  return normalizeStoryProgress({
    visited: [...a.visited, ...b.visited],
    finished: [...a.finished, ...b.finished],
    choices: [...a.choices, ...b.choices],
    endings: [...a.endings, ...b.endings],
  });
}
