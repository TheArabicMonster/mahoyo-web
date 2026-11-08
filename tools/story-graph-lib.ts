/**
 * Construction du graphe de scénario (`story-graph.json`) à partir de la table
 * d'enchaînement (`story-chain.json`).
 *
 * Logique pure (sans disque ni réseau) : voir `story-chain.ts` pour l'I/O.
 * Le résultat est déterministe : mêmes entrées, même sortie (ordre des nœuds et
 * des arêtes compris), car il ne dépend que de l'ordre de la table.
 */
import type { StoryChain } from "../src/core/story-chain.js";
import type { GraphEdge, GraphNode, GraphNodeKind, StoryGraph } from "../src/core/story-graph.js";
import type { ScriptPlacement } from "./story-chain-lib.js";

export type GraphOptions = {
  /** Page et chapitre de chaque script (clés = identifiants de nœud) : voir `scriptPlacements`. */
  placements?: ReadonlyMap<string, ScriptPlacement>;
  /** Première image de chaque script (clés = identifiants de nœud) : voir `firstImageOf`. */
  thumbs?: ReadonlyMap<string, string>;
};

/** Identifiant de nœud : nom du script sans extension, en minuscules. */
export function nodeId(script: string): string {
  return script.toLowerCase().replace(/\.ks$/, "");
}

/**
 * Construit le graphe.
 *
 * - Un nœud par script cité par la table (clé de `next`, cible `to` ou élément de `then`).
 * - Une arête par route. `then` est déroulé : `a -> to`, puis `to -> then[0]`, `then[0] -> then[1]`…
 *   (arêtes `normal`) ; le libellé et la condition restent sur la première arête.
 * - `interlude` : script cité mais sans entrée propre dans `next` (la table n'en donne pas aux
 *   scripts partagés entre plusieurs blocs du graphe d'origine : un seul nœud, plusieurs arêtes
 *   entrantes). Le premier script du jeu n'en est jamais un.
 * - `choice` : toutes les routes du script sont libellées (même règle que `resolveNext`).
 * - `end` : aucune arête sortante.
 */
export function buildStoryGraph(chain: StoryChain, options: GraphOptions = {}): StoryGraph {
  const files = new Map<string, string>(); // id -> nom de fichier, dans l'ordre de première apparition
  const note = (script: string): string => {
    const id = nodeId(script);
    if (!files.has(id)) files.set(id, script);
    return id;
  };

  note(chain.first);
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  const addEdge = (edge: GraphEdge): void => {
    const key = [edge.from, edge.to, edge.kind, edge.choice, edge.condition].join("\u0000");
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push(edge);
  };

  const ownEntries = new Set<string>();
  const choiceNodes = new Set<string>();
  for (const [script, routes] of Object.entries(chain.next)) {
    const from = note(script);
    ownEntries.add(from);
    if (routes.length > 0 && routes.every((r) => r.choice)) choiceNodes.add(from);
    for (const route of routes) {
      const to = note(route.to);
      const edge: GraphEdge = { from, to, kind: route.choice ? "choice" : route.condition !== undefined ? "conditional" : "normal" };
      if (route.choice) edge.choice = route.choice;
      if (route.condition !== undefined) edge.condition = route.condition;
      addEdge(edge);
      let previous = to;
      for (const after of route.then ?? []) {
        const target = note(after);
        addEdge({ from: previous, to: target, kind: "normal" });
        previous = target;
      }
    }
  }

  const firstId = nodeId(chain.first);
  const outgoing = new Set(edges.map((e) => e.from));
  const placements = options.placements;
  const thumbs = options.thumbs;

  const nodes: GraphNode[] = [...files].map(([id, file]) => {
    let kind: GraphNodeKind = "normal";
    if (!ownEntries.has(id) && id !== firstId) kind = "interlude";
    else if (choiceNodes.has(id)) kind = "choice";
    else if (!outgoing.has(id)) kind = "end";

    const node: GraphNode = { id, file, kind };
    const placement = placements?.get(id);
    if (placement) {
      if (placement.chapter !== undefined) node.chapter = placement.chapter;
      node.arc = placement.arc;
    }
    const thumb = thumbs?.get(id);
    if (thumb !== undefined) node.thumb = thumb;
    return node;
  });

  return { version: 1, first: firstId, nodes, edges };
}

/** Stockages de fond qui ne sont que des aplats de couleur : inutiles comme vignette. */
const SOLID_BACKGROUNDS = new Set(["black", "white", "red", "gray"]);

/**
 * Nom de la première image de fond d'un script (`@bg storage=…` ou `[bg storage=…]`),
 * sans extension ; les aplats de couleur sont ignorés. Clé seulement : l'image n'est jamais lue.
 */
export function firstImageOf(source: string): string | undefined {
  const tag = /(?:^[ \t]*@|\[)bg\s[^\]\n]*?\bstorage=([^\s\]]+)/gm;
  for (const match of source.matchAll(tag)) {
    const name = match[1]!.replace(/^["']|["']$/g, "").replace(/\.[A-Za-z0-9]{2,4}$/, "");
    if (name !== "" && !SOLID_BACKGROUNDS.has(name.toLowerCase())) return name;
  }
  return undefined;
}

/** Résumé chiffré d'un graphe, pour la sortie de la commande et les vérifications locales. */
export type GraphSummary = {
  nodes: number;
  edges: number;
  choiceNodes: number;
  choiceEdges: number;
  /** Arêtes portant une condition (`conditional`, ou `choice` à option conditionnelle). */
  conditionalEdges: number;
  interludes: number;
  ends: number;
  /** Fins qu'on atteint en partant du premier script. */
  reachableEnds: number;
  /** Nœuds sans arête, entrante ni sortante (bonus isolés). */
  isolated: number;
};

export function summarizeGraph(graph: StoryGraph): GraphSummary {
  const count = (kind: GraphNodeKind): number => graph.nodes.filter((n) => n.kind === kind).length;
  const successors = new Map<string, string[]>();
  const touched = new Set<string>();
  for (const e of graph.edges) {
    (successors.get(e.from) ?? successors.set(e.from, []).get(e.from)!).push(e.to);
    touched.add(e.from).add(e.to);
  }
  const reached = new Set<string>();
  const stack = [graph.first];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    stack.push(...(successors.get(id) ?? []));
  }
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    choiceNodes: count("choice"),
    choiceEdges: graph.edges.filter((e) => e.kind === "choice").length,
    conditionalEdges: graph.edges.filter((e) => e.condition !== undefined).length,
    interludes: count("interlude"),
    ends: count("end"),
    reachableEnds: graph.nodes.filter((n) => n.kind === "end" && reached.has(n.id)).length,
    isolated: graph.nodes.filter((n) => !touched.has(n.id)).length,
  };
}
