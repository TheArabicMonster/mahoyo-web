/**
 * Enchaînement des scripts du jeu.
 *
 * Les scripts narratifs se terminent par `@return` : dans le jeu d'origine, un
 * plugin (« tracer ») les appelle l'un après l'autre selon un graphe stocké dans
 * `main.gc`. Le pipeline en extrait une table `story-chain.json`, chargée ici.
 * Ce module est pur : il valide la table et choisit la suite d'un script.
 */

/** Une sortie possible d'un script. */
export type ChainRoute = {
  /** Script suivant (nom de fichier `.ks`). */
  to: string;
  /**
   * Scripts joués ensuite, dans l'ordre, avant de consulter à nouveau la table.
   * Sert aux interludes partagés par plusieurs chapitres (ex. le goûter entre
   * deux chapitres) dont la suite dépend du chapitre qui les précède.
   */
  then?: string[];
  /** Expression TJS ; la route ne s'applique que si elle est vraie. */
  condition?: string;
  /** Libellé de l'option quand la route est un choix du joueur. */
  choice?: string;
};

export type StoryChain = {
  version: 1;
  /** Premier script du jeu. */
  first: string;
  /** Sorties de chaque script, dans l'ordre du graphe d'origine. */
  next: Record<string, ChainRoute[]>;
};

export type NextStep =
  /** Fin de l'histoire (ou script absent de la table). */
  | { kind: "end" }
  | { kind: "script"; file: string; then: string[] }
  /** Le joueur choisit parmi plusieurs suites. */
  | { kind: "choice"; options: { label: string; file: string; then: string[] }[] };

function isRoute(value: unknown): value is ChainRoute {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.to === "string" &&
    r.to.length > 0 &&
    (r.then === undefined || (Array.isArray(r.then) && r.then.every((s) => typeof s === "string" && s.length > 0))) &&
    (r.condition === undefined || typeof r.condition === "string") &&
    (r.choice === undefined || typeof r.choice === "string")
  );
}

/** Valide une table désérialisée ; null si elle n'a pas la forme attendue. */
export function parseStoryChain(data: unknown): StoryChain | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || typeof d.first !== "string" || typeof d.next !== "object" || d.next === null) {
    return null;
  }
  const next: Record<string, ChainRoute[]> = {};
  for (const [script, routes] of Object.entries(d.next as Record<string, unknown>)) {
    if (!Array.isArray(routes) || !routes.every(isRoute)) return null;
    next[script] = routes;
  }
  return { version: 1, first: d.first, next };
}

/** Les noms de scripts se comparent sans tenir compte de la casse (comme KiriKiri). */
function lookup(chain: StoryChain, script: string): ChainRoute[] {
  const exact = chain.next[script];
  if (exact) return exact;
  const lower = script.toLowerCase();
  for (const [key, routes] of Object.entries(chain.next)) {
    if (key.toLowerCase() === lower) return routes;
  }
  return [];
}

/**
 * Choisit la suite d'un script terminé.
 *
 * - Toutes les routes libellées : c'est un menu. Une condition sert à afficher ou
 *   masquer une option (fausse = masquée). Deux options ou plus : menu, même si
 *   elles mènent au même script ; une seule : on l'enchaîne.
 * - Sinon, une route conditionnelle vraie l'emporte sur les routes sans condition ;
 *   sans condition vraie, on garde les routes sans condition.
 * - Une seule suite (après dédoublonnage) : on l'enchaîne ; plusieurs sans libellé :
 *   la première du graphe (déterministe).
 *
 * `evalCondition` évalue une condition ; sans lui, les routes conditionnelles
 * sont ignorées.
 */
export function resolveNext(
  chain: StoryChain,
  script: string,
  evalCondition?: (expression: string) => boolean,
): NextStep {
  const routes = lookup(chain, script);
  if (routes.length === 0) return { kind: "end" };

  const sequence = (r: ChainRoute): string => [r.to, ...(r.then ?? [])].join(">");
  const dedupe = (list: ChainRoute[]): ChainRoute[] => {
    const out: ChainRoute[] = [];
    for (const route of list) {
      if (!out.some((u) => sequence(u) === sequence(route) && u.choice === route.choice)) out.push(route);
    }
    return out;
  };

  // Menu : toutes les routes sont des options libellées.
  if (routes.every((r) => r.choice)) {
    const shown = dedupe(
      routes.filter((r) => r.condition === undefined || (evalCondition !== undefined && evalCondition(r.condition))),
    );
    if (shown.length === 0) return { kind: "end" };
    if (shown.length === 1) return { kind: "script", file: shown[0]!.to, then: shown[0]!.then ?? [] };
    return {
      kind: "choice",
      options: shown.map((r) => ({ label: r.choice!, file: r.to, then: r.then ?? [] })),
    };
  }

  const conditionalTrue = routes.filter(
    (r) => r.condition !== undefined && evalCondition !== undefined && evalCondition(r.condition),
  );
  const candidates = conditionalTrue.length > 0 ? conditionalTrue : routes.filter((r) => r.condition === undefined);

  const unique = dedupe(candidates);
  if (unique.length === 0) return { kind: "end" };
  return { kind: "script", file: unique[0]!.to, then: unique[0]!.then ?? [] };
}
