// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowNodeLayout, StoryGraph } from "@/core/flow-graph.js";
import { setUiLanguage } from "@/ui/i18n.js";
import {
  accessibleChapters,
  computeNodeStates,
  focusOrder,
  layoutOf,
  neighborNode,
  renderFlowchartScreen,
  type FlowchartData,
} from "@/ui/flowchart-view.js";
import { setRememberedScale } from "@/ui/flowchart-viewport.js";
import type { StoryProgress } from "@/ui/types.js";

/**
 * FLOW-07 (#206) : navigation clavier par arêtes, équivalent liste, `aria-live` et anti-spoiler de l'arbre
 * d'accessibilité. Graphe factice original (aucun texte du jeu) :
 *
 *   start -> menu (choix) -> left  -> mid -> finale (fin)
 *                         -> right -> mid
 *   teatime (interlude partagé) ; iso (fin isolée, section Bonus)
 *   secret (choix caché à deux options, jamais découvert)
 */
const graph: StoryGraph = {
  version: 1,
  first: "start",
  nodes: [
    { id: "start", file: "start.ks", kind: "normal", chapter: "c1", arc: "ARC-ONE" },
    { id: "menu", file: "menu.ks", kind: "choice", chapter: "c1", arc: "ARC-ONE" },
    { id: "left", file: "left.ks", kind: "normal", chapter: "c1", arc: "ARC-ONE" },
    { id: "right", file: "right.ks", kind: "normal", chapter: "c1", arc: "ARC-ONE" },
    { id: "mid", file: "mid.ks", kind: "normal", chapter: "c2", arc: "ARC-TWO" },
    { id: "finale", file: "finale.ks", kind: "end", chapter: "c2", arc: "ARC-TWO" },
    { id: "teatime", file: "teatime.ks", kind: "interlude" },
    { id: "iso", file: "iso.ks", kind: "end", chapter: "cx", arc: "ARC-BONUS" },
    { id: "secret", file: "secret.ks", kind: "choice", chapter: "c1", arc: "ARC-ONE" },
    { id: "s1", file: "s1.ks", kind: "normal", chapter: "c1", arc: "ARC-ONE" },
    { id: "s2", file: "s2.ks", kind: "normal", chapter: "c1", arc: "ARC-ONE" },
  ],
  edges: [
    { from: "start", to: "menu", kind: "normal" },
    { from: "menu", to: "left", kind: "choice", choice: "LABEL-LEFT" },
    { from: "menu", to: "right", kind: "choice", choice: "LABEL-RIGHT" },
    { from: "left", to: "mid", kind: "normal" },
    { from: "right", to: "mid", kind: "normal" },
    { from: "mid", to: "finale", kind: "normal" },
    { from: "start", to: "teatime", kind: "normal" },
    { from: "teatime", to: "mid", kind: "normal" },
    { from: "secret", to: "s1", kind: "choice", choice: "SECRET-A" },
    { from: "secret", to: "s2", kind: "choice", choice: "SECRET-B" },
  ],
};
const chapters = [
  { id: "c1", label: "TITLE-ONE" },
  { id: "c2", label: "TITLE-TWO" },
  { id: "cx", label: "TITLE-BONUS" },
];
const story = (p: Partial<StoryProgress> = {}): StoryProgress => ({ visited: [], finished: [], choices: [], endings: [], ...p });
const played = story({ visited: ["start", "menu", "left", "teatime"], finished: ["start", "menu"], choices: [{ from: "menu", to: "left" }] });

function render(patch: Partial<FlowchartData> = {}, onBack = vi.fn()): HTMLElement {
  const screen = renderFlowchartScreen({ graph, chapters, currentScript: null, story: played, revealAll: false, ...patch }, onBack);
  document.body.replaceChildren(screen);
  return screen;
}

const node = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`.mh-flow-node[data-id="${id}"]`)!;
const rawNode = (root: HTMLElement, index: number) => root.querySelector<HTMLElement>(`.mh-flow-node[data-n="${index}"]`)!;
const panel = (root: HTMLElement) => root.querySelector<HTMLElement>(".mh-flow-detail");
const live = (root: HTMLElement) => root.querySelector<HTMLElement>(".mh-flow-live")!;
const key = (el: HTMLElement, k: string): void => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
};
const graphIndex = (id: string) => graph.nodes.findIndex((n) => n.id === id);

beforeEach(() => {
  setUiLanguage("fr");
  setRememberedScale(1);
});
afterEach(() => {
  document.body.replaceChildren();
  setRememberedScale(1);
});

// ---------------------------------------------------------------------------
// Calculs purs
// ---------------------------------------------------------------------------

const box = (id: string, x: number, y: number): FlowNodeLayout => ({
  id,
  x,
  y,
  width: 64,
  height: 40,
  level: 0,
  groupId: "g",
  section: "main",
  hub: false,
  ending: false,
});
const pureLayout = { nodes: [box("a", 0, 0), box("b", 0, 100), box("c", -100, 100), box("d", 100, 100)] };
const pureGraph = {
  edges: [
    { from: "a", to: "b", kind: "normal" as const },
    { from: "a", to: "c", kind: "normal" as const },
    { from: "a", to: "d", kind: "normal" as const },
    { from: "b", to: "a", kind: "normal" as const },
    { from: "a", to: "a", kind: "normal" as const },
  ],
};

describe("neighborNode : flèches = nœud voisin par arête", () => {
  it("choisit le voisin du côté demandé, dans un sens ou dans l'autre", () => {
    expect(neighborNode(pureGraph, pureLayout, "a", "down")).toBe("b");
    expect(neighborNode(pureGraph, pureLayout, "a", "left")).toBe("c");
    expect(neighborNode(pureGraph, pureLayout, "a", "right")).toBe("d");
    // Arête inversée (b -> a) : on remonte quand même.
    expect(neighborNode(pureGraph, pureLayout, "b", "up")).toBe("a");
  });

  it("renvoie null sans voisin de ce côté et ignore les boucles sur soi-même", () => {
    expect(neighborNode(pureGraph, pureLayout, "a", "up")).toBeNull();
    expect(neighborNode(pureGraph, pureLayout, "c", "right")).toBe("a"); // a est à droite de c
    expect(neighborNode(pureGraph, pureLayout, "b", "down")).toBeNull();
    expect(neighborNode(pureGraph, pureLayout, "inconnu", "down")).toBeNull();
  });

  it("départage deux voisins par la distance, puis par l'ordre du graphe", () => {
    const layout = { nodes: [box("a", 0, 0), box("b", 0, 100), box("b2", 0, 200)] };
    const g = { edges: [{ from: "a", to: "b2", kind: "normal" as const }, { from: "a", to: "b", kind: "normal" as const }] };
    expect(neighborNode(g, layout, "a", "down")).toBe("b"); // le plus proche
  });
});

describe("accessibleChapters / focusOrder", () => {
  it("un chapitre par groupe, puis les interludes partagés ; les chapitres masqués sont « ??? »", () => {
    const layout = layoutOf(graph);
    const states = computeNodeStates(graph, played, "left", false);
    const cs = accessibleChapters(layout, chapters, states, false);
    expect(cs.map((c) => c.title)).toContain("TITLE-ONE"); // c1 a des nœuds découverts
    expect(cs.map((c) => c.title)).toContain("???");
    expect(cs.some((c) => c.title === "Interludes partagés")).toBe(true);
    // Aucun titre de chapitre masqué ne fuit.
    expect(cs.filter((c) => c.locked).every((c) => c.title === "???")).toBe(true);
    expect(cs.flatMap((c) => c.nodeIds).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
  });

  it("focusOrder suit l'ordre de lecture chapitres puis nœuds", () => {
    const layout = layoutOf(graph);
    const states = computeNodeStates(graph, played, "left", false);
    const order = focusOrder(accessibleChapters(layout, chapters, states, false));
    expect(order).toHaveLength(graph.nodes.length);
    expect(new Set(order).size).toBe(graph.nodes.length);
  });

  it("en mode « tout révéler », les titres et nœuds sont listés sans anti-spoiler", () => {
    const layout = layoutOf(graph);
    const states = computeNodeStates(graph, played, "left", true);
    const cs = accessibleChapters(layout, chapters, states, true);
    expect(cs.some((c) => c.title === "TITLE-TWO")).toBe(true);
    expect(cs.some((c) => c.locked)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DOM : liste équivalente, roving tabindex, aria-live
// ---------------------------------------------------------------------------

describe("équivalent liste pour lecteurs d'écran", () => {
  it("imbrique une <ul> par chapitre, avec un bouton par nœud et son aria-label", () => {
    const r = render();
    const a11y = r.querySelector<HTMLElement>(".mh-flow-a11y")!;
    const nav = a11y.querySelector<HTMLElement>(".mh-flow-a11y-nav")!;
    expect(nav.getAttribute("aria-labelledby")).toBe(a11y.querySelector("h3")!.id);
    const outer = nav.querySelector<HTMLUListElement>(":scope > ul.mh-flow-a11y-list")!;
    expect(outer).not.toBeNull();
    const chaptersLi = [...outer.querySelectorAll<HTMLElement>(":scope > li.mh-flow-a11y-chapter")];
    expect(chaptersLi.length).toBe(accessibleChapters(layoutOf(graph), chapters, computeNodeStates(graph, played, null, false), false).length);
    for (const li of chaptersLi) {
      expect(li.querySelector(":scope > h4")!.textContent).not.toBe("");
      const sub = li.querySelector<HTMLUListElement>(":scope > ul.mh-flow-a11y-nodes")!;
      expect(sub).not.toBeNull();
      for (const child of [...sub.children]) expect(child.tagName).toBe("LI");
    }
    const buttons = [...a11y.querySelectorAll<HTMLButtonElement>(".mh-flow-a11y-node")];
    expect(buttons).toHaveLength(graph.nodes.length);
    // Le parcours clavier se fait sur la carte : pas de second arrêt de tabulation par nœud.
    expect(buttons.every((b) => b.tabIndex === -1)).toBe(true);
    expect(buttons.every((b) => b.getAttribute("aria-label") === b.textContent)).toBe(true);
    // Le nœud courant est marqué dans le libellé de la liste quand l'écran en reçoit un.
    expect(a11y.textContent).toContain("Scène left, visitée");
  });

  it("anti-spoiler (décision 5) : la liste et les aria-label d'un nœud masqué ne révèlent rien", () => {
    const r = render();
    const a11y = r.querySelector<HTMLElement>(".mh-flow-a11y")!;
    const html = a11y.outerHTML;
    // Identifiants, titres de chapitre et libellés de choix des nœuds non visités : absents.
    for (const secret of ["right", "mid", "finale", "iso", "secret", "s1", "s2", "TITLE-TWO", "TITLE-BONUS", "LABEL-RIGHT", "SECRET-A", "SECRET-B"]) {
      expect(html, secret).not.toContain(secret);
    }
    // Un nœud masqué est annoncé « scène non découverte », sans compteur d'options.
    const hiddenButtons = [...r.querySelectorAll<HTMLElement>(".mh-flow-stage .mh-flow-node[data-state='hidden']")];
    expect(hiddenButtons.length).toBeGreaterThan(0);
    for (const el of hiddenButtons) {
      expect(el.getAttribute("aria-label")).toBe("Scène non découverte");
      expect(el.getAttribute("aria-label")).not.toMatch(/\d/);
    }
    // Le chapitre entièrement masqué porte un titre neutre.
    const locked = a11y.querySelectorAll<HTMLElement>(".mh-flow-a11y-chapter[data-a11y-locked='true']");
    expect(locked.length).toBeGreaterThan(0);
    for (const li of locked) {
      expect(li.querySelector("h4")!.textContent).toBe("???");
      expect(li.textContent).not.toMatch(/[0-9]/);
    }
  });
});

describe("roving tabindex et aria-live", () => {
  it("exactement un nœud focalisable : la position courante découverte", () => {
    const r = render({ currentScript: "left" });
    const focusables = [...r.querySelectorAll<HTMLElement>(".mh-flow-stage .mh-flow-node[tabindex='0']")];
    expect(focusables).toHaveLength(1);
    expect(focusables[0]).toBe(node(r, "left"));
    expect(live(r).getAttribute("role")).toBe("status");
    expect(live(r).getAttribute("aria-live")).toBe("polite");
  });

  it("sans position courante, le premier nœud découvert est l'arrêt de tabulation", () => {
    const r = render({ currentScript: null });
    const focusables = [...r.querySelectorAll<HTMLElement>(".mh-flow-stage .mh-flow-node[tabindex='0']")];
    expect(focusables).toHaveLength(1);
    expect(focusables[0]!.dataset.id).toBe("start");
  });

  it("le focus annonce le libellé du nœud dans la région aria-live", () => {
    const r = render({ currentScript: "left" });
    node(r, "left").focus();
    expect(document.activeElement).toBe(node(r, "left"));
    expect(live(r).textContent).toBe("Scène left, position actuelle");
  });
});

describe("parcours clavier par arêtes", () => {
  it("flèche haut : nœud voisin ; l'aria-live suit la position", () => {
    const r = render({ currentScript: "left" });
    const left = node(r, "left");
    left.focus();
    key(left, "ArrowUp");
    const focused = document.activeElement as HTMLElement;
    expect(focused).not.toBe(left);
    expect(focused.classList.contains("mh-flow-node")).toBe(true);
    expect(focused.dataset.state).not.toBe("hidden");
    expect(live(r).textContent).toBe(focused.getAttribute("aria-label"));
    expect(focused.tabIndex).toBe(0);
    expect(left.tabIndex).toBe(-1);
  });

  it("flèches bas/haut/droite/gauche suivent les arêtes sans faire défiler la carte", () => {
    const r = render({ currentScript: "left" });
    const scroller = r.querySelector<HTMLElement>(".mh-flow-scroll")!;
    let scrolled = 0;
    scroller.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key.startsWith("Arrow")) scrolled++;
    });
    const start = node(r, "start");
    start.focus();
    // start -> menu (enfant) ; le clavier sur un nœud ne remonte pas à la région.
    key(start, "ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.id).toBe("menu");
    key(document.activeElement as HTMLElement, "ArrowUp");
    expect(document.activeElement).toBe(start);
    expect(scrolled).toBe(0);
  });

  it("Home/End : premier et dernier nœud de l'ordre de parcours", () => {
    const r = render({ currentScript: "left" });
    const order = focusOrder(accessibleChapters(layoutOf(graph), chapters, computeNodeStates(graph, played, "left", false), false));
    node(r, "left").focus();
    key(document.activeElement as HTMLElement, "End");
    expect((document.activeElement as HTMLElement).dataset.id).toBe(order[order.length - 1]);
    key(document.activeElement as HTMLElement, "Home");
    expect((document.activeElement as HTMLElement).dataset.id).toBe(order[0]);
  });

  it("Entrée ouvre le volet du nœud ouvert ; Échap le ferme et rend le focus au nœud", () => {
    const r = render({ currentScript: "left" });
    const left = node(r, "left");
    left.focus();
    key(left, "Enter");
    const p = panel(r)!;
    expect(p).not.toBeNull();
    expect(document.activeElement).toBe(p);
    expect(left.dataset.selected).toBe("true");
    key(p, "Escape");
    expect(panel(r)).toBeNull();
    expect(document.activeElement).toBe(left);
  });

  it("Entrée n'ouvre rien sur un nœud masqué (annoncé inaccessible)", () => {
    const r = render({ currentScript: "left" });
    const hiddenIndex = graph.nodes.findIndex((n) => n.id === "secret");
    const secret = rawNode(r, hiddenIndex);
    // Le nœud masqué est atteignable au clavier via les arêtes, mais il n'ouvre rien.
    expect(secret).not.toBeNull();
    secret.focus();
    key(secret, "Enter");
    expect(panel(r)).toBeNull();
    expect(secret.getAttribute("aria-disabled")).toBe("true");
  });

  it("un bouton de la liste active le même parcours (focus carte puis volet)", () => {
    const r = render({ currentScript: "left" });
    const button = r.querySelector<HTMLButtonElement>(`.mh-flow-a11y-node[data-a11y-node="${graphIndex("left")}"]`)!;
    expect(button.getAttribute("aria-label")).toBe("Scène left, position actuelle");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(node(r, "left").dataset.selected).toBe("true");
    expect(panel(r)).not.toBeNull();
  });
});
