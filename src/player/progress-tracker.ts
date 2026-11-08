/**
 * Enregistrement de la progression par scène (flowchart) pendant la partie.
 *
 * `StoryProgress` est un blob unique (`mahoyo.story-progress`) : le suivi garde donc la
 * progression en mémoire (chargée une fois), applique les événements avec les fonctions pures
 * de `story-progress.ts` et réécrit le blob complet, sans jamais enchaîner de lecture-modification-
 * écriture concurrentes. Les écritures sont sérialisées et regroupées ; un échec d'écriture
 * (quota dépassé, stockage inaccessible) est toléré : la progression reste en mémoire et la
 * prochaine modification retente.
 *
 * Ne manipule que des identifiants de scripts (nom sans extension, en minuscules).
 */
import type { StoryChain } from "@/core/story-chain.js";
import type { StoryProgress, TakenChoice } from "@/ui/types.js";
import type { SettingsStore } from "./settings-store.js";
import {
  emptyStoryProgress,
  markFinished,
  markVisited,
  mergeStoryProgress,
  recordChoice,
  recordEnding,
} from "./story-progress.js";

/** Identifiant de script : nom de fichier sans extension, en minuscules (même règle que le graphe). */
export function scriptIdOf(file: string): string {
  return file.toLowerCase().replace(/\.ks$/, "");
}

/**
 * Fins du parcours : scripts terminaux (sans suite dans la table) ATTEIGNABLES depuis le
 * premier script. Les bonus isolés, sans lien avec le parcours, n'en font pas partie.
 *
 * Même modèle que le graphe de scénario : une route `a -> to` suivie de `then` se déroule
 * en `a -> to -> then[0] -> ...`.
 */
export function reachableEndings(chain: StoryChain): ReadonlySet<string> {
  const successors = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const list = successors.get(from);
    if (list) list.push(to);
    else successors.set(from, [to]);
  };
  for (const [script, routes] of Object.entries(chain.next)) {
    const from = scriptIdOf(script);
    for (const route of routes) {
      let previous = scriptIdOf(route.to);
      link(from, previous);
      for (const after of route.then ?? []) {
        const target = scriptIdOf(after);
        link(previous, target);
        previous = target;
      }
    }
  }
  const reached = new Set<string>();
  const stack = [scriptIdOf(chain.first)];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    stack.push(...(successors.get(id) ?? []));
  }
  return new Set([...reached].filter((id) => !successors.has(id)));
}

export class ProgressTracker {
  private progress: StoryProgress = emptyStoryProgress();
  private endings: ReadonlySet<string> = new Set();
  private loaded = false;
  /** Des modifications ne sont pas encore écrites. */
  private pendingWrite = false;
  private writing: Promise<void> | null = null;
  private warned = false;

  constructor(
    private readonly store: Pick<SettingsStore, "loadStoryProgress" | "saveStoryProgress">,
    private readonly warn: (message: string, error?: unknown) => void = console.warn,
  ) {}

  /**
   * Charge la progression enregistrée et la fusionne avec ce qui a pu être noté avant la fin
   * du chargement (union : rien n'est perdu). Aucune écriture n'a lieu avant ce point, pour ne
   * pas écraser le stockage avec une progression partielle.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.store.loadStoryProgress().catch(() => emptyStoryProgress());
    this.progress = mergeStoryProgress(stored, this.progress);
    this.loaded = true;
    this.kick();
  }

  /** Définit les fins du parcours (voir `reachableEndings`) ; absent : aucune fin n'est notée. */
  setEndings(endings: ReadonlySet<string>): void {
    this.endings = endings;
  }

  /** Copie de la progression courante (immuable). */
  get snapshot(): StoryProgress {
    return this.progress;
  }

  /** Un script démarre (ou est restauré) : visité, et fin atteinte s'il est terminal. */
  enter(scriptId: string): void {
    this.update((p) => {
      const visited = markVisited(p, scriptId);
      return this.endings.has(scriptId) ? recordEnding(visited, scriptId) : visited;
    });
  }

  /** Un script est lu jusqu'à son `@return`. */
  finish(scriptId: string): void {
    this.update((p) => markFinished(p, scriptId));
  }

  /** Une arête de choix est prise (scripts uniquement, jamais le libellé). */
  choose(from: string, to: string): void {
    this.update((p) => recordChoice(p, from, to));
  }

  /** Ajoute des arêtes (chargement d'une sauvegarde) : union, ne retire jamais rien. */
  absorbChoices(choices: readonly TakenChoice[]): void {
    this.update((p) => choices.reduce((acc, c) => recordChoice(acc, c.from, c.to), p));
  }

  /** Résolue quand toutes les écritures demandées jusqu'ici sont terminées (tests, fermeture). */
  async flush(): Promise<void> {
    await this.load();
    while (this.writing) await this.writing;
  }

  private update(fn: (p: StoryProgress) => StoryProgress): void {
    const next = fn(this.progress);
    if (next === this.progress) return;
    this.progress = next;
    this.pendingWrite = true;
    this.kick();
  }

  private kick(): void {
    if (!this.loaded || !this.pendingWrite || this.writing) return;
    this.writing = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pendingWrite) {
        this.pendingWrite = false;
        try {
          await this.store.saveStoryProgress(this.progress);
        } catch (err) {
          // Quota dépassé ou stockage inaccessible : la progression reste en mémoire pour la session.
          if (!this.warned) {
            this.warned = true;
            this.warn("progression du flowchart non enregistrée", err);
          }
        }
      }
    } finally {
      this.writing = null;
    }
  }
}
