import { describe, it, expect, afterEach } from "vitest";
import { Player, type PlayerDeps, type RuntimeLike } from "@/ui/player.js";
import { createMemorySaveStore, type SaveRecord } from "@/player/save-store.js";
import { createMemorySettingsStore } from "@/player/settings-store.js";
import { FakeAudioPlayer } from "../mocks/fake-audio-player.js";
import { FakeUIManager } from "../mocks/fake-ui-manager.js";
import { RecordingStageRenderer } from "../renderer/recording-stage-renderer.js";
import { DEFAULT_AUDIO_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "@/renderer/types.js";
import type { RunOptions } from "@/renderer/types.js";
import { defaultShortcuts } from "@/core/shortcuts.js";
import type { RenderEvent, Step } from "@/kag/events.js";
import type { RuntimeSaveData } from "@/kag/runtime.js";
import type { ParsedScript } from "@/kag/types.js";
import type { StoryChain } from "@/core/story-chain.js";
import type { LanguageIndex } from "@/core/language.js";
import { getUiLanguage, setUiLanguage, translate } from "@/ui/i18n.js";
import prologue from "../../fixtures/prologue.json";
import audioFixture from "../../fixtures/audio.json";

const display = (o: Partial<typeof DEFAULT_DISPLAY_SETTINGS> = {}) => ({ ...DEFAULT_DISPLAY_SETTINGS, ...o });
const audio = (o: Partial<typeof DEFAULT_AUDIO_SETTINGS> = {}) => ({ ...DEFAULT_AUDIO_SETTINGS, ...o });

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

class TestStage extends RecordingStageRenderer {
  hurries = 0;
  restores = 0;
  applyCalls: { events: readonly RenderEvent[]; opts: RunOptions }[] = [];
  active = 0;
  maxActive = 0;
  gate: Promise<void> | null = null;
  indicators: (string | null)[] = [];
  /** Historique de l'indicateur d'attente non interruptible. */
  waitIndicator: boolean[] = [];
  nudges = 0;
  setWaitIndicator(active: boolean): void {
    this.waitIndicator.push(active);
  }
  nudgeWaitIndicator(): void {
    this.nudges++;
  }
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
  setUiLanguage("fr");
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

  it("save enregistre le titre de scène dérivé du sommaire local, sans commentaire ni verrou", async () => {
    const ctx = setup(prologue as Step[], {
      scripts: [{ id: "t", label: "Libellé local", file: "t.ks", arc: "Test", x: 0, y: 0 }],
    });
    await start(ctx);
    await ctx.player.save(1);
    expect(ctx.saveStore.records.get("1")).toMatchObject({ sceneTitle: "Libellé local", comment: "", locked: false });
  });

  it("save retombe sur le nom du fichier si le script est absent du sommaire", async () => {
    const ctx = setup(prologue as Step[], { scripts: [] });
    await start(ctx);
    await ctx.player.save(1);
    expect(ctx.saveStore.records.get("1")?.sceneTitle).toBe("t.ks");
  });

  it("save refuse d'écraser un emplacement verrouillé, sans confirmation", async () => {
    const ctx = setup();
    await start(ctx);
    await ctx.player.save(1);
    const before = ctx.saveStore.records.get("1")!;
    await ctx.saveStore.update(1, { locked: true });
    ctx.ui.toasts = [];

    ctx.player.advance();
    await until(() => ctx.player.currentState === "waiting-click" || ctx.player.currentState === "title");
    await ctx.player.save(1);
    expect(ctx.ui.confirms).toHaveLength(0);
    expect(ctx.ui.toasts.at(-1)?.message).toContain("verrouillé");
    expect(ctx.saveStore.records.get("1")).toEqual({ ...before, locked: true });
  });

  it("save peut de nouveau écraser après déverrouillage", async () => {
    const ctx = setup();
    await start(ctx);
    await ctx.player.save(1);
    await ctx.saveStore.update(1, { locked: true });
    await ctx.saveStore.update(1, { locked: false });
    await ctx.player.save(1);
    expect(ctx.ui.toasts.at(-1)?.message).toBe("Sauvegardé.");
  });

  it("deleteSave refuse de supprimer un emplacement verrouillé, sans confirmation", async () => {
    const ctx = setup();
    await start(ctx);
    await ctx.player.save(2);
    await ctx.saveStore.update(2, { locked: true });
    await ctx.player.deleteSave(2);
    expect(ctx.ui.confirms).toHaveLength(0);
    expect(ctx.ui.toasts.at(-1)?.message).toContain("verrouillé");
    expect(ctx.saveStore.records.has("2")).toBe(true);
  });

  it("une ancienne sauvegarde sans titre ni verrou se charge dans le player", async () => {
    const ctx = setup();
    await start(ctx);
    await ctx.player.save(1);
    const old = ctx.saveStore.records.get("1")! as Partial<SaveRecord>;
    delete old.sceneTitle;
    delete old.comment;
    delete old.locked;
    await ctx.player.load(1);
    await until(() => ctx.player.currentState === "waiting-click", "chargement");
    expect(ctx.stage.restores).toBe(1);
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
    ctx.player.updateSettings({ display: display({ textSpeedUnread: 30, textSpeedRead: 30, autoPageDelay: 15, autoLineDelay: 15, fontScale: 1, textboxOpacity: 1 }) });
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
    ctx.player.updateSettings({ audio: audio({ master: 0.5, bgm: 1, se: 1, voice: 1, muted: true }) });
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

describe("Player — attente non interruptible (@wait canskip=0)", () => {
  const at = (page: number) => ({ scriptName: "t.ks", page, instruction: 0 });
  const lockedWait = (ms: number): Step => ({ position: at(0), events: [], stop: { kind: "wait", time: ms, skippable: false } });
  const click = (): Step => ({
    position: at(1),
    events: [{ kind: "text", segments: [{ text: "page suivante" }] }],
    stop: { kind: "click", style: "page" },
  });

  it("des clics répétés ne relancent pas le minuteur de l'attente", async () => {
    const ctx = setup([lockedWait(80), click()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "attente");

    // Un joueur impatient clique sans arrêt : l'attente doit quand même se terminer
    // à son échéance, puis la page suivante est atteinte.
    const spam = setInterval(() => ctx.player.advance(), 10);
    try {
      await until(() => ctx.player.currentState === "waiting-click" || ctx.player.currentState === "title", "fin de l'attente");
    } finally {
      clearInterval(spam);
    }
    expect(ctx.stage.events.some((e) => e.kind === "text")).toBe(true);
  });

  it("un clic pendant l'attente ne fait pas sauter la page de texte suivante", async () => {
    const ctx = setup([lockedWait(60), click()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "attente");

    ctx.player.advance();
    ctx.player.advance();
    await until(() => ctx.player.currentState === "waiting-click", "page suivante");
    // Le clic fait pendant l'attente ne doit pas valoir pour cette page.
    await wait(120);
    expect(ctx.player.currentState).toBe("waiting-click");
  });

  it("un clic pendant une attente d'animation non interruptible ne saute pas la page suivante", async () => {
    // @wact canskip=0 : le player attend la fin des animations. Les clics faits pendant
    // l'attente ne doivent pas être mémorisés pour la page de texte qui suit.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    class GateStage extends TestStage {
      async waitFor(): Promise<void> {
        await gate;
      }
    }
    const stage = new GateStage();
    const waitAnim: Step = { position: at(0), events: [], stop: { kind: "waitFor", what: "animation", skippable: false } };
    const ctx = setup([waitAnim, click()], { createStageRenderer: () => stage });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "attente d'animation");

    ctx.player.advance();
    ctx.player.advance();
    ctx.player.advance();
    release();
    await until(() => ctx.player.currentState === "waiting-click", "page suivante");
    await wait(120);
    expect(ctx.player.currentState).toBe("waiting-click");
  });

  it("le skip continue après une attente non interruptible au lieu de s'arrêter", async () => {
    const text = (page: number): Step => ({
      position: at(page),
      events: [{ kind: "text", segments: [{ text: `page ${page}` }] }],
      stop: { kind: "click", style: "page" },
    });
    const ctx = setup([text(0), lockedWait(40), text(2), text(3)]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.updateSettings({ skipUnread: true });
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-click", "première page");
    ctx.player.advance();
    await until(() => ctx.player.currentState === "waiting-wait", "attente");

    ctx.player.setMode("skip");
    // Si l'attente coupait le skip, la page suivante attendrait un clic au lieu de défiler.
    await until(() => ctx.player.currentState === "title", "fin du script en skip");
    expect(ctx.ui.toasts.some((t) => t.message.includes("skip interrompu"))).toBe(false);
  });

  it("affiche un indicateur pendant l'attente et le retire à la fin (#134)", async () => {
    const ctx = setup([lockedWait(50), click()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "attente");
    expect(ctx.stage.waitIndicator.at(-1)).toBe(true);

    await until(() => ctx.player.currentState === "waiting-click", "page suivante");
    expect(ctx.stage.waitIndicator.at(-1)).toBe(false);
  });

  it("un clic ignoré par l'attente fait réagir l'indicateur, sans avancer (#134)", async () => {
    const ctx = setup([lockedWait(80), click()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "attente");

    ctx.player.advance();
    ctx.player.advance();
    ctx.player.advance();
    expect(ctx.stage.nudges).toBe(3);
    expect(ctx.player.currentState).toBe("waiting-wait");
  });

  it("l'indicateur couvre aussi une attente d'animation non interruptible (#134)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    class GateStage extends TestStage {
      async waitFor(): Promise<void> {
        await gate;
      }
    }
    const stage = new GateStage();
    const waitAnim: Step = { position: at(0), events: [], stop: { kind: "waitFor", what: "animation", skippable: false } };
    const ctx = setup([waitAnim, click()], { createStageRenderer: () => stage });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "attente d'animation");
    expect(stage.waitIndicator.at(-1)).toBe(true);
    ctx.player.advance();
    expect(stage.nudges).toBe(1);

    release();
    await until(() => ctx.player.currentState === "waiting-click", "page suivante");
    expect(stage.waitIndicator.at(-1)).toBe(false);
  });

  it("une attente interruptible n'affiche pas l'indicateur et un clic la coupe", async () => {
    const ctx = setup([{ position: at(0), events: [], stop: { kind: "wait", time: 5000, skippable: true } }, click()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "attente");
    expect(ctx.stage.waitIndicator.includes(true)).toBe(false);
    ctx.player.advance();
    await until(() => ctx.player.currentState === "waiting-click", "page suivante");
    expect(ctx.stage.nudges).toBe(0);
  });

  it("un clic reste pris en compte une fois l'attente terminée", async () => {
    const ctx = setup([lockedWait(40), click()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-click", "page suivante");
    ctx.player.advance();
    await until(() => ctx.player.currentState === "title", "fin du script");
  });
});


/** Runtime qui joue un petit script par fichier : un clic puis la fin. */
class ChainRuntime implements RuntimeLike {
  scriptLoader: RuntimeLike["scriptLoader"] = null;
  loaded: string[] = [];
  conditions: string[] = [];
  private queue: Step[];
  /** Script courant et nombre de pas déjà consommés (pour la sauvegarde et le rollback). */
  private current: string;
  private taken = 0;
  constructor(first: string, private readonly failOn: string | null = null, private readonly condResult = false) {
    this.current = first;
    this.queue = ChainRuntime.script(first);
  }
  static script(name: string): Step[] {
    return [
      { position: { scriptName: name, page: 0, instruction: 0 }, events: [{ kind: "text", segments: [{ text: name }] }], stop: { kind: "click", style: "page" } },
      { position: { scriptName: name, page: 1, instruction: 0 }, events: [], stop: { kind: "end" } },
    ];
  }
  step(): Step {
    this.taken++;
    return this.queue.shift() ?? { position: { scriptName: "x.ks", page: 9, instruction: 0 }, events: [], stop: { kind: "end" } };
  }
  async loadScript(storage: string): Promise<boolean> {
    if (storage === this.failOn) return false;
    this.loaded.push(storage);
    this.current = storage;
    this.taken = 0;
    this.queue = ChainRuntime.script(storage);
    return true;
  }
  evaluateCondition(expression: string): boolean {
    this.conditions.push(expression);
    return this.condResult;
  }
  jump(): boolean {
    return true;
  }
  getSaveData(): RuntimeSaveData {
    return { ...new ScriptedRuntime([]).getSaveData(), scriptName: this.current, pc: this.taken };
  }
  async loadSaveData(data: RuntimeSaveData): Promise<boolean> {
    this.current = data.scriptName;
    this.taken = data.pc;
    this.queue = ChainRuntime.script(data.scriptName).slice(data.pc);
    return true;
  }
}

function chainSetup(chain: StoryChain | null, makeRuntime: () => ChainRuntime) {
  const runtimes: ChainRuntime[] = [];
  const ctx = setup([], {
    loadChain: async () => chain,
    createRuntime: () => {
      const rt = makeRuntime();
      runtimes.push(rt);
      return rt;
    },
  });
  return { ...ctx, chainRuntimes: runtimes };
}

async function startChain(ctx: ReturnType<typeof chainSetup>, file = "a.ks") {
  current = ctx.player;
  await ctx.player.ready;
  ctx.player.startScript(file);
  await until(() => ctx.player.currentState === "waiting-click", "premier clic");
}

describe("Player — enchaînement des scripts", () => {
  it("charge le script suivant à la fin du courant, sur deux chapitres consécutifs", async () => {
    const chain: StoryChain = { version: 1, first: "a.ks", next: { "a.ks": [{ to: "b.ks" }], "b.ks": [] } };
    const ctx = chainSetup(chain, () => new ChainRuntime("a.ks"));
    await startChain(ctx);

    ctx.player.advance();
    await until(() => ctx.chainRuntimes[0]!.loaded.length === 1 && ctx.player.currentState === "waiting-click", "b.ks");
    expect(ctx.chainRuntimes[0]!.loaded).toEqual(["b.ks"]);
    expect(ctx.stage.events.filter((e) => e.kind === "text")).toHaveLength(2);

    // Fin de b.ks : plus de suite, retour au titre.
    ctx.player.advance();
    await until(() => ctx.player.currentState === "title", "titre");
  });

  it("joue l'interlude puis le chapitre suivant (then)", async () => {
    const chain: StoryChain = { version: 1, first: "a.ks", next: { "a.ks": [{ to: "tea.ks", then: ["b.ks"] }] } };
    const ctx = chainSetup(chain, () => new ChainRuntime("a.ks"));
    await startChain(ctx);

    ctx.player.advance(); // fin de a.ks → tea.ks
    await until(() => ctx.chainRuntimes[0]!.loaded.length === 1 && ctx.player.currentState === "waiting-click");
    ctx.player.advance(); // fin de tea.ks → b.ks (file d'interlude, pas la table)
    await until(() => ctx.chainRuntimes[0]!.loaded.length === 2 && ctx.player.currentState === "waiting-click");
    expect(ctx.chainRuntimes[0]!.loaded).toEqual(["tea.ks", "b.ks"]);
  });

  it("propose un menu quand la suite est un choix, puis charge l'option retenue", async () => {
    const chain: StoryChain = {
      version: 1,
      first: "a.ks",
      next: { "a.ks": [{ to: "b.ks", choice: "Option B" }, { to: "c.ks", choice: "Option C" }] },
    };
    const ctx = chainSetup(chain, () => new ChainRuntime("a.ks"));
    await startChain(ctx);

    ctx.player.advance();
    await until(() => ctx.player.currentState === "waiting-choice", "menu");
    expect(ctx.ui.choices.at(-1)).toEqual(["Option B", "Option C"]);

    ctx.player.choose(1);
    await until(() => ctx.chainRuntimes[0]!.loaded.length === 1 && ctx.player.currentState === "waiting-click");
    expect(ctx.chainRuntimes[0]!.loaded).toEqual(["c.ks"]);
  });

  it("évalue la condition d'une route avec le runtime", async () => {
    const chain: StoryChain = {
      version: 1,
      first: "a.ks",
      next: { "a.ks": [{ to: "x.ks", condition: "room>0" }, { to: "y.ks" }] },
    };
    const ctx = chainSetup(chain, () => new ChainRuntime("a.ks", null, true));
    await startChain(ctx);
    ctx.player.advance();
    await until(() => ctx.chainRuntimes[0]!.loaded.length === 1 && ctx.player.currentState === "waiting-click");
    expect(ctx.chainRuntimes[0]!.conditions).toEqual(["room>0"]);
    expect(ctx.chainRuntimes[0]!.loaded).toEqual(["x.ks"]);
  });

  it("sans table d'enchaînement, revient au titre comme avant", async () => {
    const ctx = chainSetup(null, () => new ChainRuntime("a.ks"));
    await startChain(ctx);
    ctx.player.advance();
    await until(() => ctx.player.currentState === "title", "titre");
    expect(ctx.chainRuntimes[0]!.loaded).toEqual([]);
  });

  it("signale un script suivant introuvable et revient au titre", async () => {
    const chain: StoryChain = { version: 1, first: "a.ks", next: { "a.ks": [{ to: "absent.ks" }] } };
    const ctx = chainSetup(chain, () => new ChainRuntime("a.ks", "absent.ks"));
    await startChain(ctx);
    ctx.player.advance();
    await until(() => ctx.player.currentState === "title", "titre");
    expect(ctx.ui.toasts.some((t) => t.message.includes("absent.ks"))).toBe(true);
  });

  describe("file d'interlude (then) : retour arrière et sauvegarde", () => {
    const teaChain: StoryChain = { version: 1, first: "a.ks", next: { "a.ks": [{ to: "tea.ks", then: ["b.ks"] }] } };
    const allLoaded = (ctx: ReturnType<typeof chainSetup>) => ctx.chainRuntimes.flatMap((r) => r.loaded);

    it("un retour arrière avant l'interlude le rejoue au lieu de sauter au chapitre suivant", async () => {
      const ctx = chainSetup(teaChain, () => new ChainRuntime("a.ks"));
      await startChain(ctx);
      ctx.player.advance(); // a.ks terminé → tea.ks (file : b.ks)
      await until(() => allLoaded(ctx).length === 1 && ctx.player.currentState === "waiting-click", "tea.ks");

      await ctx.player.rollback(); // retour au dernier clic de a.ks
      await until(() => ctx.player.currentState === "waiting-click", "retour sur a.ks");
      ctx.player.advance();
      await until(() => allLoaded(ctx).length === 2 && ctx.player.currentState === "waiting-click", "tea.ks rejoué");

      expect(allLoaded(ctx)).toEqual(["tea.ks", "tea.ks"]);
    });

    it("un retour arrière depuis le chapitre suivant retrouve l'interlude puis le chapitre", async () => {
      const ctx = chainSetup(teaChain, () => new ChainRuntime("a.ks"));
      await startChain(ctx);
      ctx.player.advance(); // → tea.ks
      await until(() => allLoaded(ctx).length === 1 && ctx.player.currentState === "waiting-click");
      ctx.player.advance(); // tea.ks terminé → b.ks (file vidée)
      await until(() => allLoaded(ctx).length === 2 && ctx.player.currentState === "waiting-click", "b.ks");

      await ctx.player.rollback(); // retour au clic de tea.ks : la file doit contenir b.ks
      await until(() => ctx.player.currentState === "waiting-click", "retour sur tea.ks");
      ctx.player.advance();
      await until(() => allLoaded(ctx).includes("b.ks") && allLoaded(ctx).length === 3 && ctx.player.currentState === "waiting-click", "b.ks rejoué");

      expect(ctx.player.currentState).not.toBe("title");
      expect(allLoaded(ctx)).toEqual(["tea.ks", "b.ks", "b.ks"]);
    });

    it("une sauvegarde faite pendant l'interlude garde la suite prévue", async () => {
      const ctx = chainSetup(teaChain, () => new ChainRuntime("a.ks"));
      await startChain(ctx);
      ctx.player.advance();
      await until(() => allLoaded(ctx).length === 1 && ctx.player.currentState === "waiting-click", "tea.ks");
      await ctx.player.save(1);
      expect((await ctx.saveStore.get(1))?.chainQueue).toEqual(["b.ks"]);

      await ctx.player.load(1);
      await until(() => ctx.player.currentState === "waiting-click", "chargement");
      ctx.player.advance(); // tea.ks terminé → doit enchaîner b.ks, pas revenir au titre
      await until(() => allLoaded(ctx).includes("b.ks") && ctx.player.currentState === "waiting-click", "b.ks après chargement");
      expect(allLoaded(ctx)).toEqual(["tea.ks", "b.ks"]);
    });

    it("une sauvegarde antérieure sans file se charge sans erreur", async () => {
      const ctx = chainSetup(teaChain, () => new ChainRuntime("a.ks"));
      await startChain(ctx);
      await ctx.player.save(2);
      const rec = await ctx.saveStore.get(2);
      delete (rec as { chainQueue?: string[] }).chainQueue;
      await ctx.saveStore.put(2, rec!);
      await ctx.player.load(2);
      await until(() => ctx.player.currentState === "waiting-click", "chargement");
    });
  });
});

describe("Player — séquence minutée (@playtimeline)", () => {
  const pos = (page: number) => ({ scriptName: "t.ks", page, instruction: 0 });
  const scene = (bg: string): RenderEvent => ({
    kind: "scene",
    scene: { bg, sprites: [], effect: null },
    transition: { method: "none" },
  });
  const audio = (storage: string): RenderEvent => ({
    kind: "audio",
    event: { kind: "play", channel: "bgm", storage, loop: false, volume: 1 },
  });
  const timeline = (schedule: { at: number; events: RenderEvent[] }[], duration: number): Step => ({
    position: pos(0),
    events: [],
    stop: { kind: "timeline", schedule, duration },
  });
  const after = (): Step => ({
    position: pos(1),
    events: [{ kind: "text", segments: [{ text: "après" }] }],
    stop: { kind: "click", style: "page" },
  });
  const plays = (ctx: ReturnType<typeof setup>) => ctx.audio.events.filter((e) => e.kind === "play");
  const bgs = (ctx: ReturnType<typeof setup>) =>
    ctx.stage.applyCalls.flatMap((c) => c.events).filter((e) => e.kind === "scene").map((e) => (e as Extract<RenderEvent, { kind: "scene" }>).scene.bg);

  it("applique chaque entrée à son instant puis rend la main à la fin", async () => {
    const ctx = setup([timeline([{ at: 20, events: [scene("a")] }, { at: 90, events: [audio("m01"), scene("b")] }], 160), after()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "séquence");

    await until(() => bgs(ctx).includes("a"), "première entrée");
    expect(bgs(ctx)).not.toContain("b");
    expect(plays(ctx)).toHaveLength(0);

    await until(() => bgs(ctx).includes("b"), "seconde entrée");
    expect(plays(ctx)).toHaveLength(1);
    expect(ctx.player.currentState).toBe("waiting-wait");

    await until(() => ctx.player.currentState === "waiting-click", "fin de la séquence");
    expect(ctx.stage.applyCalls.every((c) => c.opts.instant === false || c.events.some((e) => e.kind === "text"))).toBe(true);
  });

  it("un clic saute la séquence et applique d'un coup les entrées restantes", async () => {
    const ctx = setup([
      timeline([{ at: 10, events: [scene("a")] }, { at: 5000, events: [audio("m01")] }, { at: 6000, events: [scene("z")] }], 8000),
      after(),
    ]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => bgs(ctx).includes("a"), "première entrée");

    ctx.player.advance();
    await until(() => ctx.player.currentState === "waiting-click", "séquence sautée");
    expect(bgs(ctx)).toContain("z");
    expect(plays(ctx)).toHaveLength(1);
    // Les entrées sautées sont appliquées sans transition.
    const skipped = ctx.stage.applyCalls.filter((c) => c.events.some((e) => e.kind === "scene" && e.scene.bg === "z"));
    expect(skipped.every((c) => c.opts.instant)).toBe(true);
  });

  it("n'applique jamais deux fois la même entrée, même avec des clics répétés", async () => {
    const ctx = setup([timeline([{ at: 10, events: [scene("a")] }, { at: 3000, events: [scene("b")] }], 5000), after()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => bgs(ctx).includes("a"), "première entrée");
    ctx.player.advance();
    ctx.player.advance();
    ctx.player.advance();
    await until(() => ctx.player.currentState === "waiting-click", "séquence sautée");
    await wait(60);
    expect(bgs(ctx).filter((b) => b === "a")).toHaveLength(1);
    expect(bgs(ctx).filter((b) => b === "b")).toHaveLength(1);
  });

  it("passer en mode skip pendant la séquence la saute", async () => {
    const ctx = setup([timeline([{ at: 4000, events: [scene("fin")] }], 6000), after()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "séquence");
    ctx.player.setMode("skip");
    await until(() => bgs(ctx).includes("fin"), "entrée appliquée par le skip");
    await until(() => ctx.player.currentState === "waiting-click" || ctx.player.currentState === "title", "suite");
  });

  it("une séquence vide dure sa durée puis rend la main", async () => {
    const ctx = setup([timeline([], 60), after()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "séquence");
    await until(() => ctx.player.currentState === "waiting-click", "fin");
  });

  it("fermer le player pendant la séquence n'applique plus rien", async () => {
    const ctx = setup([timeline([{ at: 80, events: [scene("tard")] }], 200), after()]);
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-wait", "séquence");
    await ctx.player.dispose();
    current = null;
    await wait(150);
    expect(bgs(ctx)).not.toContain("tard");
  });
});

function makeIndex(language: string, scripts: string[]): LanguageIndex {
  return {
    version: 1,
    language,
    label: language,
    credits: "",
    scripts,
    strict: scripts,
    skipped: [],
    extraAssets: {},
  };
}

describe("Player — langues", () => {
  it("charge le script traduit quand la langue fr est disponible", async () => {
    const calls: { file: string; language?: string }[] = [];
    const index = makeIndex("fr", ["t.ks"]);
    const ctx = setup([], {
      loadLanguages: async () => new Map([["fr", index]]),
      loadScript: async (file, language) => {
        calls.push({ file, language });
        return { pages: [], labels: {} } as unknown as ParsedScript;
      },
    });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.updateSettings({ language: "fr" });
    ctx.player.startScript("t.ks");
    await until(() => calls.some((c) => c.file === "t.ks" && c.language === "fr"), "load fr");
    expect(calls.some((c) => c.file === "t.ks" && c.language === "fr")).toBe(true);
  });

  it("retombe sur le script japonais si le fichier n'est pas dans l'index fr", async () => {
    const calls: { file: string; language?: string }[] = [];
    const index = makeIndex("fr", ["other.ks"]);
    const ctx = setup([], {
      loadLanguages: async () => new Map([["fr", index]]),
      loadScript: async (file, language) => {
        calls.push({ file, language });
        return { pages: [], labels: {} } as unknown as ParsedScript;
      },
    });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.updateSettings({ language: "fr" });
    ctx.player.startScript("t.ks");
    await until(() => calls.some((c) => c.file === "t.ks" && c.language === undefined), "load ja");
    expect(calls.some((c) => c.file === "t.ks" && c.language === undefined)).toBe(true);
    expect(calls.some((c) => c.file === "t.ks" && c.language === "fr")).toBe(false);
  });

  it("retombe sur ja si la langue sauvegardée n'est pas disponible", async () => {
    const calls: { file: string; language?: string }[] = [];
    const store = createMemorySettingsStore();
    await store.saveSettings({
      display: display({ textSpeedUnread: 30, autoPageDelay: 1500 }),
      audio: audio({ bgm: 0.8, se: 0.8 }),
      skipUnread: false,
      language: "fr",
      shortcuts: defaultShortcuts(),
      flowchartRevealAll: false,
    });
    const ctx = setup([], {
      settingsStore: store,
      loadLanguages: async () => new Map(),
      loadScript: async (file, language) => {
        calls.push({ file, language });
        return { pages: [], labels: {} } as unknown as ParsedScript;
      },
    });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => calls.some((c) => c.file === "t.ks" && c.language === undefined), "load ja");
    expect(calls.some((c) => c.file === "t.ks" && c.language === undefined)).toBe(true);
    expect(calls.some((c) => c.file === "t.ks" && c.language === "fr")).toBe(false);
  });

  it("affiche un toast au changement de langue en pleine partie", async () => {
    const ctx = setup(prologue as Step[], {
      loadLanguages: async () => new Map([["fr", makeIndex("fr", ["t.ks"])]]),
    });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-click", "waiting-click");
    ctx.player.updateSettings({ language: "ja" });
    // Le toast est déjà dans la nouvelle langue de l'interface (#184).
    expect(ctx.ui.toasts.some((t) => t.message === translate("ja", "toast.languageNextChapter"))).toBe(true);
    expect(getUiLanguage()).toBe("ja");
  });

  it("la langue de l'interface suit le réglage chargé, même sans traduction installée", async () => {
    const store = createMemorySettingsStore();
    await store.saveSettings({ ...(await store.loadSettings()), language: "en" });
    const ctx = setup([], { settingsStore: store });
    current = ctx.player;
    await ctx.player.ready;
    expect(getUiLanguage()).toBe("en");
    // Un réglage sans langue ne ramène pas l'interface au japonais de repli du texte.
    ctx.player.updateSettings({ skipUnread: true });
    expect(getUiLanguage()).toBe("en");
  });

  it("casse les scripts par langue", async () => {
    const calls: { file: string; language?: string }[] = [];
    const ctx = setup([], {
      loadLanguages: async () => new Map([["fr", makeIndex("fr", ["t.ks"])]]),
      loadScript: async (file, language) => {
        calls.push({ file, language });
        return { pages: [], labels: {} } as unknown as ParsedScript;
      },
    });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.updateSettings({ language: "fr" });
    ctx.player.startScript("t.ks");
    await until(() => calls.some((c) => c.file === "t.ks" && c.language === "fr"), "load fr");
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "title", "titre");
    expect(calls.filter((c) => c.file === "t.ks" && c.language === "fr")).toHaveLength(1);
  });
});

describe("Player — menu rapide verrouillé et auto suspendu", () => {
  const pos = (n: number) => ({ scriptName: "t.ks", page: 0, instruction: n });
  const click = (n: number, events: RenderEvent[] = []): Step => ({
    position: pos(n),
    events,
    stop: { kind: "click", style: "page" },
  });

  it("verrouille sauvegarde et chargement tant que le script ne déverrouille pas", async () => {
    const ctx = setup([
      click(0, [{ kind: "quickMenu", locked: true }]),
      click(1, [{ kind: "quickMenu", locked: false }]),
    ]);
    await start(ctx);
    expect(ctx.ui.statuses.at(-1)?.quickMenuLocked).toBe(true);

    await ctx.player.save(1);
    expect(ctx.saveStore.records.has("1")).toBe(false);
    expect(ctx.ui.toasts.at(-1)?.message).toContain("indisponibles");

    const viewsBefore = ctx.ui.views.length;
    ctx.player.openScreen("save");
    ctx.player.openScreen("load");
    expect(ctx.ui.views.length).toBe(viewsBefore);

    // La pause (réglages, retour au titre) reste accessible.
    ctx.player.openScreen("pause");
    await until(() => ctx.ui.views.at(-1)?.screen === "pause", "pause");
    ctx.player.closeScreen();
    await until(() => ctx.player.currentState === "waiting-click", "reprise");

    ctx.player.advance();
    await until(() => ctx.ui.statuses.at(-1)?.quickMenuLocked === false, "déverrouillé");
    await ctx.player.save(1);
    expect(ctx.saveStore.records.has("1")).toBe(true);
  });

  it("refuse aussi le chargement d'une sauvegarde pendant le verrou", async () => {
    const ctx = setup([click(0), click(1, [{ kind: "quickMenu", locked: true }])]);
    await start(ctx);
    await ctx.player.save("quick");
    ctx.player.advance();
    await until(() => ctx.ui.statuses.at(-1)?.quickMenuLocked === true, "verrouillé");
    const restores = ctx.stage.restores;
    await ctx.player.load("quick");
    expect(ctx.stage.restores).toBe(restores);
  });

  it("le verrou est levé au retour au titre, où le chargement reste possible", async () => {
    const ctx = setup([click(0, [{ kind: "quickMenu", locked: true }])]);
    await start(ctx);
    await ctx.player.returnToTitle();
    expect(ctx.ui.statuses.at(-1)?.quickMenuLocked).toBe(false);
    ctx.player.openScreen("load");
    await until(() => ctx.ui.views.at(-1)?.screen === "load", "écran de chargement");
  });

  it("suspend l'auto sans changer le mode choisi, puis le reprend", async () => {
    const ctx = setup([
      click(0, [{ kind: "autoMode", paused: true }]),
      click(1, [{ kind: "autoMode", paused: false }]),
    ]);
    await start(ctx);
    ctx.player.updateSettings({ display: display({ textSpeedUnread: 30, textSpeedRead: 30, autoPageDelay: 10, autoLineDelay: 10, fontScale: 1, textboxOpacity: 1 }) });
    ctx.player.setMode("auto");
    expect(ctx.ui.statuses.at(-1)).toMatchObject({ mode: "auto", autoPaused: true });

    // Suspendu : aucun enchaînement automatique, le mode reste « auto ».
    await wait(80);
    expect(ctx.player.currentState).toBe("waiting-click");
    expect(ctx.player.currentMode).toBe("auto");

    // Un clic avance ; la reprise relance l'auto, qui mène à la fin.
    ctx.player.advance();
    await until(() => ctx.player.currentState === "title", "auto repris");
  });
});

describe("Player — vitesses et avance rapide (#177)", () => {
  const at = (page: number) => ({ scriptName: "t.ks", page, instruction: 0 });
  const page = (n: number, text: string): Step => ({
    position: at(n),
    events: [{ kind: "text", segments: [{ text }] }],
    stop: { kind: "click", style: "page" },
  });
  const readKey = (n: number) => `t.ks:${n}:0:`;

  it("utilise la vitesse déjà lue, puis celle des pages non lues", async () => {
    const store = createMemorySettingsStore();
    await store.saveRead(new Set([readKey(1)]));
    const ctx = setup([page(1, "Premier"), page(2, "Second")], { settingsStore: store });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-click", "première page");
    expect(ctx.stage.lastOptions?.textSpeed).toBe(DEFAULT_DISPLAY_SETTINGS.textSpeedRead);

    ctx.player.advance();
    await until(
      () =>
        ctx.player.currentState === "waiting-click" &&
        ctx.stage.events.some(
          (e) => e.kind === "text" && e.segments.some((s) => "text" in s && s.text === "Second"),
        ),
      "seconde page",
    );
    expect(ctx.stage.lastOptions?.textSpeed).toBe(DEFAULT_DISPLAY_SETTINGS.textSpeedUnread);
  });

  it("force la page entière quand instantReadPage est actif", async () => {
    const store = createMemorySettingsStore();
    await store.saveRead(new Set([readKey(1)]));
    const ctx = setup([page(1, "Premier")], { settingsStore: store });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.updateSettings({ display: display({ instantReadPage: true }) });
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState === "waiting-click", "page instantanée");
    expect(ctx.stage.lastOptions?.textSpeed).toBe(0);
  });

  it("saute automatiquement une page déjà lue après confirmation", async () => {
    const store = createMemorySettingsStore();
    await store.saveRead(new Set([readKey(1)]));
    const ctx = setup([page(1, "Premier"), page(2, "Second")], { settingsStore: store });
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.updateSettings({ display: display({ autoSkipRead: true, autoSkipConfirm: true }) });
    ctx.player.startScript("t.ks");
    // La page lue est sautée ; le skip s'arrête sur la page non lue avec un message.
    await until(() => ctx.ui.toasts.some((t) => t.message.includes("non lu")), "skip interrompu");
    expect(ctx.ui.confirms.some((m) => m.includes("scènes déjà lues"))).toBe(true);
    expect(ctx.stage.events.some((e) => e.kind === "text" && e.segments.some((s) => "text" in s && s.text === "Second"))).toBe(true);
    expect(ctx.player.currentState).toBe("waiting-click");
  });

  it("avance rapide selon la portée et ne consomme pas une page non lue en mode « déjà lus »", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ctx = setup([page(1, "Premier")]);
    ctx.stage.gate = gate;
    current = ctx.player;
    await ctx.player.ready;
    ctx.player.startScript("t.ks");
    await until(() => ctx.stage.active > 0, "frappe en cours");

    const before = ctx.stage.hurries;
    expect(ctx.player.hurryText()).toBe(false);
    ctx.player.updateSettings({ display: display({ fastForwardScope: "all" }) });
    expect(ctx.player.hurryText()).toBe(true);
    expect(ctx.stage.hurries).toBe(before + 1);
    release();
    await until(() => ctx.player.currentState === "waiting-click", "fin de page");
  });
});

