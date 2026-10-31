import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime, type RuntimeSaveData } from "@/kag/runtime.js";
import { applyStageSnapshot, reduceAudio } from "@/kag/stage-state.js";
import { WebAudioPlayer } from "@/renderer/audio-manager.js";
import { createAssetResolver, type AssetResolver } from "@/core/asset-resolver.js";
import { hasTranslation, parseLanguageIndex, type LanguageIndex } from "@/core/language.js";
import { parseStoryChain, resolveNext, type StoryChain } from "@/core/story-chain.js";
import { parseTimelineData, type TimelineData } from "@/core/timeline.js";
import { createLocalSaveStore, type SaveRecord, type SaveStore } from "@/player/save-store.js";
import {
  DEFAULT_SETTINGS,
  createLocalSettingsStore,
  mergeSettings,
  toScriptProgress,
  type SettingsStore,
} from "@/player/settings-store.js";
import type {
  AudioChannel,
  AudioSnapshot,
  Position,
  RenderEvent,
  StageSnapshot,
  Step,
  StopReason,
} from "@/kag/events.js";
import type { ParsedScript } from "@/kag/types.js";
import type {
  AudioPlayer,
  AudioPlayerFactory,
  StageRenderer,
  StageRendererFactory,
} from "@/renderer/types.js";
import type {
  BacklogEntry,
  GameLanguage,
  GameSettings,
  OverlayScreen,
  PlayMode,
  PlayerCommands,
  SaveSlot,
  ScriptSummary,
  SlotId,
  UIManager,
} from "./types.js";

/** Sous-ensemble de `Runtime` utilisé par le player (permet de le simuler en test). */
export interface RuntimeLike {
  scriptLoader: ((storage: string) => Promise<ParsedScript | null>) | null;
  step(): Step;
  loadScript(storage: string, label?: string, pushCallStack?: boolean): Promise<boolean>;
  jump(label: string): boolean;
  getSaveData(): RuntimeSaveData;
  loadSaveData(data: RuntimeSaveData, scripts: Map<string, ParsedScript>): Promise<boolean>;
  /** Évalue une condition de la table d'enchaînement (absent : routes conditionnelles ignorées). */
  evaluateCondition?(expression: string): boolean;
  /** Timelines d'animation pour @playtimeline (absentes : la commande est sans effet). */
  timelines?: TimelineData | null;
}

export type PlayerState =
  | "title"
  | "loading"
  | "playing"
  | "waiting-click"
  | "waiting-choice"
  | "waiting-wait"
  | "paused";

export type PlayerDeps = {
  root: HTMLElement;
  resolver: AssetResolver;
  createStageRenderer: StageRendererFactory;
  createAudioPlayer: AudioPlayerFactory;
  createUIManager: () => UIManager;
  createRuntime: (script: ParsedScript, scriptName: string) => RuntimeLike;
  /** Charge et parse un script ; null si introuvable. */
  loadScript: (file: string, language?: string) => Promise<ParsedScript | null>;
  /** Charge la table d'enchaînement des scripts ; null si absente (pas d'enchaînement). */
  loadChain: () => Promise<StoryChain | null>;
  /** Charge les timelines d'animation ; null si absentes (@playtimeline sans effet). */
  loadTimelines: () => Promise<TimelineData | null>;
  /** Charge les index des langues traduites disponibles. */
  loadLanguages: () => Promise<Map<string, LanguageIndex>>;
  scripts: readonly ScriptSummary[];
  saveStore: SaveStore;
  settingsStore: SettingsStore;
  now: () => number;
  /** Cadence du mode skip entre deux points d'arrêt (ms). */
  skipDelay: number;
};

const DEFAULT_SCRIPTS: ScriptSummary[] = [
  { id: "1-0", label: "Prologue", file: "1-0.ks", x: 512, y: 80, arc: "Prologue" },
  { id: "1-1", label: "Chapitre 1 — Partie 1", file: "1-1.ks", x: 512, y: 180, arc: "Chapitre 1" },
  { id: "1-2", label: "Chapitre 1 — Partie 2", file: "1-2.ks", x: 512, y: 260, arc: "Chapitre 1" },
];

const NUMBERED_SLOTS = 12;
const HISTORY_LIMIT = 100;
const THUMBNAIL_WIDTH = 320;

/** Point de clic/choix : de quoi réafficher l'écran et reprendre le runtime. */
type HistoryEntry = {
  position: Position;
  stop: StopReason;
  runtime: RuntimeSaveData;
  stage: StageSnapshot;
  audio: AudioSnapshot;
  text: string;
  /** Scripts d'interlude encore à jouer (voir `chainQueue`) : à restaurer avec le point. */
  chainQueue: string[];
};

async function defaultLoadScript(resolver: AssetResolver, file: string, language?: string): Promise<ParsedScript | null> {
  try {
    const url = language ? resolver.translatedScenario(file, language) : resolver.scenario(file);
    const res = await fetch(url);
    if (!res.ok) return null;
    return parse(lex(await res.text()));
  } catch {
    return null;
  }
}

async function defaultLoadTimelines(resolver: AssetResolver): Promise<TimelineData | null> {
  try {
    const res = await fetch(resolver.timelines());
    if (!res.ok) return null;
    return parseTimelineData(await res.json());
  } catch {
    return null;
  }
}

async function defaultLoadChain(resolver: AssetResolver): Promise<StoryChain | null> {
  try {
    const res = await fetch(resolver.chain());
    if (!res.ok) return null;
    return parseStoryChain(await res.json());
  } catch {
    return null;
  }
}

async function defaultLoadLanguages(resolver: AssetResolver): Promise<Map<string, LanguageIndex>> {
  const indexes = new Map<string, LanguageIndex>();
  for (const language of ["fr", "en"]) {
    try {
      const res = await fetch(resolver.languageIndex(language));
      if (!res.ok) continue;
      const index = parseLanguageIndex(await res.json());
      if (index) indexes.set(language, index);
    } catch {
      // Langue indisponible : on ignore silencieusement.
    }
  }
  return indexes;
}

function toAudioChannel(target: string | undefined): AudioChannel {
  if (target === "bgm" || target === "voice") return target;
  const n = target?.match(/^(?:se:)?(\d+)$/)?.[1];
  return `se:${Number(n ?? 0)}`;
}

function previewOf(stage: StageSnapshot): string {
  return stage.text
    .map((s) => ("text" in s ? s.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function snapshotToEvents(snapshot: AudioSnapshot): RenderEvent[] {
  return snapshot.loops.map((l) => ({
    kind: "audio",
    event: { kind: "play", channel: l.channel, storage: l.storage, loop: true, volume: l.volume },
  }));
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function positionKey(p: Position): string {
  return `${p.scriptName}:${p.page}:${p.instruction}:${p.segment ?? ""}`;
}

/** Signal enfant : annulé avec le parent ou via son propre contrôleur (un par apply()). */
function childController(parent: AbortSignal): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", onAbort, { once: true });
  return { controller, dispose: () => parent.removeEventListener("abort", onAbort) };
}

/**
 * Orchestrateur : connecte Runtime, StageRenderer, AudioPlayer et UIManager.
 *
 * Boucle de lecture : `runtime.step()` → routage des events (visuels vers le
 * renderer, audio vers l'AudioPlayer) → gestion du point d'arrêt. Les appels
 * à `StageRenderer.apply()` sont séquentiels. Chaque session (nouvelle partie,
 * load, rollback, retour titre) possède un `AbortController` qui annule tout.
 */
export class Player implements PlayerCommands {
  /** Résolue quand les réglages sont chargés et le titre affiché. */
  readonly ready: Promise<void>;

  private readonly deps: PlayerDeps;
  private readonly stage: StageRenderer;
  private readonly audio: AudioPlayer;
  private readonly ui: UIManager;

  private settings: GameSettings;
  private readSet = new Set<string>();
  private completed: string[] = [];

  private state: PlayerState = "title";
  private mode: PlayMode = "normal";
  /** Menu rapide verrouillé par le script (@lockquickmenu). */
  private quickMenuLocked = false;
  /** Avance automatique suspendue par le script (@pauseautomode) ; `mode` n'est pas touché. */
  private autoPaused = false;
  private userHidden = false;
  private overlays: OverlayScreen[] = [];
  private stateBeforePause: PlayerState = "playing";

  private abort = new AbortController();
  private loop: Promise<void> = Promise.resolve();
  private runtime: RuntimeLike | null = null;
  private scriptFile = "";
  private scriptCache = new Map<string, ParsedScript>();
  private stageSnap: StageSnapshot = { scene: { bg: null, sprites: [], effect: null }, textbox: { visible: true, frame: true }, text: [], staffroll: null };
  private audioSnap: AudioSnapshot = { loops: [] };
  private history: HistoryEntry[] = [];

  /** Le renderer est en train d'afficher du texte (un clic doit appeler hurry). */
  private applying = false;
  /** Réveil d'une attente par `advance()` ; null si le clic est sans effet. */
  private onAdvance: (() => void) | null = null;
  /** Réévalue l'attente en cours après un changement de mode ou de pause. */
  private rearm: (() => void) | null = null;
  /** Clic reçu avant que `waitUser` n'ait installé `onAdvance` (course test/state). */
  private pendingAdvance = false;
  /**
   * Une attente non interruptible est en cours (`@wait canskip=0`, `@wt`/`@wact canskip=0`) :
   * les clics sont ignorés, comme dans le moteur d'origine. Sans cela un clic relançait
   * le minuteur de l'attente et faisait sauter la page de texte suivante.
   */
  private lockedWait = false;

  /** Pose ou lève l'attente non interruptible, avec son indicateur à l'écran. */
  private setLockedWait(locked: boolean): void {
    if (this.lockedWait === locked) return;
    this.lockedWait = locked;
    this.stage.setWaitIndicator(locked);
  }
  private pendingChoice: ((index: number) => void) | null = null;
  /** Table d'enchaînement des scripts (null si le pipeline ne l'a pas générée). */
  private chain: StoryChain | null = null;
  /** Timelines d'animation (null si le pipeline ne les a pas générées). */
  private timelines: TimelineData | null = null;
  /** Index des langues traduites disponibles. */
  private languageIndexes: Map<string, LanguageIndex> = new Map();
  /** Scripts à jouer à la suite avant de consulter à nouveau la table (interludes). */
  private chainQueue: string[] = [];
  /** Le point d'arrêt courant n'avait pas encore été lu (pour le skip). */
  private stopWasRead = true;

  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") {
      this.audio.suspend();
      void this.deps.settingsStore.saveRead(this.readSet).catch(() => {});
    } else {
      this.audio.resume();
    }
  };

  constructor(deps: Partial<PlayerDeps> = {}) {
    const resolver = deps.resolver ?? createAssetResolver();
    if (!deps.createStageRenderer) throw new Error("Player: createStageRenderer est requis");
    if (!deps.createUIManager) throw new Error("Player: createUIManager est requis");
    this.deps = {
      root: deps.root ?? document.getElementById("app") ?? document.body,
      resolver,
      createStageRenderer: deps.createStageRenderer,
      createAudioPlayer: deps.createAudioPlayer ?? ((d) => new WebAudioPlayer(d)),
      createUIManager: deps.createUIManager,
      createRuntime: deps.createRuntime ?? ((script, name) => new Runtime(script, name)),
      loadScript: deps.loadScript ?? ((file, language) => defaultLoadScript(resolver, file, language)),
      loadChain: deps.loadChain ?? (() => defaultLoadChain(resolver)),
      loadTimelines: deps.loadTimelines ?? (() => defaultLoadTimelines(resolver)),
      loadLanguages: deps.loadLanguages ?? (() => defaultLoadLanguages(resolver)),
      scripts: deps.scripts ?? DEFAULT_SCRIPTS,
      saveStore: deps.saveStore ?? createLocalSaveStore(),
      settingsStore: deps.settingsStore ?? createLocalSettingsStore(),
      now: deps.now ?? Date.now,
      skipDelay: deps.skipDelay ?? 25,
    };
    this.settings = DEFAULT_SETTINGS;

    this.stage = this.deps.createStageRenderer({ resolver });
    this.audio = this.deps.createAudioPlayer({ resolver });
    this.ui = this.deps.createUIManager();
    this.stage.mount(this.deps.root);
    this.ui.init(this.deps.root, this.bindCommands());
    document.addEventListener("visibilitychange", this.onVisibility);

    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const store = this.deps.settingsStore;
    this.settings = await store.loadSettings();
    this.readSet = await store.loadRead();
    this.completed = (await store.loadProgress()).completed;
    this.chain = await this.deps.loadChain().catch(() => null);
    this.timelines = await this.deps.loadTimelines().catch(() => null);
    this.languageIndexes = await this.deps.loadLanguages().catch(() => new Map());
    if (this.settings.language !== "ja" && !this.languageIndexes.has(this.settings.language)) {
      this.settings = { ...this.settings, language: "ja" };
    }
    this.applySettings();
    await this.showTitle();
  }

  private bindCommands(): PlayerCommands {
    return {
      advance: () => this.advance(),
      setMode: (m) => this.setMode(m),
      toggleUserHide: () => this.toggleUserHide(),
      rollback: () => this.rollback(),
      choose: (i) => this.choose(i),
      startScript: (f, l) => this.startScript(f, l),
      openScreen: (s) => this.openScreen(s),
      closeScreen: () => this.closeScreen(),
      returnToTitle: () => this.returnToTitle(),
      save: (s) => this.save(s),
      load: (s) => this.load(s),
      deleteSave: (s) => this.deleteSave(s),
      updateSettings: (p) => this.updateSettings(p),
      toggleFullscreen: () => this.toggleFullscreen(),
    };
  }

  // ── Accesseurs (tests, debug) ──

  get currentState(): PlayerState {
    return this.state;
  }

  get currentMode(): PlayMode {
    return this.mode;
  }

  /** Résolue quand la boucle de lecture est suspendue ou terminée. */
  get idle(): Promise<void> {
    return this.loop;
  }

  // ── Commandes : lecture ──

  advance(): void {
    // Synchrone, avant tout await : politique autoplay.
    void this.audio.unlock().catch(() => {});
    if (this.overlays.length > 0 || this.state === "title" || this.state === "loading") return;
    if (this.userHidden) {
      this.toggleUserHide();
      return;
    }
    if (this.mode === "skip") {
      this.setMode("normal");
      return;
    }
    if (this.applying) {
      this.stage.hurry();
      return;
    }
    if (this.onAdvance) {
      this.onAdvance();
      return;
    }
    if (this.lockedWait) {
      // Attente non interruptible : le clic est ignoré, mais pas en silence (#134).
      this.stage.nudgeWaitIndicator();
      return;
    }
    // Le clic est arrivé entre setState("waiting-*") et l'installation de onAdvance.
    if (this.state === "waiting-click" || this.state === "waiting-wait") {
      this.pendingAdvance = true;
      this.rearm?.();
    }
  }

  setMode(mode: PlayMode): void {
    if (this.state === "title" || this.state === "loading") return;
    this.mode = mode;
    if (mode === "skip" && this.applying) this.stage.hurry();
    this.pushStatus();
    this.rearm?.();
  }

  /** @lockquickmenu / @unlockquickmenu : appliqué par le script, pas par le joueur. */
  private setQuickMenuLocked(locked: boolean): void {
    if (this.quickMenuLocked === locked) return;
    this.quickMenuLocked = locked;
    this.pushStatus();
  }

  /**
   * @pauseautomode / @resumeautomode : suspend le déclenchement automatique sans toucher à
   * `mode` (le joueur garde « auto » et le retrouve à la reprise).
   */
  private setAutoPaused(paused: boolean): void {
    if (this.autoPaused === paused) return;
    this.autoPaused = paused;
    this.pushStatus();
    this.rearm?.();
  }

  /** Vrai (avec un message) si le script a verrouillé le menu rapide pendant la partie. */
  private quickMenuRefused(): boolean {
    if (!this.quickMenuLocked || this.state === "title") return false;
    this.ui.toast("Sauvegarde et chargement indisponibles pendant cette séquence.");
    return true;
  }

  toggleUserHide(): void {
    if (this.state === "title" || this.state === "loading") return;
    this.userHidden = !this.userHidden;
    this.stage.setUserHidden(this.userHidden);
    this.pushStatus();
  }

  choose(index: number): void {
    this.pendingChoice?.(index);
  }

  async rollback(): Promise<void> {
    if (!this.canRollback() || this.overlays.length > 0) return;
    if (this.state !== "waiting-click" && this.state !== "waiting-choice") return;
    this.history.pop();
    const previous = this.history[this.history.length - 1];
    await this.restoreEntry(previous);
  }

  private canRollback(): boolean {
    return this.history.length >= 2;
  }

  // ── Commandes : navigation ──

  startScript(file: string, label?: string): void {
    void this.audio.unlock().catch(() => {});
    void this.beginScript(file, label);
  }

  private async beginScript(file: string, label?: string): Promise<void> {
    if (this.state === "loading") return;
    await this.endSession();
    this.setState("loading");
    this.ui.setInputEnabled(false);
    try {
      const script = await this.getScript(file);
      if (!script) {
        this.ui.toast(`Script introuvable : ${file}`);
        await this.showTitle();
        return;
      }
      const runtime = this.makeRuntime(script, file);
      if (label && !runtime.jump(label)) console.warn(`label introuvable : ${label}`);
      this.runtime = runtime;
      this.scriptFile = file;
      this.chainQueue = [];
      this.quickMenuLocked = false;
      this.autoPaused = false;
      this.resetStageState();
      this.stage.clear();
      this.audio.stopAll();
      this.enterGame();
      this.startLoop();
    } finally {
      this.ui.setInputEnabled(true);
    }
  }

  openScreen(screen: OverlayScreen): void {
    if (this.state === "loading") return;
    const inGame = this.state !== "title";
    if (!inGame && (screen === "pause" || screen === "save" || screen === "backlog")) return;
    if ((screen === "save" || screen === "load") && this.quickMenuRefused()) return;
    if (inGame && this.overlays.length === 0) {
      this.stateBeforePause = this.state;
      this.setState("paused");
    }
    this.overlays.push(screen);
    void this.showOverlay(screen);
  }

  closeScreen(): void {
    if (this.overlays.length === 0) return;
    this.overlays.pop();
    const top = this.overlays[this.overlays.length - 1];
    if (top) {
      void this.showOverlay(top);
      return;
    }
    if (this.state === "title") {
      void this.showTitle();
      return;
    }
    this.setState(this.stateBeforePause);
    this.ui.show({ screen: "game" });
    this.rearm?.();
  }

  async returnToTitle(): Promise<void> {
    await this.endSession();
    this.runtime = null;
    this.history = [];
    this.mode = "normal";
    this.quickMenuLocked = false;
    this.autoPaused = false;
    this.userHidden = false;
    this.stage.setUserHidden(false);
    this.stage.clear();
    this.audio.stopAll();
    await this.deps.settingsStore.saveRead(this.readSet).catch(() => {});
    await this.showTitle();
  }

  // ── Commandes : sauvegardes ──

  async save(slot: SlotId): Promise<void> {
    if (this.quickMenuRefused()) return;
    const entry = this.history[this.history.length - 1];
    if (!entry || !this.runtime) {
      this.ui.toast("Impossible de sauvegarder à cet instant.");
      return;
    }
    const existing = await this.deps.saveStore.get(slot);
    if (existing && !(await this.ui.confirm("Écraser cette sauvegarde ?"))) return;
    const blob = await this.stage.captureThumbnail(THUMBNAIL_WIDTH).catch(() => null);
    const thumbnailUrl = blob ? await blobToDataUrl(blob) : null;
    try {
      await this.deps.saveStore.put(slot, this.toRecord(entry, thumbnailUrl));
    } catch (err) {
      console.error("save failed", err);
      this.ui.toast("Échec de la sauvegarde.");
      return;
    }
    this.ui.toast("Sauvegardé.");
    if (this.overlays[this.overlays.length - 1] === "save") await this.showOverlay("save");
  }

  async load(slot: SlotId): Promise<void> {
    // Synchrone, avant le premier await : politique autoplay.
    void this.audio.unlock().catch(() => {});
    if (this.state === "loading") return;
    if (this.quickMenuRefused()) return;
    const record = await this.deps.saveStore.get(slot);
    if (!record) {
      this.ui.toast("Sauvegarde vide.");
      return;
    }
    this.scriptFile = record.scriptFile;
    this.history = [
      {
        position: record.position,
        stop: record.stop,
        runtime: record.runtime,
        stage: record.stage,
        audio: record.audio,
        text: record.previewText,
        chainQueue: record.chainQueue ?? [],
      },
    ];
    if (await this.restoreEntry(this.history[0])) this.overlays = [];
  }

  async deleteSave(slot: SlotId): Promise<void> {
    if (!(await this.ui.confirm("Supprimer cette sauvegarde ?"))) return;
    await this.deps.saveStore.delete(slot);
    const top = this.overlays[this.overlays.length - 1];
    if (top === "save" || top === "load") await this.showOverlay(top);
    else if (this.state === "title") await this.showTitle();
  }

  // ── Commandes : système ──

  updateSettings(patch: Partial<GameSettings>): void {
    const previousLanguage = this.settings.language;
    this.settings = mergeSettings(this.settings, patch);
    if (this.settings.language !== "ja" && !this.languageIndexes.has(this.settings.language)) {
      this.settings = { ...this.settings, language: "ja" };
    }
    this.applySettings();
    void this.deps.settingsStore.saveSettings(this.settings).catch(() => {});
    if (this.overlays[this.overlays.length - 1] === "settings") void this.showOverlay("settings");
    if (patch.language && this.settings.language !== previousLanguage && this.state !== "title") {
      this.ui.toast("La langue s'appliquera au prochain chapitre.");
    }
  }

  toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  async dispose(): Promise<void> {
    document.removeEventListener("visibilitychange", this.onVisibility);
    await this.endSession();
    this.stage.dispose();
    this.audio.dispose();
    this.ui.dispose();
  }

  // ── Session et boucle de lecture ──

  /** Annule la session courante et attend la fin de la boucle avant de toucher aux renderers. */
  private async endSession(): Promise<void> {
    this.abort.abort();
    this.pendingChoice?.(-1);
    this.ui.hideChoices();
    this.stage.setClickIndicator(null);
    await this.loop;
    this.abort = new AbortController();
    this.onAdvance = null;
    this.rearm = null;
    this.applying = false;
    this.pendingAdvance = false;
  }

  private startLoop(pending?: { step: Step; record: boolean }): void {
    const signal = this.abort.signal;
    this.loop = this.runLoop(signal, pending).catch((err) => {
      console.error("player loop failed", err);
    });
  }

  private async runLoop(signal: AbortSignal, pending?: { step: Step; record: boolean }): Promise<void> {
    let next = pending;
    while (!signal.aborted && this.runtime) {
      const step = next?.step ?? this.runtime.step();
      const record = next?.record ?? true;
      next = undefined;

      const read = this.readSet.has(positionKey(step.position));
      this.stopWasRead = read || this.settings.skipUnread;
      const instant = this.mode === "skip" && this.stopWasRead;
      this.setState("playing");
      await this.applyStep(step, instant, signal);
      if (signal.aborted) return;
      if (!(await this.handleStop(step, record, signal))) return;
    }
  }

  private async applyStep(step: Step, instant: boolean, signal: AbortSignal): Promise<void> {
    const visual: RenderEvent[] = [];
    for (const event of step.events) {
      if (event.kind === "audio") this.audio.apply(event.event, { instant });
      else if (event.kind === "quickMenu") this.setQuickMenuLocked(event.locked);
      else if (event.kind === "autoMode") this.setAutoPaused(event.paused);
      else visual.push(event);
    }
    this.stageSnap = applyStageSnapshot(this.stageSnap, step.events);
    this.audioSnap = reduceAudio([...snapshotToEvents(this.audioSnap), ...step.events]);
    if (visual.length === 0) return;

    const { controller, dispose } = childController(signal);
    this.applying = true;
    try {
      await this.stage.apply(visual, { instant, signal: controller.signal });
    } finally {
      this.applying = false;
      dispose();
    }
  }

  /** Retourne false si la boucle doit s'arrêter. */
  private async handleStop(step: Step, record: boolean, signal: AbortSignal): Promise<boolean> {
    const { stop, position } = step;
    switch (stop.kind) {
      case "click": {
        const entry = record ? this.recordPoint(step) : null;
        const skippable = this.stopWasRead;
        this.readSet.add(positionKey(position));
        if (entry && this.mode !== "skip") void this.autosave(entry);
        this.stage.setClickIndicator(stop.style);
        this.setState("waiting-click");
        await this.waitUser(signal, {
          clickable: true,
          skipOk: skippable,
        });
        this.stage.setClickIndicator(null);
        return !signal.aborted;
      }
      case "wait": {
        this.setState("waiting-wait");
        await this.waitUser(signal, {
          clickable: stop.skippable,
          skipOk: stop.skippable,
          fixedMs: stop.time,
        });
        return !signal.aborted;
      }
      case "waitFor": {
        await this.waitForEffect(stop, signal);
        return !signal.aborted;
      }
      case "timeline": {
        this.setState("waiting-wait");
        await this.playTimeline(step, stop, signal);
        return !signal.aborted;
      }
      case "choice": {
        if (record) this.recordPoint(step);
        if (this.mode === "skip") this.setMode("normal");
        this.setState("waiting-choice");
        this.ui.showChoices(stop.options.map((o) => o.label));
        const index = await new Promise<number>((resolve) => {
          this.pendingChoice = resolve;
          signal.addEventListener("abort", () => resolve(-1), { once: true });
        });
        this.pendingChoice = null;
        this.ui.hideChoices();
        if (signal.aborted || index < 0) return false;
        const option = stop.options[index];
        if (option && !this.runtime?.jump(option.target)) console.warn(`label introuvable : ${option.target}`);
        return true;
      }
      case "loadScript": {
        this.setState("loading");
        const push = stop.pushCallStack !== false;
        const ok = await this.runtime!.loadScript(stop.file, stop.label, push);
        if (signal.aborted) return false;
        if (!ok) {
          this.ui.toast(`Script introuvable : ${stop.file}`);
          void this.returnToTitle();
          return false;
        }
        return true;
      }
      case "end": {
        this.markCompleted();
        if (await this.chainToNext(position.scriptName, signal)) return true;
        if (signal.aborted) return false;
        void this.returnToTitle();
        return false;
      }
    }
  }

  /**
   * Joue une séquence minutée (@playtimeline) : chaque entrée du calendrier est
   * appliquée à son instant, jusqu'à `duration`. Un clic (ou le mode skip) saute
   * toute la séquence : les entrées restantes sont appliquées d'un coup, sans
   * transition, pour que l'écran et le son rejoignent l'état final.
   */
  private playTimeline(step: Step, stop: Extract<StopReason, { kind: "timeline" }>, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let applied = 0;
      let ending = false;
      let finished = false;

      const apply = (index: number, instant: boolean): Promise<void> =>
        this.applyStep({ position: step.position, events: stop.schedule[index]!.events, stop: step.stop }, instant, signal);

      const finish = () => {
        if (finished) return;
        finished = true;
        for (const t of timers) clearTimeout(t);
        timers.clear();
        this.onAdvance = null;
        this.rearm = null;
        this.pendingAdvance = false;
        signal.removeEventListener("abort", finish);
        resolve();
      };

      /** Applique d'un coup ce qui reste, puis termine. */
      const skip = () => {
        if (ending || finished) return;
        ending = true;
        for (const t of timers) clearTimeout(t);
        timers.clear();
        void (async () => {
          for (let i = applied; i < stop.schedule.length && !signal.aborted; i++) {
            applied = i + 1;
            await apply(i, true);
          }
          finish();
        })();
      };

      this.onAdvance = skip;
      this.rearm = () => {
        if (this.mode === "skip") skip();
      };
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) return finish();
      if (this.mode === "skip") return skip();

      // Précharge les images des calques pour qu'ils n'apparaissent pas avec un temps de retard.
      const images = new Set<string>();
      for (const entry of stop.schedule) {
        for (const ev of entry.events) if (ev.kind === "timelineLayer") images.add(ev.layer.storage);
      }
      if (images.size > 0) void this.stage.preload([...images], signal).catch(() => {});

      stop.schedule.forEach((entry, index) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (ending || finished) return;
          applied = index + 1;
          void apply(index, false);
        }, entry.at);
        timers.add(timer);
      });
      const end = setTimeout(() => {
        timers.delete(end);
        skip();
      }, stop.duration);
      timers.add(end);
    });
  }

  /**
   * Enchaîne sur le script suivant quand le courant se termine : d'abord la file
   * d'interlude, puis la table d'enchaînement (menu si la suite est un choix).
   * Retourne false s'il n'y a pas de suite (fin de l'histoire) ou si le chargement échoue.
   */
  private async chainToNext(current: string, signal: AbortSignal): Promise<boolean> {
    let file: string | undefined = this.chainQueue.shift();

    if (file === undefined && this.chain) {
      const evalCondition = this.runtime?.evaluateCondition
        ? (expr: string) => this.runtime!.evaluateCondition!(expr)
        : undefined;
      const next = resolveNext(this.chain, current, evalCondition);
      if (next.kind === "script") {
        file = next.file;
        this.chainQueue = [...next.then];
      } else if (next.kind === "choice") {
        if (this.mode === "skip") this.setMode("normal");
        this.setState("waiting-choice");
        this.ui.showChoices(next.options.map((o) => o.label));
        const index = await new Promise<number>((resolve) => {
          this.pendingChoice = resolve;
          signal.addEventListener("abort", () => resolve(-1), { once: true });
        });
        this.pendingChoice = null;
        this.ui.hideChoices();
        const option = next.options[index];
        if (signal.aborted || !option) return false;
        file = option.file;
        this.chainQueue = [...option.then];
      }
    }
    if (file === undefined) return false;

    this.setState("loading");
    const ok = await this.runtime!.loadScript(file, undefined, false);
    if (signal.aborted) return false;
    if (!ok) {
      this.ui.toast(`Script introuvable : ${file}`);
      return false;
    }
    this.scriptFile = file;
    return true;
  }

  private async waitForEffect(stop: Extract<StopReason, { kind: "waitFor" }>, signal: AbortSignal): Promise<void> {
    const isAudio = stop.what === "audio";
    if (stop.skippable && this.mode === "skip" && this.stopWasRead) {
      if (!isAudio) this.stage.hurry();
      return;
    }
    this.setState("waiting-wait");
    const { controller, dispose } = childController(signal);
    const interrupt = () => {
      controller.abort();
      if (!isAudio) this.stage.hurry();
    };
    if (stop.skippable) {
      this.onAdvance = interrupt;
      this.rearm = () => {
        if (this.mode === "skip" && this.stopWasRead) interrupt();
      };
    } else {
      this.setLockedWait(true);
    }
    try {
      if (stop.what === "audio") await this.audio.waitFor(toAudioChannel(stop.target), controller.signal);
      else await this.stage.waitFor(stop.what, stop.target, controller.signal);
    } finally {
      dispose();
      this.onAdvance = null;
      this.rearm = null;
      this.setLockedWait(false);
    }
  }

  /**
   * Attend un clic, un délai ou une annulation.
   * - skip : enchaîne après `skipDelay` si le texte est lu ; sinon quitte le skip ;
   * - délai fixe (`@wait`) ;
   * - auto : enchaîne après `autoMs`.
   */
  private waitUser(
    signal: AbortSignal,
    opts: { clickable: boolean; skipOk: boolean; fixedMs?: number; autoMs?: number },
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        clearTimeout(timer);
        this.setLockedWait(false);
        this.onAdvance = null;
        this.rearm = null;
        this.pendingAdvance = false;
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const arm = () => {
        clearTimeout(timer);
        if (this.overlays.length > 0) return;
        if (this.mode === "skip") {
          if (opts.skipOk) {
            timer = setTimeout(finish, this.deps.skipDelay);
          } else if (!opts.clickable && opts.fixedMs !== undefined) {
            // Attente non interruptible (@wait canskip=0) : elle se déroule en entier,
            // puis le skip reprend. Elle ne doit pas le couper.
            timer = setTimeout(finish, opts.fixedMs);
          } else {
            this.ui.toast("Texte non lu : skip interrompu.");
            this.setMode("normal");
          }
          return;
        }
        if (opts.fixedMs !== undefined) timer = setTimeout(finish, opts.fixedMs);
        else if (this.mode === "auto" && !this.autoPaused) {
          timer = setTimeout(finish, this.settings.display.autoDelay);
        }
      };
      this.onAdvance = opts.clickable ? finish : null;
      this.setLockedWait(!opts.clickable);
      this.rearm = arm;
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
      else {
        arm();
        if (this.pendingAdvance && opts.clickable) {
          this.pendingAdvance = false;
          finish();
        }
      }
    });
  }

  // ── Historique, sauvegarde et restauration ──

  private recordPoint(step: Step): HistoryEntry {
    const entry: HistoryEntry = {
      position: step.position,
      stop: step.stop,
      runtime: this.runtime!.getSaveData(),
      stage: this.stageSnap,
      audio: this.audioSnap,
      text: previewOf(this.stageSnap),
      chainQueue: [...this.chainQueue],
    };
    this.history.push(entry);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.pushStatus();
    return entry;
  }

  private toRecord(entry: HistoryEntry, thumbnailUrl: string | null): SaveRecord {
    return {
      scriptFile: entry.runtime.scriptName,
      timestamp: this.deps.now(),
      previewText: entry.text,
      thumbnailUrl,
      stage: entry.stage,
      position: entry.position,
      runtime: entry.runtime,
      audio: entry.audio,
      stop: entry.stop,
      chainQueue: entry.chainQueue,
    };
  }

  private async autosave(entry: HistoryEntry): Promise<void> {
    try {
      await this.deps.saveStore.put("auto", this.toRecord(entry, null));
    } catch {
      // quota dépassé : l'autosave est facultatif
    }
  }

  /**
   * Remplace la session par l'état d'un point d'historique (load, rollback).
   * `this.history` doit déjà refléter l'état voulu.
   */
  private async restoreEntry(entry: HistoryEntry): Promise<boolean> {
    if (this.state === "loading") return false;
    void this.audio.unlock().catch(() => {});
    await this.endSession();
    const signal = this.abort.signal;
    this.setState("loading");
    this.ui.setInputEnabled(false);
    try {
      const data = entry.runtime;
      const names = [data.scriptName, ...data.callStack.map((c) => c.scriptName)];
      const scripts = new Map<string, ParsedScript>();
      for (const name of names) {
        const script = await this.getScript(name);
        if (!script) throw new Error(`Script introuvable : ${name}`);
        scripts.set(name, script);
      }
      const runtime = this.makeRuntime(scripts.get(data.scriptName)!, data.scriptName);
      if (!(await runtime.loadSaveData(data, scripts))) throw new Error("Restauration du runtime refusée");

      this.runtime = runtime;
      this.scriptFile = data.scriptName;
      this.quickMenuLocked = data.state.quickMenuLocked ?? false;
      this.autoPaused = data.state.autoModePaused ?? false;
      this.chainQueue = [...entry.chainQueue];
      this.stageSnap = entry.stage;
      this.audioSnap = entry.audio;
      this.audio.stopAll();
      this.audio.restore(entry.audio);
      await this.stage.restore(entry.stage, signal);
      if (signal.aborted) return false;
      this.enterGame();
      this.startLoop({ step: { position: entry.position, events: [], stop: entry.stop }, record: false });
      return true;
    } catch (err) {
      console.error("restore failed", err);
      this.ui.toast("Chargement impossible.");
      await this.returnToTitle();
      return false;
    } finally {
      this.ui.setInputEnabled(true);
    }
  }

  private markCompleted(): void {
    const script = this.deps.scripts.find((s) => s.file === this.scriptFile);
    if (script && !this.completed.includes(script.id)) {
      this.completed = [...this.completed, script.id];
      void this.deps.settingsStore.saveProgress({ completed: this.completed }).catch(() => {});
    }
  }

  // ── Scripts ──

  private async getScript(file: string): Promise<ParsedScript | null> {
    const language = this.settings.language;
    const cacheKey = `${language}:${file}`;
    const cached = this.scriptCache.get(cacheKey);
    if (cached) return cached;

    let script: ParsedScript | null = null;
    if (language !== "ja") {
      const index = this.languageIndexes.get(language);
      if (index && hasTranslation(index, file)) {
        script = await this.deps.loadScript(file, language);
      }
    }
    if (!script) {
      script = await this.deps.loadScript(file);
    }
    if (script) this.scriptCache.set(cacheKey, script);
    return script;
  }

  private makeRuntime(script: ParsedScript, name: string): RuntimeLike {
    const runtime = this.deps.createRuntime(script, name);
    runtime.scriptLoader = (storage) => this.getScript(storage);
    runtime.timelines = this.timelines;
    return runtime;
  }

  // ── UI ──

  private resetStageState(): void {
    this.stageSnap = { scene: { bg: null, sprites: [], effect: null }, textbox: { visible: true, frame: true }, text: [], staffroll: null };
    this.audioSnap = { loops: [] };
    this.history = [];
    this.userHidden = false;
    this.stage.setUserHidden(false);
  }

  private enterGame(): void {
    this.overlays = [];
    this.ui.show({ screen: "game" });
    this.pushStatus();
  }

  private applySettings(): void {
    this.stage.setSettings(this.settings.display);
    this.audio.setSettings(this.settings.audio);
  }

  private setState(state: PlayerState): void {
    if (this.state === state) return;
    this.state = state;
    this.pushStatus();
  }

  private pushStatus(): void {
    this.ui.setStatus({
      mode: this.mode,
      inGame: this.state !== "title",
      userHidden: this.userHidden,
      canRollback: this.canRollback(),
      quickMenuLocked: this.quickMenuLocked,
      autoPaused: this.autoPaused,
    });
  }

  private async showTitle(): Promise<void> {
    this.overlays = [];
    this.setState("title");
    const auto = await this.deps.saveStore.get("auto");
    this.ui.show({ screen: "title", scripts: this.deps.scripts, hasContinue: auto !== null });
  }

  private async slots(): Promise<SaveSlot[]> {
    const ids: SlotId[] = ["auto", "quick", ...Array.from({ length: NUMBERED_SLOTS }, (_, i) => i + 1)];
    return Promise.all(ids.map(async (id) => ({ id, data: await this.deps.saveStore.get(id) })));
  }

  /** Langues disponibles : japonais toujours, plus celles dont l'index est chargé. */
  private availableLanguages(): GameLanguage[] {
    const languages: GameLanguage[] = ["ja"];
    for (const language of this.languageIndexes.keys()) {
      if (language === "ja") continue;
      if (language === "en" || language === "fr") {
        languages.push(language);
      }
    }
    return languages;
  }

  private async showOverlay(screen: OverlayScreen): Promise<void> {
    switch (screen) {
      case "pause":
        this.ui.show({ screen: "pause" });
        break;
      case "save":
      case "load":
        this.ui.show({ screen, slots: await this.slots() });
        break;
      case "settings":
        this.ui.show({
          screen: "settings",
          settings: this.settings,
          availableLanguages: this.availableLanguages(),
        });
        break;
      case "backlog":
        this.ui.show({ screen: "backlog", entries: this.backlog() });
        break;
      case "flowchart":
        this.ui.show({
          screen: "flowchart",
          scripts: this.deps.scripts,
          progress: toScriptProgress(
            this.deps.scripts.map((s) => s.id),
            this.completed,
          ),
        });
        break;
    }
  }

  private backlog(): BacklogEntry[] {
    return this.history.filter((e) => e.text).map((e) => ({ text: e.text }));
  }
}
