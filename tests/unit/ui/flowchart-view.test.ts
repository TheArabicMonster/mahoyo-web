// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryGraph } from "@/core/story-graph.js";
import { setUiLanguage } from "@/ui/i18n.js";
import {
  computeNodeStates,
  labelLines,
  renderFlowchartScreen,
  takenEdgeIndexes,
  visibleChoiceLabels,
  type FlowchartData,
} from "@/ui/flowchart-view.js";
import type { StoryProgress } from "@/ui/types.js";

/**
 * Graphe factice original (aucun texte du jeu) :
 *
 *   start -> menu (choix) -> left  -> mid -> finale (fin)
 *                         -> right -> mid
 *   menu2 (choix, deux options vers le même script) -> twin
 *   teatime : interlude partagé, relié à start et à lone
 *   iso : script isolé (section Bonus)
 */
const graph: StoryGraph = {
  version: 1,
  first: "start",
  nodes: [
    { id: "start", file: "start.ks", kind: "normal", chapter: "c1", arc: "ARC-ONE", thumb: "thumb-start" },
    { id: "menu", file: "menu.ks", kind: "choice", chapter: "c1", arc: "ARC-ONE", thumb: "thumb-menu" },
    { id: "left", file: "left.ks", kind: "normal", chapter: "c1", arc: "ARC-ONE", thumb: "thumb-left" },
    { id: "right", file: "right.ks", kind: "normal", chapter: "c1", arc: "ARC-ONE", thumb: "thumb-right" },
    { id: "mid", file: "mid.ks", kind: "normal", chapter: "c2", arc: "ARC-TWO" },
    { id: "finale", file: "finale.ks", kind: "end", chapter: "c2", arc: "ARC-TWO", thumb: "thumb-finale" },
    { id: "teatime", file: "teatime.ks", kind: "interlude" },
    { id: "iso", file: "iso.ks", kind: "end", chapter: "cx", arc: "ARC-BONUS" },
  ],
  edges: [
    { from: "start", to: "menu", kind: "normal" },
    { from: "menu", to: "left", kind: "choice", choice: "LABEL-LEFT" },
    { from: "menu", to: "right", kind: "choice", choice: "LABEL-RIGHT" },
    { from: "left", to: "mid", kind: "normal" },
    { from: "right", to: "mid", kind: "conditional", condition: "flag>0" },
    { from: "mid", to: "finale", kind: "normal" },
    { from: "start", to: "teatime", kind: "normal" },
    { from: "teatime", to: "mid", kind: "normal" },
  ],
};

const chapters = [
  { id: "c1", label: "TITLE-ONE" },
  { id: "c2", label: "TITLE-TWO" },
  { id: "cx", label: "TITLE-BONUS" },
];

const story = (p: Partial<StoryProgress> = {}): StoryProgress => ({ visited: [], finished: [], choices: [], endings: [], ...p });

const thumbs = (key: string): string | null => (key === "thumb-start" || key.startsWith("thumb-") ? `/assets/${key}.webp` : null);

function render(patch: Partial<FlowchartData> = {}, onBack = vi.fn()): HTMLElement {
  const screen = renderFlowchartScreen(
    { graph, chapters, currentScript: null, story: story(), revealAll: false, thumbnail: thumbs, ...patch },
    onBack,
  );
  document.body.replaceChildren(screen);
  return screen;
}

const nodeEl = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`.mh-flow-node[data-id="${id}"]`);
const allNodes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".mh-flow-stage .mh-flow-node")];

beforeEach(() => setUiLanguage("fr"));
afterEach(() => {
  document.body.replaceChildren();
  setUiLanguage("fr");
});

// A story where the player has played start -> menu -> left, is currently in `left`, and has not finished `menu`.
const played = story({
  visited: ["start", "menu", "left", "teatime"],
  finished: ["start", "menu"],
  choices: [{ from: "menu", to: "left" }],
});

describe("états des nœuds", () => {
  it("calcule hidden / unvisited / visited / finished / current", () => {
    const hidden = computeNodeStates(graph, played, "left", false);
    expect(hidden.get("start")).toBe("finished");
    expect(hidden.get("teatime")).toBe("visited");
    expect(hidden.get("left")).toBe("current");
    expect(hidden.get("right")).toBe("hidden");
    const revealed = computeNodeStates(graph, played, "left", true);
    expect(revealed.get("right")).toBe("unvisited");
    expect(revealed.get("left")).toBe("current");
  });

  it("différencie chaque état sans dépendre de la couleur (forme, glyphe, texte accessible)", () => {
    const root = render({ story: played, currentScript: "left", revealAll: true });
    const state = (id: string) => nodeEl(root, id)!.dataset.state;
    expect([state("start"), state("teatime"), state("left"), state("right")]).toEqual(["finished", "visited", "current", "unvisited"]);

    const glyph = (id: string) => nodeEl(root, id)!.querySelector(".mh-flow-glyph")?.textContent;
    expect(glyph("start")).toBe("✓");
    expect(glyph("teatime")).toBe("●");
    expect(glyph("right")).toBe("○");
    expect(glyph("left")).toBeUndefined(); // le courant a un repère à la place
    expect(nodeEl(root, "left")!.querySelector(".mh-flow-marker")).not.toBeNull();

    const labels = ["start", "teatime", "left", "right"].map((id) => nodeEl(root, id)!.getAttribute("aria-label"));
    expect(new Set(labels).size).toBe(4);
    expect(labels[0]).toContain("terminée");
    expect(labels[2]).toContain("position actuelle");
    expect(labels[3]).toContain("non visitée");
  });

  it("distingue les types par la forme et le texte : choix, interlude, fin", () => {
    const root = render({ revealAll: true, story: story({ endings: ["finale"] }) });
    expect(nodeEl(root, "menu")!.dataset.kind).toBe("choice");
    expect(nodeEl(root, "menu")!.getAttribute("aria-label")).toContain("choix de 2 options");
    expect(nodeEl(root, "teatime")!.dataset.kind).toBe("interlude");
    expect(nodeEl(root, "teatime")!.getAttribute("aria-label")).toContain("interlude");
    const finale = nodeEl(root, "finale")!;
    expect(finale.dataset.kind).toBe("end");
    expect(finale.dataset.ending).toBe("reached");
    expect(finale.getAttribute("aria-label")).toContain("fin atteinte");
    expect(finale.querySelector(".mh-flow-flag")?.textContent).toBe("⚑");
    // Une fin non atteinte garde sa forme mais ne se dit pas atteinte.
    expect(nodeEl(root, "iso")!.dataset.ending).toBe("pending");
  });

  it("le nœud courant porte aria-current et le repère « Ici » ; les autres non", () => {
    const root = render({ story: played, currentScript: "left" });
    const current = root.querySelectorAll('[aria-current]');
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(nodeEl(root, "left"));
    expect(current[0]!.getAttribute("aria-current")).toBe("location");
    expect(current[0]!.querySelector<HTMLElement>(".mh-flow-marker-text")?.dataset.text).toBe("Ici");
  });
});

describe("anti-spoiler (mode par défaut)", () => {
  const root = () => render({ story: played, currentScript: "left" });

  it("un nœud non visité est une silhouette annoncée « scène non découverte », sans identifiant ni texte", () => {
    const r = root();
    const silhouettes = allNodes(r).filter((n) => n.dataset.state === "hidden");
    expect(silhouettes.length).toBe(4); // right, mid, finale, iso
    for (const n of silhouettes) {
      // Décision 5 : le nœud masqué reste dans l'arbre d'accessibilité, sans rien révéler du jeu.
      expect(n.getAttribute("aria-hidden")).toBeNull();
      expect(n.getAttribute("role")).toBe("button");
      expect(n.getAttribute("aria-label")).toBe("Scène non découverte");
      expect(n.getAttribute("aria-disabled")).toBe("true");
      expect(n.textContent).toBe("");
      expect(n.querySelector("img")).toBeNull();
      expect(n.hasAttribute("data-id")).toBe(false);
      expect(n.hasAttribute("data-kind")).toBe(false);
      // Un seul arrêt de tabulation au maximum sur la carte (roving tabindex) : aucune silhouette.
      expect(n.tabIndex).toBe(-1);
    }
  });

  it("aucun identifiant, titre, vignette ni libellé non emprunté d'un nœud caché dans le DOM", () => {
    const html = root().outerHTML;
    for (const secret of ["right", "mid", "finale", "iso", "TITLE-TWO", "TITLE-BONUS", "LABEL-RIGHT", "thumb-right", "thumb-finale", "ARC-TWO", "ARC-BONUS", "flag>0"]) {
      expect(html, secret).not.toContain(secret);
    }
    // Les nœuds visités, eux, sont bien là.
    for (const shown of ["start", "menu", "left", "TITLE-ONE", "thumb-left"]) expect(html, shown).toContain(shown);
  });

  it("les libellés de choix ne s'affichent que sur l'arête empruntée", () => {
    const r = root();
    const texts = [...r.querySelectorAll(".mh-flow-choice tspan")].map((t) => t.textContent);
    expect(texts).toEqual(["LABEL-LEFT"]);
  });

  it("un chapitre sans nœud visité cache son titre", () => {
    const r = root();
    const groups = [...r.querySelectorAll<HTMLElement>(".mh-flow-group")];
    expect(groups.map((g) => g.querySelector(".mh-flow-group-title")!.textContent)).toEqual(["TITLE-ONE", "???", "???"]);
    expect(groups.filter((g) => g.dataset.locked === "true")).toHaveLength(2);
  });

  it("sans aucune progression, tout est silhouette (aucun texte du graphe)", () => {
    const r = render();
    expect(allNodes(r).every((n) => n.dataset.state === "hidden")).toBe(true);
    expect(r.querySelector(".mh-flow-stage")!.textContent).not.toMatch(/start|menu|left|TITLE|LABEL/);
  });
});

describe("mode « révéler tout »", () => {
  it("affiche identifiants, titres, vignettes et tous les libellés", () => {
    const r = render({ story: played, currentScript: "left", revealAll: true });
    expect(allNodes(r).some((n) => n.dataset.state === "hidden")).toBe(false);
    const html = r.outerHTML;
    for (const text of ["right", "finale", "iso", "TITLE-TWO", "TITLE-BONUS", "LABEL-LEFT", "LABEL-RIGHT", "thumb-right", "thumb-finale"]) {
      expect(html, text).toContain(text);
    }
    expect(r.querySelectorAll(".mh-flow-group[data-locked]")).toHaveLength(0);
  });
});

describe("arêtes", () => {
  it("marque parcourues les arêtes empruntées et estompe l'interlude partagé", () => {
    const states = computeNodeStates(graph, played, "left", false);
    const taken = takenEdgeIndexes(graph, played, states);
    expect([...taken].sort()).toEqual([0, 1, 6]); // start>menu, menu>left, start>teatime
    const r = render({ story: played, currentScript: "left" });
    const edges = [...r.querySelectorAll<SVGElement>(".mh-flow-stage .mh-flow-edge")];
    expect(edges).toHaveLength(graph.edges.length);
    expect(edges.filter((e) => e.getAttribute("data-taken") === "true")).toHaveLength(3);
    expect(edges.filter((e) => e.getAttribute("data-hub") === "true")).toHaveLength(2);
    expect(edges.filter((e) => e.getAttribute("data-kind") === "conditional")).toHaveLength(1);
  });

  it("le survol d'un nœud éclaire ses arêtes", () => {
    const r = render({ story: played, currentScript: "left" });
    const hub = nodeEl(r, "teatime")!;
    hub.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(r.querySelectorAll(".mh-flow-stage .mh-flow-edge.is-lit")).toHaveLength(2);
    r.querySelector(".mh-flow-stage")!.dispatchEvent(new Event("pointerleave"));
    expect(r.querySelectorAll(".mh-flow-stage .mh-flow-edge.is-lit")).toHaveLength(0);
  });

  it("plusieurs options vers le même script : aucun libellé tant qu'on ne sait pas laquelle fut choisie", () => {
    const twin: StoryGraph = {
      version: 1,
      first: "a",
      nodes: [
        { id: "a", file: "a.ks", kind: "choice" },
        { id: "b", file: "b.ks", kind: "normal" },
      ],
      edges: [
        { from: "a", to: "b", kind: "choice", choice: "ONE" },
        { from: "a", to: "b", kind: "choice", choice: "TWO" },
      ],
    };
    const taken = new Set([0, 1]);
    expect(visibleChoiceLabels(twin, taken, false).size).toBe(0);
    expect(visibleChoiceLabels(twin, taken, true).get(0)).toEqual({ label: "ONE", more: 1 });
  });
});

describe("vignettes", () => {
  it("n'utilise que la clé et retombe sur le CSS si la clé est absente ou l'image échoue", () => {
    const r = render({ story: played, currentScript: "left", thumbnail: (k) => (k === "thumb-left" ? "/assets/l.webp" : null) });
    expect(nodeEl(r, "left")!.querySelector("img")!.getAttribute("src")).toBe("/assets/l.webp");
    expect(nodeEl(r, "start")!.querySelector("img")).toBeNull();
    const img = nodeEl(r, "left")!.querySelector("img")!;
    img.dispatchEvent(new Event("error"));
    expect(nodeEl(r, "left")!.querySelector("img")).toBeNull();
    expect(nodeEl(r, "left")!.querySelector(".mh-flow-id")!.textContent).toBe("left");
  });

  it("sans résolveur de vignette, aucune image", () => {
    const r = render({ story: played, thumbnail: undefined });
    expect(r.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("compteurs, légende et structure", () => {
  it("compte les scènes lues et les fins atteignables (jamais « x/4 »)", () => {
    const r = render({ story: played });
    expect(r.querySelector('[data-counter="scenes"]')!.textContent).toBe("Scènes lues : 4/8");
    // Une seule fin atteignable depuis le début : `finale` ; `iso` est en section Bonus.
    expect(r.querySelector('[data-counter="endings"]')!.textContent).toBe("Fins atteintes : 0/1");
    const done = render({ story: story({ visited: ["finale"], endings: ["finale", "iso"] }) });
    expect(done.querySelector('[data-counter="endings"]')!.textContent).toBe("Fins atteintes : 1/1");
  });

  it("légende : tous les états et types", () => {
    const r = render();
    const ids = [...r.querySelectorAll<HTMLElement>(".mh-flow-legend-item")].map((li) => li.dataset.legend);
    expect(ids).toEqual(["hidden", "unvisited", "visited", "finished", "current", "choice", "interlude", "end", "taken", "conditional"]);
  });

  it("section Bonus séparée avec son titre", () => {
    const r = render();
    expect(r.querySelector(".mh-flow-section-title")!.textContent).toBe("Bonus");
    expect(r.querySelectorAll(".mh-flow-group[data-section='bonus']")).toHaveLength(1);
  });

  it("titre, sous-titre japonais décoratif, région défilante et « Retour »", () => {
    const onBack = vi.fn();
    const r = render({}, onBack);
    expect(r.querySelector("#mh-flow-title")!.textContent).toBe("Flowchart");
    expect(r.querySelector(".mh-flow-title-deco")!.getAttribute("aria-hidden")).toBe("true");
    expect(r.querySelector(".mh-flow-scroll")!.getAttribute("role")).toBe("region");
    expect(r.classList.contains("mh-ui-night")).toBe(true);
    r.querySelector<HTMLButtonElement>(".mh-flow-back")!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("libellés traduits (anglais)", () => {
    setUiLanguage("en");
    const r = render({ story: played, currentScript: "left" });
    expect(r.querySelector('[data-counter="scenes"]')!.textContent).toBe("Scenes read: 4/8");
    expect(nodeEl(r, "left")!.getAttribute("aria-label")).toBe("Scene left, current position");
  });
});

describe("état vide", () => {
  it.each([null, undefined])("graphe %s : message clair, « Retour » conservé, aucune erreur", (g) => {
    const onBack = vi.fn();
    const r = render({ graph: g }, onBack);
    expect(r.dataset.empty).toBe("true");
    expect(r.querySelector(".mh-flow-empty")!.textContent).toContain("npm run chain");
    expect(r.querySelector(".mh-flow-stage")).toBeNull();
    r.querySelector<HTMLButtonElement>(".mh-flow-back")!.click();
    expect(onBack).toHaveBeenCalled();
  });
});

describe("libellés de choix", () => {
  it("coupe à deux lignes et tronque (plein chasse = 2 unités)", () => {
    expect(labelLines("court")).toEqual(["court"]);
    expect(labelLines("a\\nb\\nc")).toEqual(["a", "b"]);
    expect(labelLines("あ".repeat(20))).toEqual([`${"あ".repeat(12)}…`]);
  });
});

describe("feuille de style", () => {
  const css = readFileSync(resolve(__dirname, "../../../src/ui/flowchart-view.css"), "utf8");
  const tokens = readFileSync(resolve(__dirname, "../../../src/ui/tokens.css"), "utf8");
  const defined = new Set([...tokens.matchAll(/(--mh-[\w-]+)\s*:/g)].map((m) => m[1]!));
  // Variables locales déclarées par la feuille elle-même.
  const local = new Set([...css.matchAll(/(--mh-[\w-]+)\s*:/g)].map((m) => m[1]!));

  it("n'utilise que des tokens existants ou ses propres variables (ou une valeur de repli)", () => {
    const used = [...css.matchAll(/var\((--mh-[\w-]+)(,)?/g)].map((m) => ({ name: m[1]!, fallback: m[2] === "," }));
    const unknown = used.filter((u) => !u.fallback && !defined.has(u.name) && !local.has(u.name));
    expect(unknown).toEqual([]);
  });

  it("le halo du courant utilise --mh-cyan-glint et les choix --mh-select", () => {
    expect(css).toMatch(/\[data-state="current"\][^{]*\{[^}]*drop-shadow\([^)]*--mh-cyan-glint/);
    expect(css).toMatch(/\[data-kind="choice"\] \.mh-flow-shape \{[^}]*--mh-select/);
  });

  it("ne référence aucune image du jeu", () => {
    expect(css).not.toMatch(/url\(/);
  });
});
