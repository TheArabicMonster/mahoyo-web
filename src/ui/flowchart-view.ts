/**
 * Écran « Flowchart » : rendu statique du graphe de scénario (FLOW-05, #197).
 *
 * Docs : `docs/ANALYSE_HUD_ORIGINAL.md` §7, `docs/DESIGN.md` (tokens, §9 repli sans assets) et
 * `docs/ENCHAINEMENT_SCRIPTS.md` (mise en page).
 *
 * - Les positions viennent de `layoutFlowchart` (pure, calculée une fois par graphe) ; ce module n'y
 *   ajoute que le rendu : groupes (DOM), arêtes (SVG), nœuds (DOM), libellés de choix (SVG au-dessus).
 * - Anti-spoiler (décision 5) : un nœud non visité est une silhouette **sans** identifiant, titre,
 *   vignette, libellé ni `aria-label` (il est `aria-hidden`), sauf si `revealAll`. Les identifiants des
 *   scripts cachés n'apparaissent nulle part dans le DOM (ni `data-*`, ni `title`).
 * - Un état n'est jamais codé par la seule couleur : forme (losange, hexagone, double bord), pastille
 *   à glyphe (○ ● ✓ ⚑) et `aria-label` en toutes lettres.
 * - Aucune image du jeu : les vignettes sont une surcouche (`<img>`, clé du manifeste de l'utilisateur) au-dessus
 *   d'un repli CSS ; sans graphe, un état vide s'affiche.
 *
 * Interactions (FLOW-06, #202) : pan et zoom (`flowchart-viewport.ts`), bouton « centrer », clic sur un nœud visité
 * (volet de détails et « Relire depuis ici », `flowchart-detail.ts`). Les silhouettes et les nœuds simplement révélés
 * ne sont ni cliquables ni relisables. Clavier et lecteur d'écran avancés (nœuds focalisables) : #206.
 */
import { choiceLabelLines, endingProgress, groupTitle } from "@/core/flow-graph.js";
import type { FlowEdgeLayout, FlowGroupLayout, FlowLayout, FlowNodeLayout, GraphNode, StoryGraph } from "@/core/flow-graph.js";
import { layoutFlowchart } from "@/core/flow-layout.js";
import { describeNode, renderDetailPanel, type ReplayDeps } from "@/ui/flowchart-detail.js";
import { attachViewport, MAX_SCALE, MIN_SCALE, ZOOM_STEP } from "@/ui/flowchart-viewport.js";
import { decoKeyOf, t } from "@/ui/i18n.js";
import type { StoryProgress } from "@/ui/types.js";
import "./night.css";
import "./flowchart-view.css";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Classe de l'écran (surchargée par `.mh-ui-flowchart > .mh-flow-screen` pour la position). */
export const FLOW_SCREEN_CLASS = "mh-flow-screen";

/**
 * État d'un nœud.
 *
 * - `hidden` : silhouette (non visité, anti-spoiler actif) ;
 * - `unvisited` : non visité mais révélé (`revealAll`) ;
 * - `visited` : ouvert au moins une fois ; `finished` : lu jusqu'au `@return` ;
 * - `current` : script en cours.
 */
export type FlowNodeState = "hidden" | "unvisited" | "visited" | "finished" | "current";

export type FlowchartData = {
  /** `null` ou absent : état vide. */
  graph: StoryGraph | null | undefined;
  /** Titres des chapitres (`story-chain.json.chapters`) : `id` et `label`. */
  chapters: readonly { id: string; label: string }[];
  currentScript: string | null;
  story: StoryProgress;
  revealAll: boolean;
  /** URL de la vignette d'une clé d'image du manifeste, ou `null`. Absent : repli CSS seul. */
  thumbnail?: (key: string) => string | null;
  /** « Relire depuis ici » : boîte de confirmation (`UIManager.confirm`, « Non » par défaut). Absente : aucune relecture. */
  confirm?: ReplayDeps["confirm"];
  /** « Relire depuis ici » : lance le script (`PlayerCommands.startScript`). Absent : pas de bouton de relecture. */
  replay?: ReplayDeps["replay"];
};

// ---------------------------------------------------------------------------
// Calculs purs
// ---------------------------------------------------------------------------

/** État de chaque nœud du graphe (clé : `GraphNode.id`). */
export function computeNodeStates(
  graph: Pick<StoryGraph, "nodes">,
  story: StoryProgress,
  currentScript: string | null,
  revealAll: boolean,
): Map<string, FlowNodeState> {
  const visited = new Set(story.visited);
  const finished = new Set(story.finished);
  const states = new Map<string, FlowNodeState>();
  for (const n of graph.nodes) {
    let state: FlowNodeState;
    if (n.id === currentScript) state = "current";
    else if (finished.has(n.id)) state = "finished";
    else if (visited.has(n.id)) state = "visited";
    else state = revealAll ? "unvisited" : "hidden";
    states.set(n.id, state);
  }
  return states;
}

/** Vrai si le nœud a été ouvert (visité, terminé ou en cours). */
export function isDiscovered(state: FlowNodeState | undefined): boolean {
  return state === "visited" || state === "finished" || state === "current";
}

/**
 * Arêtes parcourues (indices de `graph.edges`). Une option de choix l'est si l'arête `from -> to` figure dans
 * `story.choices` ; toute autre arête l'est quand ses deux extrémités ont été ouvertes. Approximation : la
 * progression ne garde que la cible d'un choix, pas son libellé.
 */
export function takenEdgeIndexes(graph: Pick<StoryGraph, "edges">, story: StoryProgress, states: ReadonlyMap<string, FlowNodeState>): Set<number> {
  const choices = new Set(story.choices.map((c) => `${c.from}\u0000${c.to}`));
  const taken = new Set<number>();
  graph.edges.forEach((e, i) => {
    if (e.kind === "choice") {
      if (choices.has(`${e.from}\u0000${e.to}`)) taken.add(i);
    } else if (isDiscovered(states.get(e.from)) && isDiscovered(states.get(e.to))) {
      taken.add(i);
    }
  });
  return taken;
}

/**
 * Libellés de choix à afficher, par indice d'arête (le premier de chaque paire `from -> to`).
 *
 * - `revealAll` : tous les libellés de la paire (on n'affiche que le premier, suivi du nombre d'autres) ;
 * - sinon : seulement une arête parcourue, et seulement si **aucune autre option** ne mène au même script
 *   (la progression n'enregistre que la cible : avec plusieurs options vers le même script, afficher l'une
 *   révélerait aussi les autres).
 */
export function visibleChoiceLabels(
  graph: Pick<StoryGraph, "edges">,
  taken: ReadonlySet<number>,
  revealAll: boolean,
): Map<number, { label: string; more: number }> {
  const byPair = new Map<string, number[]>();
  graph.edges.forEach((e, i) => {
    if (e.kind !== "choice" || !e.choice) return;
    const key = `${e.from}\u0000${e.to}`;
    byPair.set(key, [...(byPair.get(key) ?? []), i]);
  });
  const out = new Map<number, { label: string; more: number }>();
  for (const indexes of byPair.values()) {
    const first = indexes[0]!;
    if (revealAll) {
      out.set(first, { label: graph.edges[first]!.choice!, more: indexes.length - 1 });
    } else if (indexes.length === 1 && taken.has(first)) {
      out.set(first, { label: graph.edges[first]!.choice!, more: 0 });
    }
  }
  return out;
}

/** Largeur visuelle approchée d'un caractère (plein chasse = 2). */
function charWidth(c: string): number {
  return c.charCodeAt(0) >= 0x2e80 ? 2 : 1;
}

/** Libellé de choix découpé en au plus 2 lignes, chacune tronquée à `maxWidth` unités (plein chasse = 2). */
export function labelLines(label: string, maxWidth = 24): string[] {
  return choiceLabelLines(label)
    .slice(0, 2)
    .map((line) => {
      let width = 0;
      let out = "";
      for (const c of line) {
        width += charWidth(c);
        if (width > maxWidth) return `${out}…`;
        out += c;
      }
      return out;
    });
}

const layoutCache = new WeakMap<StoryGraph, FlowLayout>();

/** Mise en page d'un graphe, calculée une seule fois par objet graphe. */
export function layoutOf(graph: StoryGraph): FlowLayout {
  let layout = layoutCache.get(graph);
  if (!layout) {
    layout = layoutFlowchart(graph);
    layoutCache.set(graph, layout);
  }
  return layout;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, cls?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (cls) el.setAttribute("class", cls);
  return el;
}

function place(el: HTMLElement, x: number, y: number, width: number, height: number): void {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
}

/** Glyphe de la pastille d'état (jamais la seule information : voir `aria-label`). */
const STATE_GLYPH: Record<Exclude<FlowNodeState, "hidden" | "current">, string> = { unvisited: "○", visited: "●", finished: "✓" };

function nodeLabel(node: GraphNode, state: FlowNodeState, choiceCount: number, endingReached: boolean): string {
  const id = node.id;
  const base =
    state === "current"
      ? t("flowchart.node.current", { id })
      : state === "finished"
        ? t("flowchart.node.finished", { id })
        : state === "visited"
          ? t("flowchart.node.visited", { id })
          : t("flowchart.node.unvisited", { id });
  const kind =
    node.kind === "choice"
      ? t("flowchart.kind.choice", { n: choiceCount })
      : node.kind === "interlude"
        ? t("flowchart.kind.interlude")
        : node.kind === "end"
          ? endingReached
            ? t("flowchart.kind.endReached")
            : t("flowchart.kind.end")
          : "";
  return kind ? `${base}, ${kind}` : base;
}

type NodeContext = {
  data: FlowchartData;
  endings: ReadonlySet<string>;
  choiceCounts: ReadonlyMap<string, number>;
};

function renderNode(index: number, graphNode: GraphNode, box: FlowNodeLayout, state: FlowNodeState, ctx: NodeContext): HTMLElement {
  const el = h("div", "mh-flow-node");
  place(el, box.x, box.y, box.width, box.height);
  el.dataset.n = String(index);
  el.dataset.state = state;
  const shape = h("div", "mh-flow-shape");
  const fill = h("div", "mh-flow-fill");
  shape.appendChild(fill);
  el.appendChild(shape);

  if (state === "hidden") {
    // Silhouette : aucune information du jeu, y compris pour les lecteurs d'écran.
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  const reached = graphNode.kind === "end" && ctx.endings.has(graphNode.id);
  el.dataset.id = graphNode.id;
  el.dataset.kind = graphNode.kind;
  // Seuls les nœuds ouverts répondent au clic (volet de détails) ; un nœud révélé non visité reste inerte.
  if (isDiscovered(state)) el.dataset.interactive = "true";
  if (graphNode.kind === "end") el.dataset.ending = reached ? "reached" : "pending";
  if (box.hub) el.dataset.hub = "true";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", nodeLabel(graphNode, state, ctx.choiceCounts.get(graphNode.id) ?? 0, reached));
  if (state === "current") el.setAttribute("aria-current", "location");

  // Une silhouette est déjà sortie plus haut : ici le nœud est ouvert, ou révélé par `revealAll`.
  const url = graphNode.thumb ? ctx.data.thumbnail?.(graphNode.thumb) : null;
  if (url) {
    const img = h("img", "mh-flow-thumb");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;
    img.addEventListener("error", () => img.remove());
    img.src = url;
    fill.appendChild(img);
  }
  fill.appendChild(h("span", "mh-flow-id", graphNode.id));

  if (state !== "current") {
    const glyph = h("span", "mh-flow-glyph", STATE_GLYPH[state]);
    glyph.setAttribute("aria-hidden", "true");
    el.appendChild(glyph);
  } else {
    const marker = h("span", "mh-flow-marker");
    marker.setAttribute("aria-hidden", "true");
    marker.append(h("span", "mh-flow-marker-arrow"), h("span", "mh-flow-marker-text", t("flowchart.here")));
    el.appendChild(marker);
  }
  if (graphNode.kind === "end") {
    const flag = h("span", "mh-flow-flag", "⚑");
    flag.setAttribute("aria-hidden", "true");
    el.appendChild(flag);
  }
  return el;
}

function pathData(points: FlowEdgeLayout["points"]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`).join(" ");
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function renderEdges(
  layout: FlowLayout,
  graph: StoryGraph,
  hubIds: ReadonlySet<string>,
  taken: ReadonlySet<number>,
  nodeIndex: ReadonlyMap<string, number>,
  edgesOfNode: Map<number, SVGElement[]>,
): SVGSVGElement {
  const svg = s("svg", { width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}` }, "mh-flow-edges");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const defs = s("defs");
  for (const [id, cls] of [["mh-flow-arrow", "mh-flow-arrow"], ["mh-flow-arrow-taken", "mh-flow-arrow mh-flow-arrow-taken"]] as const) {
    const marker = s("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, markerUnits: "userSpaceOnUse", orient: "auto" });
    marker.appendChild(s("path", { d: "M0 0 L10 5 L0 10 z" }, cls));
    defs.appendChild(marker);
  }
  svg.appendChild(defs);

  // Les arêtes parcourues sont tracées en dernier, donc au-dessus des autres.
  const ordered = [...layout.edges].sort((a, b) => Number(taken.has(a.index)) - Number(taken.has(b.index)));
  for (const e of ordered) {
    const isTaken = taken.has(e.index);
    const hub = hubIds.has(e.from) || hubIds.has(e.to);
    const path = s("path", { d: pathData(e.points) }, "mh-flow-edge");
    path.setAttribute("marker-end", `url(#${isTaken ? "mh-flow-arrow-taken" : "mh-flow-arrow"})`);
    path.dataset.kind = graph.edges[e.index]?.kind ?? e.kind;
    if (isTaken) path.dataset.taken = "true";
    if (hub) path.dataset.hub = "true";
    if (e.reversed) path.dataset.reversed = "true";
    const a = nodeIndex.get(e.from);
    const b = nodeIndex.get(e.to);
    if (a !== undefined) edgesOfNode.set(a, [...(edgesOfNode.get(a) ?? []), path]);
    if (b !== undefined) edgesOfNode.set(b, [...(edgesOfNode.get(b) ?? []), path]);
    svg.appendChild(path);
  }
  return svg;
}

function renderLabels(layout: FlowLayout, labels: ReadonlyMap<number, { label: string; more: number }>): SVGSVGElement {
  const svg = s("svg", { width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}` }, "mh-flow-labels");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const e of layout.edges) {
    const info = labels.get(e.index);
    const p0 = e.points[0];
    if (!info || !p0) continue;
    const lines = labelLines(info.label);
    if (lines.length === 0) continue;
    if (info.more > 0) lines[lines.length - 1] += ` (+${info.more})`;
    const text = s("text", { x: round(p0.x + 6), y: round(p0.y + 13) }, "mh-flow-choice");
    lines.forEach((line, i) => {
      const span = s("tspan", { x: round(p0.x + 6), dy: i === 0 ? 0 : 13 });
      span.textContent = line;
      text.appendChild(span);
    });
    const title = s("title");
    title.textContent = choiceLabelLines(info.label).join(" ");
    text.appendChild(title);
    svg.appendChild(text);
  }
  return svg;
}

function renderGroup(group: FlowGroupLayout, discovered: boolean, revealAll: boolean, data: FlowchartData, index: number): HTMLElement {
  const el = h("div", "mh-flow-group");
  place(el, group.x, group.y, group.width, group.height);
  el.dataset.section = group.section;
  el.dataset.g = String(index);
  const shown = discovered || revealAll;
  const title = shown ? groupTitle(group, data.chapters) : t("flowchart.group.hidden");
  const head = h("div", "mh-flow-group-title", title);
  head.style.height = `${group.headerHeight}px`;
  head.style.lineHeight = `${group.headerHeight}px`;
  if (shown) head.title = title;
  else el.dataset.locked = "true";
  el.appendChild(head);
  return el;
}

function renderLegend(): HTMLElement {
  const box = h("section", "mh-flow-legend");
  box.setAttribute("aria-label", t("flowchart.legend.title"));
  box.appendChild(h("h3", "mh-flow-legend-title", t("flowchart.legend.title")));
  const list = h("ul", "mh-flow-legend-list");
  const nodeItems: [string, string, FlowNodeState | null, string | null, string][] = [
    ["hidden", "flowchart.legend.hidden", "hidden", null, ""],
    ["unvisited", "flowchart.legend.unvisited", "unvisited", null, "○"],
    ["visited", "flowchart.legend.visited", "visited", null, "●"],
    ["finished", "flowchart.legend.finished", "finished", null, "✓"],
    ["current", "flowchart.legend.current", "current", null, ""],
    ["choice", "flowchart.legend.choice", "visited", "choice", ""],
    ["interlude", "flowchart.legend.interlude", "visited", "interlude", ""],
    ["end", "flowchart.legend.end", "visited", "end", ""],
  ];
  for (const [id, key, state, kind, glyph] of nodeItems) {
    const li = h("li", "mh-flow-legend-item");
    li.dataset.legend = id;
    const sample = h("span", "mh-flow-node mh-flow-legend-sample");
    sample.dataset.state = state ?? "visited";
    if (kind) sample.dataset.kind = kind;
    const shape = h("span", "mh-flow-shape");
    shape.appendChild(h("span", "mh-flow-fill"));
    sample.appendChild(shape);
    if (glyph) sample.appendChild(h("span", "mh-flow-glyph", glyph));
    sample.setAttribute("aria-hidden", "true");
    li.append(sample, h("span", "mh-flow-legend-text", t(key as "flowchart.legend.hidden")));
    list.appendChild(li);
  }
  for (const [id, key, kind, taken] of [
    ["taken", "flowchart.legend.taken", "normal", true],
    ["conditional", "flowchart.legend.conditional", "conditional", false],
  ] as const) {
    const li = h("li", "mh-flow-legend-item");
    li.dataset.legend = id;
    const svg = s("svg", { width: 36, height: 12, viewBox: "0 0 36 12" }, "mh-flow-legend-edge");
    svg.setAttribute("aria-hidden", "true");
    const line = s("path", { d: "M2 6 L34 6" }, "mh-flow-edge");
    line.dataset.kind = kind;
    if (taken) line.dataset.taken = "true";
    svg.appendChild(line);
    li.append(svg, h("span", "mh-flow-legend-text", t(key)));
    list.appendChild(li);
  }
  box.appendChild(list);
  return box;
}

function renderCounters(graph: StoryGraph | null | undefined, layout: FlowLayout | null, story: StoryProgress): HTMLElement {
  const box = h("section", "mh-flow-counters");
  if (graph && layout) {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const read = new Set(story.visited.filter((id) => ids.has(id))).size;
    const scenes = h("p", "mh-flow-counter", t("flowchart.counter.scenes", { read, total: graph.nodes.length }));
    scenes.dataset.counter = "scenes";
    box.appendChild(scenes);
    const endings = endingProgress(layout, story.endings);
    if (endings.total > 0) {
      const el = h("p", "mh-flow-counter", t("flowchart.counter.endings", { reached: endings.reached, total: endings.total }));
      el.dataset.counter = "endings";
      box.appendChild(el);
    }
  }
  return box;
}

/**
 * Construit l'écran complet (titre, compteurs, légende, carte, « Retour »). L'appelant l'ajoute au slot
 * `#ui-flowchart` et fournit `onBack`.
 */
export function renderFlowchartScreen(data: FlowchartData, onBack: () => void): HTMLElement {
  const screen = h("section", `${FLOW_SCREEN_CLASS} mh-ui-night`);
  screen.setAttribute("aria-labelledby", "mh-flow-title");

  const head = h("header", "mh-flow-head");
  const title = h("h2", "mh-flow-title", t("flowchart.title"));
  title.id = "mh-flow-title";
  const deco = h("span", "mh-flow-title-deco", t(decoKeyOf("flowchart.title")));
  deco.setAttribute("aria-hidden", "true");
  head.append(title, deco);

  const back = h("button", "mh-flow-back", t("common.back"));
  back.type = "button";
  back.addEventListener("click", onBack);
  const foot = h("footer", "mh-flow-foot");
  foot.appendChild(back);

  const graph = data.graph ?? null;
  if (!graph) {
    const empty = h("p", "mh-flow-empty", t("flowchart.empty"));
    empty.setAttribute("role", "status");
    screen.append(head, empty, foot);
    screen.dataset.empty = "true";
    return screen;
  }

  const layout = layoutOf(graph);
  const states = computeNodeStates(graph, data.story, data.currentScript, data.revealAll);
  const taken = takenEdgeIndexes(graph, data.story, states);
  const labels = visibleChoiceLabels(graph, taken, data.revealAll);

  const choiceCounts = new Map<string, number>();
  for (const e of graph.edges) if (e.kind === "choice") choiceCounts.set(e.from, (choiceCounts.get(e.from) ?? 0) + 1);
  const ctx: NodeContext = { data, endings: new Set(layout.endings), choiceCounts };

  const aside = h("aside", "mh-flow-aside");
  aside.append(renderCounters(graph, layout, data.story), renderLegend());

  const map = h("div", "mh-flow-map");
  const scroller = h("div", "mh-flow-scroll");
  scroller.tabIndex = 0;
  scroller.setAttribute("role", "region");
  scroller.setAttribute("aria-label", t("flowchart.region"));
  // sizer : taille `contenu x zoom`, centré ; stage : la scène à l'échelle 1 (unités de la mise en page).
  const sizer = h("div", "mh-flow-sizer");
  const stage = h("div", "mh-flow-stage");
  stage.style.width = `${layout.width}px`;
  stage.style.height = `${layout.height}px`;

  const nodeIndex = new Map<string, number>();
  graph.nodes.forEach((n, i) => nodeIndex.set(n.id, i));
  const layoutOfNode = new Map(layout.nodes.map((n) => [n.id, n]));

  // 1. Groupes et titre de la section Bonus (sous les arêtes).
  layout.groups.forEach((g, i) => {
    const discovered = g.nodeIds.some((id) => isDiscovered(states.get(id)));
    stage.appendChild(renderGroup(g, discovered, data.revealAll, data, i));
  });
  for (const section of layout.sections) {
    if (section.headerHeight <= 0) continue;
    const sectionTitle = h("div", "mh-flow-section-title", t("flowchart.section.bonus"));
    sectionTitle.dataset.section = section.id;
    place(sectionTitle, 0, section.y, layout.width, section.headerHeight);
    sectionTitle.style.lineHeight = `${section.headerHeight}px`;
    stage.appendChild(sectionTitle);
  }

  // 2. Arêtes.
  const hubIds = new Set(layout.nodes.filter((n) => n.hub).map((n) => n.id));
  const edgesOfNode = new Map<number, SVGElement[]>();
  stage.appendChild(renderEdges(layout, graph, hubIds, taken, nodeIndex, edgesOfNode));

  // 3. Nœuds.
  graph.nodes.forEach((n, i) => {
    const box = layoutOfNode.get(n.id);
    if (!box) return;
    stage.appendChild(renderNode(i, n, box, states.get(n.id) ?? "hidden", ctx));
  });

  // 4. Libellés des choix empruntés, au-dessus des nœuds.
  stage.appendChild(renderLabels(layout, labels));

  // Survol : éclaire les arêtes du nœud (les 26 arêtes de l'interlude partagé restent estompées sinon).
  let lit: number | null = null;
  const setLit = (next: number | null): void => {
    if (next === lit) return;
    for (const p of (lit !== null ? edgesOfNode.get(lit) : undefined) ?? []) p.classList.remove("is-lit");
    for (const p of (next !== null ? edgesOfNode.get(next) : undefined) ?? []) p.classList.add("is-lit");
    lit = next;
  };
  stage.addEventListener("pointerover", (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest<HTMLElement>(".mh-flow-node[data-n]") : null;
    setLit(target ? Number(target.dataset.n) : null);
  });
  stage.addEventListener("pointerleave", () => setLit(null));

  sizer.appendChild(stage);
  scroller.appendChild(sizer);

  // Pan, zoom, centrage. `initialScale` : le zoom est conservé d'une ouverture à l'autre (mémoire du module).
  const zoomValue = h("output", "mh-flow-zoom-value");
  const showZoom = (scale: number): void => {
    zoomValue.textContent = t("flowchart.zoom.value", { percent: Math.round(scale * 100) });
  };
  let syncTools = (): void => {};
  const viewport = attachViewport({
    scroller,
    sizer,
    stage,
    content: { width: layout.width, height: layout.height },
    onScaleChange: (scale) => {
      showZoom(scale);
      syncTools();
    },
  });
  showZoom(viewport.getScale());

  const currentBox = data.currentScript ? layoutOfNode.get(data.currentScript) : undefined;
  const tools = renderTools(viewport, currentBox ? () => viewport.centerOn(currentBox, true) : null, zoomValue);
  syncTools = tools.sync;
  tools.sync();

  // Clic sur un nœud ouvert : volet de détails (jamais pour une silhouette ni un nœud révélé non visité).
  let detail: HTMLElement | null = null;
  let selected: HTMLElement | null = null;
  const closeDetail = (restoreFocus: boolean): void => {
    detail?.remove();
    detail = null;
    selected?.removeAttribute("data-selected");
    selected = null;
    if (restoreFocus) scroller.focus({ preventScroll: true });
  };
  const deps: ReplayDeps = { confirm: data.confirm, replay: data.replay };
  scroller.addEventListener("click", (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest<HTMLElement>(".mh-flow-node[data-n]") : null;
    if (!target) return;
    const index = Number(target.dataset.n);
    const node = graph.nodes[index];
    if (!node) return;
    const details = describeNode(graph, node.id, states.get(node.id), data.story, layout.endings, data.chapters);
    if (!details) return;
    closeDetail(false);
    selected = target;
    target.dataset.selected = "true";
    detail = renderDetailPanel(details, deps, () => closeDetail(true));
    detail.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      // Échap ferme d'abord le volet ; l'écran ne se ferme qu'à l'Échap suivant.
      e.stopPropagation();
      closeDetail(true);
    });
    map.appendChild(detail);
    detail.focus({ preventScroll: true });
  });

  map.append(scroller, tools.el);
  screen.append(head, aside, map, foot);

  // Position initiale : le zoom mémorisé est déjà posé ; on centre le nœud courant, sinon on reste en haut.
  // L'écran est ajouté au DOM de façon synchrone par l'appelant.
  queueMicrotask(() => {
    if (currentBox) viewport.centerOn(currentBox);
    scroller.focus({ preventScroll: true });
  });
  return screen;
}

function toolButton(cls: string, label: string, glyph: string, onClick: () => void): HTMLButtonElement {
  const btn = h("button", `mh-flow-tool ${cls}`, glyph);
  btn.type = "button";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.addEventListener("click", onClick);
  return btn;
}

/** Boutons ronds (zoom +, zoom −, centrer sur ma position) et pourcentage de zoom, au-dessus de la carte. */
function renderTools(
  viewport: ReturnType<typeof attachViewport>,
  center: (() => void) | null,
  zoomValue: HTMLElement,
): { el: HTMLElement; sync: () => void } {
  const box = h("div", "mh-flow-tools");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", t("flowchart.tools"));
  const zoomIn = toolButton("mh-flow-zoom-in", t("flowchart.zoom.in"), "+", () => viewport.zoomBy(ZOOM_STEP));
  const zoomOut = toolButton("mh-flow-zoom-out", t("flowchart.zoom.out"), "\u2212", () => viewport.zoomBy(1 / ZOOM_STEP));
  const centre = toolButton("mh-flow-center", t("flowchart.center"), "", () => center?.());
  centre.disabled = center === null;
  // Pas de position courante (écran titre) : bouton inactif, l'état est dit en toutes lettres.
  if (center === null) centre.title = t("flowchart.center.none");
  const sync = (): void => {
    zoomIn.disabled = viewport.getScale() >= MAX_SCALE - 1e-9;
    zoomOut.disabled = viewport.getScale() <= MIN_SCALE + 1e-9;
  };
  box.append(zoomIn, zoomValue, zoomOut, centre);
  return { el: box, sync };
}
