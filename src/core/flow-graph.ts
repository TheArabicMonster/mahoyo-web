/**
 * Types du flowchart : le graphe d'entrée (`story-graph.json`, produit par `npm run chain`) et
 * la mise en page calculée par `layoutFlowchart` (`flow-layout.ts`).
 *
 * Module pur (sans DOM). Le graphe contient des libellés de choix du jeu : il est généré
 * localement et jamais commité. La mise en page, elle, ne contient que des identifiants,
 * des indices et des coordonnées (aucun texte du jeu).
 */
import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeKind, StoryGraph } from "./story-graph.js";

export type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeKind, StoryGraph };

const NODE_KINDS: readonly string[] = ["normal", "choice", "interlude", "end"];
const EDGE_KINDS: readonly string[] = ["normal", "choice", "conditional"];

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNode(value: unknown): value is GraphNode {
  if (typeof value !== "object" || value === null) return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    n.id.length > 0 &&
    typeof n.file === "string" &&
    typeof n.kind === "string" &&
    NODE_KINDS.includes(n.kind) &&
    isOptionalString(n.chapter) &&
    isOptionalString(n.arc) &&
    isOptionalString(n.thumb)
  );
}

function isEdge(value: unknown): value is GraphEdge {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.from === "string" &&
    typeof e.to === "string" &&
    typeof e.kind === "string" &&
    EDGE_KINDS.includes(e.kind) &&
    isOptionalString(e.choice) &&
    isOptionalString(e.condition)
  );
}

/**
 * Valide un `story-graph.json` désérialisé ; renvoie `null` s'il n'a pas la forme attendue :
 * version 1, nœuds aux identifiants uniques, premier script présent, arêtes dont les deux
 * extrémités sont des nœuds connus.
 */
export function parseStoryGraph(data: unknown): StoryGraph | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || typeof d.first !== "string") return null;
  if (!Array.isArray(d.nodes) || !d.nodes.every(isNode)) return null;
  if (!Array.isArray(d.edges) || !d.edges.every(isEdge)) return null;
  const nodes = d.nodes as GraphNode[];
  const edges = d.edges as GraphEdge[];
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length || !ids.has(d.first)) return null;
  if (!edges.every((e) => ids.has(e.from) && ids.has(e.to))) return null;
  return { version: 1, first: d.first, nodes, edges };
}

/**
 * Découpe un libellé de choix en lignes. Le libellé extrait du jeu peut contenir la séquence
 * littérale « \n » (deux caractères) ou un vrai saut de ligne : les deux séparent les lignes.
 */
export function choiceLabelLines(label: string): string[] {
  return label
    .split(/\\n|\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// ---------------------------------------------------------------------------
// Mise en page
// ---------------------------------------------------------------------------

export type FlowPoint = { x: number; y: number };

/** Dimensions et espacements (unités de la mise en page, ~ pixels à 720p). */
export type FlowLayoutOptions = {
  /** Largeur d'un nœud (défaut 64). */
  nodeWidth?: number;
  /** Hauteur d'un nœud (défaut 40). */
  nodeHeight?: number;
  /** Espace horizontal entre deux nœuds d'un même niveau (défaut 24). */
  gapX?: number;
  /** Espace vertical entre deux niveaux, où passent les arêtes (défaut 44). */
  gapY?: number;
  /** Marge intérieure d'un groupe (défaut 16). */
  groupPadding?: number;
  /** Hauteur réservée au titre d'un groupe (défaut 32). */
  groupHeaderHeight?: number;
  /** Espace vertical entre deux groupes (défaut 40). */
  groupGap?: number;
  /** Espace entre la section principale et la section Bonus (défaut 72). */
  sectionGap?: number;
  /** Hauteur réservée au titre de la section Bonus (défaut 40). */
  sectionHeaderHeight?: number;
  /** Espace entre le contenu et la colonne des interludes partagés (défaut 64). */
  hubGap?: number;
};

/**
 * Section de la page.
 *
 * - `main` : nœuds atteignables depuis le premier script.
 * - `bonus` : tout le reste (scripts isolés, pages annexes jamais atteintes depuis le début).
 */
export type FlowSectionId = "main" | "bonus";

export type FlowNodeLayout = {
  id: string;
  /** Coin supérieur gauche. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Niveau (rang) dans son groupe, 0 pour le premier ; 0 pour un interlude partagé. */
  level: number;
  /** Identifiant du groupe (`FlowGroupLayout.id`) ; `null` pour un interlude partagé. */
  groupId: string | null;
  section: FlowSectionId;
  /**
   * Interlude partagé (nœud d'interlude sans chapitre ni arc, comme `teatime`) : un seul nœud
   * placé dans la colonne de droite, à la hauteur moyenne de ses voisins.
   */
  hub: boolean;
  /** Fin atteignable depuis le début du jeu (voir `FlowLayout.endings`). */
  ending: boolean;
};

export type FlowGroupLayout = {
  /** `main:<arc>` ou `bonus:<arc>` (arc de remplacement : chapitre, puis `_`). */
  id: string;
  section: FlowSectionId;
  /** Chapitre (`id` d'une entrée de `story-chain.json.chapters`) : sert à trouver le titre. */
  chapter?: string;
  /** Titre de la page du graphe d'origine. */
  arc?: string;
  /** Rectangle du groupe, marge et zone de titre comprises. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Hauteur de la zone de titre, en haut du rectangle. */
  headerHeight: number;
  /** Nœuds du groupe, dans l'ordre du graphe. */
  nodeIds: string[];
};

export type FlowSectionLayout = {
  id: FlowSectionId;
  y: number;
  height: number;
  /** Hauteur de la zone de titre en haut de la section (0 pour la section principale). */
  headerHeight: number;
  groupIds: string[];
  /** Tous les nœuds de la section, interludes partagés compris. */
  nodeIds: string[];
};

export type FlowEdgeLayout = {
  /** Indice de l'arête dans `graph.edges` (le libellé et la condition restent dans le graphe). */
  index: number;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  /**
   * Tracé orthogonal de `from` vers `to` : la dernière extrémité est celle de la flèche.
   * Chaque segment est horizontal ou vertical.
   */
  points: FlowPoint[];
  /** Arête qui remonte (cycle) : tracée de bas en haut. */
  reversed: boolean;
  /** Arête entre deux groupes ou vers un interlude partagé : passe par les couloirs entre niveaux. */
  external: boolean;
};

export type FlowLayout = {
  width: number;
  height: number;
  /** Dans l'ordre du graphe. */
  nodes: FlowNodeLayout[];
  /** Arêtes dont les deux extrémités sont des nœuds connus, dans l'ordre du graphe. */
  edges: FlowEdgeLayout[];
  /** Dans l'ordre de lecture (de haut en bas). */
  groups: FlowGroupLayout[];
  /** `main` puis `bonus`, chacune présente seulement si elle contient des nœuds. */
  sections: FlowSectionLayout[];
  /**
   * Fins atteignables depuis le premier script : nœuds sans successeur de la section
   * principale. Les extrémités isolées (section Bonus) n'y figurent pas et ne se comptent pas.
   */
  endings: string[];
};

/** Titre à afficher pour un groupe : libellé du chapitre s'il est connu, sinon titre de l'arc. */
export function groupTitle(group: Pick<FlowGroupLayout, "chapter" | "arc">, chapters?: readonly { id: string; label: string }[]): string {
  const label = group.chapter === undefined ? undefined : chapters?.find((c) => c.id === group.chapter)?.label;
  return label ?? group.arc ?? group.chapter ?? "";
}

/**
 * Compteur de fins pour l'affichage : `total` ne compte que les fins atteignables depuis le
 * début du jeu, `reached` celles déjà vues (les identifiants hors de cette liste, comme les
 * extrémités de la section Bonus, sont ignorés).
 */
export function endingProgress(layout: Pick<FlowLayout, "endings">, reachedIds: Iterable<string>): { reached: number; total: number } {
  const seen = new Set(reachedIds);
  return { reached: layout.endings.filter((id) => seen.has(id)).length, total: layout.endings.length };
}
