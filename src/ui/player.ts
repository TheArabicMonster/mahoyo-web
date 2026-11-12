import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime, type RuntimeSaveData } from "@/kag/runtime.js";
import { applyStageSnapshot, reduceAudio } from "@/kag/stage-state.js";
import type { ReviewSnapshot } from "./review-mode.js";
import { audioPreloadPolicy, WebAudioPlayer } from "@/renderer/audio-manager.js";
import { createAssetResolver, type AssetResolver } from "@/core/asset-resolver.js";
import { applyViewportLayout, computeViewportLayout } from "@/core/display.js";
import { defaultShortcuts } from "@/core/shortcuts.js";
import { hasTranslation, parseLanguageIndex, type LanguageIndex } from "@/core/language.js";
import { parseStoryGraph } from "@/core/flow-graph.js";
import type { StoryGraph } from "@/core/story-graph.js";
import { parseStoryChain, resolveNext, type StoryChain } from "@/core/story-chain.js";
import { parseTimelineData, type TimelineData } from "@/core/timeline.js";
import { setUiLanguage, t } from "@/ui/i18n.js";
import { unlockedChapterIds } from "@/ui/chapter-list.js";
import { SAVE_COMMENT_MAX_LENGTH, saveSlotIds } from "@/ui/save-pages.js";
import {
  createLocalSaveStore,
  deriveSceneTitle,
  SaveLockedError,
  type SaveRecord,
  type SaveStore,
} from "@/player/save-store.js";
import { ProgressTracker, reachableEndings, scriptIdOf } from "@/player/progress-tracker.js";
import { overlayOfRoute, resolveRoute, viewRoute, type Route, type ScreenRouter } from "./router.js";
import { createScreenTransitions, type ScreenTransitions, type TransitionKind } from "./transitions.js";
import {
  DEFAULT_SETTINGS,
  createLocalSettingsStore,
  mergeSettings,
  type SettingsStore,
} from "@/player/settings-store.js";
import type {
  AudioChannel,
  AudioSnapshot,
  Ms,
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
  SaveMetaUpdate,
  SaveSlot,
  ScriptSummary,
  StoryProgress,
  SlotId,
  TakenChoice,
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
  /** Libère un canal SE du pool à la fin de lecture (callback audio, #358). */
  releaseSeChannel?(channel: AudioChannel): void;
  /** Assets visuels/audio à venir depuis la position courante (#367, lookahead). */
  peekAssets?(budget?: number, nextScript?: ParsedScript): {
    assets: { kind: "bg" | "image"; storage: string }[];
    audio: { kind: "bgm" | "se"; storage: string }[];
    atEnd: boolean;
  };
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
  /** Charge le graphe de scénario du flowchart (`story-graph.json`) ; null si absent. Appelé à l'ouverture de l'écran. */
  loadGraph: () => Promise<StoryGraph | null>;
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
  /** Routes d'URL des écrans (WEB-04, #204) ; null = pas de routage (tests unitaires, intégration). */
  router: ScreenRouter | null;
  /**
   * Transitions plein écran (HUD-14, #205). Absent : rideau DOM créé sur la racine du player.
   * Les tests unitaires injectent un double instantané pour ne pas dépendre d'une horloge réelle.
   */
  transitions?: ScreenTransitions;
};

const DEFAULT_SCRIPTS: ScriptSummary[] = [
  { id: "1-0", label: "Prologue", file: "1-0.ks", arc: "Prologue" },
  { id: "1-1", label: "Chapitre 1 — Partie 1", file: "1-1.ks", arc: "Chapitre 1" },
  { id: "1-2", label: "Chapitre 1 — Partie 2", file: "1-2.ks", arc: "Chapitre 1" },
];

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
  /** Chemin de choix de la partie à ce point (restauré avec lui). */
  choices: readonly TakenChoice[];
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

async function defaultLoadGraph(resolver: AssetResolver): Promise<StoryGraph | null> {
  try {
    const res = await fetch(resolver.graph());
    if (!res.ok) return null;
    return parseStoryGraph(await res.json());
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
  /** Rideau de transition plein écran (HUD-14, #205) ; injecté en test. */
  private readonly transitions: ScreenTransitions;

  private settings: GameSettings;
  private readSet = new Set<string>();
  private completed: string[] = [];
  /** Progression par scène (flowchart) : cumulative, jamais réinitialisée par un chargement. */
  private readonly progress: ProgressTracker;
  /** Arêtes de choix prises depuis le début de la partie en cours (état, enregistré dans les sauvegardes). */
  private choicePath: readonly TakenChoice[] = [];

  private state: PlayerState = "title";
  /** État d'avant la pause du panneau de revue (#400), null hors pause revue. */
  private reviewPausedFrom: PlayerState | null = null;
  private mode: PlayMode = "normal";
  /** Menu rapide verrouillé par le script (@lockquickmenu). */
  private quickMenuLocked = false;
  /** `@store enabled=false` : sauvegarde/chargement désactivés par le script. */
  private saveLoadEnabled = true;
  /** Avance automatique suspendue par le script (@pauseautomode) ; `mode` n'est pas touché. */
  private autoPaused = false;
  private userHidden = false;
  private overlays: OverlayScreen[] = [];
  private stateBeforePause: PlayerState = "playing";
  /** Détache le routeur d'URL (WEB-04) ; null tant qu'il n'est pas démarré. */
  private stopRouter: (() => void) | null = null;

  private abort = new AbortController();
  private loop: Promise<void> = Promise.resolve();
  private runtime: RuntimeLike | null = null;
  /** Désabonnement du callback de fin de canal audio (#358). */
  private stopAudioEnded: (() => void) | null = null;
  /** Préchargement lookahead (#367) : contrôleur d'annulation et références bornées. */
  private lookaheadController: AbortController | null = null;
  private lookaheadRunning = false;
  /** Médias préchargés partagés avec l'AudioManager (#394) : un élément par URL. */
  private readonly audioPreloads = new Map<string, HTMLAudioElement>();
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
  /** Graphe du flowchart, chargé à la première ouverture de l'écran (null = absent). */
  private graphPromise: Promise<StoryGraph | null> | undefined;
  /** Timelines d'animation (null si le pipeline ne les a pas générées). */
  private timelines: TimelineData | null = null;
  /** Index des langues traduites disponibles. */
  private languageIndexes: Map<string, LanguageIndex> = new Map();
  /** Scripts à jouer à la suite avant de consulter à nouveau la table (interludes). */
  private chainQueue: string[] = [];
  /** Saut au clic autorisé (@clickskip ; défaut moteur = true). */
  private clickSkipEnabled = true;
  /** Saut des effets autorisé (@effectskip ; défaut moteur = true). */
  private effectSkipEnabled = true;
  /** Le point d'arrêt courant n'avait pas encore été lu (pour le skip). */
  private stopWasRead = true;
  /** La page courante a déjà été lue (vitesse, avance rapide, auto-skip). */
  private pageRead = true;
  /** Confirmation du skip automatique déjà obtenue pour cette session. */
  private autoSkipConfirmed = false;
  /** L'utilisateur a refusé le skip automatique : ne plus demander tant qu'on reste en normal. */
  private autoSkipDeclined = false;

  private readonly onViewportChange = () => this.applyViewportScale();

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
      loadGraph: deps.loadGraph ?? (() => defaultLoadGraph(resolver)),
      loadTimelines: deps.loadTimelines ?? (() => defaultLoadTimelines(resolver)),
      loadLanguages: deps.loadLanguages ?? (() => defaultLoadLanguages(resolver)),
      scripts: deps.scripts ?? DEFAULT_SCRIPTS,
      saveStore: deps.saveStore ?? createLocalSaveStore(),
      settingsStore: deps.settingsStore ?? createLocalSettingsStore(),
      now: deps.now ?? Date.now,
      skipDelay: deps.skipDelay ?? 25,
      router: deps.router ?? null,
    };
    this.settings = DEFAULT_SETTINGS;
    this.progress = new ProgressTracker(this.deps.settingsStore);

    this.stage = this.deps.createStageRenderer({ resolver });
    this.audio = this.deps.createAudioPlayer({ resolver, audioPreloads: this.audioPreloads });
    this.ui = this.deps.createUIManager();
    this.stage.mount(this.deps.root);
    this.ui.init(this.deps.root, this.bindCommands());
    // Après `init` : l'overlay existe, le rideau se pose dedans pour rester sous `#ui-loading` (z-index 300).
    this.transitions = deps.transitions ?? createScreenTransitions({ host: this.deps.root });
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("resize", this.onViewportChange);
    document.addEventListener("fullscreenchange", this.onViewportChange);
    this.applyViewportScale();

    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const store = this.deps.settingsStore;
    this.settings = await store.loadSettings();
    setUiLanguage(this.settings.language); // langue demandée, avant le repli éventuel sur le japonais
    this.readSet = await store.loadRead();
    this.completed = (await store.loadProgress()).completed;
    this.chain = await this.deps.loadChain().catch(() => null);
    this.progress.setEndings(this.chain ? reachableEndings(this.chain) : new Set());
    await this.progress.load();
    this.timelines = await this.deps.loadTimelines().catch(() => null);
    this.languageIndexes = await this.deps.loadLanguages().catch(() => new Map());
    if (this.settings.language !== "ja" && !this.languageIndexes.has(this.settings.language)) {
      this.settings = { ...this.settings, language: "ja" };
    }
    this.applySettings();
    await this.showTitle();
    this.startRouter();
  }

  private bindCommands(): PlayerCommands {
    return {
      advance: () => this.advance(),
      hurryText: () => this.hurryText(),
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
      updateSave: (s, p) => this.updateSave(s, p),
      updateSettings: (p) => this.updateSettings(p),
      resetSettings: () => this.resetSettings(),
      toggleFullscreen: () => this.toggleFullscreen(),
      testSe: () => this.audio.testSe(),
    };
  }

  // ── Accesseurs (tests, debug) ──

  get currentState(): PlayerState {
    return this.state;
  }

  get currentMode(): PlayMode {
    return this.mode;
  }

  /** Identifiant du script en cours (nom sans extension, minuscules) ; null au titre. */
  get currentScript(): string | null {
    return this.state === "title" || this.scriptFile === "" ? null : scriptIdOf(this.scriptFile);
  }

  /** Progression par scène cumulée (copie immuable). */
  get storyProgress(): StoryProgress {
    return this.progress.snapshot;
  }

  /** Arêtes de choix de la partie en cours (celles que la sauvegarde embarque). */
  get choiceHistory(): readonly TakenChoice[] {
    return this.choicePath;
  }

  /** Résolue quand les écritures de progression en attente sont terminées (tests). */
  flushProgress(): Promise<void> {
    return this.progress.flush();
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
    // Réglage d'origine « Clic en mode auto » (#177) : arrêter l'auto au lieu d'avancer.
    // Une auto suspendue par le script (@pauseautomode) laisse le clic avancer normalement.
    if (this.mode === "auto" && !this.autoPaused && this.settings.display.autoClick === "cancel") {
      this.setMode("normal");
      return;
    }
    if (this.mode === "skip") {
      this.setMode("normal");
      return;
    }
    if (this.applying) {
      // @clickskip enabled=0 : le clic ne termine plus la frappe en cours.
      // #316 : ne terminer QUE la frappe, pas une transition/effet en cours (sinon cut parasite).
      if (this.clickSkipEnabled) {
        if (this.stage.hurryText) this.stage.hurryText();
        else this.stage.hurry();
      }
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

  /** Touche d'avance rapide : termine la frappe en cours. Retourne true si consommée. */
  hurryText(): boolean {
    if (this.state === "title" || this.state === "loading" || this.overlays.length > 0) return false;
    if (this.settings.display.fastForwardScope === "read" && !this.pageRead) return false;
    if (!this.applying) return false;
    if (this.stage.hurryText) this.stage.hurryText();
    else this.stage.hurry();
    return true;
  }

  setMode(mode: PlayMode): void {
    if (this.state === "title" || this.state === "loading") return;
    this.mode = mode;
    if (mode === "skip") this.cancelLookahead();
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

  /** `@store enabled=…` : coupe ou rétablit la sauvegarde/le chargement dans le HUD. */
  private applyStore(event: Extract<RenderEvent, { kind: "store" }>): void {
    if (this.saveLoadEnabled === event.enabled) return;
    this.saveLoadEnabled = event.enabled;
    this.pushStatus();
  }

  /**
   * @pauseautomode / @resumeautomode : suspend le déclenchement automatique sans toucher à
   * `mode` (le joueur garde « auto » et le retrouve à la reprise).
   */
  /**
   * `@clickskip` / `@effectskip` : règlages du moteur qui autorisent ou interdisent le saut
   * au clic (fin de frappe, interruption d'effets) et le saut des effets par réglage.
   */
  private applySkipSetting(event: Extract<RenderEvent, { kind: "skipSetting" }>): void {
    if (event.clickSkip !== undefined) this.clickSkipEnabled = event.clickSkip;
    if (event.effectSkip !== undefined) this.effectSkipEnabled = event.effectSkip;
  }

  /** `@cancelskip` : sort du mode skip (le script reprend la main en lecture normale). */
  private cancelSkip(): void {
    if (this.mode === "skip") this.setMode("normal");
  }

  /** Un clic peut-il interrompre les effets en cours ? (clickskip + effectskip + réglage joueur). */
  private canClickCutEffects(): boolean {
    return this.clickSkipEnabled && this.effectSkipEnabled && this.settings.display.stopAnimations;
  }

  private setAutoPaused(paused: boolean): void {
    if (this.autoPaused === paused) return;
    this.autoPaused = paused;
    this.pushStatus();
    this.rearm?.();
  }

  /** Vrai (avec un message) si le script a verrouillé le menu rapide pendant la partie. */
  private quickMenuRefused(): boolean {
    if (!this.quickMenuLocked || this.state === "title") return false;
    this.ui.toast(t("toast.quickMenuLocked"));
    return true;
  }

  /**
   * Vrai (avec un message) si la sauvegarde/le chargement est interdit : `@store enabled=false`
   * y compris hors « menu rapide verrouillé », puis verrou du menu rapide.
   */
  private saveLoadRefused(): boolean {
    if (this.state === "title") return false;
    if (!this.saveLoadEnabled) {
      this.ui.toast(t("toast.saveLoadDisabled"));
      return true;
    }
    return this.quickMenuRefused();
  }

  /**
   * Mode revue (#400) : instantané **en lecture seule** de l'état utile au flag (script/position,
   * texte source, scène, calques de timeline, transition, audio, réglages). Aucun effet de bord.
   */
  reviewSnapshot(): ReviewSnapshot {
    const save = this.runtime?.getSaveData() ?? null;
    const stageReview = this.stage.reviewState?.() ?? { transition: null, timelineLayers: [] };
    const scene = this.stageSnap.scene;
    const overlays = this.overlays;
    return {
      screen: overlays.length > 0 ? overlays[overlays.length - 1]! : this.state === "title" ? "title" : "game",
      state: this.state,
      mode: this.mode,
      script: {
        scriptName: save?.scriptName ?? (this.scriptFile || null),
        page: save?.pc ?? null,
        instruction: save?.instructionIndex ?? null,
        segment: save?.segmentIndex ?? null,
      },
      text: previewOf(this.stageSnap),
      scene: {
        bg: scene.bg,
        bgLeft: scene.bgLeft,
        bgTop: scene.bgTop,
        bgZoomX: scene.bgZoomX,
        bgZoomY: scene.bgZoomY,
        bgRotate: scene.bgRotate,
        bgEffect: scene.bgEffect,
        bgType: scene.bgType,
        sprites: scene.sprites.map((sprite) => ({
          id: sprite.id,
          storage: sprite.storage,
          x: sprite.x,
          y: sprite.y,
          z: sprite.z,
          opacity: sprite.opacity,
          ...(sprite.visible === undefined ? {} : { visible: sprite.visible }),
        })),
        effect: scene.effect,
        textbox: {
          visible: this.stageSnap.textbox.visible,
          frame: this.stageSnap.textbox.frame,
          ...(this.stageSnap.textbox.frameImage === undefined ? {} : { frameImage: this.stageSnap.textbox.frameImage }),
          ...(this.stageSnap.textbox.action === undefined ? {} : { action: this.stageSnap.textbox.action }),
        },
      },
      timelineLayers: stageReview.timelineLayers,
      transition: stageReview.transition,
      audio: {
        loops: this.audioSnap.loops.map((loop) => ({ channel: loop.channel, storage: loop.storage, volume: loop.volume })),
      },
      settings: {
        language: this.settings.language,
        audio: {
          master: this.settings.audio.master,
          bgm: this.settings.audio.bgm,
          se: this.settings.audio.se,
          voice: this.settings.audio.voice,
          muted: this.settings.audio.muted,
        },
      },
      historyPreview: this.history.slice(-3).map((entry) => entry.text),
    };
  }

  /** Pause courte du panneau de revue (#400) : fige l'état de jeu, restaure à la fermeture. */
  reviewPause(paused: boolean): void {
    if (paused) {
      if (this.state === "title" || this.state === "loading" || this.state === "paused") return;
      this.reviewPausedFrom = this.state;
      this.setState("paused");
    } else if (this.reviewPausedFrom) {
      const previous = this.reviewPausedFrom;
      this.reviewPausedFrom = null;
      this.setState(previous);
    }
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
    // Le fondu au noir démarre avec le préchargement (HUD-14, #205) : de là vient l'absence de noir
    // prolongé quand les assets sont prêts. Depuis le titre c'est « titre → jeu », sinon « chargement → scène ».
    const kind: TransitionKind = this.state === "title" ? "title-to-game" : "loading-to-scene";
    const transition = this.transitions.start(kind);
    try {
      await this.endSession();
      this.setState("loading");
      this.ui.setInputEnabled(false);
      // Préchargement pendant le fondu : seul le script est lu, rien n'est encore affiché.
      const script = await this.getScript(file);
      if (!script) {
        // Erreur : on ne réaffiche le titre qu'une fois l'écran noirci, jamais pendant le fondu.
        await transition.black;
        this.ui.toast(t("toast.scriptNotFound", { file }));
        await this.showTitle();
        this.ui.setInputEnabled(true);
        await transition.reveal();
        return;
      }
      const runtime = this.makeRuntime(script, file);
      if (label && !runtime.jump(label)) console.warn(`label introuvable : ${label}`);
      this.runtime = runtime;
      this.scriptFile = file;
      this.progress.enter(scriptIdOf(file));
      this.chainQueue = [];
      this.quickMenuLocked = false;
      this.saveLoadEnabled = true;
      this.autoPaused = false;
      // Échange des écrans une fois le noir complet : le titre reste visible pendant tout le fondu.
      await transition.black;
      this.resetStageState();
      this.stage.clear();
      this.audio.stopAll();
      this.enterGame();
      // #367 : premier lookahead dès que le runtime est prêt (avant le premier changement de scène).
      this.scheduleLookahead();
      this.startLoop();
      // L'écran de chargement cède la place au rideau avant l'apparition de la scène.
      this.ui.setInputEnabled(true);
      await transition.reveal();
    } catch (err) {
      transition.cancel();
      throw err;
    } finally {
      this.ui.setInputEnabled(true);
    }
  }

  openScreen(screen: OverlayScreen): void {
    if (this.state === "loading") return;
    const inGame = this.state !== "title";
    if (!inGame && (screen === "pause" || screen === "save" || screen === "backlog")) return;
    if ((screen === "save" || screen === "load") && this.saveLoadRefused()) return;
    if (screen === "backlog") {
      // Déjà ouvert (raccourci pressé deux fois) : rien à empiler.
      if (this.overlays[this.overlays.length - 1] === "backlog") return;
      // Historique vide : pas d'écran, un toast (comme l'original, HUD-12 / #201).
      if (this.backlog().length === 0) {
        this.ui.toast(t("toast.historyEmpty"));
        return;
      }
    }
    if (inGame && this.overlays.length === 0) {
      this.stateBeforePause = this.state;
      this.setState("paused");
    }
    this.overlays.push(screen);
    void this.showOverlay(screen);
    this.syncRoute();
  }

  closeScreen(): void {
    if (this.overlays.length === 0) return;
    this.overlays.pop();
    this.syncRoute();
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
    // « Jeu → titre » (HUD-14, #205) : fondu au noir 0,4 s, noir 0,1 s, apparition du titre 0,8 s.
    // Depuis le titre (fermeture d'un écran par exemple), aucun fondu : rien ne change à l'écran.
    const transition = this.state === "title" ? null : this.transitions.start("game-to-title");
    try {
      await this.endSession();
      // La scène reste visible pendant le fondu ; on ne la démonte qu'une fois l'écran noirci.
      await transition?.black;
      this.runtime = null;
      this.history = [];
      this.mode = "normal";
      this.quickMenuLocked = false;
      this.saveLoadEnabled = true;
      this.autoPaused = false;
      this.userHidden = false;
      this.stage.setUserHidden(false);
      this.stage.clear();
      this.audio.stopAll();
      await this.deps.settingsStore.saveRead(this.readSet).catch(() => {});
      await this.showTitle();
    } catch (err) {
      transition?.cancel();
      throw err;
    }
    await transition?.reveal();
  }

  // ── Commandes : sauvegardes ──

  async save(slot: SlotId): Promise<void> {
    if (this.saveLoadRefused()) return;
    const entry = this.history[this.history.length - 1];
    if (!entry || !this.runtime) {
      this.ui.toast(t("toast.saveUnavailable"));
      return;
    }
    const existing = await this.deps.saveStore.get(slot);
    if (existing?.locked) {
      this.ui.toast(t("toast.slotLockedOverwrite"));
      return;
    }
    if (existing && !(await this.ui.confirm(t("confirm.overwriteSave")))) return;
    const blob = await this.stage.captureThumbnail(THUMBNAIL_WIDTH).catch(() => null);
    const thumbnailUrl = blob ? await blobToDataUrl(blob) : null;
    try {
      await this.deps.saveStore.put(slot, this.toRecord(entry, thumbnailUrl));
    } catch (err) {
      if (err instanceof SaveLockedError) {
        this.ui.toast(t("toast.slotLockedOverwrite"));
        return;
      }
      console.error("save failed", err);
      this.ui.toast(t("toast.saveFailed"));
      return;
    }
    this.ui.toast(t("toast.saved"));
    if (this.overlays[this.overlays.length - 1] === "save") await this.showOverlay("save");
  }

  async load(slot: SlotId): Promise<void> {
    // Synchrone, avant le premier await : politique autoplay.
    void this.audio.unlock().catch(() => {});
    if (this.state === "loading") return;
    if (this.saveLoadRefused()) return;
    const record = await this.deps.saveStore.get(slot);
    if (!record) {
      this.ui.toast(t("toast.saveEmpty"));
      return;
    }
    // « Chargement → scène » (HUD-14, #205) : le noir couvre la restauration des assets, puis la scène
    // apparaît en `--mh-dur-scene-in`. Le rollback (`restoreEntry` sans transition) n'est pas concerné.
    const transition = this.transitions.start("loading-to-scene");
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
        choices: record.choices ?? [],
      },
    ];
    // Ajout seul : une sauvegarde ne retire ni n'écrase jamais la progression cumulée.
    this.progress.absorbChoices(this.history[0]!.choices);
    try {
      // Le noir couvre la restauration ; l'écran de chargement stylé n'apparaît qu'après le fondu.
      await transition.black;
      if (await this.restoreEntry(this.history[0])) this.overlays = [];
    } catch (err) {
      transition.cancel();
      throw err;
    }
    await transition.reveal();
  }

  async deleteSave(slot: SlotId): Promise<void> {
    if ((await this.deps.saveStore.get(slot))?.locked) {
      this.ui.toast(t("toast.slotLockedDelete"));
      return;
    }
    if (!(await this.ui.confirm(t("confirm.deleteSave")))) return;
    try {
      await this.deps.saveStore.delete(slot);
    } catch (err) {
      if (!(err instanceof SaveLockedError)) throw err;
      this.ui.toast(t("toast.slotLockedDelete"));
      return;
    }
    const top = this.overlays[this.overlays.length - 1];
    if (top === "save" || top === "load") await this.showOverlay(top);
    else if (this.state === "title") await this.showTitle();
  }

  /** Commentaire et/ou verrou d'un emplacement (HUD-10, #196) ; rafraîchit toujours l'écran, même en cas d'échec. */
  async updateSave(slot: SlotId, patch: SaveMetaUpdate): Promise<void> {
    const clean: SaveMetaUpdate = {};
    if (typeof patch.comment === "string") clean.comment = patch.comment.trim().slice(0, SAVE_COMMENT_MAX_LENGTH);
    if (typeof patch.locked === "boolean") clean.locked = patch.locked;
    try {
      await this.deps.saveStore.update(slot, clean);
    } catch (err) {
      console.error("save update failed", err);
      this.ui.toast(t("toast.saveFailed"));
    }
    const top = this.overlays[this.overlays.length - 1];
    if (top === "save" || top === "load") await this.showOverlay(top);
  }

  // ── Commandes : système ──

  updateSettings(patch: Partial<GameSettings>): void {
    const previousLanguage = this.settings.language;
    this.settings = mergeSettings(this.settings, patch);
    if (patch.language) setUiLanguage(this.settings.language); // langue demandée, avant le repli éventuel
    if (this.settings.language !== "ja" && !this.languageIndexes.has(this.settings.language)) {
      this.settings = { ...this.settings, language: "ja" };
    }
    if (patch.display?.autoSkipRead !== undefined) {
      this.autoSkipConfirmed = false;
      this.autoSkipDeclined = false;
    }
    this.applySettings();
    this.pushStatus();
    void this.deps.settingsStore.saveSettings(this.settings).catch(() => {});
    if (patch.language && this.settings.language !== previousLanguage && this.state !== "title") {
      this.ui.toast(t("toast.languageNextChapter"));
    }
  }

  /** « Réglages par défaut » (#177) : conserve la langue et la progression. */
  resetSettings(): void {
    this.settings = {
      ...DEFAULT_SETTINGS,
      display: { ...DEFAULT_SETTINGS.display },
      audio: { ...DEFAULT_SETTINGS.audio },
      shortcuts: defaultShortcuts(),
      language: this.settings.language,
    };
    this.autoSkipConfirmed = false;
    this.autoSkipDeclined = false;
    this.applySettings();
    this.pushStatus();
    void this.deps.settingsStore.saveSettings(this.settings).catch(() => {});
    if (this.overlays[this.overlays.length - 1] === "settings") void this.showOverlay("settings");
  }

  testSe(): void {
    this.audio.testSe();
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
    window.removeEventListener("resize", this.onViewportChange);
    document.removeEventListener("fullscreenchange", this.onViewportChange);
    this.stopRouter?.();
    this.stopRouter = null;
    await this.endSession();
    this.transitions.dispose();
    this.stage.dispose();
    this.audio.dispose();
    this.ui.dispose();
  }

  // ── Session et boucle de lecture ──

  /** Annule la session courante et attend la fin de la boucle avant de toucher aux renderers. */
  private async endSession(): Promise<void> {
    this.cancelLookahead();
    this.abort.abort();
    this.pendingChoice?.(-1);
    this.ui.hideChoices();
    this.stage.setClickIndicator(null);
    await this.loop;
    this.abort = new AbortController();
    this.stopAudioEnded?.();
    this.stopAudioEnded = null;
    this.onAdvance = null;
    this.rearm = null;
    this.applying = false;
    this.pendingAdvance = false;
    // Les réglages de skip (@clickskip/@effectskip) sont propres au script : retour aux
    // valeurs par défaut du moteur à chaque nouvelle session.
    this.clickSkipEnabled = true;
    this.effectSkipEnabled = true;
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
      this.pageRead = read;
      // L'état doit être « playing » avant le skip automatique : setMode refuse « loading ».
      this.setState("playing");
      const display = this.settings.display;
      // « Saut automatique des scènes déjà lues » (#177), avec confirmation optionnelle.
      if (display.autoSkipRead && read && this.mode === "normal" && !this.autoPaused && !this.autoSkipDeclined) {
        let accepted = this.autoSkipConfirmed || !display.autoSkipConfirm;
        if (!this.autoSkipConfirmed && display.autoSkipConfirm) {
          this.autoSkipConfirmed = true;
          accepted = await this.ui.confirm(t("confirm.skipRead"), { defaultButton: "yes" });
        }
        if (accepted) this.setMode("skip");
        else this.autoSkipDeclined = true;
      }
      this.stopWasRead = read || this.settings.skipUnread;
      const instant = this.mode === "skip" && this.stopWasRead;
      const instantPage = read ? display.instantReadPage : display.instantUnreadPage;
      const textSpeed = instantPage ? 0 : read ? display.textSpeedRead : display.textSpeedUnread;
      await this.applyStep(step, instant, signal, textSpeed);
      if (signal.aborted) return;
      if (!(await this.handleStop(step, record, signal))) return;
    }
  }

  private async applyStep(step: Step, instant: boolean, signal: AbortSignal, textSpeed?: Ms): Promise<void> {
    const visual: RenderEvent[] = [];
    for (const event of step.events) {
      if (event.kind === "audio") this.audio.apply(event.event, { instant });
      else if (event.kind === "quickMenu") this.setQuickMenuLocked(event.locked);
      else if (event.kind === "store") this.applyStore(event);
      else if (event.kind === "autoMode") this.setAutoPaused(event.paused);
      else if (event.kind === "skipSetting") this.applySkipSetting(event);
      else if (event.kind === "cancelSkip") this.cancelSkip();
      else visual.push(event);
    }
    this.stageSnap = applyStageSnapshot(this.stageSnap, step.events);
    this.audioSnap = reduceAudio([...snapshotToEvents(this.audioSnap), ...step.events]);
    if (visual.length === 0) return;

    const { controller, dispose } = childController(signal);
    this.applying = true;
    try {
      await this.stage.apply(visual, { instant, signal: controller.signal, textSpeed });
    } finally {
      this.applying = false;
      dispose();
    }
  }

  /** Retourne false si la boucle doit s'arrêter. */
  private async handleStop(step: Step, record: boolean, signal: AbortSignal): Promise<boolean> {
    const { stop, position } = step;
    // #367 : préparer les images suivantes pendant tous les temps d'attente (pas seulement les clics).
    if (stop.kind !== "loadScript") this.scheduleLookahead();
    switch (stop.kind) {
      case "click": {
        const entry = record ? this.recordPoint(step) : null;
        // #382 : la portée « tout » autorise l'avance rapide sur une page non lue ; la portée
        // « lus » garde le comportement historique (skip s'arrête sur l'inédit).
        const skippable = this.stopWasRead || this.settings.display.fastForwardScope === "all";
        this.readSet.add(positionKey(position));
        if (entry && this.mode !== "skip") void this.autosave(entry);
        // « Affichage final des pages » : amène les effets en cours à leur état final (#177).
        // @effectskip enabled=0 (scènes de démonstration) neutralise ce réglage.
        if (this.settings.display.instantEffects && this.effectSkipEnabled) this.stage.hurry();
        this.stage.setClickIndicator(stop.style);
        this.scheduleLookahead();
        this.setState("waiting-click");
        await this.waitUser(signal, {
          clickable: true,
          skipOk: skippable,
          // Le délai est relu à chaque réarmement : un changement de réglage s'applique tout de suite.
          autoKind: stop.style === "line" ? "line" : "page",
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
          this.ui.toast(t("toast.scriptNotFound", { file: stop.file }));
          void this.returnToTitle();
          return false;
        }
        return true;
      }
      case "end": {
        this.progress.finish(scriptIdOf(position.scriptName));
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

      // « Arrêt des animations en cours » : le clic ne saute la timeline que si activé (#177),
      // et si les skips ne sont pas désactivés par @clickskip/@effectskip.
      this.onAdvance = () => {
        if (this.canClickCutEffects()) skip();
      };
      this.rearm = () => {
        if (this.mode === "skip") skip();
      };
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) return finish();
      if (this.mode === "skip") return skip();

      // Précharge les images des calques pour qu'ils n'apparaissent pas avec un temps de retard.
      const images = new Set<string>();
      for (const entry of stop.schedule) {
        for (const ev of entry.events) if (ev.kind === "track" && ev.track.layer) images.add(ev.track.layer.storage);
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
        this.takeChoice(current, option.file);
        file = option.file;
        this.chainQueue = [...option.then];
      }
    }
    if (file === undefined) return false;

    this.setState("loading");
    const ok = await this.runtime!.loadScript(file, undefined, false);
    if (signal.aborted) return false;
    if (!ok) {
      this.ui.toast(t("toast.scriptNotFound", { file }));
      return false;
    }
    this.scriptFile = file;
    this.progress.enter(scriptIdOf(file));
    return true;
  }

  /** Menu de choix : arête `from -> to` en scripts (jamais le libellé), dans la partie et la progression. */
  private takeChoice(fromFile: string, toFile: string): void {
    const from = scriptIdOf(fromFile);
    const to = scriptIdOf(toFile);
    this.choicePath = [...this.choicePath, { from, to }];
    this.progress.choose(from, to);
  }

  private async waitForEffect(stop: Extract<StopReason, { kind: "waitFor" }>, signal: AbortSignal): Promise<void> {
    // Les attentes audio (fin de lecture [ws] et fin de fondu [wb]) ont leur propre logique :
    // un clic ne termine pas le son, il abandonne seulement l'attente (documenté).
    const isAudio = stop.what === "audio" || stop.what === "bgmFade";
    if (stop.skippable && this.mode === "skip" && this.stopWasRead) {
      if (!isAudio) this.stage.hurry();
      return;
    }
    this.setState("waiting-wait");
    const { controller, dispose } = childController(signal);
    const interrupt = (force = false) => {
      // « Arrêt des animations en cours » : un clic ne coupe les effets que si activé (#177).
      // @clickskip/@effectskip enabled=0 neutralisent aussi cette coupure.
      if (!isAudio && !force && !this.canClickCutEffects()) return;
      controller.abort();
      if (!isAudio) this.stage.hurry();
    };
    if (stop.skippable) {
      this.onAdvance = () => interrupt(false);
      this.rearm = () => {
        if (this.mode === "skip" && this.stopWasRead) interrupt(true);
      };
    } else {
      this.setLockedWait(true);
    }
    try {
      if (stop.what === "audio") await this.audio.waitFor(toAudioChannel(stop.target), controller.signal);
      else if (stop.what === "bgmFade") await this.audio.waitForFade("bgm", controller.signal);
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
    opts: { clickable: boolean; skipOk: boolean; fixedMs?: number; autoKind?: "line" | "page" },
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
            this.ui.toast(t("toast.skipStoppedUnread"));
            this.setMode("normal");
          }
          return;
        }
        if (opts.fixedMs !== undefined) timer = setTimeout(finish, opts.fixedMs);
        else if (this.mode === "auto" && !this.autoPaused) {
          const delay =
            opts.autoKind === "line" ? this.settings.display.autoLineDelay : this.settings.display.autoPageDelay;
          timer = setTimeout(finish, delay);
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
      choices: this.choicePath,
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
      sceneTitle: deriveSceneTitle(entry.runtime.scriptName, this.deps.scripts),
      comment: "",
      locked: false,
      thumbnailUrl,
      stage: entry.stage,
      position: entry.position,
      runtime: entry.runtime,
      audio: entry.audio,
      stop: entry.stop,
      chainQueue: entry.chainQueue,
      choices: entry.choices.map((c) => ({ ...c })),
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
      this.progress.enter(scriptIdOf(data.scriptName));
      this.choicePath = entry.choices;
      this.quickMenuLocked = data.state.quickMenuLocked ?? false;
      this.saveLoadEnabled = data.state.saveLoadEnabled ?? true;
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
      this.ui.toast(t("toast.loadFailed"));
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

  /** Budget du lookahead (#367) : commandes parcourues, images et audio conservés. */
  private static readonly LOOKAHEAD_BUDGET = 40;
  private static readonly LOOKAHEAD_MAX_IMAGES = 16;
  private static readonly LOOKAHEAD_MAX_AUDIO = 8;
  private static readonly LOOKAHEAD_CONCURRENCY = 2;

  /** Annule le préchargement lookahead (skip, chargement, saut de flowchart, fin de session). */
  private cancelLookahead(): void {
    this.lookaheadController?.abort();
    this.lookaheadController = null;
  }

  /**
   * Précharge en temps mort les assets à venir (#367, PERF-04) : au plus 2 images à la fois,
   * priorités basses, références conservées ; respecte `navigator.connection.saveData`.
   */
  private scheduleLookahead(): void {
    if (this.lookaheadRunning || this.lookaheadController) return;
    if (!this.runtime?.peekAssets) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    const controller = new AbortController();
    this.lookaheadController = controller;
    void this.runLookahead(controller);
  }

  private async runLookahead(controller: AbortController): Promise<void> {
    this.lookaheadRunning = true;
    const signal = controller.signal;
    try {
      await this.whenIdle();
      const runtime = this.runtime;
      if (!runtime?.peekAssets || signal.aborted) return;
      const peek = runtime.peekAssets(Player.LOOKAHEAD_BUDGET);
      let images = peek.assets;
      if (peek.atEnd && this.chain) {
        const evalCondition = runtime.evaluateCondition
          ? (expr: string) => runtime.evaluateCondition!(expr)
          : undefined;
        const next = resolveNext(this.chain, this.scriptFile, evalCondition);
        if (next.kind === "script") {
          const script = await this.getScript(next.file);
          if (script && !signal.aborted) {
            images = images.concat(runtime.peekAssets(Player.LOOKAHEAD_BUDGET, script).assets);
          }
        }
      }
      if (signal.aborted) return;

      this.preloadAudio(peek.audio);
      const urls: string[] = [];
      const seen = new Set<string>();
      for (const asset of images) {
        const url = asset.kind === "bg" ? this.deps.resolver.background(asset.storage) : this.deps.resolver.image(asset.storage);
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
        if (urls.length >= Player.LOOKAHEAD_MAX_IMAGES) break;
      }

      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (!signal.aborted && cursor < urls.length) {
          const url = urls[cursor++]!;
          // #386 : passer par le cache décodé du renderer, pas par une Map séparée.
          await this.stage.prepare?.(url, { decode: true });
        }
      };
      await Promise.all(Array.from({ length: Player.LOOKAHEAD_CONCURRENCY }, worker));
    } catch {
      // Préchargement opportuniste : jamais bloquant pour la lecture.
    } finally {
      if (this.lookaheadController === controller) this.lookaheadController = null;
      this.lookaheadRunning = false;
    }
  }

  private whenIdle(): Promise<void> {
    return new Promise((resolve) => {
      const win = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
      if (typeof win.requestIdleCallback === "function") {
        win.requestIdleCallback(() => resolve(), { timeout: 200 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  private preloadAudio(audio: readonly { kind: "bgm" | "se"; storage: string }[]): void {
    for (const entry of audio) {
      // #394 : ne jamais précharger un asset absent du manifeste (voix Steam → 404 en rafale).
      if (!this.deps.resolver.hasAudio(entry.storage)) continue;
      const url = entry.kind === "bgm" ? this.deps.resolver.bgm(entry.storage) : this.deps.resolver.se(entry.storage);
      if (this.audioPreloads.has(url)) continue;
      try {
        const el = new Audio(url);
        el.preload = audioPreloadPolicy(entry.kind, this.deps.resolver.audioSize(entry.storage), entry.storage);
        this.audioPreloads.set(url, el);
        if (this.audioPreloads.size > Player.LOOKAHEAD_MAX_AUDIO) {
          const oldest = this.audioPreloads.keys().next().value;
          if (oldest !== undefined) this.audioPreloads.delete(oldest);
        }
      } catch {
        // Audio indisponible : le préchargement audio est opportuniste.
      }
    }
  }

  private makeRuntime(script: ParsedScript, name: string): RuntimeLike {
    const runtime = this.deps.createRuntime(script, name);
    runtime.scriptLoader = (storage) => this.getScript(storage);
    runtime.timelines = this.timelines;
    // Fin de lecture d'un canal SE/voix : libère le pool du runtime courant (#358).
    this.stopAudioEnded?.();
    this.stopAudioEnded = this.audio.onChannelEnded?.((channel) => {
      if (this.runtime === runtime) runtime.releaseSeChannel?.(channel);
    }) ?? null;
    return runtime;
  }

  // ── UI ──

  private resetStageState(): void {
    this.stageSnap = { scene: { bg: null, sprites: [], effect: null }, textbox: { visible: true, frame: true }, text: [], staffroll: null };
    this.audioSnap = { loops: [] };
    this.history = [];
    this.choicePath = [];
    this.userHidden = false;
    this.autoSkipConfirmed = false;
    this.autoSkipDeclined = false;
    this.stage.setUserHidden(false);
  }

  private enterGame(): void {
    this.overlays = [];
    this.ui.show({ screen: "game" });
    this.pushStatus();
    this.syncRoute(true);
  }

  private applySettings(): void {
    this.applyReducedMotionPreference();
    this.stage.setSettings(this.settings.display);
    this.audio.setSettings(this.settings.audio);
    this.applyViewportScale();
  }

  /**
   * Réduction des animations choisie dans le jeu (#99) : attribut `data-reduce-motion` sur <html>,
   * lu par `tokens.css` (durées à 0 + neutralisation CSS). Complète `prefers-reduced-motion`, qui
   * reste géré par les media queries.
   */
  private applyReducedMotionPreference(): void {
    document.documentElement.dataset.reduceMotion = this.settings.display.reduceMotion ? "true" : "false";
  }

  /**
   * Applique la disposition du viewport : repère 1280×720 mis à l'échelle en paysage (#177),
   * viewport à taille réelle en portrait (#210, zone de texte dédiée sous la scène).
   */
  private applyViewportScale(): void {
    const root = this.deps.root;
    if (!root) return;
    const layout = computeViewportLayout(window.innerWidth, window.innerHeight, {
      fullscreen: Boolean(document.fullscreenElement),
      mode: this.settings.display.fullscreenMode,
      windowSize: this.settings.display.windowSize,
    });
    applyViewportLayout(root, layout);
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
      saveLoadEnabled: this.saveLoadEnabled,
      autoPaused: this.autoPaused,
      mouseMode: this.settings.display.mouseMode,
      autoHideCursor: this.settings.display.autoHideCursor,
      fastForwardKey: this.settings.display.fastForwardKey,
      fastForwardScope: this.settings.display.fastForwardScope,
      pageRead: this.pageRead,
      shortcuts: this.settings.shortcuts,
    });
  }

  // ── Routes d'URL (WEB-04, #204) ──

  /** Route décrivant la vue actuelle (écran du dessus de la pile, sinon partie ou titre). */
  private currentRoute(inGame = this.state !== "title"): Route {
    return viewRoute({ inGame, top: this.overlays[this.overlays.length - 1] });
  }

  /** Publie la vue actuelle au routeur (pendant un chargement, la vue n'est pas encore connue : rien). */
  private syncRoute(inGame?: boolean): void {
    if (!this.deps.router || (inGame === undefined && this.state === "loading")) return;
    this.deps.router.publish(this.currentRoute(inGame));
  }

  /** Démarre le routage à la fin de l'initialisation : le lien d'arrivée ouvre l'écran demandé (sans partie : repli titre). */
  private startRouter(): void {
    const router = this.deps.router;
    if (!router || this.stopRouter) return;
    const started = router.start((route) => this.applyRoute(route), { inGame: false });
    this.stopRouter = started.stop;
    this.applyRoute(started.initial);
  }

  /**
   * Navigation du navigateur (précédent, suivant, lien) : amène le player sur l'écran demandé.
   * Une route inatteignable (exige une partie sans partie, inconnue) retombe sur le titre. Depuis la partie, la
   * route `title` demande la même confirmation que « Title » du menu système (la progression non sauvegardée
   * serait perdue) ; refusée, l'URL est réalignée sur la partie par le routeur.
   */
  applyRoute(target: Route | null): void {
    if (this.state === "loading") return;
    const inGame = this.state !== "title";
    const route = resolveRoute(target, { inGame });
    if (route === this.currentRoute()) return;

    if (route === "title") {
      if (inGame) {
        void this.ui.confirm(t("confirm.returnToTitle")).then((ok) => {
          if (ok) void this.returnToTitle();
        });
      } else {
        void this.showTitle();
      }
      return;
    }
    if (route === "game") {
      // Fermer les écrans ouverts par-dessus la partie ; le menu système (`pause`) fait partie de la route `game`.
      while (this.overlays.length > 0 && this.overlays[this.overlays.length - 1] !== "pause") this.closeScreen();
      return;
    }
    const screen = overlayOfRoute(route);
    if (!screen) return;
    const top = this.overlays[this.overlays.length - 1];
    if (top && top !== "pause") {
      // Un autre écran est ouvert : il est remplacé, la pile ne grandit pas.
      if ((screen === "save" || screen === "load") && this.saveLoadRefused()) return;
      this.overlays[this.overlays.length - 1] = screen;
      void this.showOverlay(screen);
      this.syncRoute();
      return;
    }
    this.openScreen(screen);
  }

  private async showTitle(): Promise<void> {
    this.overlays = [];
    this.setState("title");
    this.syncRoute();
    const auto = await this.deps.saveStore.get("auto");
    const { visited, finished } = this.progress.snapshot;
    const unlockedChapters = unlockedChapterIds(this.deps.scripts, {
      visited,
      finished,
      completed: this.completed,
      hasContinue: auto !== null,
    });
    this.ui.show({ screen: "title", scripts: this.deps.scripts, hasContinue: auto !== null, unlockedChapters });
  }

  private async slots(): Promise<SaveSlot[]> {
    // Une seule lecture du stockage (IndexedDB : un seul parcours au lieu de 120 transactions).
    const byKey = new Map((await this.deps.saveStore.list()).map((e) => [String(e.slot), e.record] as const));
    return saveSlotIds().map((id) => ({ id, data: byKey.get(String(id)) ?? null }));
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
      case "flowchart": {
        this.graphPromise ??= this.deps.loadGraph().catch(() => null);
        const graph = await this.graphPromise;
        this.ui.show({
          screen: "flowchart",
          scripts: this.deps.scripts,
          currentScript: this.currentScript,
          story: this.progress.snapshot,
          graph,
          revealAll: this.settings.flowchartRevealAll,
          thumbnail: (key) => this.deps.resolver.uiImage(key),
        });
        break;
      }
    }
  }

  private backlog(): BacklogEntry[] {
    return this.history.filter((e) => e.text).map((e) => ({ text: e.text }));
  }
}
