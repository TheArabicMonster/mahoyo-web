/**
 * Volet de détails d'un nœud du flowchart et « Relire depuis ici » (FLOW-06, #202).
 *
 * Règle d'anti-spoiler (décision 5) : seuls les nœuds **visités** (ouverts, terminés ou en cours) ont un volet.
 * Une silhouette et un nœud simplement révélé par « tout révéler » n'ouvrent rien et ne sont pas relisables :
 * `describeNode` renvoie `null`, c'est l'unique point de contrôle.
 */
import type { GraphNode, StoryGraph } from "@/core/flow-graph.js";
import type { FlowNodeState } from "@/ui/flowchart-view.js";
import { t } from "@/ui/i18n.js";
import type { ConfirmOptions, StoryProgress } from "@/ui/types.js";

export type NodeDetails = {
  id: string;
  file: string;
  arc?: string;
  chapter?: string;
  state: Extract<FlowNodeState, "visited" | "finished" | "current">;
  kind: GraphNode["kind"];
  /** Fins (atteignables depuis le début) accessibles depuis ce nœud : `reached` déjà vues sur `total`. */
  endings: { reached: number; total: number };
};

/** Scripts atteignables depuis `from` (lui compris), en suivant toutes les arêtes. */
export function reachableFrom(graph: Pick<StoryGraph, "edges">, from: string): Set<string> {
  const next = new Map<string, string[]>();
  for (const e of graph.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const to of next.get(id) ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

/**
 * Détails d'un nœud, ou `null` s'il n'est pas visité (aucun volet, aucune relecture).
 * `endingIds` : fins atteignables depuis le début (`FlowLayout.endings`).
 */
export function describeNode(
  graph: StoryGraph,
  id: string,
  state: FlowNodeState | undefined,
  story: Pick<StoryProgress, "endings">,
  endingIds: readonly string[],
  chapters: readonly { id: string; label: string }[],
): NodeDetails | null {
  if (state !== "visited" && state !== "finished" && state !== "current") return null;
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return null;
  const reachable = reachableFrom(graph, id);
  const inReach = endingIds.filter((e) => reachable.has(e));
  const seen = new Set(story.endings);
  return {
    id: node.id,
    file: node.file,
    arc: node.arc,
    chapter: node.chapter === undefined ? undefined : (chapters.find((c) => c.id === node.chapter)?.label ?? node.chapter),
    state,
    kind: node.kind,
    endings: { reached: inReach.filter((e) => seen.has(e)).length, total: inReach.length },
  };
}

export type ReplayDeps = {
  /** Boîte de confirmation (« Non » par défaut). Absente : aucune relecture. */
  confirm?: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  /** Lance le script (`PlayerCommands.startScript`). Absent : pas de bouton. */
  replay?: (node: { id: string; file: string }) => void;
};

/** Demande confirmation (Non par défaut) puis relance le script. Renvoie `true` si la relecture a été lancée. */
export async function requestReplay(node: Pick<NodeDetails, "id" | "file">, deps: ReplayDeps): Promise<boolean> {
  if (!deps.replay || !deps.confirm) return false;
  const ok = await deps.confirm(t("flowchart.replay.confirm", { id: node.id }), { defaultButton: "no" });
  if (!ok) return false;
  deps.replay({ id: node.id, file: node.file });
  return true;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const STATE_KEY = {
  visited: "flowchart.legend.visited",
  finished: "flowchart.legend.finished",
  current: "flowchart.legend.current",
} as const;

let nextPanelId = 0;

/** Construit le volet. `onClose` est appelé par le bouton « Fermer » (le focus est rendu par l'appelant). */
export function renderDetailPanel(details: NodeDetails, deps: ReplayDeps, onClose: () => void): HTMLElement {
  const id = `mh-flow-detail-${++nextPanelId}`;
  const panel = h("aside", "mh-flow-detail");
  panel.tabIndex = -1;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", `${id}-title`);
  panel.dataset.node = details.id;

  const head = h("header", "mh-flow-detail-head");
  const title = h("h3", "mh-flow-detail-title", t("flowchart.detail.scene", { id: details.id }));
  title.id = `${id}-title`;
  const close = h("button", "mh-flow-detail-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", t("flowchart.detail.close"));
  close.addEventListener("click", onClose);
  head.append(title, close);

  const list = h("dl", "mh-flow-detail-list");
  const row = (key: string, label: string, value: string): void => {
    const dt = h("dt", undefined, label);
    const dd = h("dd", undefined, value);
    dd.dataset.field = key;
    list.append(dt, dd);
  };
  if (details.arc) row("arc", t("flowchart.detail.arc"), details.arc);
  if (details.chapter) row("chapter", t("flowchart.detail.chapter"), details.chapter);
  row("state", t("flowchart.detail.state"), t(STATE_KEY[details.state]));
  if (details.endings.total > 0) {
    row("endings", t("flowchart.detail.endings"), t("flowchart.detail.endingsValue", details.endings));
  }

  panel.append(head, list);

  if (deps.replay) {
    const replay = h("button", "mh-flow-replay", t("flowchart.replay"));
    replay.type = "button";
    replay.addEventListener("click", () => void requestReplay(details, deps));
    panel.append(replay, h("p", "mh-flow-detail-note", t("flowchart.replay.note")));
  }
  return panel;
}
