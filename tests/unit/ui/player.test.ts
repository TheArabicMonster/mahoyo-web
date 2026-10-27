import { describe, it, expect, afterEach } from "vitest";
import { Player, type PlayerDeps, type RuntimeLike } from "@/ui/player.js";
import { createMemorySaveStore } from "@/player/save-store.js";
import { createMemorySettingsStore } from "@/player/settings-store.js";
import { FakeAudioPlayer } from "../mocks/fake-audio-player.js";
import { FakeUIManager } from "../mocks/fake-ui-manager.js";
import { RecordingStageRenderer } from "../renderer/recording-stage-renderer.js";
import type { RunOptions } from "@/renderer/types.js";
import type { RenderEvent, Step } from "@/kag/events.js";
import type { RuntimeSaveData } from "@/kag/runtime.js";
import type { ParsedScript } from "@/kag/types.js";
import prologue from "../../fixtures/prologue.json";
import audioFixture from "../../fixtures/audio.json";

/** Runtime qui rejoue des Steps et sait se repositionner (save/load/rollback). */
class ScriptedRuntime implements RuntimeLike {
  scriptLoader: RuntimeLike["scriptLoader"] = null;
  jumps: string[] = [];
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
  async loadScript(_storage: string, _label?: string, _pushCallStack?: boolean): Promise<boolean> {
    return true;
  }
  jump(label: string): boolean {
    this.jumps.push(label);
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
      },
      callStack: [],
    };
  }
  async loadSaveData(data: RuntimeSaveData): Promise<boolean> {
    this.index = data.pc;
    return true;
  }
}

class TestStage extends RecordingStageRenderer {
  hurries = 0;
  restores = 0;
  applyCalls: { events: readonly RenderEvent[]; opts: RunOptions }[] = [];
  active = 0;
  maxActive = 0;
  gate: Promise<void> | null = null;
  indicators: (string | null)[] = [];
  async apply(events: readonly RenderEvent[], opts: RunOptions): Promise<void> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.applyCalls.push({ events, opts });
    await super.apply(events, opts);
    if (this.gate) await this.gate;
    this.active--;
  }
  hurry(): void {
    this.hurries++;
  }
  setClickIndicator(style?: "line" | "page" | null): void {
    this.indicators.push(style ?? null);
  }
  async restore(...args: Parameters<RecordingStageRenderer["restore"]>): Promise<void> {
    this.restores++;
    return super.restore(...args);
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

function setup(steps: Step[] = prologue as Step[], extra: Partial<PlayerDeps> = {}) {
  const stage = new TestStage();
  const audio = new FakeAudioPlayer();
  const ui = new FakeUIManager();
  const saveStore = createMemorySaveStore();
  const runtimes: ScriptedRuntime[] = [];
  const player = new Player({
    root: document.body,
    createStageRenderer: () => stage,
    createAudioPlayer: () => audio,
    createUIManager: () => ui,
    createRuntime: () => {
      const rt = new ScriptedRuntime(steps);
      runtimes.push(rt);
      return rt;
    },
    loadScript: async () => ({ pages: [], labels: {} }) as unknown as ParsedScript,
    saveStore,
    settingsStore: createMemorySettingsStore(),
    skipDelay: 1,
    ...extra,
  });
  return { player, stage, audio, ui, saveStore, runtimes };
}

let current: Player | null = null;
afterEach(async () => {
  await current?.dispose();
  current = null;
});

async function start(ctx: ReturnType<typeof setup>) {
  current = ctx.player;
  await ctx.player.ready;
  ctx.player.startScript("t.ks");
  await until(() => ctx.player.currentState === "waiting-click", "waiting-click");
}

describe("Player", () => {
  it("construit les composants, injecte les commandes et affiche le titre", async () => {
    const ctx = setup();
    current = ctx.player;
    await ctx.player.ready;
    expect(ctx.ui.commands).not.toBeNull();
    expect(ctx.ui.views.at(-1)).toMatchObject({ screen: "title", hasContinue: false });
    expect(ctx.audio.settings).not.toBeNull();
  });

  it("rejoue la fixture prologue de bout en bout puis revient au titre", async () => {
    const ctx = setup();
    await start(ctx);
    expect(ctx.stage.events.some((e) => e.kind === "text")).toBe(true);
    expect(ctx.stage.indicators).toContain("line");

    ctx.player.advance();
    await until(() => ctx.stage.indicators.includes("page"));
    ctx.player.advance();
    await until(() => ctx.player.currentState === "title");
    expect(ctx.ui.views.at(-1)).toMatchObject({ screen: "title" });
    expect(ctx.stage.maxActive).toBe(1);
  });

  it("route l'audio vers l'AudioPlayer et le visuel vers le StageRenderer", async () => {
    const ctx = setup(audioFixture as Step[]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait");
    expect(ctx.audio.events.length).toBeGreaterThan(0);
    expect(ctx.stage.events.every((e) => e.kind !== "audio")).toBe(true);
  });

  it("appelle audio.unlock() de façon synchrone dans advance et startScript", async () => {
    const ctx = setup();
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    expect(ctx.audio.unlocked).toBe(true);
    await until(() => ctx.player.currentState === "waiting-click");

    ctx.audio.unlocked = false;
    ctx.player.advance();
    expect(ctx.audio.unlocked).toBe(true);
  });

  it("appelle audio.unlock() de façon synchrone dans load", async () => {
    const ctx = setup();
    current = ctx.player;
    await ctx.player.ready;
    const promise = ctx.player.load(1);
    expect(ctx.audio.unlocked).toBe(true);
    await promise;
    expect(ctx.ui.toasts.at(-1)?.message).toContain("vide");
  });

  it("un clic pendant l'affichage du texte appelle hurry()", async () => {
    const ctx = setup();
    current = ctx.player;
    let release!: () => void;
    ctx.stage.gate = new Promise((r) => (release = r));
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.stage.applyCalls.length > 0);
    ctx.player.advance();
    expect(ctx.stage.hurries).toBe(1);
    release();
    await until(() => ctx.player.currentState === "waiting-click");
  });

  it("save puis load restaurent la scène et la position", async () => {
    const ctx = setup();
    await start(ctx);
    ctx.player.advance();
    await until(() => ctx.stage.indicators.includes("page"));
    await ctx.player.save(1);
    const record = ctx.saveStore.records.get("1");
    expect(record?.scriptFile).toBe("t.ks");
    expect(record?.stop).toMatchObject({ kind: "click", style: "page" });

    ctx.player.advance();
    await until(() => ctx.player.currentState === "title");

    await ctx.player.load(1);
    expect(ctx.stage.restores).toBe(1);
    await until(() => ctx.player.currentState === "waiting-click");
    expect(ctx.ui.views.some((v) => v.screen === "game")).toBe(true);

    ctx.player.advance();
    await until(() => ctx.player.currentState === "title");
  });

  it("restaure l'audio en boucle avec reduceAudio au load", async () => {
    const loopStep: Step = {
      position: { scriptName: "t.ks", page: 0, instruction: 0 },
      events: [{ kind: "audio", event: { kind: "play", channel: "bgm", storage: "theme", loop: true, volume: 0.7 } }],
      stop: { kind: "click", style: "page" },
    };
    const ctx = setup([loopStep]);
    await start(ctx);
    await ctx.player.save("quick");
    expect(ctx.saveStore.records.get("quick")?.audio.loops).toEqual([{ channel: "bgm", storage: "theme", volume: 0.7 }]);
    await ctx.player.load("quick");
    expect(ctx.audio.events).toEqual([{ kind: "play", channel: "bgm", storage: "theme", loop: true, volume: 0.7 }]);
  });

  it("deleteSave demande confirmation puis supprime", async () => {
    const ctx = setup();
    await start(ctx);
    await ctx.player.save(2);
    expect(ctx.saveStore.records.has("2")).toBe(true);
    await ctx.player.deleteSave(2);
    expect(ctx.ui.confirms).toHaveLength(1);
    expect(ctx.saveStore.records.has("2")).toBe(false);
  });

  it("autosave à chaque clic et hasContinue au retour au titre", async () => {
    const ctx = setup();
    await start(ctx);
    await until(() => ctx.saveStore.records.has("auto"), "autosave");
    await ctx.player.returnToTitle();
    expect(ctx.ui.views.at(-1)).toMatchObject({ screen: "title", hasContinue: true });
  });

  it("rollback revient au point de clic précédent", async () => {
    const ctx = setup();
    await start(ctx);
    expect(ctx.ui.statuses.at(-1)?.canRollback).toBe(false);
    ctx.player.advance();
    await until(() => ctx.stage.indicators.includes("page"));
    await until(() => ctx.ui.statuses.at(-1)?.canRollback === true, "canRollback");

    await ctx.player.rollback();
    await until(() => ctx.player.currentState === "waiting-click");
    expect(ctx.stage.restores).toBe(1);
    expect(ctx.ui.statuses.at(-1)?.canRollback).toBe(false);
    // Le runtime reprend juste après le premier point de clic.
    ctx.player.advance();
    await until(() => ctx.stage.indicators.filter((i) => i === "page").length === 2);
  });

  it("mode skip : instant, pas d'attente sur les clics, retour titre à la fin", async () => {
    const ctx = setup();
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-click");
    ctx.player.advance();
    await until(() => ctx.player.currentState === "waiting-click");
    ctx.player.advance();
    await until(() => ctx.player.currentState === "title");

    // Deuxième lecture : tout est déjà lu, le skip enchaîne seul.
    ctx.stage.applyCalls = [];
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-click");
    ctx.player.setMode("skip");
    await until(() => ctx.player.currentState === "title");
    expect(ctx.stage.applyCalls.slice(1).every((c) => c.opts.instant)).toBe(true);
  });

  it("skip s'arrête sur le texte non lu quand skipUnread est false", async () => {
    const ctx = setup();
    await start(ctx);
    ctx.player.setMode("skip");
    await until(() => ctx.player.currentMode === "normal");
    expect(ctx.ui.toasts.some((t) => t.message.includes("non lu"))).toBe(true);
    expect(ctx.player.currentState).toBe("waiting-click");
  });

  it("mode auto : avance après autoDelay", async () => {
    const ctx = setup();
    await start(ctx);
    ctx.player.updateSettings({ display: { textSpeed: 30, autoDelay: 15, fontScale: 1, textboxOpacity: 1 } });
    ctx.player.setMode("auto");
    await until(() => ctx.player.currentState === "title", "auto fin");
  });

  it("choose saute au label choisi", async () => {
    const choice: Step = {
      position: { scriptName: "t.ks", page: 0, instruction: 0 },
      events: [],
      stop: { kind: "choice", options: [{ label: "A", target: "*a" }, { label: "B", target: "*b" }] },
    };
    const ctx = setup([choice]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-choice");
    expect(ctx.ui.choices.at(-1)).toEqual(["A", "B"]);
    ctx.player.choose(1);
    await until(() => ctx.runtimes[0].jumps.length === 1);
    expect(ctx.runtimes[0].jumps).toEqual(["*b"]);
    expect(ctx.ui.choices.at(-1)).toEqual([]);
  });

  it("wait skippable : un clic interrompt l'attente", async () => {
    const wait1: Step = {
      position: { scriptName: "t.ks", page: 0, instruction: 0 },
      events: [],
      stop: { kind: "wait", time: 60_000, skippable: true },
    };
    const ctx = setup([wait1]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait");
    ctx.player.advance();
    await until(() => ctx.player.currentState === "title");
  });

  it("pause : openScreen suspend l'avancement, closeScreen reprend", async () => {
    const ctx = setup();
    await start(ctx);
    ctx.player.openScreen("pause");
    expect(ctx.player.currentState).toBe("paused");
    ctx.player.advance();
    expect(ctx.player.currentState).toBe("paused");
    ctx.player.openScreen("settings");
    expect(ctx.ui.views.at(-1)).toMatchObject({ screen: "settings" });
    ctx.player.closeScreen();
    expect(ctx.ui.views.at(-1)).toMatchObject({ screen: "pause" });
    ctx.player.closeScreen();
    expect(ctx.player.currentState).toBe("waiting-click");
    expect(ctx.ui.views.at(-1)).toMatchObject({ screen: "game" });
  });

  it("toggleUserHide masque, et le clic suivant réaffiche sans avancer", async () => {
    const ctx = setup();
    await start(ctx);
    ctx.player.toggleUserHide();
    expect(ctx.ui.statuses.at(-1)?.userHidden).toBe(true);
    ctx.player.advance();
    expect(ctx.ui.statuses.at(-1)?.userHidden).toBe(false);
    expect(ctx.player.currentState).toBe("waiting-click");
  });

  it("updateSettings fusionne, persiste et propage aux renderers", async () => {
    const ctx = setup();
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.updateSettings({ audio: { master: 0.5, bgm: 1, se: 1, voice: 1, muted: true } });
    expect(ctx.audio.settings?.muted).toBe(true);
  });

  it("visibilitychange suspend puis reprend l'audio", async () => {
    const ctx = setup();
    current = ctx.player;
    await ctx.player.ready;
    const set = (v: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    set("hidden");
    expect(ctx.audio.suspended).toBe(true);
    set("visible");
    expect(ctx.audio.suspended).toBe(false);
  });

  it("load annule la lecture en cours sans appels concurrents à apply()", async () => {
    const ctx = setup();
    await start(ctx);
    await ctx.player.save(3);
    ctx.player.advance();
    await ctx.player.load(3);
    await until(() => ctx.player.currentState === "waiting-click");
    expect(ctx.stage.maxActive).toBe(1);
  });
});
