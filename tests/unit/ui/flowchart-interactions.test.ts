// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryGraph } from "@/core/story-graph.js";
import { describeNode, reachableFrom, requestReplay } from "@/ui/flowchart-detail.js";
import { layoutOf, renderFlowchartScreen, type FlowchartData } from "@/ui/flowchart-view.js";
import { setRememberedScale, ZOOM_STEP } from "@/ui/flowchart-viewport.js";
import { setUiLanguage } from "@/ui/i18n.js";
import type { StoryProgress } from "@/ui/types.js";

/**
 * Graphe factice original :
 *   start -> menu (choix) -> left  -> mid -> finale (fin)
 *                         -> right -> mid
 *   teatime (interlude) relié à start et à mid ; iso : fin isolée (Bonus).
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
  ],
};
const chapters = [
  { id: "c1", label: "TITLE-ONE" },
  { id: "c2", label: "TITLE-TWO" },
  { id: "cx", label: "TITLE-BONUS" },
];
const story = (p: Partial<StoryProgress> = {}): StoryProgress => ({ visited: [], finished: [], choices: [], endings: [], ...p });
const played = story({ visited: ["start", "menu", "left", "teatime"], finished: ["start", "menu"], choices: [{ from: "menu", to: "left" }] });

function render(patch: Partial<FlowchartData> = {}): HTMLElement {
  const screen = renderFlowchartScreen({ graph, chapters, currentScript: null, story: played, revealAll: false, ...patch }, vi.fn());
  document.body.replaceChildren(screen);
  // jsdom n'a pas de mise en page : la zone visible est simulée avant la première mesure (micro-tâche).
  const scroller = screen.querySelector<HTMLElement>(".mh-flow-scroll");
  if (scroller) {
    Object.defineProperty(scroller, "clientWidth", { value: 600, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });
    scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, x: 0, y: 0, toJSON: () => ({}) });
  }
  return screen;
}
const node = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`.mh-flow-node[data-id="${id}"]`)!;
const silhouettes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.mh-flow-stage .mh-flow-node[data-state="hidden"]')];
const panel = (root: HTMLElement) => root.querySelector<HTMLElement>(".mh-flow-detail");
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  setUiLanguage("fr");
  setRememberedScale(1);
});
afterEach(() => {
  document.body.replaceChildren();
  setRememberedScale(1);
});

describe("describeNode", () => {
  const layout = layoutOf(graph);
  it("ne décrit que les nœuds ouverts (visité, terminé, courant)", () => {
    for (const state of ["hidden", "unvisited", undefined] as const) {
      expect(describeNode(graph, "left", state, story(), layout.endings, chapters)).toBeNull();
    }
    for (const state of ["visited", "finished", "current"] as const) {
      expect(describeNode(graph, "left", state, story(), layout.endings, chapters)?.state).toBe(state);
    }
    expect(describeNode(graph, "inconnu", "visited", story(), layout.endings, chapters)).toBeNull();
  });

  it("arc, titre de chapitre et fins atteintes depuis ce nœud", () => {
    expect(layout.endings).toEqual(["finale"]); // iso est en Bonus : ne compte pas
    const d = describeNode(graph, "left", "visited", story({ endings: ["finale"] }), layout.endings, chapters)!;
    expect(d).toMatchObject({ id: "left", file: "left.ks", arc: "ARC-ONE", chapter: "TITLE-ONE", kind: "normal", endings: { reached: 1, total: 1 } });
    // Un nœud sans chapitre connu retombe sur l'identifiant de chapitre ; aucune fin accessible depuis la fin elle-même hors liste.
    const tea = describeNode(graph, "teatime", "visited", story(), layout.endings, chapters)!;
    expect(tea.chapter).toBeUndefined();
    expect(describeNode(graph, "finale", "visited", story(), layout.endings, chapters)!.endings).toEqual({ reached: 0, total: 1 });
    expect(describeNode(graph, "iso", "visited", story(), layout.endings, chapters)!.endings).toEqual({ reached: 0, total: 0 });
  });

  it("reachableFrom suit toutes les arêtes (cycles compris)", () => {
    expect([...reachableFrom(graph, "left")].sort()).toEqual(["finale", "left", "mid"]);
    const loop = { edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] } as StoryGraph;
    expect([...reachableFrom(loop, "a")].sort()).toEqual(["a", "b"]);
  });
});

describe("clic sur un nœud et volet de détails", () => {
  it("un nœud visité ouvre le volet : arc, chapitre, état, fins atteintes", () => {
    const r = render({ story: { ...played, endings: [] }, currentScript: "left" });
    expect(panel(r)).toBeNull();
    node(r, "left").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const p = panel(r)!;
    expect(p.getAttribute("role")).toBe("region");
    expect(p.querySelector("h3")!.textContent).toBe("Scène left");
    expect(p.getAttribute("aria-labelledby")).toBe(p.querySelector("h3")!.id);
    const field = (k: string) => p.querySelector(`[data-field="${k}"]`)?.textContent;
    expect(field("arc")).toBe("ARC-ONE");
    expect(field("chapter")).toBe("TITLE-ONE");
    expect(field("state")).toBe("Position actuelle");
    expect(field("endings")).toBe("0/1");
    expect(node(r, "left").dataset.selected).toBe("true");
    expect(document.activeElement).toBe(p);
  });

  it("un autre clic remplace le volet et la sélection ; × et Échap le ferment", () => {
    const r = render();
    node(r, "start").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    node(r, "menu").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(r.querySelectorAll(".mh-flow-detail")).toHaveLength(1);
    expect(panel(r)!.dataset.node).toBe("menu");
    expect(r.querySelectorAll("[data-selected]")).toHaveLength(1);

    r.querySelector<HTMLButtonElement>(".mh-flow-detail-close")!.click();
    expect(panel(r)).toBeNull();
    expect(r.querySelector("[data-selected]")).toBeNull();

    node(r, "start").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    panel(r)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel(r)).toBeNull();
    expect(outer).not.toHaveBeenCalled(); // Échap ne ferme pas l'écran en plus du volet
    expect(document.activeElement).toBe(r.querySelector(".mh-flow-scroll"));
  });

  it("une silhouette n'ouvre rien, n'est pas cliquable et ne porte aucun identifiant", () => {
    const r = render();
    const hidden = silhouettes(r);
    expect(hidden.length).toBe(4);
    for (const el of hidden) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(el.hasAttribute("data-id")).toBe(false);
      expect(el.hasAttribute("data-interactive")).toBe(false);
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(el.tabIndex).toBe(-1);
      expect(el.querySelector("button, a, [tabindex]")).toBeNull();
    }
    expect(panel(r)).toBeNull();
    // Un clic sur le fond n'ouvre rien non plus.
    r.querySelector(".mh-flow-stage")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel(r)).toBeNull();
  });

  it("aucun identifiant caché ne fuit dans le volet ni dans l'écran quand un nœud est ouvert", () => {
    const r = render({ currentScript: "left" });
    node(r, "left").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const html = r.outerHTML;
    for (const secret of ["right", "mid", "finale", "iso", "TITLE-TWO", "TITLE-BONUS", "LABEL-RIGHT", "ARC-TWO", "ARC-BONUS"]) {
      expect(html, secret).not.toContain(secret);
    }
  });

  it("« tout révéler » : un nœud non visité reste inerte (ni volet ni relecture), un nœud visité s'ouvre", () => {
    const replay = vi.fn();
    const r = render({ revealAll: true, replay, confirm: vi.fn(async () => true) });
    const unvisited = node(r, "right");
    expect(unvisited.dataset.state).toBe("unvisited");
    expect(unvisited.hasAttribute("data-interactive")).toBe(false);
    unvisited.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel(r)).toBeNull();
    expect(r.querySelector(".mh-flow-replay")).toBeNull();
    expect(replay).not.toHaveBeenCalled();

    node(r, "left").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel(r)).not.toBeNull();
    expect(node(r, "left").dataset.interactive).toBe("true");
  });
});

describe("« Relire depuis ici »", () => {
  it("demande confirmation avec Non par défaut, puis lance le bon script sur Oui", async () => {
    const confirm = vi.fn(async () => true);
    const replay = vi.fn();
    const r = render({ confirm, replay });
    node(r, "left").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    r.querySelector<HTMLButtonElement>(".mh-flow-replay")!.click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("left"), { defaultButton: "no" });
    expect(replay).not.toHaveBeenCalled(); // pas avant la réponse
    await flush();
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith({ id: "left", file: "left.ks" });
  });

  it("ne lance rien si l'utilisateur répond Non", async () => {
    const replay = vi.fn();
    const r = render({ confirm: vi.fn(async () => false), replay });
    node(r, "start").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    r.querySelector<HTMLButtonElement>(".mh-flow-replay")!.click();
    await flush();
    expect(replay).not.toHaveBeenCalled();
  });

  it("sans boîte de confirmation, aucune relecture ; sans commande, pas de bouton", async () => {
    const replay = vi.fn();
    await expect(requestReplay({ id: "a", file: "a.ks" }, { replay })).resolves.toBe(false);
    expect(replay).not.toHaveBeenCalled();
    await expect(requestReplay({ id: "a", file: "a.ks" }, { confirm: async () => true })).resolves.toBe(false);

    const r = render();
    node(r, "start").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel(r)).not.toBeNull();
    expect(r.querySelector(".mh-flow-replay")).toBeNull();
  });

  it("le message de confirmation suit la langue", async () => {
    setUiLanguage("en");
    const confirm = vi.fn(async (_message: string) => false);
    const r = render({ confirm, replay: vi.fn() });
    node(r, "start").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(r.querySelector(".mh-flow-replay")!.textContent).toBe("Replay from here");
    r.querySelector<HTMLButtonElement>(".mh-flow-replay")!.click();
    expect(confirm.mock.calls[0]![0]).toContain("Replay scene start");
  });
});

describe("pan, zoom et centrage dans l'écran", () => {
  const stageOf = (r: HTMLElement) => r.querySelector<HTMLElement>(".mh-flow-stage")!;
  const scrollerOf = (r: HTMLElement) => r.querySelector<HTMLElement>(".mh-flow-scroll")!;
  const readout = (r: HTMLElement) => r.querySelector(".mh-flow-zoom-value")!.textContent;

  it("la scène est dans un conteneur dimensionné au zoom ; la carte reste une région focalisable nommée", () => {
    const r = render();
    const layout = layoutOf(graph);
    const sizer = r.querySelector<HTMLElement>(".mh-flow-sizer")!;
    expect(sizer.parentElement).toBe(scrollerOf(r));
    expect(stageOf(r).parentElement).toBe(sizer);
    expect(sizer.style.width).toBe(`${layout.width}px`);
    expect(stageOf(r).style.transform).toBe("scale(1)");
    const s = scrollerOf(r);
    expect(s.getAttribute("role")).toBe("region");
    expect(s.getAttribute("aria-label")).toBe("Carte du scénario");
    expect(s.tabIndex).toBe(0);
    expect(readout(r)).toBe("100 %");
  });

  it("boutons + et − : zoom, pourcentage, bornes (boutons désactivés)", () => {
    const r = render();
    const plus = r.querySelector<HTMLButtonElement>(".mh-flow-zoom-in")!;
    const minus = r.querySelector<HTMLButtonElement>(".mh-flow-zoom-out")!;
    expect([plus.getAttribute("aria-label"), minus.getAttribute("aria-label")]).toEqual(["Zoom avant", "Zoom arrière"]);
    plus.click();
    expect(stageOf(r).style.transform).toBe(`scale(${ZOOM_STEP})`);
    expect(readout(r)).toBe("125 %");
    minus.click();
    minus.click();
    expect(readout(r)).toBe("80 %");
    for (let i = 0; i < 20; i++) minus.click();
    expect(minus.disabled).toBe(true);
    expect(plus.disabled).toBe(false);
    for (let i = 0; i < 40; i++) plus.click();
    expect(plus.disabled).toBe(true);
    expect(readout(r)).toBe("300 %");
  });

  it("le zoom est conservé à la réouverture de l'écran", () => {
    const first = render();
    first.querySelector<HTMLButtonElement>(".mh-flow-zoom-in")!.click();
    first.querySelector<HTMLButtonElement>(".mh-flow-zoom-in")!.click();
    const second = render();
    expect(stageOf(second).style.transform).toBe(`scale(${ZOOM_STEP * ZOOM_STEP})`);
    expect(readout(second)).toBe("156 %");
  });

  it("« Centrer » amène la vue sur le nœud courant (zoom conservé) ; la position initiale aussi", async () => {
    const box = layoutOf(graph).nodes.find((n) => n.id === "mid")!;
    const r = render({ story: story({ visited: ["start", "mid"] }), currentScript: "mid" });
    const s = scrollerOf(r);
    await Promise.resolve();
    // Position initiale : le nœud courant est centré (zone visible simulée 600 x 400).
    const expectedTop = Math.max(0, box.y + box.height / 2 - 200);
    expect(s.scrollTop).toBeCloseTo(expectedTop);

    s.scrollTop = 0;
    s.scrollLeft = 0;
    r.querySelector<HTMLButtonElement>(".mh-flow-center")!.click();
    expect(s.scrollTop).toBeCloseTo(expectedTop);

    // Avec un autre zoom, le centre du nœud, à l'échelle, est au centre de la zone visible.
    r.querySelector<HTMLButtonElement>(".mh-flow-zoom-in")!.click();
    s.scrollTop = 0;
    r.querySelector<HTMLButtonElement>(".mh-flow-center")!.click();
    expect(s.scrollTop).toBeCloseTo(Math.max(0, (box.y + box.height / 2) * ZOOM_STEP - 200));
    expect(r.querySelector<HTMLButtonElement>(".mh-flow-center")!.getAttribute("aria-label")).toBe("Centrer sur ma position");
  });

  it("sans position courante (écran titre), « Centrer » est inactif", () => {
    const r = render({ currentScript: null });
    expect(r.querySelector<HTMLButtonElement>(".mh-flow-center")!.disabled).toBe(true);
    const unknown = render({ currentScript: "absent-du-graphe" });
    expect(unknown.querySelector<HTMLButtonElement>(".mh-flow-center")!.disabled).toBe(true);
  });

  it("Ctrl + molette et glissement agissent sur la carte rendue ; un glissement n'ouvre pas de volet", () => {
    const r = render();
    const s = scrollerOf(r);
    s.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    expect(readout(r)).toBe("125 %");

    const before = s.scrollTop;
    s.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, pointerType: "mouse", clientX: 300, clientY: 300, bubbles: true }));
    s.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 300, clientY: 200, bubbles: true }));
    s.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, pointerType: "mouse", clientX: 300, clientY: 200, bubbles: true }));
    expect(s.scrollTop).toBe(before + 100);
    node(r, "start").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel(r)).toBeNull(); // le clic qui suit un glissement est ignoré
    node(r, "start").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel(r)).not.toBeNull();
  });

  it("libellés traduits (anglais, japonais)", () => {
    setUiLanguage("en");
    expect(render().querySelector(".mh-flow-zoom-in")!.getAttribute("aria-label")).toBe("Zoom in");
    setUiLanguage("ja");
    expect(render().querySelector(".mh-flow-center")!.getAttribute("aria-label")).toBe("現在地に移動");
  });
});

describe("feuille de style des interactions", () => {
  const css = readFileSync(resolve(__dirname, "../../../src/ui/flowchart-view.css"), "utf8");
  const rule = (selector: string): string => {
    const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    return m?.[1] ?? "";
  };

  it("la carte gère elle-même le glissement et le pincement (touch-action: none), la molette reste native", () => {
    expect(rule(".mh-flow-scroll")).toMatch(/touch-action:\s*none/);
    expect(rule(".mh-flow-scroll")).toMatch(/overflow:\s*auto/);
  });

  it("la scène est mise à l'échelle depuis son coin haut-gauche", () => {
    expect(rule(".mh-flow-stage")).toMatch(/transform-origin:\s*0 0/);
  });

  it("mouvement réduit : pas d'animation d'ouverture ; boutons tactiles de 44 px", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.mh-ui-flowchart > \.mh-flow-screen\s*\{\s*animation:\s*none/);
    expect(css).toMatch(/pointer: coarse\)[\s\S]*\.mh-flow-tool\s*\{[^}]*width:\s*44px/);
  });

  it("les nœuds inertes (silhouettes, révélés non visités) n'ont pas le curseur d'un élément cliquable", () => {
    expect(css).toMatch(/\.mh-flow-node\[data-interactive="true"\]\s*\{\s*cursor:\s*pointer/);
    expect(css).not.toMatch(/\.mh-flow-node\s*\{[^}]*cursor:\s*pointer/);
  });
});
