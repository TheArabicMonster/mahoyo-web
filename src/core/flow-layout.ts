/**
 * Mise en page du flowchart : fonction pure, sans DOM.
 *
 * `layoutFlowchart(graph)` place TOUT le graphe, quelle que soit la progression du joueur :
 * les positions sont stables, le masquage anti-spoiler se joue dans le rendu.
 *
 * Principe (méthode en couches, dite de Sugiyama) :
 *
 * 1. Les nœuds sont rangés en groupes (un groupe par page du graphe d'origine, c'est-à-dire par
 *    chapitre) et en deux sections : `main` (atteignable depuis le premier script) et `bonus`
 *    (tout le reste : scripts isolés, pages annexes jamais atteintes depuis le début).
 * 2. Chaque groupe est mis en page seul : cycles cassés par un parcours en profondeur (l'arête
 *    qui remonte est dessinée à l'envers), niveaux par plus long chemin, nœuds factices sur les
 *    arêtes qui sautent des niveaux, ordre dans chaque niveau par barycentres (le meilleur
 *    ordre rencontré, en nombre de croisements), abscisses lissées vers la moyenne des voisins.
 * 3. Les groupes sont empilés de haut en bas dans l'ordre du récit (tri topologique des
 *    groupes, départage par l'ordre du graphe), centrés horizontalement.
 * 4. Un interlude partagé (`kind: "interlude"` sans chapitre ni arc, comme `teatime`) n'appartient
 *    à aucun groupe : il reste un seul nœud, dans une colonne à droite, à la hauteur moyenne de
 *    ses voisins. Pour ordonner les groupes, ses entrées et ses sorties sont appariées dans
 *    l'ordre du graphe (la sortie `s` suit l'entrée la plus proche qui la précède) : le graphe
 *    seul ne dit pas quelle sortie va avec quelle entrée.
 * 5. Toutes les arêtes sont des polylignes orthogonales qui passent dans les couloirs entre les
 *    niveaux, jamais à travers un nœud.
 *
 * Résultat déterministe : mêmes entrées, même sortie (ordre des tableaux et coordonnées).
 */
import type {
  FlowEdgeLayout,
  FlowGroupLayout,
  FlowLayout,
  FlowLayoutOptions,
  FlowNodeLayout,
  FlowPoint,
  FlowSectionId,
  FlowSectionLayout,
  GraphNode,
  StoryGraph,
} from "./flow-graph.js";

export type { FlowLayout, FlowLayoutOptions } from "./flow-graph.js";

const DEFAULTS: Required<FlowLayoutOptions> = {
  nodeWidth: 64,
  nodeHeight: 40,
  gapX: 24,
  gapY: 44,
  groupPadding: 16,
  groupHeaderHeight: 32,
  groupGap: 40,
  sectionGap: 72,
  sectionHeaderHeight: 40,
  hubGap: 64,
};

/** Largeur d'un nœud factice (passage d'une arête qui saute des niveaux) et ses marges. */
const DUMMY_WIDTH = 12;
const DUMMY_GAP = 10;
/** Nombre de balayages d'ordonnancement et de lissage des abscisses. */
const ORDER_SWEEPS = 8;
const COORD_PASSES = 3;
/** Couloirs verticaux (à droite du contenu) des arêtes entre deux groupes. */
const GUTTER_OFFSET = 12;
const GUTTER_STEP = 6;
const GUTTER_TRACKS = 6;

type Resolved = Required<FlowLayoutOptions>;

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** Supprime les points en double et les points alignés avec leurs voisins. */
function simplify(points: FlowPoint[]): FlowPoint[] {
  const out: FlowPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && same(last.x, p.x) && same(last.y, p.y)) continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out[out.length - 3]!;
      const b = out[out.length - 2]!;
      const c = out[out.length - 1]!;
      const collinear = (same(a.x, b.x) && same(b.x, c.x)) || (same(a.y, b.y) && same(b.y, c.y));
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

function mean(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

// ---------------------------------------------------------------------------
// Mise en page d'un groupe
// ---------------------------------------------------------------------------

type GroupLocal = {
  /** Largeur du contenu (sans marge). */
  width: number;
  /** Hauteur des niveaux, de la première ligne à la dernière. */
  rowsHeight: number;
  /** Abscisse locale (bord gauche) et niveau de chaque membre (clé : indice global). */
  place: Map<number, { x: number; level: number }>;
  /** Tracés locaux (y = 0 en haut du premier niveau), clé `<de>><vers>` dans le sens du DAG. */
  routes: Map<string, FlowPoint[]>;
};

/**
 * Met en page un groupe. `members` : indices globaux des nœuds, triés ; `pairs` : arêtes
 * internes sans doublon ni boucle, dans l'ordre du graphe.
 */
function layoutGroup(members: number[], pairs: ReadonlyArray<readonly [number, number]>, o: Resolved): GroupLocal {
  const n = members.length;
  const local = new Map<number, number>();
  members.forEach((g, i) => local.set(g, i));

  // --- 1. Cycles : un parcours en profondeur repère les arêtes qui remontent. ---
  const outAdj: number[][] = members.map(() => []);
  const hasPred = new Array<boolean>(n).fill(false);
  for (const [a, b] of pairs) {
    const u = local.get(a)!;
    const v = local.get(b)!;
    outAdj[u]!.push(v);
    hasPred[v] = true;
  }
  const backEdges = new Set<string>();
  const state = new Array<number>(n).fill(0);
  const roots: number[] = [];
  for (let i = 0; i < n; i++) if (!hasPred[i]) roots.push(i);
  for (let i = 0; i < n; i++) if (hasPred[i]) roots.push(i);
  for (const root of roots) {
    if (state[root] !== 0) continue;
    state[root] = 1;
    const stack: Array<{ v: number; i: number }> = [{ v: root, i: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const next = outAdj[top.v]![top.i++];
      if (next === undefined) {
        state[top.v] = 2;
        stack.pop();
      } else if (state[next] === 1) {
        backEdges.add(`${top.v}>${next}`);
      } else if (state[next] === 0) {
        state[next] = 1;
        stack.push({ v: next, i: 0 });
      }
    }
  }

  // DAG : les arêtes qui remontent sont retournées ; doublons écartés.
  const dagKeys = new Set<string>();
  const dag: Array<[number, number]> = [];
  for (const [a, b] of pairs) {
    const u = local.get(a)!;
    const v = local.get(b)!;
    const [from, to] = backEdges.has(`${u}>${v}`) ? [v, u] : [u, v];
    const key = `${from}>${to}`;
    if (dagKeys.has(key)) continue;
    dagKeys.add(key);
    dag.push([from, to]);
  }

  // --- 2. Niveaux par plus long chemin (Kahn, file FIFO déterministe). ---
  const dagOut: number[][] = members.map(() => []);
  const indeg = new Array<number>(n).fill(0);
  for (const [u, v] of dag) {
    dagOut[u]!.push(v);
    indeg[v]!++;
  }
  const level = new Array<number>(n).fill(0);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]!;
    for (const v of dagOut[u]!) {
      if (level[v]! < level[u]! + 1) level[v] = level[u]! + 1;
      if (--indeg[v]! === 0) queue.push(v);
    }
  }
  const levelCount = n === 0 ? 0 : Math.max(...level) + 1;

  // --- 3. Éléments : nœuds, puis nœuds factices des arêtes longues. ---
  const itemLevel: number[] = [...level];
  const itemWidth: number[] = new Array<number>(n).fill(o.nodeWidth);
  const ups: number[][] = members.map(() => []);
  const downs: number[][] = members.map(() => []);
  const chains: number[][] = [];
  for (const [u, v] of dag) {
    const chain = [u];
    for (let l = level[u]! + 1; l < level[v]!; l++) {
      const id = itemLevel.length;
      itemLevel.push(l);
      itemWidth.push(DUMMY_WIDTH);
      ups.push([]);
      downs.push([]);
      chain.push(id);
    }
    chain.push(v);
    for (let k = 0; k + 1 < chain.length; k++) {
      downs[chain[k]!]!.push(chain[k + 1]!);
      ups[chain[k + 1]!]!.push(chain[k]!);
    }
    chains.push(chain);
  }
  const itemCount = itemLevel.length;
  const isDummy = (item: number): boolean => item >= n;

  // --- 4. Ordre initial : parcours en profondeur depuis les sources. ---
  const seq = new Array<number>(itemCount).fill(-1);
  let counter = 0;
  for (let s = 0; s < itemCount; s++) {
    if (ups[s]!.length > 0 || seq[s]! >= 0) continue;
    const stack = [s];
    while (stack.length > 0) {
      const item = stack.pop()!;
      if (seq[item]! >= 0) continue;
      seq[item] = counter++;
      const children = downs[item]!;
      for (let k = children.length - 1; k >= 0; k--) stack.push(children[k]!);
    }
  }
  const rows: number[][] = Array.from({ length: levelCount }, () => []);
  for (let item = 0; item < itemCount; item++) rows[itemLevel[item]!]!.push(item);
  for (const row of rows) row.sort((a, b) => seq[a]! - seq[b]!);
  const pos = new Array<number>(itemCount).fill(0);
  const refreshPos = (row: number[]): void => row.forEach((item, i) => (pos[item] = i));
  rows.forEach(refreshPos);

  // --- 5. Ordre dans les niveaux : barycentres, meilleur résultat conservé. ---
  const crossings = (): number => {
    let total = 0;
    for (let l = 0; l + 1 < levelCount; l++) {
      const segs: Array<[number, number]> = [];
      for (const a of rows[l]!) for (const b of downs[a]!) segs.push([pos[a]!, pos[b]!]);
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          const si = segs[i]!;
          const sj = segs[j]!;
          if ((si[0] - sj[0]) * (si[1] - sj[1]) < 0) total++;
        }
      }
    }
    return total;
  };
  const sortRow = (l: number, neighbors: number[][]): void => {
    const row = rows[l]!;
    const key = new Map<number, number>();
    for (const item of row) {
      const nb = neighbors[item]!;
      key.set(item, nb.length > 0 ? mean(nb.map((x) => pos[x]!)) : pos[item]!);
    }
    row.sort((a, b) => key.get(a)! - key.get(b)! || pos[a]! - pos[b]!);
    refreshPos(row);
  };
  let best = rows.map((r) => [...r]);
  let bestCross = crossings();
  for (let sweep = 0; sweep < ORDER_SWEEPS && bestCross > 0; sweep++) {
    for (let l = 1; l < levelCount; l++) sortRow(l, ups);
    for (let l = levelCount - 2; l >= 0; l--) sortRow(l, downs);
    const c = crossings();
    if (c < bestCross) {
      bestCross = c;
      best = rows.map((r) => [...r]);
    }
  }
  for (let l = 0; l < levelCount; l++) {
    rows[l] = best[l]!;
    refreshPos(rows[l]!);
  }

  // --- 6. Abscisses : tassement centré, puis lissage vers la moyenne des voisins. ---
  const x = new Array<number>(itemCount).fill(0);
  const sep = (a: number, b: number): number => (isDummy(a) || isDummy(b) ? DUMMY_GAP : o.gapX);
  const rowExtent = (row: number[]): number => {
    let w = 0;
    row.forEach((item, i) => {
      w += itemWidth[item]! + (i > 0 ? sep(row[i - 1]!, item) : 0);
    });
    return w;
  };
  const widest = rows.reduce((m, r) => Math.max(m, rowExtent(r)), 0);
  for (const row of rows) {
    let cursor = (widest - rowExtent(row)) / 2;
    row.forEach((item, i) => {
      if (i > 0) cursor += sep(row[i - 1]!, item);
      x[item] = cursor;
      cursor += itemWidth[item]!;
    });
  }
  const center = (item: number): number => x[item]! + itemWidth[item]! / 2;
  const smooth = (l: number, neighbors: number[][]): void => {
    const row = rows[l]!;
    const want = row.map((item) => {
      const nb = neighbors[item]!;
      return (nb.length > 0 ? mean(nb.map(center)) : center(item)) - itemWidth[item]! / 2;
    });
    const forward = new Array<number>(row.length);
    const backward = new Array<number>(row.length);
    row.forEach((item, i) => {
      forward[i] = i === 0 ? want[i]! : Math.max(want[i]!, forward[i - 1]! + itemWidth[row[i - 1]!]! + sep(row[i - 1]!, item));
    });
    for (let i = row.length - 1; i >= 0; i--) {
      const item = row[i]!;
      backward[i] = i === row.length - 1 ? want[i]! : Math.min(want[i]!, backward[i + 1]! - itemWidth[item]! - sep(item, row[i + 1]!));
    }
    row.forEach((item, i) => (x[item] = (forward[i]! + backward[i]!) / 2));
  };
  for (let pass = 0; pass < COORD_PASSES; pass++) {
    for (let l = 1; l < levelCount; l++) smooth(l, ups);
    for (let l = levelCount - 2; l >= 0; l--) smooth(l, downs);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  for (let item = 0; item < itemCount; item++) {
    minX = Math.min(minX, x[item]!);
    maxX = Math.max(maxX, x[item]! + itemWidth[item]!);
  }
  if (itemCount === 0) {
    minX = 0;
    maxX = 0;
  }
  for (let item = 0; item < itemCount; item++) x[item] = x[item]! - minX;

  // --- 7. Tracés : couloirs entre niveaux, une piste par segment horizontal qui se chevauche. ---
  const rowTop = (l: number): number => l * (o.nodeHeight + o.gapY);
  const rowBottom = (l: number): number => rowTop(l) + o.nodeHeight;
  type Piece = { chain: number; k: number; lo: number; hi: number };
  const gaps: Piece[][] = Array.from({ length: Math.max(levelCount - 1, 0) }, () => []);
  chains.forEach((chain, c) => {
    for (let k = 0; k + 1 < chain.length; k++) {
      const x1 = center(chain[k]!);
      const x2 = center(chain[k + 1]!);
      if (same(x1, x2)) continue;
      gaps[itemLevel[chain[k]!]!]!.push({ chain: c, k, lo: Math.min(x1, x2), hi: Math.max(x1, x2) });
    }
  });
  const trackY = new Map<string, number>();
  gaps.forEach((pieces, l) => {
    pieces.sort((a, b) => a.lo - b.lo || a.hi - b.hi || a.chain - b.chain || a.k - b.k);
    const ends: number[] = [];
    const assigned: number[] = [];
    for (const p of pieces) {
      let t = ends.findIndex((end) => end < p.lo - 0.5);
      if (t < 0) {
        t = ends.length;
        ends.push(p.hi);
      } else {
        ends[t] = p.hi;
      }
      assigned.push(t);
    }
    pieces.forEach((p, i) => trackY.set(`${p.chain}:${p.k}`, rowBottom(l) + ((assigned[i]! + 1) * o.gapY) / (ends.length + 1)));
  });
  const routes = new Map<string, FlowPoint[]>();
  chains.forEach((chain, c) => {
    const first = chain[0]!;
    const pts: FlowPoint[] = [{ x: center(first), y: rowBottom(level[first]!) }];
    for (let k = 0; k + 1 < chain.length; k++) {
      const a = chain[k]!;
      const b = chain[k + 1]!;
      const y = trackY.get(`${c}:${k}`);
      if (y !== undefined) pts.push({ x: center(a), y }, { x: center(b), y });
      pts.push({ x: center(b), y: rowTop(itemLevel[b]!) });
      if (isDummy(b)) pts.push({ x: center(b), y: rowBottom(itemLevel[b]!) });
    }
    routes.set(`${members[chain[0]!]}>${members[chain[chain.length - 1]!]}`, simplify(pts));
  });

  const place = new Map<number, { x: number; level: number }>();
  members.forEach((g, i) => place.set(g, { x: x[i]!, level: level[i]! }));
  return {
    width: maxX - minX,
    rowsHeight: levelCount === 0 ? 0 : rowBottom(levelCount - 1),
    place,
    routes,
  };
}

// ---------------------------------------------------------------------------
// Mise en page globale
// ---------------------------------------------------------------------------

type GroupInfo = {
  id: string;
  section: FlowSectionId;
  members: number[];
  arc?: string;
  chapter?: string;
  local?: GroupLocal;
  width: number;
  height: number;
  x: number;
  y: number;
};

/** Ordre de lecture des groupes d'une section : tri topologique, départage par l'ordre du graphe. */
function orderGroups(groups: GroupInfo[], links: ReadonlyArray<readonly [string, string]>): GroupInfo[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const incoming = new Map<string, Set<string>>(groups.map((g) => [g.id, new Set<string>()]));
  for (const [a, b] of links) {
    if (a !== b && byId.has(a) && byId.has(b)) incoming.get(b)!.add(a);
  }
  const remaining = [...groups];
  const out: GroupInfo[] = [];
  while (remaining.length > 0) {
    const ready = remaining.filter((g) => [...incoming.get(g.id)!].every((p) => !remaining.some((r) => r.id === p)));
    // `remaining` reste dans l'ordre du graphe : la première est la plus tôt dans le graphe.
    const pick = ready[0] ?? remaining[0]!;
    out.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return out;
}

export function layoutFlowchart(graph: StoryGraph, options: FlowLayoutOptions = {}): FlowLayout {
  const o: Resolved = { ...DEFAULTS, ...options };

  // Nœuds uniques (le premier gagne) et arêtes dont les extrémités existent.
  const nodes: GraphNode[] = [];
  const index = new Map<string, number>();
  for (const node of graph.nodes) {
    if (index.has(node.id)) continue;
    index.set(node.id, nodes.length);
    nodes.push(node);
  }
  const N = nodes.length;
  const edges: Array<{ index: number; f: number; t: number; kind: FlowEdgeLayout["kind"] }> = [];
  graph.edges.forEach((e, i) => {
    const f = index.get(e.from);
    const t = index.get(e.to);
    if (f !== undefined && t !== undefined) edges.push({ index: i, f, t, kind: e.kind });
  });
  const succ: number[][] = nodes.map(() => []);
  const pred: number[][] = nodes.map(() => []);
  for (const { f, t } of edges) {
    if (!succ[f]!.includes(t)) succ[f]!.push(t);
    if (!pred[t]!.includes(f)) pred[t]!.push(f);
  }

  // Atteignable depuis le premier script (tout, si le premier script est inconnu).
  const start = index.get(graph.first);
  const reach = new Array<boolean>(N).fill(start === undefined);
  if (start !== undefined) {
    reach[start] = true;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      for (const v of succ[queue[head]!]!) {
        if (reach[v]) continue;
        reach[v] = true;
        queue.push(v);
      }
    }
  }
  const sectionOf = (i: number): FlowSectionId => (reach[i] ? "main" : "bonus");

  // Interludes partagés, puis groupes.
  const hub = nodes.map((nd) => nd.kind === "interlude" && nd.arc === undefined && nd.chapter === undefined);
  const groupOf = new Array<GroupInfo | null>(N).fill(null);
  const groups: GroupInfo[] = [];
  const groupById = new Map<string, GroupInfo>();
  nodes.forEach((nd, i) => {
    if (hub[i]) return;
    const key = nd.arc ?? nd.chapter ?? "";
    const id = `${sectionOf(i)}:${key === "" ? "_" : key}`;
    let g = groupById.get(id);
    if (!g) {
      g = { id, section: sectionOf(i), members: [], width: 0, height: 0, x: 0, y: 0 };
      groupById.set(id, g);
      groups.push(g);
    }
    g.members.push(i);
    if (g.arc === undefined && nd.arc !== undefined) g.arc = nd.arc;
    if (g.chapter === undefined && nd.chapter !== undefined) g.chapter = nd.chapter;
    groupOf[i] = g;
  });

  // Mise en page de chaque groupe.
  const header = o.groupHeaderHeight;
  for (const g of groups) {
    const seen = new Set<string>();
    const pairs: Array<[number, number]> = [];
    for (const { f, t } of edges) {
      if (f === t || groupOf[f] !== g || groupOf[t] !== g) continue;
      const key = `${f}>${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([f, t]);
    }
    g.local = layoutGroup(g.members, pairs, o);
    g.width = g.local.width + 2 * o.groupPadding;
    g.height = 2 * o.groupPadding + header + o.gapY + g.local.rowsHeight;
  }

  // Ordre des groupes : liens entre groupes, plus appariement des entrées et sorties des interludes.
  const links = new Map<FlowSectionId, Array<[string, string]>>([
    ["main", []],
    ["bonus", []],
  ]);
  for (const { f, t } of edges) {
    const a = groupOf[f];
    const b = groupOf[t];
    if (a && b && a !== b && a.section === b.section) links.get(a.section)!.push([a.id, b.id]);
  }
  nodes.forEach((_, h) => {
    if (!hub[h]) return;
    const ins = pred[h]!.filter((p) => groupOf[p]).sort((a, b) => a - b);
    for (const s of [...succ[h]!].filter((v) => groupOf[v]).sort((a, b) => a - b)) {
      const p = [...ins].reverse().find((candidate) => candidate < s);
      const a = p === undefined ? null : groupOf[p]!;
      const b = groupOf[s]!;
      if (a && a !== b && a.section === b.section) links.get(a.section)!.push([a.id, b.id]);
    }
  });
  const ordered: GroupInfo[] = [];
  for (const id of ["main", "bonus"] as const) {
    ordered.push(...orderGroups(groups.filter((g) => g.section === id), links.get(id)!));
  }

  // Empilement des sections et des groupes.
  const contentWidth = groups.reduce((m, g) => Math.max(m, g.width), 0);
  const hubs = nodes.map((_, i) => i).filter((i) => hub[i]);
  const sections: FlowSectionLayout[] = [];
  const nodeBox: Array<{ x: number; y: number }> = nodes.map(() => ({ x: 0, y: 0 }));
  const levelOf = new Array<number>(N).fill(0);
  const step = o.nodeHeight + o.gapY;
  let cursor = 0;
  for (const id of ["main", "bonus"] as const) {
    const sectionGroups = ordered.filter((g) => g.section === id);
    const sectionHubs = hubs.filter((h) => sectionOf(h) === id);
    if (sectionGroups.length === 0 && sectionHubs.length === 0) continue;
    if (sections.length > 0) cursor += o.sectionGap;
    const top = cursor;
    const headerHeight = id === "bonus" ? o.sectionHeaderHeight : 0;
    let y = top + headerHeight;
    sectionGroups.forEach((g, i) => {
      if (i > 0) y += o.groupGap;
      g.x = (contentWidth - g.width) / 2;
      g.y = y;
      y += g.height;
      for (const m of g.members) {
        const p = g.local!.place.get(m)!;
        nodeBox[m] = { x: g.x + o.groupPadding + p.x, y: g.y + o.groupPadding + header + o.gapY / 2 + p.level * step };
        levelOf[m] = p.level;
      }
    });
    // Interludes partagés : à la hauteur moyenne des voisins, sans chevauchement.
    const hubX = contentWidth + o.hubGap;
    const wanted = sectionHubs.map((h) => {
      const around = [...new Set([...succ[h]!, ...pred[h]!])].filter((v) => !hub[v] && sectionOf(v) === id);
      return { h, y: around.length > 0 ? mean(around.map((v) => nodeBox[v]!.y + o.nodeHeight / 2)) - o.nodeHeight / 2 : top + headerHeight };
    });
    wanted.sort((a, b) => a.y - b.y || a.h - b.h);
    let floor = top + headerHeight;
    for (const w of wanted) {
      const hy = Math.max(w.y, floor);
      nodeBox[w.h] = { x: hubX, y: hy };
      floor = hy + o.nodeHeight + o.gapY;
      y = Math.max(y, hy + o.nodeHeight);
    }
    sections.push({
      id,
      y: top,
      height: y - top,
      headerHeight,
      groupIds: sectionGroups.map((g) => g.id),
      nodeIds: nodes.filter((_, i) => sectionOf(i) === id).map((nd) => nd.id),
    });
    cursor = y;
  }
  const width = hubs.length > 0 ? contentWidth + o.hubGap + o.nodeWidth : contentWidth;
  const height = cursor;

  // Tracés des arêtes.
  const cx = (i: number): number => nodeBox[i]!.x + o.nodeWidth / 2;
  const topY = (i: number): number => nodeBox[i]!.y;
  const bottomY = (i: number): number => nodeBox[i]!.y + o.nodeHeight;
  let gutterCount = 0;
  const routed: FlowEdgeLayout[] = edges.map(({ index: i, f, t, kind }) => {
    const base = { index: i, from: nodes[f]!.id, to: nodes[t]!.id, kind };
    if (f === t) {
      const r = nodeBox[f]!.x + o.nodeWidth;
      const cy = nodeBox[f]!.y + o.nodeHeight / 2;
      const points = [
        { x: r, y: cy - 6 },
        { x: r + 12, y: cy - 6 },
        { x: r + 12, y: cy + 6 },
        { x: r, y: cy + 6 },
      ];
      return { ...base, points: points.map((p) => ({ x: round(p.x), y: round(p.y) })), reversed: false, external: false };
    }
    const g = groupOf[f];
    if (g && g === groupOf[t]) {
      const forward = g.local!.routes.get(`${f}>${t}`);
      const backward = forward ? undefined : g.local!.routes.get(`${t}>${f}`);
      const local = forward ?? [...backward!].reverse();
      const ox = g.x + o.groupPadding;
      const oy = g.y + o.groupPadding + header + o.gapY / 2;
      return {
        ...base,
        points: local.map((p) => ({ x: round(p.x + ox), y: round(p.y + oy) })),
        reversed: forward === undefined,
        external: false,
      };
    }
    // Entre deux groupes ou vers un interlude partagé : sortie et entrée par les couloirs.
    const down = nodeBox[t]!.y >= nodeBox[f]!.y;
    const half = o.gapY / 2;
    const out = down ? bottomY(f) : topY(f);
    const outLane = down ? bottomY(f) + half : topY(f) - half;
    const inn = down ? topY(t) : bottomY(t);
    const inLane = down ? topY(t) - half : bottomY(t) + half;
    // Couloir vertical entre le contenu et la colonne des interludes. Les interludes ont chacun
    // leur ligne (hauteurs disjointes) : on les rejoint par la gauche, à mi-hauteur, sans passer
    // devant un autre.
    const gx = contentWidth + GUTTER_OFFSET + (gutterCount++ % GUTTER_TRACKS) * GUTTER_STEP;
    const start: FlowPoint[] = hub[f]
      ? [{ x: nodeBox[f]!.x, y: nodeBox[f]!.y + o.nodeHeight / 2 }]
      : [
          { x: cx(f), y: out },
          { x: cx(f), y: outLane },
        ];
    const finish: FlowPoint[] = hub[t]
      ? [{ x: nodeBox[t]!.x, y: nodeBox[t]!.y + o.nodeHeight / 2 }]
      : [
          { x: cx(t), y: inLane },
          { x: cx(t), y: inn },
        ];
    const points = simplify([
      ...start,
      { x: gx, y: start[start.length - 1]!.y },
      { x: gx, y: finish[0]!.y },
      ...finish,
    ]);
    return { ...base, points: points.map((p) => ({ x: round(p.x), y: round(p.y) })), reversed: false, external: true };
  });

  // Fins atteignables : nœuds de la section principale sans successeur (hors premier script).
  const endings = nodes.filter((_, i) => reach[i] && i !== start && succ[i]!.length === 0).map((nd) => nd.id);
  const endingSet = new Set(endings);

  const nodeLayouts: FlowNodeLayout[] = nodes.map((nd, i) => ({
    id: nd.id,
    x: round(nodeBox[i]!.x),
    y: round(nodeBox[i]!.y),
    width: o.nodeWidth,
    height: o.nodeHeight,
    level: hub[i] ? 0 : levelOf[i]!,
    groupId: groupOf[i]?.id ?? null,
    section: sectionOf(i),
    hub: hub[i]!,
    ending: endingSet.has(nd.id),
  }));
  const groupLayouts: FlowGroupLayout[] = ordered.map((g) => ({
    id: g.id,
    section: g.section,
    ...(g.chapter !== undefined ? { chapter: g.chapter } : {}),
    ...(g.arc !== undefined ? { arc: g.arc } : {}),
    x: round(g.x),
    y: round(g.y),
    width: round(g.width),
    height: round(g.height),
    headerHeight: header,
    nodeIds: g.members.map((m) => nodes[m]!.id),
  }));

  return { width: round(width), height: round(height), nodes: nodeLayouts, edges: routed, groups: groupLayouts, sections, endings };
}
