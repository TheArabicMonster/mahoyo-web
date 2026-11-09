import { describe, it, expect, afterEach } from "vitest";
import { Player, type RuntimeLike } from "@/ui/player.js";
import { createMemorySaveStore } from "@/player/save-store.js";
import { createMemorySettingsStore } from "@/player/settings-store.js";
import { HistoryRouter } from "@/ui/router.js";
import { FakeAudioPlayer } from "../mocks/fake-audio-player.js";
import { FakeScreenTransitions } from "../mocks/fake-screen-transitions.js";
import { FakeUIManager } from "../mocks/fake-ui-manager.js";
import { FakeBrowserHistory } from "../mocks/fake-browser-history.js";
import { RecordingStageRenderer } from "../renderer/recording-stage-renderer.js";
import type { Step } from "@/kag/events.js";
import type { RuntimeSaveData } from "@/kag/runtime.js";
import type { ParsedScript } from "@/kag/types.js";
import prologue from "../../fixtures/prologue.json";

/** WEB-04 (#204) : le player publie sa vue au routeur et applique les navigations du navigateur. */

class ScriptedRuntime implements RuntimeLike {
  scriptLoader: RuntimeLike["scriptLoader"] = null;
  index = 0;
  constructor(private steps: Step[]) {}
  step(): Step {
    return (
      this.steps[this.index++] ?? {
        position: { scriptName: "t.ks", page: 99, instruction: 0 },
        events: [],
        stop: { kind: "end" },
      }
    );
  }
  async loadScript(): Promise<boolean> {
    return true;
  }
  jump(): boolean {
    return true;
  }
  getSaveData(): RuntimeSaveData {
    return {
      scriptName: "t.ks",
      pc: this.index,
      instructionIndex: 0,
      segmentIndex: 0,
      state: {
        fore: { background: "", layers: [] },
        back: { background: "", layers: [] },
        bgm: null,
        se: null,
        variables: { f: {}, sf: {}, tf: {} },
        evalGlobal: {},
      },
      callStack: [],
      macros: {},
    };
  }
  async loadSaveData(data: RuntimeSaveData): Promise<boolean> {
    this.index = data.pc;
    return true;
  }
}

class ConfirmingUI extends FakeUIManager {
  answer = true;
  async confirm(message: string): Promise<boolean> {
    this.confirms.push(message);
    return this.answer;
  }
}

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, label = "condition"): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await wait(2);
  }
  throw new Error(`timeout: ${label}`);
}

let current: Player | null = null;
afterEach(async () => {
  await current?.dispose();
  current = null;
});

async function setup(initialHash = "", steps: Step[] = prologue as Step[]) {
  const host = new FakeBrowserHistory(initialHash);
  const ui = new ConfirmingUI();
  const player = new Player({
    root: document.body,
    createStageRenderer: () => new RecordingStageRenderer(),
    createAudioPlayer: () => new FakeAudioPlayer(),
    createUIManager: () => ui,
    createRuntime: () => new ScriptedRuntime(steps),
    loadScript: async () => ({ pages: [], labels: {} }) as unknown as ParsedScript,
    loadChain: async () => null,
    loadGraph: async () => null,
    loadTimelines: async () => null,
    loadLanguages: async () => new Map(),
    saveStore: createMemorySaveStore(),
    settingsStore: createMemorySettingsStore(),
    skipDelay: 1,
    router: new HistoryRouter(host),
    transitions: new FakeScreenTransitions(),
  });
  current = player;
  await player.ready;
  return { host, ui, player };
}

async function startGame(ctx: Awaited<ReturnType<typeof setup>>) {
  ctx.player.startScript("t.ks");
  await until(() => ctx.player.currentState === "waiting-click", "waiting-click");
}

const lastScreen = (ui: FakeUIManager) => ui.views.at(-1)?.screen;

describe("Player + routes d'URL", () => {
  it("sans hash : #/title", async () => {
    const { host } = await setup();
    expect(host.hashes).toEqual(["#/title"]);
  });

  it("lien direct vers #/config : écran ouvert, précédent le ferme et ramène au titre", async () => {
    const { host, ui, player } = await setup("#/config");
    await until(() => lastScreen(ui) === "settings", "settings");
    expect(host.hashes).toEqual(["#/title", "#/config"]);
    host.go(-1);
    await until(() => lastScreen(ui) === "title", "title");
    expect(player.currentState).toBe("title");
    expect(host.location.hash).toBe("#/title");
  });

  it("liens directs vers load et flowchart", async () => {
    for (const [hash, screen] of [
      ["#/load", "load"],
      ["#/flowchart", "flowchart"],
    ] as const) {
      const ctx = await setup(hash);
      await until(() => lastScreen(ctx.ui) === screen, screen);
      await ctx.player.dispose();
      current = null;
    }
  });

  it("#/game, #/save et #/backlog sans partie : repli sur le titre", async () => {
    for (const hash of ["#/game", "#/save", "#/backlog"]) {
      const ctx = await setup(hash);
      expect(lastScreen(ctx.ui)).toBe("title");
      expect(ctx.host.hashes).toEqual(["#/title"]);
      await ctx.player.dispose();
      current = null;
    }
  });

  it("navigation du navigateur vers un écran qui exige une partie, sans partie : titre", async () => {
    const { host, ui } = await setup();
    host.typeHash("#/save");
    await wait(5);
    expect(lastScreen(ui)).toBe("title");
    expect(host.location.hash).toBe("#/title");
  });

  it("ouvrir un écran depuis l'interface met à jour l'URL ; précédent le ferme sans recharger", async () => {
    const { host, ui, player } = await setup();
    player.openScreen("settings");
    expect(host.location.hash).toBe("#/config");
    host.go(-1);
    await until(() => lastScreen(ui) === "title");
    expect(host.location.hash).toBe("#/title");
  });

  it("fermer un écran avec le bouton de l'interface dépile l'entrée d'historique", async () => {
    const { host, player } = await setup();
    player.openScreen("load");
    player.closeScreen();
    await wait(5);
    expect(host.location.hash).toBe("#/title");
    expect(host.entries.length).toBe(2); // entrée de la forward, pas de nouvelle entrée
    expect(host.index).toBe(0);
  });

  it("en partie : #/game, écrans empilés, précédent ferme un écran à la fois", async () => {
    const ctx = await setup();
    await startGame(ctx);
    expect(ctx.host.location.hash).toBe("#/game");

    ctx.player.openScreen("pause");
    expect(ctx.host.location.hash).toBe("#/game"); // menu système : pas d'entrée d'historique
    ctx.player.openScreen("save");
    expect(ctx.host.location.hash).toBe("#/save");
    ctx.host.go(-1);
    await until(() => ctx.player.currentState === "paused" && lastScreen(ctx.ui) !== "save", "pause");
    expect(ctx.host.location.hash).toBe("#/game");

    ctx.player.closeScreen(); // ferme le menu système
    await until(() => ctx.player.currentState === "waiting-click", "reprise");
    expect(ctx.host.location.hash).toBe("#/game");
  });

  it("en partie : précédent depuis #/backlog reprend la partie", async () => {
    const ctx = await setup();
    await startGame(ctx);
    ctx.player.openScreen("backlog");
    expect(ctx.host.location.hash).toBe("#/backlog");
    ctx.host.go(-1);
    await until(() => ctx.player.currentState === "waiting-click", "reprise");
    expect(lastScreen(ctx.ui)).toBe("game");
  });

  describe("historique vide (HUD-12, #201)", () => {
    const silent = [
      { position: { scriptName: "t.ks", page: 0, instruction: 0 }, events: [], stop: { kind: "click", style: "line" } },
    ] as Step[];

    it("openScreen : toast, aucune entrée d'historique du navigateur, URL sur la partie", async () => {
      const ctx = await setup("", silent);
      await startGame(ctx);
      const before = [...ctx.host.hashes];
      ctx.player.openScreen("backlog");
      expect(ctx.ui.toasts.at(-1)?.message).toBe("L'historique n'existe pas encore.");
      expect(ctx.host.hashes).toEqual(before);
      expect(ctx.host.location.hash).toBe("#/game");
      expect(ctx.player.currentState).toBe("waiting-click");
    });

    it("lien #/backlog en partie : toast et l'URL revient à la partie", async () => {
      const ctx = await setup("", silent);
      await startGame(ctx);
      ctx.host.typeHash("#/backlog");
      await until(() => ctx.ui.toasts.length === 1, "toast");
      await wait(5);
      expect(lastScreen(ctx.ui)).not.toBe("backlog");
      expect(ctx.host.location.hash).toBe("#/game");
      expect(ctx.player.currentState).toBe("waiting-click");
    });

    it("avec du texte lu, #/backlog ouvre l'écran", async () => {
      const ctx = await setup();
      await startGame(ctx);
      ctx.host.typeHash("#/backlog");
      await until(() => lastScreen(ctx.ui) === "backlog", "backlog");
      expect(ctx.ui.toasts).toHaveLength(0);
    });
  });

  it("en partie : un lien #/config remplace l'écran ouvert au lieu d'empiler", async () => {
    const ctx = await setup();
    await startGame(ctx);
    ctx.player.openScreen("backlog");
    ctx.host.typeHash("#/config");
    await until(() => lastScreen(ctx.ui) === "settings", "settings");
    expect(ctx.player.currentState).toBe("paused");
    ctx.player.closeScreen();
    await until(() => ctx.player.currentState === "waiting-click", "reprise");
  });

  it("en partie : #/title demande confirmation ; refusée, l'URL revient à la partie", async () => {
    const ctx = await setup();
    await startGame(ctx);
    ctx.ui.answer = false;
    ctx.host.typeHash("#/title");
    await until(() => ctx.ui.confirms.length === 1, "confirm");
    await wait(5);
    expect(ctx.player.currentState).toBe("waiting-click");
    expect(ctx.host.location.hash).toBe("#/game");
  });

  it("en partie : #/title confirmé retourne au titre", async () => {
    const ctx = await setup();
    await startGame(ctx);
    ctx.host.typeHash("#/title");
    await until(() => ctx.player.currentState === "title", "title");
    expect(ctx.host.location.hash).toBe("#/title");
  });

  it("l'URL ne contient ni script ni progression", async () => {
    const ctx = await setup();
    await startGame(ctx);
    ctx.player.openScreen("settings");
    for (const e of ctx.host.entries) expect(e.hash).toMatch(/^#\/(title|game|config)$/);
  });
});
