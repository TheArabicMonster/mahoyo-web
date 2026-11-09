/**
 * Équivalence normal / skip / auto (#295).
 *
 * Une même séquence de `Step` jouée dans les trois modes doit produire :
 * - la même **séquence d'événements appliqués** au renderer (aucun saut de contenu) ;
 * - le même **état final** (fin de script → titre), sans blocage ;
 * - le respect des attentes non interruptibles, notamment `@wb` (`waitFor: "bgmFade"`,
 *   `skippable: false`) même en mode skip.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Player, type PlayerDeps, type RuntimeLike } from "@/ui/player.js";
import { createMemorySaveStore } from "@/player/save-store.js";
import { createMemorySettingsStore } from "@/player/settings-store.js";
import { FakeAudioPlayer } from "../mocks/fake-audio-player.js";
import { FakeScreenTransitions } from "../mocks/fake-screen-transitions.js";
import { FakeUIManager } from "../mocks/fake-ui-manager.js";
import { RecordingStageRenderer } from "../renderer/recording-stage-renderer.js";
import { DEFAULT_DISPLAY_SETTINGS } from "@/renderer/types.js";
import type { RunOptions } from "@/renderer/types.js";
import type { RenderEvent, Step } from "@/kag/events.js";
import type { RuntimeSaveData } from "@/kag/runtime.js";
import type { ParsedScript } from "@/kag/types.js";

type Mode = "normal" | "skip" | "auto";

/** Renderer de test qui journalise les événements appliqués (comme le fixture du player). */
class TestStage extends RecordingStageRenderer {
  applyCalls: { events: readonly RenderEvent[]; opts: RunOptions }[] = [];
  async apply(events: readonly RenderEvent[], opts: RunOptions): Promise<void> {
    this.applyCalls.push({ events, opts });
    return super.apply(events, opts);
  }
}

class ScriptedRuntime implements RuntimeLike {
  scriptLoader: RuntimeLike["scriptLoader"] = null;
  index = 0;
  constructor(private readonly steps: Step[]) {}
  step(): Step {
    const step = this.steps[Math.min(this.index, this.steps.length - 1)]!;
    if (this.index < this.steps.length - 1) this.index++;
    return step;
  }
  async loadScript(): Promise<boolean> {
    return false;
  }
  jump(): boolean {
    return false;
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

const position = (page: number) => ({ scriptName: "t.ks", page, instruction: 0 });

const STEPS: Step[] = [
  { position: position(0), events: [{ kind: "text", segments: [{ text: "a" }] }], stop: { kind: "click", style: "line" } },
  { position: position(1), events: [{ kind: "text", segments: [{ text: "b" }] }], stop: { kind: "click", style: "page" } },
  {
    position: position(2),
    events: [
      { kind: "textbox", state: { visible: true, frame: true, action: "swing" }, time: 0 },
      { kind: "text", segments: [{ text: "c" }] },
    ],
    stop: { kind: "wait", time: 5, skippable: true },
  },
  // @wb : fin de fondu BGM non skippable (audio mock : résout immédiatement).
  { position: position(3), events: [], stop: { kind: "waitFor", what: "bgmFade", skippable: false } },
  { position: position(4), events: [{ kind: "text", segments: [{ text: "d" }] }], stop: { kind: "click", style: "line" } },
  { position: position(5), events: [], stop: { kind: "end" } },
];

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await wait(5);
  }
  throw new Error(`timeout: ${label}`);
}

let current: Player | null = null;
afterEach(async () => {
  await current?.dispose();
  current = null;
});

function setup(steps: Step[] = STEPS) {
  const stage = new TestStage();
  const audio = new FakeAudioPlayer();
  const ui = new FakeUIManager();
  const player = new Player({
    root: document.body,
    createStageRenderer: () => stage,
    createAudioPlayer: () => audio,
    createUIManager: () => ui,
    createRuntime: () => new ScriptedRuntime(steps),
    loadScript: async () => ({ pages: [], labels: {} }) as unknown as ParsedScript,
    saveStore: createMemorySaveStore(),
    settingsStore: createMemorySettingsStore(),
    skipDelay: 1,
    transitions: new FakeScreenTransitions(),
  } satisfies Partial<PlayerDeps>);
  return { player, stage, audio, ui };
}

/** Joue la séquence dans le mode demandé et retourne les événements appliqués + l'état final. */
async function playThrough(mode: Mode): Promise<{ events: RenderEvent[]; finalState: string }> {
  const ctx = setup();
  current = ctx.player;
  await ctx.player.ready;
  // Skip/auto doivent progresser rapidement quelle que soit la lecture (contenu non lu).
  ctx.player.updateSettings({
    skipUnread: true,
    display: { ...DEFAULT_DISPLAY_SETTINGS, autoPageDelay: 5, autoLineDelay: 5 },
  });
  ctx.player.startScript("t.ks");
  await until(() => ctx.player.currentState !== "title" && ctx.player.currentState !== "loading", "début de lecture");
  ctx.player.setMode(mode);
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline && ctx.player.currentState !== "title") {
    if (mode === "normal" && (ctx.player.currentState === "waiting-click" || ctx.player.currentState === "waiting-wait")) {
      ctx.player.advance();
    }
    await wait(5);
  }
  expect(ctx.player.currentState, `mode ${mode} : le script doit se terminer`).toBe("title");
  const events = ctx.stage.applyCalls.flatMap((call) => [...call.events]);
  return { events, finalState: ctx.player.currentState };
}

const normalize = (events: RenderEvent[]): unknown => JSON.parse(JSON.stringify(events));

describe("Équivalence normal / skip / auto (#295)", () => {
  it("normal, skip et auto appliquent la même séquence d'événements et finissent à l'identique", async () => {
    const normal = await playThrough("normal");
    const skip = await playThrough("skip");
    const auto = await playThrough("auto");
    expect(normalize(skip.events)).toEqual(normalize(normal.events));
    expect(normalize(auto.events)).toEqual(normalize(normal.events));
    expect(skip.finalState).toBe("title");
    expect(auto.finalState).toBe("title");
    // Le contenu de la 4e étape (après @wb) est bien appliqué dans tous les modes.
    for (const run of [normal, skip, auto]) {
      expect(normalize(run.events)).toContainEqual(expect.objectContaining({ kind: "text" }));
    }
  });

  it("skip ne contourne pas une attente @wb non skippable", async () => {
    const ctx = setup();
    current = ctx.player;
    let releaseFade!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseFade = resolve;
    });
    // @wb bloqué tant que le fondu BGM n'est pas terminé, même en mode skip.
    ctx.audio.waitForFade = () => pending;
    await ctx.player.ready;
    ctx.player.updateSettings({ skipUnread: true });
    ctx.player.startScript("t.ks");
    await until(() => ctx.player.currentState !== "title" && ctx.player.currentState !== "loading", "début");
    ctx.player.setMode("skip");
    await until(() => ctx.player.currentState === "waiting-wait", "attente @wb en skip");
    await wait(50);
    // Toujours bloqué : le skip n'a pas sauté l'attente non interruptible.
    expect(ctx.player.currentState).toBe("waiting-wait");
    releaseFade();
    await until(() => ctx.player.currentState === "title", "@wb libéré puis fin");
  });
});
