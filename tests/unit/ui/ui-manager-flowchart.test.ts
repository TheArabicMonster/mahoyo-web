import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultShortcuts } from "@/core/shortcuts.js";
import type { StoryGraph } from "@/core/story-graph.js";
import { setUiLanguage } from "@/ui/i18n.js";
import { setRememberedScale } from "@/ui/flowchart-viewport.js";
import { DomUIManager } from "@/ui/ui-manager.js";
import type { PlayerCommands, StoryProgress } from "@/ui/types.js";

// FLOW-06 (#202) : branchement de « Relire depuis ici » dans DomUIManager (confirmation Non par défaut, puis startScript).

const graph: StoryGraph = {
  version: 1,
  first: "a",
  nodes: [
    { id: "a", file: "a.ks", kind: "normal", chapter: "c1" },
    { id: "b", file: "b.ks", kind: "normal", chapter: "c1" },
  ],
  edges: [{ from: "a", to: "b", kind: "normal" }],
};
const story: StoryProgress = { visited: ["a"], finished: [], choices: [], endings: [] };

describe("DomUIManager : flowchart interactif", () => {
  let root: HTMLElement;
  let ui: DomUIManager;
  let startScript: ReturnType<typeof vi.fn>;
  const q = (sel: string) => root.querySelector<HTMLElement>(sel);
  const openFlowchart = () => {
    ui.show({
      screen: "flowchart",
      scripts: [{ id: "c1", label: "Chapitre", file: "a.ks", arc: "X" }],
      currentScript: "a",
      story,
      graph,
      revealAll: false,
    });
  };

  beforeEach(() => {
    setUiLanguage("fr");
    setRememberedScale(1);
    document.body.innerHTML = '<div id="viewport"></div>';
    root = document.getElementById("viewport")!;
    startScript = vi.fn();
    ui = new DomUIManager();
    ui.init(root, { startScript, closeScreen: vi.fn(), openScreen: vi.fn() } as unknown as PlayerCommands);
    ui.show({ screen: "game" });
    ui.setStatus({
      mode: "normal", inGame: true, userHidden: false, canRollback: false, quickMenuLocked: false, autoPaused: false,
      mouseMode: "menu", autoHideCursor: false, fastForwardKey: "shift", shortcuts: defaultShortcuts(),
    });
  });
  afterEach(() => ui.dispose());

  function clickReplay(): void {
    openFlowchart();
    q('.mh-flow-node[data-id="a"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    q(".mh-flow-replay")!.click();
  }

  it("Non (présélectionné, Entrée) : la boîte se ferme et rien ne démarre", async () => {
    clickReplay();
    expect(q(".mh-ui-confirm")).not.toBeNull();
    expect(q(".mh-ui-confirm-message")!.textContent).toContain("a");
    expect(document.activeElement).toBe(q(".mh-ui-confirm-no"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(q(".mh-ui-confirm")).toBeNull();
    expect(startScript).not.toHaveBeenCalled();
  });

  it("Oui : startScript reçoit le fichier du script", async () => {
    clickReplay();
    q(".mh-ui-confirm-yes")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(startScript).toHaveBeenCalledTimes(1);
    expect(startScript).toHaveBeenCalledWith("a.ks");
  });

  it("FLOW-08 : la vue rendue respecte le réglage « tout révéler » (décision 5)", () => {
    // Anti-spoiler par défaut : les scènes non visitées sont des silhouettes.
    openFlowchart();
    expect(root.querySelectorAll('.mh-flow-stage .mh-flow-node[data-state="hidden"]').length).toBe(1);
    expect(root.querySelectorAll('.mh-flow-stage .mh-flow-node[data-state="unvisited"]').length).toBe(0);

    // Option active (réglage HUD-09 relayé par le player) : plus de silhouette, les non visitées sont révélées.
    ui.show({
      screen: "flowchart",
      scripts: [{ id: "c1", label: "Chapitre", file: "a.ks", arc: "X" }],
      currentScript: "a",
      story,
      graph,
      revealAll: true,
    });
    expect(root.querySelectorAll('.mh-flow-stage .mh-flow-node[data-state="hidden"]').length).toBe(0);
    expect(root.querySelectorAll('.mh-flow-stage .mh-flow-node[data-state="unvisited"]').length).toBe(1);
  });

  it("entrées bloquées (chargement) : aucune relecture", async () => {
    clickReplay();
    ui.setInputEnabled(false);
    q(".mh-ui-confirm-yes")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(startScript).not.toHaveBeenCalled();
  });
});
