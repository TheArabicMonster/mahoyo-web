/**
 * Moteur KAG3 minimal avec modèle fore/back et support multi-script.
 *
 * Le runtime produit des {@link Step} : un lot d'événements purs suivis d'un
 * point d'arrêt. Le player est responsable d'orchestrer le rendu et d'attendre
 * les interactions utilisateur.
 *
 * KiriKiri utilise un double buffer :
 * - "fore" : ce qui est actuellement affiché
 * - "back" : où les modifications sont préparées avant une transition
 * - @trans copie back → fore avec une transition visuelle
 */

import type {
  AnimKeyframe,
  Instruction,
  Layer,
  Page,
  ParsedScript,
  PluginKeyframe,
  TextSegment,
  TextStyle,
  Token,
} from "./types.js";
import { parseCommand, flattenControlFlow } from "./parser.js";
import {
  JOURNAL_COMMANDS,
  journalDurationMs,
  journalParams,
  journalTransition,
  normalizeJournalKeyframes,
  summarizePage,
  type RuntimeJournalEntry,
} from "./journal.js";
import { lookupTimeline, type TimelineBg, type TimelineData } from "@/core/timeline.js";
import type { AnimationDef, PageLayer } from "./types.js";
import { isVoiceStorage, SE_CHANNEL_COUNT, seChannel } from "./events.js";
import type {
  AudioChannel,
  AudioEvent,
  EffectState,
  PloyState,
  Position,
  QuakeSpec,
  RenderEvent,
  SceneState,
  ScreenShakeSpec,
  SeChannelState,
  SpriteState,
  StaffrollState,
  Step,
  StopReason,
  TextboxState,
  TimelineLayerState,
  TransitionSpec,
} from "./events.js";

export type RuntimeSaveData = {
  scriptName: string;
  pc: number;
  instructionIndex: number;
  segmentIndex: number;
  state: RuntimeState;
  callStack: { scriptName: string; pc: number; instructionIndex: number; segmentIndex: number }[];
  /** Serialized macro definitions (raw tokens). */
  macros: Record<string, Token[]>;
};

export type PageState = {
  background: string;
  bgLeft?: number;
  bgTop?: number;
  /** Zoom (%) et rotation (degrés) du fond ; absents = neutres (100 %, 0°). */
  bgZoomX?: number;
  bgZoomY?: number;
  bgRotate?: number;
  /** Apparence du fond (`@bg type=/effect=/blur/brightness/contrast`) ; absente = défauts. */
  bgType?: number;
  /** `@bindbg enabled=1` : les calques suivent les panoramiques du fond (approximation visuelle). */
  bindChildren?: boolean;
  bgEffect?: string;
  bgBrightness?: number;
  bgContrast?: number;
  bgBlurX?: number;
  bgBlurY?: number;
  layers: Layer[];
};

/** Zoom (%) et rotation (degrés) qui s'appliquent à un fond ou un calque. */
type TransformValues = { zoomx?: number; zoomy?: number; rotate?: number; afx?: number; afy?: number };

/** Valeurs neutres : un zoom de 100 % ou une rotation de 0° ne s'écrivent pas dans l'état. */
/** Noms des images de l'horloge in-game (macro.tjs, tagHandlers.dispclock). */
const CLOCK_BG_STORAGE = "im03lロビー時計(x2)";
const CLOCK_HOUR_HAND = "im03lロビー時計(短針x2)";
const CLOCK_MINUTE_HAND = "im03lロビー時計(長針x2)";

/**
 * Angles CSS (degrés, sens horaire — convention du port) des aiguilles pour `h:m`.
 * Le moteur calcule `(m + h*60) * -0.5` en convention anti-horaire ; on convertit en sens
 * horaire. Quand le fond est miroir (zoomx < 0), le moteur inverse les deux angles.
 */
function clockHandAngles(hour: number, minute: number, mirror: boolean): { hour: number; minute: number } {
  const h = ((hour % 12) + 12) % 12;
  const m = ((minute % 60) + 60) % 60;
  const hourAngle = (m + h * 60) * 0.5;
  const minuteAngle = m * 6;
  return mirror ? { hour: -hourAngle, minute: -minuteAngle } : { hour: hourAngle, minute: minuteAngle };
}

const NEUTRAL_ZOOM = 100;
const NEUTRAL_ROTATE = 0;

/**
 * Applique à `target` les zoom/rotation précisés dans `patch` (ceux qui sont `undefined` ne
 * changent rien). Une valeur neutre retire le champ : l'état ne porte que ce qui modifie l'image.
 */
function patchTransform(
  target: { zoomx?: number; zoomy?: number; rotate?: number; afx?: number; afy?: number },
  patch: TransformValues,
): void {
  if (patch.zoomx !== undefined) {
    if (patch.zoomx === NEUTRAL_ZOOM) delete target.zoomx;
    else target.zoomx = patch.zoomx;
  }
  if (patch.zoomy !== undefined) {
    if (patch.zoomy === NEUTRAL_ZOOM) delete target.zoomy;
    else target.zoomy = patch.zoomy;
  }
  if (patch.rotate !== undefined) {
    if (patch.rotate === NEUTRAL_ROTATE) delete target.rotate;
    else target.rotate = patch.rotate;
  }
  if (patch.afx !== undefined) target.afx = patch.afx;
  if (patch.afy !== undefined) target.afy = patch.afy;
}

/** Copie les champs d'apparence d'une commande (`type`, `effect`, blur, brightness, contrast). */
function patchAppearance(
  target: { type?: number; effect?: string; brightness?: number; contrast?: number; blurx?: number; blury?: number },
  source: { type?: number; effect?: string; brightness?: number; contrast?: number; blurx?: number; blury?: number },
): void {
  if (source.type !== undefined) target.type = source.type;
  if (source.effect !== undefined) target.effect = source.effect;
  if (source.brightness !== undefined) target.brightness = source.brightness;
  if (source.contrast !== undefined) target.contrast = source.contrast;
  if (source.blurx !== undefined) target.blurx = source.blurx;
  if (source.blury !== undefined) target.blury = source.blury;
}

/** Remet l'apparence d'un calque à ses défauts (le moteur réinitialise effect/contrast/… sur `@image`). */
function clearAppearance(target: { type?: number; effect?: string; brightness?: number; contrast?: number; blurx?: number; blury?: number }): void {
  delete target.type;
  delete target.effect;
  delete target.brightness;
  delete target.contrast;
  delete target.blurx;
  delete target.blury;
}

/** Champs « fond » d'une page (image, position, zoom, rotation), pour copier back ↔ fore. */
function bgFieldsOf(page: PageState): Omit<PageState, "layers"> {
  const fields: Omit<PageState, "layers"> = { background: page.background, bgLeft: page.bgLeft, bgTop: page.bgTop };
  if (page.bgZoomX !== undefined) fields.bgZoomX = page.bgZoomX;
  if (page.bgZoomY !== undefined) fields.bgZoomY = page.bgZoomY;
  if (page.bgRotate !== undefined) fields.bgRotate = page.bgRotate;
  if (page.bgType !== undefined) fields.bgType = page.bgType;
  if (page.bgEffect !== undefined) fields.bgEffect = page.bgEffect;
  if (page.bgBrightness !== undefined) fields.bgBrightness = page.bgBrightness;
  if (page.bgContrast !== undefined) fields.bgContrast = page.bgContrast;
  if (page.bgBlurX !== undefined) fields.bgBlurX = page.bgBlurX;
  if (page.bgBlurY !== undefined) fields.bgBlurY = page.bgBlurY;
  if (page.bindChildren !== undefined) fields.bindChildren = page.bindChildren;
  return fields;
}

export type RuntimeState = {
  fore: PageState;
  back: PageState;
  bgm: string | null;
  /** La BGM est en pause (@playpause) : une reprise (@playresume) la relance. */
  bgmPaused?: boolean;
  /** Dernier SE lancé (compatibilité) ; l'activité réelle est dans `seChannels`. */
  se: string | null;
  /** Canaux SE/voix actifs (pool multi-canaux, #358) : sauvegardé pour reprendre les ambiances. */
  seChannels?: SeChannelState[];
  /**
   * Variables KAG organisées en portées :
   * - f : variables de jeu (persistantes entre scènes, resets au new game)
   * - sf : variables système (sauvegardes, config)
   * - tf : variables temporaires (par scénario)
   * Ancien format plat (Record<string, unknown>) accepté à la restauration.
   */
  variables: {
    f: Record<string, unknown>;
    sf: Record<string, unknown>;
    tf: Record<string, unknown>;
  };
  staffroll?: {
    lines: { text: string; y: number; size: number; face?: string; cmx?: number; color?: string }[];
    face?: string;
    running: boolean;
    height: number;
    time: number;
    elapsed: number;
    /** Couleur demandée par `@staffrollsetting` (stockée, jamais peinte par le plugin d'origine). */
    bgcolor?: string;
  };
  /**
   * Sandbox partagée pour les expressions @eval et blocs @iscript.
   * Certains scripts Mahoyo utilisent `global.__tmp_tla` et `timeline_object`.
   */
  evalGlobal: Record<string, unknown>;
  textbox?: TextboxState;
  /** Effet visuel actuellement appliqué sur la scène. */
  effect?: EffectState | null;
  /** Style courant du texte (@font) ; null/absent = style par défaut. */
  textStyle?: TextStyle | null;
  /** Bulle « ploy » active (@ploysay) ; null/absent = aucune. */
  ploy?: PloyState | null;
  /** Menu rapide verrouillé (@lockquickmenu) ; absent = déverrouillé. */
  quickMenuLocked?: boolean;
  /** `@store enabled=…` : sauvegarde/chargement autorisés (défaut true). */
  saveLoadEnabled?: boolean;
  /** `@current layer=message1` : couche de message courante (approximation mono-textbox). */
  messageLayer?: 0 | 1;
  /**
   * `@pauseploy` : dernière bulle ploy mémorisée le temps de la pause, restaurée par
   * `@resumeploy`. **Transitoire** (non sauvegardé, allowlist #295).
   */
  ployPaused?: PloyState | null;
  /**
   * `@beginfallnote` : état transitoire des particules de notes (approximation `fallnoteplugin`) ;
   * non sauvegardé (allowlist #295).
   */
  fallnote?: { active: boolean; rate: number } | null;
  /**
   * Transition explicite lancée avec `nowait` : un `@wt` ultérieur doit exécuter le backlay
   * (copie fore→back) sauf `noback=1`. **Transitoire** (non sauvegardé, allowlist #295) : le
   * moteur ne persiste pas les attentes de transition.
   */
  transitionBacklayPending?: boolean;
  /** Avance automatique suspendue (@pauseautomode) ; absent = non suspendue. */
  autoModePaused?: boolean;
  /** Saut au clic autorisé (@clickskip) ; absent = true (défaut moteur). */
  clickSkipEnabled?: boolean;
  /** Saut des effets autorisé (@effectskip) ; absent = true (défaut moteur). */
  effectSkipEnabled?: boolean;
  /** Heure/minute affichées par l'horloge in-game (@dispclock/@tickclock). */
  clockHour?: number;
  clockMinute?: number;
};

/**
 * Échantillon de trace d'une commande, pour l'outil de diagnostic visuel
 * (`tools/trace-visual.ts`). Émis seulement si `Runtime.onTrace` est défini.
 */
export type RuntimeTraceSample = {
  /** Commande appliquée (telle que lue par le parser ; macros déjà dépliées). */
  instruction: Instruction;
  /** Position (page/instruction) de la commande au moment de son exécution. */
  position: Position;
  /** Page visée par la commande (`back` par défaut, `fore` pour les animations de premier plan). */
  page: PageLayer | null;
  /** Événements émis par cette commande. */
  events: readonly RenderEvent[];
  /** État des pages après application de la commande (copie). */
  fore: PageState;
  back: PageState;
};

export type ScriptContext = {
  script: ParsedScript;
  pc: number;
  instructionIndex: number;
  scriptName: string;
  /** Position dans l'instruction texte courante (pour reprise après [l]). */
  segmentIndex: number;
};

/** Type guard : vérifie si les variables sont au format scoped ({f, sf, tf}). */
function isScopedVariables(
  vars: unknown,
): vars is { f: Record<string, unknown>; sf: Record<string, unknown>; tf: Record<string, unknown> } {
  return (
    typeof vars === "object" &&
    vars !== null &&
    "f" in vars &&
    "sf" in vars &&
    "tf" in vars
  );
}

/**
 * Événements qui n'apportent rien de nouveau à lire ou à voir : effacement de la
 * textbox (émis à chaque début de page), sauts de ligne, audio, arrêt d'animation.
 * Tout autre événement compte comme du contenu nouveau pour le joueur.
 */
function isVisibleEvent(event: RenderEvent): boolean {
  return (
    event.kind !== "clearText" &&
    event.kind !== "lineBreak" &&
    event.kind !== "audio" &&
    event.kind !== "stopAnimation" &&
    event.kind !== "quickMenu" &&
    event.kind !== "store" &&
    event.kind !== "autoMode"
  );
}

/** Durée des fondus enchaînés entre deux fonds d'une timeline (ms). */
const TIMELINE_FADE_MS = 1500;

/** Durée du fondu qui réaffiche la textbox quand un texte arrive (ms, #159). */
const TEXTBOX_REVEAL_MS = 300;

/**
 * Taille de police par défaut du message pour les macro-emoji (`macro.tjs` : `<base>+fontSize`).
 * `override/config.tjs` fixe `defaultFontSize = 26` ; les assets du corpus sont `heart24`/`heart26`
 * et `アゲアゲ26`… — le style courant (`@font size=`) reste prioritaire quand il est défini.
 */
const DEFAULT_EMOJI_FONT_SIZE = 26;

export function createRuntimeState(): RuntimeState {
  return {
    fore: { background: "", layers: [] },
    back: { background: "", layers: [] },
    bgm: null,
    se: null,
    variables: { f: {}, sf: {}, tf: {} },
    evalGlobal: {},
    staffroll: { lines: [], running: false, height: 10000, time: 60000, elapsed: 0 },
    textbox: { visible: true, frame: true },
    effect: null,
    textStyle: null,
    ploy: null,
    quickMenuLocked: false,
    saveLoadEnabled: true,
    messageLayer: 0,
    ployPaused: null,
    fallnote: null,
    transitionBacklayPending: false,
    autoModePaused: false,
    clickSkipEnabled: true,
    effectSkipEnabled: true,
  };
}

export class Runtime {
  private context: ScriptContext;
  private callStack: Array<ScriptContext & { savedFrames?: unknown; savedMacroParams?: Record<string, unknown> }> = [];
  private state: RuntimeState;

  /** Callback pour charger un script par son nom de fichier. */
  public scriptLoader: ((storage: string) => Promise<ParsedScript | null>) | null = null;

  public onWarning: (message: string) => void = console.warn;
  /**
   * Compteur de commandes `raw` (inconnues) rencontrées depuis l'instanciation.
   * Permet de détecter les régressions (une commande autrefois gérée qui
   * deviendrait no-op ferait bondir ce compteur).
   */
  public rawCount = 0;

  /**
   * Callback de diagnostic (outil de trace visuelle) : reçoit chaque commande
   * non textuelle aussitôt appliquée, avec la page visée et l'état des pages.
   * Null (défaut) = aucun surcoût.
   */
  public onTrace: ((sample: RuntimeTraceSample) => void) | null = null;

  /**
   * Callback léger (nom de commande exécuté), utilisé par l'audit pour compter les commandes
   * réellement rencontrées sans le coût de `onTrace` (pas de clone d'état).
   */
  public onCommand: ((command: string) => void) | null = null;

  /** Identité des scènes émises (#317) : seul un nouvel id coupe la transition en cours. */
  private sceneTransitionId = 0;
  /**
   * Journal d'exécution détaillé (#318) : commandes, paramètres, état résolu, durées et keyframes.
   * `null` par défaut (aucun surcoût en production) ; alimenté par l'outil de diagnostic.
   */
  public onJournal: ((entry: RuntimeJournalEntry) => void) | null = null;

  /** Facteur de vitesse appliqué aux durées effectives du journal (`1` = normal). */
  public journalSpeedFactor = 1;

  /** Compteur d'occurrences par commande (alignement par événement, #318). */
  private journalCounts = new Map<string, number>();

  /** Ordre de lancement par canal SE (réutilisation du plus ancien one-shot, #358). */
  private seStartedAt = new Map<AudioChannel, number>();
  private seSequence = 0;
  /** Dernier canal SE lancé par @playtimeline (cible des actions `volume` sans storage). */
  private lastTimelineSeChannel: AudioChannel | null = null;

  /** Macros définies par @macro/@endmacro. */
  private macros: Map<string, Token[]> = new Map();

  /** Current macro parameter map (exposed as `mp` in expressions). */
  private macroParams: Record<string, unknown> = {};

  /** Minimal kag proxy for TJS expressions that reference kag.*. */
  private kagProxy = {
    con: { crashAction: "" },
    flags: {},
    /** Un SE (ou une voix routée) est-il en cours sur un canal du pool ? (#358) */
    isplayingse: (storage: string): boolean => this.isPlayingSe(storage),
  };

  /**
   * Timelines d'animation extraites des scripts (`timelines.json`), fournies par le
   * player. Sans elles, @playtimeline est sans effet.
   */
  timelines: TimelineData | null = null;

  /**
   * Réglages du jeu d'origine exposés aux scripts sous le nom `cf` (TJS). Valeurs
   * par défaut du jeu : `speffect` (effets visuels activés) choisit la scène 4 de
   * l'ouverture, celle dont les fonds portent toutes les images (#135).
   */
  cf: Record<string, unknown> = { speffect: 1 };

  /**
   * Flag set by applyJump/applyCall/applyReturn to signal that the execution
   * context has changed. More robust than comparing pc/instructionIndex.
   */
  private pendingContextChange = false;

  /**
   * Le dernier step s'est arrêté sur un point d'arrêt (hors fin de script) :
   * le prochain `step()` reprend juste après. Sert à ne pas confondre une page
   * terminée par une pause (`text [wait] [p]`) avec un retour de @call après la
   * dernière instruction (#136, B7).
   */
  private resumedAfterStop = false;

  /**
   * Du contenu lisible ou visible (texte, scène, animation…) a été émis depuis
   * le dernier arrêt sur un clic. Sans lui, une pause `[l]` n'a rien à faire
   * attendre au joueur (#136, B8).
   */
  private visibleSinceClick = false;

  /**
   * Pile de frames d'exécution pour les branches conditionnelles et les
   * expansions de macros. Chaque frame porte son index d'instruction et sa
   * position dans un éventuel segment texte ([l]).
   */
  private frames: Array<{
    instructions: Instruction[];
    index: number;
    segmentIndex: number;
    macroParams?: Record<string, unknown>;
    /** Instruction index in the calling page to resume after this frame completes (for @call return). */
    returnIndex?: number;
  }> = [];

  constructor(
    script: ParsedScript,
    scriptName: string = "main",
    initialState: RuntimeState = createRuntimeState(),
  ) {
    this.context = { script, pc: 0, instructionIndex: 0, scriptName, segmentIndex: 0 };
    this.state = initialState;
  }

  get currentPage(): Page | null {
    return this.context.script.pages[this.context.pc] ?? null;
  }

  get currentScriptName(): string {
    return this.context.scriptName;
  }

  /**
   * Assets visuels à venir depuis la position courante (#367, PERF-04).
   *
   * Parcourt environ `budget` commandes en suivant les `jump`/`call` internes, **les deux
   * branches** des `if` aplatis (`jumpIfNot`), et les pages suivantes ; en fin de script, continue
   * dans `nextScript` s'il est fourni (premières images du script d'enchaînement). Ne modifie
   * aucun état : utilisé par le player pour précharger pendant les temps morts.
   */
  peekAssets(
    budget = 40,
    nextScript?: ParsedScript,
  ): {
    assets: { kind: "bg" | "image"; storage: string }[];
    audio: { kind: "bgm" | "se"; storage: string }[];
    atEnd: boolean;
  } {
    const assets: { kind: "bg" | "image"; storage: string }[] = [];
    const audio: { kind: "bgm" | "se"; storage: string }[] = [];
    const seenAssets = new Set<string>();
    const visited = new Set<string>();
    type Cursor = { script: ParsedScript; page: number; index: number; name: string; next: boolean };
    const queue: Cursor[] = [
      { script: this.context.script, page: this.context.pc, index: this.context.instructionIndex, name: this.context.scriptName, next: false },
    ];
    let scanned = 0;
    let atEnd = false;

    const collect = (instruction: Instruction): void => {
      if (instruction.kind === "bg" || instruction.kind === "image" || instruction.kind === "fg") {
        const storage = instruction.storage;
        if (!storage) return;
        const kind = instruction.kind === "bg" ? "bg" : "image";
        const id = `${kind}:${storage}`;
        if (!seenAssets.has(id)) {
          seenAssets.add(id);
          assets.push({ kind, storage });
        }
      } else if (instruction.kind === "raw" && instruction.command === "ev") {
        const storage = instruction.args.storage;
        if (storage && !seenAssets.has(`image:${storage}`)) {
          seenAssets.add(`image:${storage}`);
          assets.push({ kind: "image", storage });
        }
      } else if (instruction.kind === "play" || instruction.kind === "se" || instruction.kind === "seact") {
        if (!instruction.storage) return;
        const kind = instruction.kind === "play" ? "bgm" : "se";
        const id = `audio:${kind}:${instruction.storage}`;
        if (!seenAssets.has(id)) {
          seenAssets.add(id);
          audio.push({ kind, storage: instruction.storage });
        }
      }
    };

    const followLabel = (cursor: Cursor, label: string | undefined): Cursor | null => {
      if (!label) return null;
      const page = cursor.script.labels[label];
      if (page === undefined) return null;
      return { ...cursor, page, index: cursor.script.labelInstructionIndex[label] ?? 0 };
    };

    while (queue.length > 0 && scanned < budget) {
      const cursor = queue.shift()!;
      if (visited.has(`${cursor.name}:${cursor.page}:${cursor.index}`)) continue;
      visited.add(`${cursor.name}:${cursor.page}:${cursor.index}`);

      if (cursor.page >= cursor.script.pages.length) {
        atEnd = true;
        if (!cursor.next && nextScript) {
          queue.push({ script: nextScript, page: 0, index: 0, name: "next", next: true });
        }
        continue;
      }

      const page = cursor.script.pages[cursor.page]!;
      let index = cursor.index;
      let jumped = false;
      while (index < page.instructions.length && scanned < budget) {
        const instruction = page.instructions[index]!;
        scanned++;
        collect(instruction);
        if (instruction.kind === "jumpIndex") {
          queue.unshift({ ...cursor, index: instruction.target });
          jumped = true;
          break;
        }
        if (instruction.kind === "jumpIfNot") {
          // Les deux branches : la cible et la suite linéaire (flatten #80).
          queue.unshift({ ...cursor, index: instruction.target });
        }
        if (instruction.kind === "jump" || instruction.kind === "call") {
          const target = followLabel(cursor, instruction.target);
          if (target) {
            queue.unshift(target);
            if (instruction.kind === "jump") {
              jumped = true;
              break;
            }
          }
        }
        if (instruction.kind === "return") {
          jumped = true;
          break;
        }
        index++;
      }
      if (!jumped) {
        // Suite de la page, puis page suivante, puis script d'enchaînement.
        if (index >= page.instructions.length) {
          queue.push({ ...cursor, page: cursor.page + 1, index: 0 });
        }
      }
    }

    return { assets, audio, atEnd };
  }

  /**
   * Copie de l'état des pages fore/back (diagnostic : outil de trace visuelle,
   * `tools/trace-visual.ts`). Ne modifie rien.
   */
  debugPages(): { fore: PageState; back: PageState } {
    return { fore: structuredClone(this.state.fore), back: structuredClone(this.state.back) };
  }

  private buildPosition(segment?: number): Position {
    return {
      scriptName: this.context.scriptName,
      page: this.context.pc,
      instruction: this.context.instructionIndex,
      segment,
    };
  }

  private makeStep(events: RenderEvent[], stop: StopReason, segment?: number): Step {
    this.resumedAfterStop = stop.kind !== "end";
    if (stop.kind === "click") {
      this.visibleSinceClick = false;
    } else if (events.some(isVisibleEvent)) {
      this.visibleSinceClick = true;
    }
    return {
      position: this.buildPosition(segment),
      events,
      stop,
    };
  }

  /**
   * Évalue une expression KAG comme @eval le ferait, avec accès aux variables
   * f/sf/tf/global/timeline_object/cf. Retourne la valeur évaluée ou undefined
   * en cas d'erreur (warning émis).
   */
  /** Normalise a TJS expression for JS evaluation. */
  private normalizeTjsExpression(expression: string): string {
    // void is TJS null — replace with undefined to avoid JS SyntaxError.
    // Simple approach: only replace standalone "void" (not inside strings).
    // This is a best-effort heuristic; complex nested quotes may still break.
    let normalized = expression;
    // Replace void only when it appears as a word boundary token (not in strings).
    // We use a simple regex that matches void at word boundaries.
    normalized = normalized.replace(/\bvoid\b/g, "undefined");
    // Prefix & is TJS dereference — treat as no-op for simple cases.
    if (normalized.startsWith("&")) {
      normalized = normalized.slice(1);
    }
    return normalized;
  }

  private evaluateExpression(expression: string): unknown {
    const { f, sf, tf } = this.state.variables;
    const normalized = this.normalizeTjsExpression(expression);
    try {
      const timeline_object = { loadByData: () => {} };
      const fn = new Function(
        "f",
        "sf",
        "tf",
        "global",
        "timeline_object",
        "mp",
        "kag",
        "cf",
        `"use strict"; return (${normalized});`,
      );
      return fn(f, sf, tf, this.state.evalGlobal, timeline_object, this.macroParams, this.kagProxy, this.cf);
    } catch (err) {
      this.onWarning(`eval failed: ${expression} — ${err}`);
      return undefined;
    }
  }

  /** Vrai entre @lockquickmenu et @unlockquickmenu (ou la fin du script). */
  get quickMenuLocked(): boolean {
    return this.state.quickMenuLocked ?? false;
  }

  /** Vrai entre @pauseautomode et @resumeautomode (ou la fin du script). */
  get autoModePaused(): boolean {
    return this.state.autoModePaused ?? false;
  }

  /** Évalue une condition dans la sandbox du runtime (utilisé aussi par le player). */
  evaluateCondition(expression: string): boolean {
    return Boolean(this.evaluateExpression(expression));
  }

  /** Extract the cond= / exp= attribute from an instruction that supports it. */
  private getCond(instruction: Instruction): string | undefined {
    switch (instruction.kind) {
      case "jump":
        return instruction.cond;
      case "call":
        return instruction.cond;
      case "eval":
        return instruction.cond;
      case "trans":
        return instruction.cond;
      case "seact":
        return instruction.cond;
      case "raw":
        return instruction.args.cond;
      default:
        return undefined;
    }
  }

  /**
   * Substitute %param|default patterns in macro tokens with call-site args.
   * Supports: %name (no default), %name|default (with default), * (all args pass-through).
   */
  private expandMacroTokens(rawTokens: Token[], callArgs: Record<string, string>): Token[] {
    return rawTokens.map((token) => {
      if (token.type !== "command") return token;
      // Substitute in each arg value
      const newArgs: Record<string, string> = {};
      for (const [key, value] of Object.entries(token.args)) {
        newArgs[key] = this.substituteMacroParams(value, callArgs);
      }
      return { ...token, args: Runtime.cleanEmptyArgs(newArgs) };
    });
  }

  /** Replace %param|default patterns in a single string. */
  private substituteMacroParams(value: string, callArgs: Record<string, string>): string {
    // KAG only substitutes %param when the whole attribute value starts with %.
    // So "f.r=7%x" (modulo) is left untouched, but "%x" or "%x|default" is substituted.
    if (!value.startsWith("%")) return value;

    return value.replace(/^%(\w+)(?:\|(.*))?$/, (_match, param, defaultVal) => {
      const provided = callArgs[param];
      if (provided !== undefined && provided !== "") return provided;
      if (defaultVal !== undefined) return defaultVal;
      return ""; // No value and no default → empty
    });
  }

  /**
   * Remove empty-string args from a token (KAG drops attributes with empty values).
   */
  private static cleanEmptyArgs(args: Record<string, string>): Record<string, string> {
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      if (value !== "") cleaned[key] = value;
    }
    return cleaned;
  }

  /** Build the mp (macro params) object from call-site args. */
  private buildMacroParams(callArgs: Record<string, string>): Record<string, unknown> {
    const mp: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(callArgs)) {
      // KAG keeps values as strings; don't auto-convert to numbers.
      mp[key] = value;
    }
    return mp;
  }

  /** Parse raw tokens (from macro body) into executable instructions. */
  private parseRawTokens(tokens: Token[]): Instruction[] {

    const instructions: Instruction[] = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];
      if (!token) { i++; continue; }

      switch (token.type) {
        case "command": {
          if (token.name === "if") {
            // Parse @if/@elsif/@else/@endif block
            const { branches, nextIdx } = this.parseConditionalTokens(tokens, i);
            instructions.push({ kind: "conditional", branches });
            i = nextIdx;
          } else if (token.name === "macro") {
            // Nested @macro definition — skip the body
            const name = token.args.name ?? "";
            let depth = 1;
            let j = i + 1;
            while (j < tokens.length && depth > 0) {
              const t = tokens[j];
              if (t?.type === "command" && t.name === "macro") depth++;
              if (t?.type === "command" && t.name === "endmacro") depth--;
              j++;
            }
            // Store the nested macro as rawTokens
            const body = tokens.slice(i + 1, j - 1);
            instructions.push({ kind: "macrodef", name, rawTokens: body });
            i = j;
          } else {
            instructions.push(parseCommand(token));
            i++;
          }
          break;
        }
        case "tag": {
          if (token.name === "l") {
            instructions.push({ kind: "text", segments: [{ lineBreak: true }, { pause: true }] });
          } else if (token.name === "p") {
            instructions.push({ kind: "text", segments: [{ pause: true }] });
          } else if (token.name === "r") {
            instructions.push({ kind: "break" });
          } else {
            // Inline tags like [chgfg ...], [fg ...], [se ...] are semantically
            // identical to their @command forms. Route through parseCommand.
            instructions.push(
              parseCommand({ type: "command", name: token.name, args: token.args }),
            );
          }
          i++;
          break;
        }
        case "text": {
          instructions.push({ kind: "text", segments: [{ text: token.content }] });
          i++;
          break;
        }
        case "label":
        case "comment":
        case "linebreak": {
          i++;
          break;
        }
      }
    }
    return flattenControlFlow(instructions).instructions;
  }

  /** Parse @if/@elsif/@else/@endif from a raw token stream. */
  private parseConditionalTokens(
    tokens: Token[],
    start: number,
  ): { branches: Array<{ cond?: string; instructions: Instruction[] }>; nextIdx: number } {
    const branches: Array<{ cond?: string; instructions: Instruction[] }> = [];
    const ifToken = tokens[start] as Extract<Token, { type: "command" }>;
    let currentCond: string | undefined = ifToken.args.exp ?? ifToken.args.cond;
    let i = start + 1;

    while (i <= tokens.length) {
      const { instructions, terminator, nextIndex } = this.parseBlockTokens(tokens, i, [
        "elsif", "else", "endif",
      ]);
      branches.push({ cond: currentCond, instructions });

      if (terminator === "elsif") {
        const elsifToken = tokens[nextIndex] as Extract<Token, { type: "command" }>;
        currentCond = elsifToken.args.exp ?? elsifToken.args.cond;
        i = nextIndex + 1;
      } else if (terminator === "else") {
        const elseRes = this.parseBlockTokens(tokens, nextIndex + 1, ["endif"]);
        branches.push({ cond: undefined, instructions: elseRes.instructions });
        return { branches, nextIdx: elseRes.nextIndex + 1 };
      } else if (terminator === "endif") {
        return { branches, nextIdx: nextIndex + 1 };
      } else {
        // Missing @endif
        return { branches, nextIdx: tokens.length };
      }
    }
    return { branches, nextIdx: tokens.length };
  }

  /** Parse a flat block of instructions until a terminator command. */
  private parseBlockTokens(
    tokens: Token[],
    start: number,
    terminators: string[],
  ): { instructions: Instruction[]; terminator: string | null; nextIndex: number } {
    const instructions: Instruction[] = [];
    let i = start;

    while (i < tokens.length) {
      const token = tokens[i];
      if (!token) { i++; continue; }

      if (token.type === "command" && terminators.includes(token.name)) {
        return { instructions, terminator: token.name, nextIndex: i };
      }

      switch (token.type) {
        case "command": {
          if (token.name === "if") {
            const { branches, nextIdx } = this.parseConditionalTokens(tokens, i);
            instructions.push({ kind: "conditional", branches });
            i = nextIdx;
          } else {
            instructions.push(parseCommand(token));
            i++;
          }
          break;
        }
        case "tag": {
          if (token.name === "l" || token.name === "p") {
            instructions.push({ kind: "text", segments: [{ pause: true }] });
          } else if (token.name === "r") {
            instructions.push({ kind: "break" });
          } else {
            // Inline tags like [chgfg ...], [fg ...], [se ...] are semantically
            // identical to their @command forms. Route through parseCommand.
            instructions.push(
              parseCommand({ type: "command", name: token.name, args: token.args }),
            );
          }
          i++;
          break;
        }
        case "text": {
          instructions.push({ kind: "text", segments: [{ text: token.content }] });
          i++;
          break;
        }
        case "label":
        case "comment":
        case "linebreak": {
          i++;
          break;
        }
      }
    }
    return { instructions, terminator: null, nextIndex: tokens.length };
  }

  private pushFrame(instructions: Instruction[], macroParams?: Record<string, unknown>, returnIndex?: number) {
    const parentFrame = this.frames.length > 0 ? this.frames[this.frames.length - 1] : undefined;
    this.frames.push({
      instructions,
      index: 0,
      segmentIndex: 0,
      macroParams: macroParams ?? (parentFrame ? parentFrame.macroParams : undefined),
      returnIndex: returnIndex ?? parentFrame?.returnIndex,
    });
  }

  /**
   * Une pause `[l]` est « morte » quand rien de lisible ni de visible n'a été
   * affiché depuis le dernier clic : l'attendre ne ferait que bloquer le joueur
   * (typiquement une ligne traduite vide, ou un `[l]` qui ne suit que des
   * commandes audio). Les pauses de fin de page (`[p]`) ne sont pas concernées.
   */
  private isDeadPause(stop: StopReason | undefined, stepEvents: readonly RenderEvent[]): boolean {
    if (!stop || stop.kind !== "click" || stop.style !== "line") return false;
    return !this.visibleSinceClick && !stepEvents.some(isVisibleEvent);
  }

  /** Applique le style courant (@font) aux segments de texte ; les pauses sont inchangées. */
  /**
   * Convertit les marqueurs emoji (`[heart]`…) en segments `graph` avec le storage du moteur :
   * `<base><fontSize courant>`. La taille vient du style de texte (`@font size=`), sinon du défaut
   * moteur (`defaultFontSize = 26`).
   */
  private expandEmojiSegments(segments: TextSegment[]): TextSegment[] {
    if (!segments.some((segment) => "emoji" in segment)) return segments;
    const size = this.state.textStyle?.size ?? DEFAULT_EMOJI_FONT_SIZE;
    return segments.map((segment) =>
      "emoji" in segment
        ? {
            graph: {
              storage: `${segment.emoji.base}${size}`,
              alt: segment.emoji.alt,
              ...(segment.emoji.ruby === undefined ? {} : { ruby: segment.emoji.ruby }),
              ...(segment.emoji.rubyGroup === undefined ? {} : { rubyGroup: segment.emoji.rubyGroup }),
            },
          }
        : segment,
    );
  }

  private withTextStyle(segments: TextSegment[]): TextSegment[] {
    const style = this.state.textStyle;
    if (!style || Object.keys(style).length === 0) return segments;
    return segments.map((seg) => ("text" in seg ? { ...seg, style: { ...style } } : seg));
  }

  private processFrameText(
    frame: { instructions: Instruction[]; index: number; segmentIndex: number },
    instruction: Extract<Instruction, { kind: "text" }>,
  ): { events: RenderEvent[]; stop?: StopReason } {
    const events: RenderEvent[] = [];
    const segments = this.expandEmojiSegments(instruction.segments);
    let index = frame.segmentIndex;
    let pending: TextSegment[] = [];
    const flush = (): void => {
      if (pending.length > 0) {
        events.push({ kind: "text", segments: this.withTextStyle(pending) });
        pending = [];
      }
    };
    while (index < segments.length) {
      const seg = segments[index++]!;
      if ("pause" in seg && seg.pause) {
        flush();
        frame.segmentIndex = index;
        return { events, stop: { kind: "click", style: "line" } };
      }
      if ("lineBreak" in seg && seg.lineBreak) {
        // `[l]` : `<br>` immédiat, sans attente (#407).
        flush();
        events.push({ kind: "lineBreak" });
        continue;
      }
      pending.push(seg);
    }
    flush();
    frame.segmentIndex = 0;
    frame.index += 1;
    return { events };
  }

  /**
   * Exécute les frames empilées (branches @if ou expansions de macros) jusqu'à
   * ce qu'elles soient vides ou qu'un point d'arrêt soit atteint. Si le
   * contexte change (jump), les frames sont abandonnées.
   */
  private drainFrames(events: RenderEvent[]): StopReason | null {
    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1];
      if (frame.index >= frame.instructions.length) {
        this.frames.pop();
        continue;
      }

      // Activate macro params for this frame if present.
      const savedMacroParams = this.macroParams;
      if (frame.macroParams) {
        this.macroParams = frame.macroParams;
      }

      const instruction = frame.instructions[frame.index];
      const flatTarget = this.flatControlTarget(instruction, frame.index);
      if (flatTarget !== null) {
        frame.index = flatTarget;
        this.macroParams = savedMacroParams;
        continue;
      }

      if (instruction.kind === "text") {
        const result = this.processFrameText(frame, instruction);
        events.push(...result.events);
        if (result.stop) {
          this.macroParams = savedMacroParams;
          // Pause sans rien de nouveau à lire : on ne bloque pas (#136, B8).
          if (this.isDeadPause(result.stop, events)) continue;
          return result.stop;
        }
        this.macroParams = savedMacroParams;
        continue;
      }

      if (instruction.kind === "break") {
        events.push({ kind: "lineBreak" });
        frame.index += 1;
        this.macroParams = savedMacroParams;
        continue;
      }

      const result = this.applyInstruction(instruction);
      events.push(...result.events);

      if (this.pendingContextChange) {
        // A jump/call/return changed the context. The caller (applyJump/
        // applyCall/applyReturn) is responsible for managing the frames.
        this.macroParams = savedMacroParams;
        return null;
      }

      if (result.stop) {
        frame.index += 1;
        this.macroParams = savedMacroParams;
        // A loadScript discards pending frames so the new script starts clean (B7).
        if (result.stop.kind === "loadScript") {
          this.frames = [];
        }
        return result.stop;
      }

      frame.index += 1;
      // Restore macroParams at end of iteration to prevent leakage (B6).
      this.macroParams = savedMacroParams;
    }

    // Final restoration when drainFrames completes normally.
    this.macroParams = this.frames.length > 0 ? this.macroParams : {};

    return null;
  }

  private getPageState(page?: PageLayer): PageState {
    return page === "back" ? this.state.back : this.state.fore;
  }

  /**
   * Résout la page cible quand `page` est absent.
   *
   * Sémantique Mahoyo (prouvée par 1-0.ks l.73-78 et 183-193) :
   * `@fg`/`@partbg`/`@chgfg`/`@clall`/`@clfg`/`@bg`/`@fgact`/`@partbgact`
   * **sans `page=`** écrivent sur **back**. Le trans explicite ou implicite
   * (back→fore) révèle ensuite le résultat.
   *
   * `@movefg`/`@movepartbg` ciblent fore (ils animent un calque déjà visible).
   */
  private resolvePage(kind: string, page?: PageLayer): PageLayer {
    if (page) return page;
    if (kind === "movefg" || kind === "movepartbg") return "fore";
    return "back";
  }

  private layerToSprite(layer: Layer): SpriteState {
    const sprite: SpriteState = {
      id: layer.id,
      storage: layer.storage,
      x: layer.center,
      y: layer.vcenter,
      z: layer.index,
      opacity: layer.opacity,
    };
    if (layer.crop) {
      sprite.crop = {
        width: layer.crop.width,
        height: layer.crop.height,
        srcLeft: layer.crop.srcLeft,
        srcTop: layer.crop.srcTop,
        srcZoomX: layer.crop.srcZoomX,
        srcZoomY: layer.crop.srcZoomY,
        bgStorage: layer.crop.bgStorage,
      };
    }
    if (layer.visible !== undefined) sprite.visible = layer.visible;
    if (layer.partbgId) sprite.partbgId = layer.partbgId;
    if (layer.zoomx !== undefined) sprite.zoomx = layer.zoomx;
    if (layer.zoomy !== undefined) sprite.zoomy = layer.zoomy;
    if (layer.rotate !== undefined) sprite.rotate = layer.rotate;
    if (layer.afx !== undefined) sprite.afx = layer.afx;
    if (layer.afy !== undefined) sprite.afy = layer.afy;
    if (layer.type !== undefined) sprite.type = layer.type;
    if (layer.effect !== undefined) sprite.effect = layer.effect;
    if (layer.brightness !== undefined) sprite.brightness = layer.brightness;
    if (layer.contrast !== undefined) sprite.contrast = layer.contrast;
    if (layer.blurx !== undefined) sprite.blurx = layer.blurx;
    if (layer.blury !== undefined) sprite.blury = layer.blury;
    return sprite;
  }

  private buildSceneState(page: PageLayer = "fore"): SceneState {
    const target = page === "back" ? this.state.back : this.state.fore;
    const scene: SceneState = {
      bg: target.background || null,
      bgLeft: target.bgLeft,
      bgTop: target.bgTop,
      sprites: target.layers.map((l) => this.layerToSprite(l)),
      effect: this.buildEffectState(),
    };
    if (target.bgZoomX !== undefined) scene.bgZoomX = target.bgZoomX;
    if (target.bgZoomY !== undefined) scene.bgZoomY = target.bgZoomY;
    if (target.bgRotate !== undefined) scene.bgRotate = target.bgRotate;
    if (target.bgType !== undefined) scene.bgType = target.bgType;
    if (target.bgEffect !== undefined) scene.bgEffect = target.bgEffect;
    if (target.bgBrightness !== undefined) scene.bgBrightness = target.bgBrightness;
    if (target.bgContrast !== undefined) scene.bgContrast = target.bgContrast;
    if (target.bgBlurX !== undefined) scene.bgBlurX = target.bgBlurX;
    if (target.bgBlurY !== undefined) scene.bgBlurY = target.bgBlurY;
    if (target.bindChildren !== undefined) scene.bindChildren = target.bindChildren;
    return scene;
  }

  private buildEffectState(): EffectState | null {
    return this.state.effect ?? null;
  }

  private buildTextboxState(): TextboxState {
    return this.state.textbox ?? { visible: true, frame: true };
  }

  private buildStaffrollState(): StaffrollState | null {
    if (!this.state.staffroll) return null;
    return {
      lines: this.state.staffroll.lines,
      face: this.state.staffroll.face,
      running: this.state.staffroll.running,
      height: this.state.staffroll.height,
      time: this.state.staffroll.time,
      elapsed: this.state.staffroll.elapsed,
      bgcolor: this.state.staffroll.bgcolor,
    };
  }

  private makeTransition(time: number, rule?: string): TransitionSpec {
    if (!rule || rule === "crossfade") {
      return time > 0 ? { method: "crossfade", time } : { method: "none" };
    }
    return { method: "universal", time, rule, vague: 32 };
  }

  private emitScene(transition: TransitionSpec): RenderEvent {
    this.sceneTransitionId += 1;
    return {
      kind: "scene",
      scene: this.buildSceneState("fore"),
      transition,
      transitionId: this.sceneTransitionId,
    };
  }

  private applyBg(instruction: Extract<Instruction, { kind: "bg" }>): { events: RenderEvent[]; stop?: StopReason } {
    const page = this.resolvePage("bg", instruction.page);
    const target = this.getPageState(page);
    // noclear=0 (défaut) : vide les calques de la page cible avant de poser le fond.
    if (!instruction.noclear) target.layers = [];
    target.background = instruction.storage;
    target.bgLeft = instruction.left;
    target.bgTop = instruction.top;
    // Un nouveau fond repart sans zoom ni rotation, sauf ceux de la commande (`zoom=`, `rotate=`).
    delete target.bgZoomX;
    delete target.bgZoomY;
    delete target.bgRotate;
    this.patchBgTransform(target, instruction);
    // Le moteur réinitialise effect/brightness/contrast/blur à chaque chargement d'image
    // (`@image` : « .effect = "" if .effect === void »…) : un @bg sans attribut d'apparence
    // efface donc ceux du fond précédent.
    delete target.bgType;
    delete target.bgEffect;
    delete target.bgBrightness;
    delete target.bgContrast;
    delete target.bgBlurX;
    delete target.bgBlurY;
    if (instruction.type !== undefined) target.bgType = instruction.type;
    if (instruction.effect !== undefined) target.bgEffect = instruction.effect;
    if (instruction.brightness !== undefined) target.bgBrightness = instruction.brightness;
    if (instruction.contrast !== undefined) target.bgContrast = instruction.contrast;
    if (instruction.blurx !== undefined) target.bgBlurX = instruction.blurx;
    if (instruction.blury !== undefined) target.bgBlurY = instruction.blury;

    // Trans implicite : @bg sans page explicite + time>0 → trans back→fore.
    // Pas de backlay : on a écrit directement sur back.
    if (!instruction.page && instruction.time && instruction.time > 0) {
      return this.runImplicitTrans(instruction.time, instruction.rule, instruction.nowait, instruction.canskip);
    }
    if (page === "back") return { events: [] };
    return { events: [this.emitScene(this.makeTransition(instruction.time ?? 0, instruction.rule))] };
  }

  /**
   * `@image` (KAG3 standard) : charge une image dans une couche d'une page, **sans transition**.
   * Tous les usages du corpus ciblent `layer=base` (fond de page, y compris dans les macros
   * système `first.ks`/`macro.ks` et les crédits `staffroll.ks`/`wik_fin.ks`) : on pose alors le
   * fond de la page cible sans vider les calques ni changer de page, exactement comme le moteur.
   * Un `layer=<numéro>` pose un sprite centré (approximation ; aucune occurrence dans le corpus).
   */
  private applyImage(instruction: Extract<Instruction, { kind: "image" }>): { events: RenderEvent[]; stop?: StopReason } {
    const page = this.resolvePage("image", instruction.page);
    const target = this.getPageState(page);
    if (instruction.layer === "base") {
      target.background = instruction.storage;
      target.bgLeft = instruction.left;
      target.bgTop = instruction.top;
      delete target.bgZoomX;
      delete target.bgZoomY;
      delete target.bgRotate;
      delete target.bgType;
      delete target.bgEffect;
      delete target.bgBrightness;
      delete target.bgContrast;
      delete target.bgBlurX;
      delete target.bgBlurY;
      if (instruction.type !== undefined) target.bgType = instruction.type;
      if (instruction.effect !== undefined) target.bgEffect = instruction.effect;
      if (instruction.brightness !== undefined) target.bgBrightness = instruction.brightness;
      if (instruction.contrast !== undefined) target.bgContrast = instruction.contrast;
      if (instruction.blurx !== undefined) target.bgBlurX = instruction.blurx;
      if (instruction.blury !== undefined) target.bgBlurY = instruction.blury;
      if (page === "back") return { events: [] };
      return { events: [this.emitScene({ method: "none" })] };
    }
    const id = `image:${instruction.layer}`;
    const layer: Layer = {
      id,
      storage: instruction.storage,
      center: instruction.left ?? 512,
      vcenter: instruction.top ?? 288,
      index: instruction.layer,
      opacity: instruction.opacity ?? 1,
    };
    clearAppearance(layer);
    patchAppearance(layer, instruction);
    target.layers = target.layers.filter((l) => l.id !== id);
    target.layers.push(layer);
    if (page === "back") return { events: [] };
    return { events: [this.emitScene({ method: "none" })] };
  }

  /**
   * Trans implicite back→fore (cas @bg/@partbg sans page + time>0).
   * fore = clone(back) ; back **conservé** (sémantique KAG exchange=false).
   * Bloque jusqu'à la fin du trans sauf si nowait.
   */
  private runImplicitTrans(time: number, rule: string | undefined, nowait?: boolean, canskip?: boolean): { events: RenderEvent[]; stop?: StopReason } {
    this.state.fore = { ...bgFieldsOf(this.state.back), layers: this.state.back.layers.slice() };
    const events: RenderEvent[] = [this.emitScene(this.makeTransition(time, rule))];
    if (nowait) return { events };
    return { events, stop: { kind: "waitFor", what: "transition", skippable: canskip ?? true } };
  }

  /**
   * Fin d'un `@fg`/`@chgfg`. Sans `page=`, une commande qui porte `time>0` fait sa propre
   * transition (§2 de `KAG_MAHOYO_SEMANTICS.md`, comme `@bg`/`@partbg`) : le calque posé sur
   * back est montré tout de suite. Sans cela, le personnage n'apparaissait qu'à la prochaine
   * transition, voire jamais dans la page. Sans `time`, le calque reste sur back jusqu'à un
   * `@trans` ou un `@bg` ; avec `page=back`, aussi.
   */
  private revealLayerChange(
    page: PageLayer,
    instruction: { page?: PageLayer; time?: number; rule?: string; nowait?: boolean; canskip?: boolean },
  ): { events: RenderEvent[]; stop?: StopReason } {
    if (!instruction.page && instruction.time && instruction.time > 0) {
      return this.runImplicitTrans(instruction.time, instruction.rule, instruction.nowait, instruction.canskip);
    }
    if (page === "back") return { events: [] };
    return { events: [this.emitScene({ method: "none" })] };
  }

  private applyFg(instruction: Extract<Instruction, { kind: "fg" }>): { events: RenderEvent[]; stop?: StopReason } {
    const page = this.resolvePage("fg", instruction.page);
    const target = this.getPageState(page);
    const id = instruction.id ?? instruction.storage;
    const layer: Layer = {
      id,
      storage: instruction.storage,
      center: instruction.center,
      vcenter: instruction.vcenter,
      index: instruction.index,
      opacity: instruction.opacity ?? 1,
      partbgId: instruction.partbgId,
    };
    patchTransform(layer, instruction);
    clearAppearance(layer);
    patchAppearance(layer, instruction);
    target.layers = target.layers.filter((l) => l.id !== id);
    target.layers.push(layer);
    return this.revealLayerChange(page, instruction);
  }

  /**
   * Zoom et rotation du fond (`zoom=`, `zoomx=`, `zoomy=`, `rotate=`) : le fond est placé en
   * (`left`, `top`) puis zoomé et tourné autour de son centre.
   */
  private patchBgTransform(target: PageState, patch: TransformValues): void {
    const values: { zoomx?: number; zoomy?: number; rotate?: number } = {};
    if (target.bgZoomX !== undefined) values.zoomx = target.bgZoomX;
    if (target.bgZoomY !== undefined) values.zoomy = target.bgZoomY;
    if (target.bgRotate !== undefined) values.rotate = target.bgRotate;
    patchTransform(values, patch);
    if (values.zoomx !== undefined) target.bgZoomX = values.zoomx;
    else delete target.bgZoomX;
    if (values.zoomy !== undefined) target.bgZoomY = values.zoomy;
    else delete target.bgZoomY;
    if (values.rotate !== undefined) target.bgRotate = values.rotate;
    else delete target.bgRotate;
  }

  /**
   * @bgact : animation du fond (panoramique, zoom, rotation). L'animation n'est pas rejouée :
   * on pose seulement la première keyframe (l'état de départ), sans toucher au fond, à ses
   * calques ni à ce que la keyframe ne précise pas. Avant, la commande était lue comme un
   * `@bg` sans position et réinitialisait le fond (recentré) et ses calques.
   */
  private applyBgact(instruction: Extract<Instruction, { kind: "bgact" }>): RenderEvent | null {
    const first = instruction.keyframes[0];
    const last = instruction.keyframes[instruction.keyframes.length - 1];
    if (!first || !last) return null;
    const page = this.resolvePage("bgact", instruction.page);
    const target = this.getPageState(page);
    if (!target.background) return null;
    // État runtime = **état final** de la piste (save/load en plein panoramique = état final, #317).
    if (last.left !== undefined && last.top !== undefined) {
      target.bgLeft = last.left;
      target.bgTop = last.top;
    }
    this.patchBgTransform(target, {
      zoomx: last.zoomx !== undefined ? last.zoomx * 100 : undefined,
      zoomy: last.zoomy !== undefined ? last.zoomy * 100 : undefined,
      rotate: last.rotate,
    });
    // Piste unifiée (#317) : une seule propriété `transform` pour la cible `bg`. La page back
    // prépare l'état ; la piste n'est émise que si le calque est visible (fore).
    if (page === "back") return null;
    return {
      kind: "track",
      track: {
        target: "bg",
        prop: "transform",
        duration: last.time,
        keyframes: instruction.keyframes.map((frame) => ({
          time: frame.time,
          ...(frame.left === undefined ? {} : { left: frame.left }),
          ...(frame.top === undefined ? {} : { top: frame.top }),
          ...(frame.zoomx === undefined ? {} : { zoomx: frame.zoomx * 100 }),
          ...(frame.zoomy === undefined ? {} : { zoomy: frame.zoomy * 100 }),
          ...(frame.rotate === undefined ? {} : { rotate: frame.rotate }),
        })),
      },
    };
  }

  private applyPartbg(instruction: Extract<Instruction, { kind: "partbg" }>): { events: RenderEvent[]; stop?: StopReason } {
    const page = this.resolvePage("partbg", instruction.page);
    const target = this.getPageState(page);
    const id = instruction.id ?? instruction.storage;
    // Le moteur n'efface jamais les autres partbg : chaque `@partbg` ajoute (ou remplace, même id)
    // SON calque ; la suppression passe explicitement par `@clpartbg` ou `@clall`. L'ancien
    // effacement des calques « crop » quand `noclear` était absent faisait disparaître les fenêtres
    // d'un montage (ex. `1-1.ks` page 11 : 5 fenêtres de pièces posées en `id=pb1..pb5` avec
    // `noclear=0`, qui doivent se cumuler) — issue #249.
    const crop = instruction.crop;
    const layer: Layer = {
      id,
      storage: instruction.storage,
      center: instruction.center,
      vcenter: instruction.vcenter,
      index: instruction.index,
      opacity: instruction.opacity ?? 1,
      crop,
    };
    clearAppearance(layer);
    patchAppearance(layer, instruction);
    target.layers = target.layers.filter((l) => l.id !== id);
    target.layers.push(layer);
    // bgstorage : remplace le fond de la page cible (doc §4).
    if (crop?.bgStorage) {
      target.background = crop.bgStorage;
    }
    // Trans implicite : @partbg sans page + time>0 → trans back→fore.
    if (!instruction.page && instruction.time && instruction.time > 0) {
      return this.runImplicitTrans(instruction.time, instruction.rule, instruction.nowait, instruction.canskip);
    }
    if (page === "back") return { events: [] };
    const transition = instruction.time && instruction.time > 0
      ? this.makeTransition(instruction.time, instruction.rule)
      : { method: "none" as const };
    return { events: [this.emitScene(transition)] };
  }

  private applyChgfg(instruction: Extract<Instruction, { kind: "chgfg" }>): { events: RenderEvent[]; stop?: StopReason } {
    const page = this.resolvePage("chgfg", instruction.page);
    const target = this.getPageState(page);
    // Moteur (fgplugin.tjs chgfg) : `.page = "back"` par défaut, et la **sélection** du calque se fait
    // sur la page opposée (`searchpage`) ; l'image est ensuite posée sur la page demandée. C'est ce qui
    // permet à un `@chgfg` sans `id` de conserver la position d'un personnage déjà affiché (au lieu de
    // créer un orphelin centré : cause du décalage du plan rapproché, #315).
    const searchPage = page === "back" ? "fore" : "back";
    const search = this.getPageState(searchPage);
    const prefix = /^([^0-9a-z]+)/.exec(instruction.storage)?.[1] ?? null;
    const sameCharacter = (layer: Layer): boolean =>
      prefix !== null && layer.visible !== false && layer.storage.startsWith(prefix);

    const matches = (layers: readonly Layer[]): Layer | undefined => {
      if (instruction.id !== undefined) {
        return layers.find((layer) => layer.id === instruction.id);
      }
      // Ponctuation exacte sur l'id (historique du port) puis même personnage (moteur).
      return layers.find((layer) => layer.id === instruction.storage) ?? layers.find(sameCharacter);
    };

    let source = matches(target.layers) ?? matches(search.layers);
    let created = false;
    if (!source) {
      // Calque inexistant : repli tolérant du port (le moteur lèverait une exception), centré ou à
      // la position explicitement demandée.
      source = {
        id: instruction.id ?? instruction.storage,
        storage: instruction.storage,
        center: instruction.center ?? 512,
        vcenter: instruction.vcenter ?? 288,
        index: instruction.index ?? 1,
        opacity: 1,
      };
      created = true;
    }

    const changed: Layer = {
      ...source,
      storage: instruction.storage,
      id: instruction.id ?? source.id,
      ...(instruction.center === undefined ? {} : { center: instruction.center }),
      ...(instruction.vcenter === undefined ? {} : { vcenter: instruction.vcenter }),
      ...(instruction.index === undefined ? {} : { index: instruction.index }),
      // Conserve crop/partbgId/apparence du calque source (même personnage, autre image).
    };
    patchTransform(changed, instruction);
    // `@chgfg` change l'image mais conserve position/z/opacité : les attributs d'apparence
    // ne sont remplacés que s'ils sont précisés.
    patchAppearance(changed, instruction);

    if (created) {
      clearAppearance(changed);
      target.layers.push(changed);
    } else {
      // Le calque source peut être sur la page opposée : on le copie sur la page cible au même id.
      const idx = target.layers.findIndex((layer) => layer.id === changed.id);
      if (idx >= 0) target.layers[idx] = changed;
      else target.layers.push(changed);
    }
    return this.revealLayerChange(page, instruction);
  }

  /**
   * `@infg` (fgplugin.tjs) : apparition animée — le calque est posé à (final − mx, final − my) avec
   * opacité 0, puis rejoint sa position finale avec l'opacité demandée. Approximation : le calque
   * est posé directement sur la page affichée (fore), sans @trans implicite, et l'animation n'est
   * pas bloquante (comme les autres animations du port).
   */
  private applyInfg(instruction: Extract<Instruction, { kind: "infg" }>): RenderEvent[] {
    const transform: Partial<AnimKeyframe> = {};
    if (instruction.zoomx !== undefined) transform.zoomx = instruction.zoomx / 100;
    if (instruction.zoomy !== undefined) transform.zoomy = instruction.zoomy / 100;
    if (instruction.rotate !== undefined) transform.rotate = instruction.rotate;
    const appearance: Partial<AnimKeyframe> = {};
    if (instruction.type !== undefined) appearance.type = instruction.type;
    if (instruction.effect !== undefined) appearance.effect = instruction.effect;
    if (instruction.brightness !== undefined) appearance.brightness = instruction.brightness;
    if (instruction.contrast !== undefined) appearance.contrast = instruction.contrast;
    if (instruction.blurx !== undefined) appearance.blurx = instruction.blurx;
    if (instruction.blury !== undefined) appearance.blury = instruction.blury;
    const first: AnimKeyframe = {
      time: 0,
      duration: 0,
      interp: "l",
      easing: "linear",
      accel: 0,
      center: instruction.center - instruction.mx,
      vcenter: instruction.vcenter - instruction.my,
      opacity: 0,
      ...transform,
      ...appearance,
    };
    const last: AnimKeyframe = {
      time: instruction.time,
      duration: instruction.time,
      interp: "l",
      easing: "linear",
      accel: instruction.accel,
      center: instruction.center,
      vcenter: instruction.vcenter,
      opacity: instruction.opacity,
      ...(instruction.index === undefined ? {} : { absolute: instruction.index }),
      ...transform,
      ...appearance,
    };
    return this.applyAnimate({
      kind: "animate",
      def: { storage: instruction.storage, id: instruction.id ?? instruction.storage, isMove: true, page: "fore", keyframes: [first, last] },
    });
  }

  /**
   * `@outfg` (fgplugin.tjs) : le calque courant glisse de (mx, my) et son opacité tombe à 0.
   * Le calque n'est pas retiré (un @clfg/@clall s'en charge), comme dans le moteur.
   */
  private applyOutfg(instruction: Extract<Instruction, { kind: "outfg" }>): RenderEvent[] {
    const key = instruction.id ?? instruction.storage ?? "";
    const existing =
      this.state.fore.layers.find((layer) => layer.id === key) ??
      (instruction.storage ? this.state.fore.layers.find((layer) => layer.storage === instruction.storage) : undefined);
    if (!existing) {
      this.onWarning(`outfg : calque introuvable (${key})`);
      return [];
    }
    const transform: Partial<AnimKeyframe> = {};
    if (existing.zoomx !== undefined) transform.zoomx = existing.zoomx / 100;
    if (existing.zoomy !== undefined) transform.zoomy = existing.zoomy / 100;
    if (existing.rotate !== undefined) transform.rotate = existing.rotate;
    const first: AnimKeyframe = {
      time: 0,
      duration: 0,
      interp: "l",
      easing: "linear",
      accel: 0,
      center: existing.center,
      vcenter: existing.vcenter,
      opacity: existing.opacity,
      ...transform,
    };
    const last: AnimKeyframe = {
      time: instruction.time,
      duration: instruction.time,
      interp: "l",
      easing: "linear",
      accel: instruction.accel,
      center: existing.center + instruction.mx,
      vcenter: existing.vcenter + instruction.my,
      opacity: 0,
      ...transform,
    };
    return this.applyAnimate({
      kind: "animate",
      def: { storage: existing.storage, id: existing.id, isMove: true, page: "fore", keyframes: [first, last] },
    });
  }

  /**
   * `@layopt` (KAG3) : options d'un calque existant (`center`/`vcenter`, `opacity`, `visible`).
   * Approximation : `left`/`top` sont lus comme `center`/`vcenter` (le port ne modélise pas le coin
   * haut-gauche) ; les calques de message (`layer=message0`…) ne sont pas modélisés (no-op, la
   * textbox reste pilotée par `@texton`/`@textoff`).
   */
  private applyLayopt(instruction: Extract<Instruction, { kind: "layopt" }>): RenderEvent | null {
    const page = instruction.page ?? "fore";
    const target = this.getPageState(page);
    const key = instruction.id ?? instruction.storage ?? instruction.layer ?? "";
    if (key === "") return null;
    const index = target.layers.findIndex(
      (layer) => layer.id === key || (instruction.storage !== undefined && layer.storage === instruction.storage),
    );
    if (index < 0) return null;
    const layer: Layer = { ...target.layers[index]! };
    if (instruction.center !== undefined) layer.center = instruction.center;
    if (instruction.vcenter !== undefined) layer.vcenter = instruction.vcenter;
    if (instruction.opacity !== undefined) layer.opacity = Math.min(1, Math.max(0, instruction.opacity));
    if (instruction.visible !== undefined) layer.visible = instruction.visible;
    target.layers[index] = layer;
    if (page === "back") return null;
    return this.emitScene({ method: "none" });
  }

  /**
   * `@chgpartbg` : change l'image/les paramètres d'un partbg **existant**
   * (`data/scenario/partbgplugin.tjs`, `kt.chgpartbg`).
   *
   * Cible : `id=` si fourni ; sinon l'unique partbg de la page ; sinon le partbg dont le `storage`
   * partage le plus long préfixe avec le nouveau (comme le moteur). Aucune cible = no-op.
   * `time=`/`rule=` déclenchent la transition back→fore (le moteur appelle `partbg_object.doTrans`).
   */
  private applyChgpartbg(
    instruction: Extract<Instruction, { kind: "chgpartbg" }>,
  ): { events: RenderEvent[]; stop?: StopReason } {
    const page = this.resolvePage("chgpartbg", instruction.page);
    const target = this.getPageState(page);
    const partbgs = target.layers.filter((l) => l.crop !== undefined);
    let selected: Layer | undefined;
    if (instruction.id !== undefined) selected = partbgs.find((l) => l.id === instruction.id);
    if (!selected && partbgs.length === 1) selected = partbgs[0];
    if (!selected && partbgs.length > 1 && instruction.storage) {
      let best = -1;
      for (const layer of partbgs) {
        let common = 0;
        while (common < layer.storage.length && common < instruction.storage.length && layer.storage[common] === instruction.storage[common]) common++;
        if (common > best) {
          best = common;
          selected = layer;
        }
      }
    }
    if (!selected) return { events: [] };
    const updated: Layer = { ...selected };
    if (instruction.storage !== undefined && instruction.storage !== "") updated.storage = instruction.storage;
    patchTransform(updated, instruction);
    patchAppearance(updated, instruction);
    target.layers = target.layers.map((l) => (l.id === updated.id ? updated : l));

    const time = instruction.time ?? 0;
    if (time > 0 || instruction.rule) {
      return this.runImplicitTrans(time, instruction.rule, instruction.nowait, instruction.canskip);
    }
    if (page === "fore") return { events: [this.emitScene({ method: "none" })] };
    return { events: [] };
  }

  /**
   * `@dispclock` : horloge in-game (`data/scenario/macro.tjs`, `tagHandlers.dispclock`).
   * Le moteur pose 4 calques (2 aiguilles réelles + 2 ombres `mono000000` floues) sur la page
   * arrière, puis charge le fond d'horloge avec `time` (transition).
   */
  private applyDispclock(
    instruction: Extract<Instruction, { kind: "dispclock" }>,
  ): { events: RenderEvent[]; stop?: StopReason } {
    const { h, m, left, top, zoomx, zoomy } = instruction;
    this.state.clockHour = h;
    this.state.clockMinute = m;
    // `time=0` : mise à jour immédiate de la page **affichée** (fore) ; le fond et les aiguilles y
    // sont posés ensemble, sans transition. `time>0` conserve le comportement moteur : calques sur
    // back puis transition back→fore déclenchée par le `@bg` (#297).
    const transition = (instruction.time ?? 0) > 0;
    const targetPage: PageLayer = transition ? "back" : "fore";
    const mirror = zoomx < 0;
    const angles = clockHandAngles(h, m, mirror);
    const ratex = zoomx / 100;
    const ratey = zoomy / 100;
    const hands: Array<Extract<Instruction, { kind: "fg" }>> = [
      {
        kind: "fg",
        storage: CLOCK_HOUR_HAND,
        center: left + 1748,
        vcenter: top + 1050,
        index: 1200,
        opacity: 1,
        page: targetPage,
        id: "clock1",
        zoomx,
        zoomy,
        rotate: angles.hour,
        afx: 69,
        afy: 621,
        effect: instruction.effect,
      },
      {
        kind: "fg",
        storage: CLOCK_MINUTE_HAND,
        center: left + 1750,
        vcenter: top + 954,
        index: 1300,
        opacity: 1,
        page: targetPage,
        id: "clock2",
        zoomx,
        zoomy,
        rotate: angles.minute,
        afx: 62,
        afy: 817,
        effect: instruction.effect,
      },
      {
        kind: "fg",
        storage: CLOCK_HOUR_HAND,
        center: left + 1748 + ratex * 9,
        vcenter: top + 1050 + ratey * 13,
        index: 1000,
        opacity: 64 / 255,
        page: targetPage,
        id: "clock3",
        zoomx,
        zoomy,
        rotate: angles.hour,
        afx: 69,
        afy: 621,
        blurx: 2,
        blury: 2,
        effect: "mono000000",
      },
      {
        kind: "fg",
        storage: CLOCK_MINUTE_HAND,
        center: left + 1750 + ratex * 9,
        vcenter: top + 954 + ratey * 13,
        index: 1100,
        opacity: 64 / 255,
        page: targetPage,
        id: "clock4",
        zoomx,
        zoomy,
        rotate: angles.minute,
        afx: 62,
        afy: 817,
        blurx: 2,
        blury: 2,
        effect: "mono000000",
      },
    ];
    const events: RenderEvent[] = [];
    for (const hand of hands) {
      const res = this.applyFg(hand);
      events.push(...res.events);
    }
    // Fond d'horloge : avec `time>0`, le moteur fait une transition back→fore (le port fait de même) ;
    // avec `time=0`, le fond est posé directement sur la page affichée (fore).
    const bgInstruction: Extract<Instruction, { kind: "bg" }> = {
      kind: "bg",
      storage: CLOCK_BG_STORAGE,
      noclear: true,
      left,
      top,
      zoomx,
      zoomy,
      effect: instruction.effect,
      time: instruction.time ?? 0,
      ...(transition ? {} : { page: "fore" as const }),
    };
    const bg = this.applyBg(bgInstruction);
    events.push(...bg.events);
    return { events, stop: bg.stop };
  }

  /**
   * `@tickclock` : avance les aiguilles (`data/scenario/macro.tjs`, `tagHandlers.tickclock`).
   * Le moteur lance 4 `fgact` de 300 ms (repos → léger dépassement à 100 ms → nouvel angle),
   * puis attend leur fin sauf attribut `wait`.
   */
  private applyTickclock(
    instruction: Extract<Instruction, { kind: "tickclock" }>,
  ): { events: RenderEvent[]; stop?: StopReason } {
    const lastHour = this.state.clockHour;
    const lastMinute = this.state.clockMinute;
    if (lastHour === undefined || lastMinute === undefined) return { events: [] };
    const h = ((instruction.h % 12) + 12) % 12;
    const m = ((instruction.m % 60) + 60) % 60;
    // Le moteur ajoute 12 h / 60 min quand l'aiguille recule, pour tourner dans le bon sens.
    const newHourAngle = (m + (h + (h < lastHour ? 12 : 0)) * 60) * 0.5;
    const newMinuteAngle = (m + (m < lastMinute ? 60 : 0)) * 6;
    const oldHourAngle = (lastMinute + lastHour * 60) * 0.5;
    const oldMinuteAngle = lastMinute * 6;
    const over = 0.3;
    const overHourAngle = newHourAngle + (newHourAngle - oldHourAngle) * over;
    const overMinuteAngle = newMinuteAngle + (newMinuteAngle - oldMinuteAngle) * over;
    this.state.clockHour = instruction.h;
    this.state.clockMinute = instruction.m;

    const kf = (time: number, duration: number, rotate: number) => ({
      time,
      duration,
      interp: "l" as const,
      easing: "linear",
      accel: 0,
      rotate,
    });
    const defs: AnimationDef[] = [
      {
        storage: CLOCK_HOUR_HAND,
        page: "fore",
        id: "clock1",
        keyframes: [kf(0, 0, oldHourAngle), kf(100, 100, overHourAngle), kf(300, 200, newHourAngle)],
      },
      {
        storage: CLOCK_MINUTE_HAND,
        page: "fore",
        id: "clock2",
        keyframes: [kf(0, 0, oldMinuteAngle), kf(100, 100, overMinuteAngle), kf(300, 200, newMinuteAngle)],
      },
      {
        storage: CLOCK_HOUR_HAND,
        page: "fore",
        id: "clock3",
        keyframes: [kf(0, 0, oldHourAngle), kf(100, 100, overHourAngle), kf(300, 200, newHourAngle)],
      },
      {
        storage: CLOCK_MINUTE_HAND,
        page: "fore",
        id: "clock4",
        keyframes: [kf(0, 0, oldMinuteAngle), kf(100, 100, overMinuteAngle), kf(300, 200, newMinuteAngle)],
      },
    ];
    const events: RenderEvent[] = [];
    for (const def of defs) {
      events.push(...this.applyAnimate({ kind: "animate", def }));
    }
    if (instruction.wait) {
      return { events, stop: { kind: "waitFor", what: "animation", skippable: true } };
    }
    return { events };
  }

  /** Applique l'action continue des messages (`@setdefaultmessageaction` / reset). */
  private applyTextAction(type: string | null): RenderEvent {
    const state: TextboxState = { ...this.buildTextboxState() };
    if (type === null || type === "") delete state.action;
    else state.action = type;
    this.state.textbox = state;
    return { kind: "textbox", state, time: 0 };
  }

  /**
   * Calque ciblé par une commande d'action (`@action`, `@removeaction`, `@pauseaction`,
   * `@resumeaction`). `page` donnée → cette page ; sinon `fore` (défaut moteur de `@action`/
   * `@pauseaction`) ou les deux pages pour `@removeaction`.
   */
  private findActionLayer(
    page: PageLayer | undefined,
    id: string | undefined,
    storage: string | undefined,
    defaultPage: "fore" | "both",
  ): { layer: Layer; page: PageLayer } | null {
    const pages: PageLayer[] = page ? [page] : defaultPage === "both" ? ["back", "fore"] : ["fore"];
    const key = id ?? storage;
    for (const target of pages) {
      const layers = this.getPageState(target).layers;
      const layer = key !== undefined ? layers.find((l) => l.id === key || l.storage === key) : undefined;
      if (layer) return { layer, page: target };
    }
    return null;
  }

  /**
   * `@action` (KAG3 + `override/action.tjs`) : action animée sur un calque.
   *
   * Seul `LayerNormalMoveModule` a une sémantique complète : translation `startx→x` / `starty→y`
   * sur `time`, avec `delay`. Les autres modules sont approximés en translation linéaire (écart
   * documenté, registre #296). Pour un partbg, les coordonnées moteur `left/top` sont converties
   * en centre du wrapper (`+ width/2`, `+ height/2`). `nonstop=0` arrête l'action en cours.
   */
  private applyAction(
    instruction: Extract<Instruction, { kind: "action" }>,
  ): { events: RenderEvent[]; stop?: StopReason } {
    const found = this.findActionLayer(instruction.page, instruction.id, instruction.storage, "fore");
    if (!found) return { events: [] };
    const { layer, page } = found;
    const crop = layer.crop;
    const dx = crop ? crop.width / 2 : 0;
    const dy = crop ? crop.height / 2 : 0;
    const startCenter = instruction.startx !== undefined ? instruction.startx + dx : layer.center;
    const startVcenter = instruction.starty !== undefined ? instruction.starty + dy : layer.vcenter;
    const endCenter = instruction.x !== undefined ? instruction.x + dx : startCenter;
    const endVcenter = instruction.y !== undefined ? instruction.y + dy : startVcenter;
    const time = Math.max(0, instruction.time);
    const delay = Math.max(0, instruction.delay ?? 0);
    const kf = (at: number, duration: number, center: number, vcenter: number): AnimKeyframe => ({
      time: at,
      duration,
      interp: "l",
      easing: "linear",
      accel: 0,
      center,
      vcenter,
    });
    const keyframes: AnimKeyframe[] = [kf(0, 0, startCenter, startVcenter)];
    if (delay > 0) keyframes.push(kf(delay, delay, startCenter, startVcenter));
    keyframes.push(kf(delay + time, time, endCenter, endVcenter));
    const def: AnimationDef = { storage: layer.storage, page, id: layer.id, keyframes };
    const events: RenderEvent[] = [];
    // Moteur : sans `nonstop`, l'action en cours sur la cible est d'abord arrêtée.
    if (!instruction.nonstop) events.push({ kind: "stopAnimation", target: layer.id });
    events.push(...this.applyAnimate({ kind: "animate", def }));
    return { events };
  }

  /** `@removeaction` (tagex.tjs) : annule les actions en conservant l'état courant. */
  private applyRemoveaction(instruction: Extract<Instruction, { kind: "removeaction" }>): RenderEvent[] {
    const key = instruction.id ?? instruction.storage;
    if (key === undefined) return [{ kind: "stopAnimation" }];
    const found = this.findActionLayer(instruction.page, instruction.id, instruction.storage, "both");
    return found ? [{ kind: "stopAnimation", target: found.layer.id }] : [];
  }

  /** `@pauseaction` / `@resumeaction` (tagex.tjs) : suspend ou relance les animations. */
  private applyPauseAction(
    instruction: Extract<Instruction, { kind: "pauseaction" | "resumeaction" }>,
  ): RenderEvent[] {
    const isPause = instruction.kind === "pauseaction";
    const all = instruction.kind === "pauseaction" && instruction.all;
    const key = instruction.id ?? instruction.storage;
    if (!all && key !== undefined) {
      const found = this.findActionLayer(instruction.page, instruction.id, instruction.storage, "fore");
      if (!found) return [];
      return [{ kind: isPause ? "pauseAnimation" : "resumeAnimation", target: found.layer.id }];
    }
    return [{ kind: isPause ? "pauseAnimation" : "resumeAnimation" }];
  }

  /**
   * `@pauseploy` (tagex.tjs) : termine la bulle « ploy » en cours, mémorise son état pour
   * `@resumeploy`, et retombe sur la police par défaut (`deffont ＭＳ Ｐゴシック` + `resetfont`
   * dans le moteur ; approximation : style de texte réinitialisé, registre #296).
   */
  private applyPausePloys(instruction: Extract<Instruction, { kind: "pauseploy" | "resumeploy" }>): RenderEvent[] {
    if (instruction.kind === "pauseploy") {
      this.state.ployPaused = this.state.ploy ? { ...this.state.ploy } : null;
      this.state.ploy = null;
      this.state.textStyle = null;
      return [{ kind: "ploy", ploy: null }];
    }
    const paused = this.state.ployPaused;
    this.state.ployPaused = null;
    if (!paused) return [];
    this.state.ploy = { ...paused };
    return [{ kind: "ploy", ploy: { ...paused } }];
  }

  /**
   * `@beginfallnote`/`@fallnoteopt`/`@endfallnote` (fallnoteplugin.tjs) : approximation de la
   * pluie de notes (particules CSS génériques ; seules `rate` et la durée du plugin sont
   * reproduites — registre #296, `fallnote-particles`). État transitoire, non sauvegardé.
   */
  private applyFallnote(instruction: Extract<Instruction, { kind: "beginfallnote" | "fallnoteopt" | "endfallnote" }>): RenderEvent[] {
    if (instruction.kind === "endfallnote") {
      this.state.fallnote = null;
      return [{ kind: "fallnote", active: false }];
    }
    const current = this.state.fallnote ?? { active: true, rate: 1 };
    const rate = instruction.kind === "fallnoteopt" ? (instruction.rate ?? current.rate) : current.rate;
    this.state.fallnote = { active: true, rate };
    return [{ kind: "fallnote", active: true, rate }];
  }

  private applyAnimate(instruction: Extract<Instruction, { kind: "animate" }>): RenderEvent[] {
    const def = instruction.def;
    const events: RenderEvent[] = [];

    // 1. Résoudre la page cible : @movefg/@movepartbg → fore, sinon back par défaut.
    const page = def.isMove
      ? this.resolvePage("movefg", def.page)
      : this.resolvePage(def.isPartbg ? "partbgact" : "fgact", def.page);
    const target = this.getPageState(page);

    const lastFrame = def.keyframes[def.keyframes.length - 1];
    const firstFrame = def.keyframes[0];

    // 2. Trouver le calque existant (dans la page cible, puis dans fore en fallback).
    const storage = def.storage || firstFrame?.storage || lastFrame?.storage || "";
    const searchId = def.id || storage;
    let existing = target.layers.find((l) => l.id === searchId);
    if (!existing && page === "back") {
      existing = this.state.fore.layers.find((l) => l.id === searchId);
    }
    // Pour un partbgact sans id, chercher par storage + crop.
    if (!existing && def.isPartbg && !def.id) {
      existing = target.layers.find((l) => l.storage === storage && l.crop);
      if (!existing && page === "back") {
        existing = this.state.fore.layers.find((l) => l.storage === storage && l.crop);
      }
    }

    // 3. Déterminer l'id réel du calque cible.
    const realId = existing?.id || def.id || storage;

    // 4. ⚠️ CAPTURER l'état de départ de `existing` AVANT toute écriture.
    //    `applyTrans` fait une copie superficielle de back.layers (slice), donc
    //    `existing` peut être partagé entre fore et back. Si on écrit sur back
    //    (étape 6), on modifierait `existing` avant l'étape 5.
    const startOpacity = existing?.opacity;
    const startCenter = existing?.center;
    const startVcenter = existing?.vcenter;

    // 5. Keyframe 0 : compléter les props manquantes depuis l'état initial capturé (copie, pas mutation).
    const enrichedDef = { ...def, id: realId };
    if (startOpacity !== undefined || startCenter !== undefined || startVcenter !== undefined) {
      enrichedDef.keyframes = def.keyframes.map((kf, i) => {
        if (i !== 0) return kf;
        const enriched: Record<string, unknown> = { ...kf };
        if (enriched.center === undefined && startCenter !== undefined) enriched.center = startCenter;
        if (enriched.vcenter === undefined && startVcenter !== undefined) enriched.vcenter = startVcenter;
        if (enriched.opacity === undefined && startOpacity !== undefined) enriched.opacity = startOpacity;
        return enriched as typeof kf;
      });
    }

    // 6. Fusionner : garder crop, partbgId, index existants ; appliquer les props finales.
    const zFromFrame = lastFrame?.absolute ?? firstFrame?.absolute;
    const merged: Layer = {
      id: realId,
      storage: lastFrame?.storage || firstFrame?.storage || existing?.storage || storage,
      center: lastFrame?.center ?? firstFrame?.center ?? existing?.center ?? 512,
      vcenter: lastFrame?.vcenter ?? firstFrame?.vcenter ?? existing?.vcenter ?? 288,
      index: zFromFrame ?? existing?.index ?? 1,
      opacity: lastFrame?.opacity ?? firstFrame?.opacity ?? existing?.opacity ?? 1,
      crop: existing?.crop,
      partbgId: existing?.partbgId,
      // Pivot du zoom/rotation (aiguilles d'horloge) : conservé pendant les animations.
      afx: existing?.afx,
      afy: existing?.afy,
    };
    // Apparence : `-type`/`-effect`/`-contrast`/`-brightness`/`-xblur`/`-yblur` sont discrets,
    // leur dernière valeur connue devient l'apparence finale du calque.
    clearAppearance(merged);
    patchAppearance(merged, {
      type: lastFrame?.type !== undefined ? Number(lastFrame.type) : firstFrame?.type !== undefined ? Number(firstFrame.type) : existing?.type,
      effect: lastFrame?.effect ?? firstFrame?.effect ?? existing?.effect,
      contrast: lastFrame?.contrast ?? firstFrame?.contrast ?? existing?.contrast,
      brightness: lastFrame?.brightness ?? firstFrame?.brightness ?? existing?.brightness,
      blurx: lastFrame?.blurx ?? firstFrame?.blurx ?? existing?.blurx,
      blury: lastFrame?.blury ?? firstFrame?.blury ?? existing?.blury,
    });

    // Zoom et rotation : ceux de la dernière keyframe, sinon ceux du calque existant.
    const endTransform: TransformValues = {
      zoomx: existing?.zoomx,
      zoomy: existing?.zoomy,
      rotate: existing?.rotate,
    };
    if (lastFrame?.zoomx !== undefined) endTransform.zoomx = lastFrame.zoomx * 100;
    if (lastFrame?.zoomy !== undefined) endTransform.zoomy = lastFrame.zoomy * 100;
    if (lastFrame?.rotate !== undefined) endTransform.rotate = lastFrame.rotate;
    patchTransform(merged, endTransform);

    // Reporter les src* de la dernière keyframe dans le crop (partbg).
    if (merged.crop && (lastFrame?.srcleft !== undefined || lastFrame?.srctop !== undefined || lastFrame?.srczoomx !== undefined)) {
      merged.crop = {
        ...merged.crop,
        srcLeft: lastFrame?.srcleft ?? merged.crop.srcLeft,
        srcTop: lastFrame?.srctop ?? merged.crop.srcTop,
        srcZoomX: lastFrame?.srczoomx ?? merged.crop.srcZoomX,
        srcZoomY: lastFrame?.srczoomy ?? merged.crop.srcZoomY,
      };
    }

    // Remplacer ou ajouter le calque dans la page cible.
    const idx = target.layers.findIndex((l) => l.id === realId);
    if (idx >= 0) {
      target.layers[idx] = merged;
    } else {
      target.layers.push(merged);
    }

    // 7. @movefg : appliquer aussi l'état final au calque homonyme sur back.
    //    ⚠️ Ne PAS utiliser Object.assign : back et fore peuvent partager le
    //    même objet Layer après un @trans (copy superficielle via slice).
    //    On remplace par un nouvel objet.
    if (def.isMove) {
      const backIdx = this.state.back.layers.findIndex((l) => l.id === realId);
      if (backIdx >= 0) {
        const oldBack = this.state.back.layers[backIdx];
        this.state.back.layers[backIdx] = {
          ...oldBack,
          center: merged.center,
          vcenter: merged.vcenter,
          opacity: merged.opacity,
          index: merged.index,
        };
      }
    }

    // (#317) Une animation de calque sur la page affichée ne ré-émet PAS de scène : elle ne doit
    // jamais terminer la transition de fond en cours. L'événement `animate` porte l'animation.
    events.push({ kind: "animate", target: realId, def: enrichedDef });
    return events;
  }

  private applyClall(instruction: Extract<Instruction, { kind: "clall" }>): RenderEvent | null {
    const page = this.resolvePage("clall", instruction.page);
    const target = this.getPageState(page);
    target.layers = [];
    if (page === "back") return null;
    return this.emitScene({ method: "none" });
  }

  private applyClfg(instruction: Extract<Instruction, { kind: "clfg" }>): RenderEvent | null {
    const page = this.resolvePage("clfg", instruction.page);
    const target = this.getPageState(page);
    if (instruction.id) {
      target.layers = target.layers.filter((l) => l.id !== instruction.id);
    } else if (instruction.storage) {
      target.layers = target.layers.filter((l) => l.storage !== instruction.storage);
    } else if (instruction.index !== undefined) {
      target.layers = target.layers.filter((l) => l.index !== instruction.index);
    }
    if (page === "back") return null;
    return this.emitScene({ method: "none" });
  }

  private applyBacklay(instruction: Extract<Instruction, { kind: "backlay" }>): RenderEvent[] {
    const storage = instruction.storage;
    if (!storage || storage === "fg") {
      this.state.back.layers = this.state.fore.layers.slice();
    }
    if (!storage || storage === "bg") {
      const { layers: backLayers } = this.state.back;
      this.state.back = { ...bgFieldsOf(this.state.fore), layers: backLayers };
    }
    return [];
  }

  /** Copie fore → back (backlay) : le moteur l'exécute en fin de transition bloquante ou à `@wt`. */
  private backlayFromFore(): void {
    const backLayers = this.state.fore.layers.slice();
    this.state.back = { ...bgFieldsOf(this.state.fore), layers: backLayers };
  }

  /**
   * `@trans` explicite (#253, sémantique `override/tagex.tjs`) :
   * - `exchange=true` par défaut : à la fin du fondu, **fore et back sont échangés** ;
   * - transition **bloquante** : le `@wt` automatique du moteur fait ensuite un **backlay**
   *   (fore→back) sauf `noback=1` ; l'état final est appliqué ici immédiatement (les commandes
   *   suivantes ne s'exécutent qu'après l'attente) ;
   * - transition **`nowait=1`** : pas de `@wt` automatique, donc `back` contient **l'ancien
   *   affichage** ; un `@wt` ultérieur fera le backlay (sauf `noback=1`) — la permutation est
   *   appliquée immédiatement (approximation d'ordonnancement documentée §2) ;
   * - `exchange=0` : comportement historique du port (`fore = clone(back)`, back conservé).
   */
  private applyTrans(instruction: Extract<Instruction, { kind: "trans" }>): { events: RenderEvent[]; stop?: StopReason } {
    const blocking = !instruction.nowait;
    const exchange = instruction.exchange !== false;
    if (exchange) {
      const oldFore = this.state.fore;
      const prepared = this.state.back;
      this.state.fore = { ...bgFieldsOf(prepared), layers: prepared.layers.slice() };
      this.state.back = oldFore;
      if (blocking) {
        // Le moteur insère un @wt automatique (noback transmis depuis @trans).
        if (!instruction.noback) this.backlayFromFore();
        this.state.transitionBacklayPending = false;
      } else {
        // nowait : pas de backlay automatique ; un @wt ultérieur le fera (sauf noback=1).
        this.state.transitionBacklayPending = true;
      }
    } else {
      // exchange=false : historique du port — fore = clone(back), back conservé.
      this.state.fore = { ...bgFieldsOf(this.state.back), layers: this.state.back.layers.slice() };
      this.state.transitionBacklayPending = blocking ? false : true;
    }
    const events: RenderEvent[] = [this.emitScene(this.makeTransition(instruction.time, instruction.rule))];
    if (!blocking) return { events };
    return { events, stop: { kind: "waitFor", what: "transition", skippable: instruction.canskip ?? true } };
  }

  private buildAudioEvent(action: AudioEvent["kind"], channel: AudioChannel, args: Omit<AudioEvent & { kind: typeof action }, "kind" | "channel">): AudioEvent {
    return { kind: action, channel, ...args } as AudioEvent;
  }

  /**
   * @playtimeline : rejoue une timeline d'animation sous forme de calendrier.
   *
   * Sont repris les fonds (fondus enchaînés ou coupes), leurs panoramiques (`bgMove`, avec
   * accélération, zoom et rotation), les calques (`timelineLayer`) et les pistes audio ; pas
   * les effets (brume, tremblement, balancement : avertissement). Les événements
   * sont construits ici, une fois pour toutes, et l'état du runtime reçoit tout de
   * suite le résultat final : le player les rejoue à leur instant, ou d'un coup si le
   * joueur saute la séquence. Sans timeline connue, la commande est sans effet.
   */
  private applyPlaytimeline(instruction: Extract<Instruction, { kind: "playtimeline" }>): { events: RenderEvent[]; stop?: StopReason } {
    const scene = lookupTimeline(this.timelines, this.context.scriptName, instruction.scene);
    if (!scene) {
      this.onWarning(`timeline introuvable : ${this.context.scriptName} scène ${instruction.scene}`);
      return { events: [] };
    }

    const entries: { at: number; order: number; events: RenderEvent[] }[] = [];
    let order = 0;
    this.lastTimelineSeChannel = null;

    // Si le fond a un zoom ou une rotation quelque part, chaque plan les (re)pose explicitement.
    const bgTransformed = scene.bg.some((b) => b.zoomx !== undefined || b.zoomy !== undefined || b.rotate !== undefined);
    let previous: TimelineBg | undefined;
    for (const bg of scene.bg) {
      // Deux fonds identiques de suite (même image, position, zoom et rotation) : un seul changement.
      if (
        previous &&
        bg.storage === previous.storage &&
        bg.left === previous.left &&
        bg.top === previous.top &&
        bg.zoomx === previous.zoomx &&
        bg.zoomy === previous.zoomy &&
        bg.rotate === previous.rotate
      )
        continue;
      previous = bg;
      const fade = bg.fade ?? (bg.at === 0 ? 0 : TIMELINE_FADE_MS);
      const res = this.applyBg({
        kind: "bg",
        storage: bg.storage,
        time: fade,
        page: "fore",
        noclear: true,
        nowait: true,
        left: bg.left,
        top: bg.top,
      });
      const events = res.events;
      if (bgTransformed && bg.left !== undefined && bg.top !== undefined) {
        // Piste unifiée (#317) : même modèle que @bgact, durée 0 = état final immédiat.
        events.push({
          kind: "track",
          track: {
            target: "bg",
            prop: "transform",
            duration: 0,
            keyframes: [
              {
                time: 0,
                left: bg.left,
                top: bg.top,
                zoomx: bg.zoomx ?? 100,
                zoomy: bg.zoomy ?? 100,
                rotate: bg.rotate ?? 0,
              },
            ],
          },
        });
      }
      entries.push({ at: bg.at, order: order++, events });
    }

    // Panoramiques : chacun déplace le fond affiché à son instant. L'état final reçoit
    // la position atteinte par le dernier panoramique du dernier fond.
    const lastBgAt = previous?.at ?? 0;
    for (const m of scene.moves ?? []) {
      // Piste unifiée (#317) : un panoramique de timeline est une piste `bg` multi-keyframes,
      // exactement comme `@bgact` — plus de `bgMove` ad hoc côté renderer.
      const fromLeft = this.state.fore.bgLeft ?? m.left;
      const fromTop = this.state.fore.bgTop ?? m.top;
      const fromZoomX = this.state.fore.bgZoomX ?? 100;
      const fromZoomY = this.state.fore.bgZoomY ?? 100;
      const fromRotate = this.state.fore.bgRotate ?? 0;
      const move: RenderEvent = {
        kind: "track",
        track: {
          target: "bg",
          prop: "transform",
          duration: m.time,
          ...(m.accel ? { accel: m.accel } : {}),
          keyframes: [
            { time: 0, left: fromLeft, top: fromTop, zoomx: fromZoomX, zoomy: fromZoomY, rotate: fromRotate },
            {
              time: m.time,
              left: m.left,
              top: m.top,
              zoomx: m.zoomx ?? fromZoomX,
              zoomy: m.zoomy ?? fromZoomY,
              rotate: m.rotate ?? fromRotate,
            },
          ],
        },
      };
      entries.push({ at: m.at, order: order++, events: [move] });
      if (previous && previous.left !== undefined && m.at >= lastBgAt) {
        this.state.fore.bgLeft = m.left;
        this.state.fore.bgTop = m.top;
      }
    }

    // Calques : transitoires, ils ne touchent pas l'état du runtime et sont retirés à
    // la fin de la séquence (après tout le reste, même si `next` raccourcit la durée).
    const layers = scene.layers ?? [];
    const unsupportedEffects = new Set<string>();
    for (const k of layers) {
      const layer: TimelineLayerState = { id: k.id, storage: k.storage, x: k.x, y: k.y, opacity: k.opacity, z: k.z };
      if (k.rain) layer.rain = true;
      if (k.zoomx !== undefined) layer.zoomx = k.zoomx;
      if (k.zoomy !== undefined) layer.zoomy = k.zoomy;
      if (k.rotate !== undefined) layer.rotate = k.rotate;
      if (k.afx !== undefined) layer.afx = k.afx;
      if (k.afy !== undefined) layer.afy = k.afy;
      if (k.effect) unsupportedEffects.add(k.effect);
      // Piste unifiée (#317) : le calque porte ses métadonnées, la piste porte l'animation.
      const event: RenderEvent = {
        kind: "track",
        track: {
          target: k.id,
          prop: "transform",
          layer,
          duration: k.time,
          ...(k.accel ? { accel: k.accel } : {}),
          keyframes: [{ time: 0 }, { time: k.time, left: k.x, top: k.y, opacity: k.opacity, zoomx: k.zoomx ?? 100, zoomy: k.zoomy ?? 100, rotate: k.rotate ?? 0 }],
        },
      };
      entries.push({ at: k.at, order: order++, events: [event] });
    }
    for (const effect of unsupportedEffects) this.onWarning(`effet de calque non pris en charge : ${effect}`);

    for (const a of scene.audio) {
      let event: AudioEvent;
      if (a.action === "play" && a.storage) {
        if (a.channel === "bgm") {
          this.state.bgm = a.storage;
          event = { kind: "play", channel: "bgm", storage: a.storage, loop: a.loop, volume: a.volume };
        } else {
          // Même pool que @se (#358) : une ambiance de timeline ne coupe pas un one-shot.
          const channel = isVoiceStorage(a.storage) ? "voice" : this.allocateSeChannel(a.storage, a.loop);
          this.recordSeChannel(channel, a.storage, a.loop, a.volume);
          this.lastTimelineSeChannel = channel;
          event = { kind: "play", channel, storage: a.storage, loop: a.loop, volume: a.volume };
        }
      } else if (a.channel === "bgm") {
        event = { kind: "fade", channel: "bgm", volume: a.volume, time: 0 };
      } else {
        const channel = this.lastTimelineSeChannel;
        if (!channel) continue;
        event = { kind: "fade", channel, volume: a.volume, time: 0 };
      }
      entries.push({ at: a.at, order: order++, events: [{ kind: "audio", event }] });
    }

    // Ordre stable : par instant, puis dans l'ordre de construction (fonds avant audio).
    entries.sort((x, y) => x.at - y.at || x.order - y.order);
    const duration = instruction.next && instruction.next > 0 ? instruction.next : scene.duration;
    if (layers.length > 0) {
      const lastAt = entries[entries.length - 1]?.at ?? 0;
      entries.push({ at: Math.max(duration, lastAt), order: order++, events: [{ kind: "timelineLayerClear" }] });
    }
    return {
      events: [],
      stop: { kind: "timeline", schedule: entries.map(({ at, events }) => ({ at, events })), duration },
    };
  }

  /**
   * `@xchgbgm` : échange de BGM avec fondu croisé (KAG3, `data/system/bgm.tjs`, `exchange`).
   *
   * Moteur : l'ancienne piste est fondue sur `outtime`, la nouvelle est jouée immédiatement à
   * volume 0 puis monte sur `intime` en démarrant après `outtime - overlap` ms (overlap > 0 =
   * vrai fondu croisé). `volume` règle le volume global BGM.
   *
   * Approximation du port : on émet un arrêt de l'ancienne piste (fondu `outtime`) puis un
   * `play` de la nouvelle (fondu `intime`, retard `outtime - overlap`) ; `volume` est appliqué
   * comme volume de piste (le port n'a pas de volume global scriptable distinct des réglages
   * utilisateur). Documenté dans `docs/KAG_MAHOYO_SEMANTICS.md`.
   */
  private applyXchgbgm(instruction: Extract<Instruction, { kind: "xchgbgm" }>): RenderEvent[] {
    const events: RenderEvent[] = [];
    const time = instruction.time;
    const intime = instruction.time ?? instruction.intime ?? 5000;
    const outtime = instruction.time ?? instruction.outtime ?? 5000;
    const overlap = Math.max(0, instruction.overlap ?? 0);
    const volume = (instruction.volume ?? 100) / 100;
    const loop = instruction.loop ?? true;

    if (this.state.bgm === instruction.storage) return events; // même piste : rien à faire

    if (this.state.bgm !== null) {
      events.push({ kind: "audio", event: { kind: "stop", channel: "bgm", fadeOut: time !== undefined ? outtime : Math.max(0, outtime) } });
    }
    this.state.bgm = instruction.storage;
    this.state.bgmPaused = false;
    events.push({
      kind: "audio",
      event: {
        kind: "play",
        channel: "bgm",
        storage: instruction.storage,
        loop,
        volume,
        fadeIn: intime,
        // Le fondu entrant démarre après la sortie, moins le chevauchement demandé.
        delay: Math.max(0, outtime - overlap),
      },
    });
    return events;
  }

  /** Canaux SE/voix actifs de l'état courant. */
  private activeSeChannels(): SeChannelState[] {
    if (!this.state.seChannels) this.state.seChannels = [];
    return this.state.seChannels;
  }

  /** Un SE/une voix de ce storage est-il encore en cours sur un canal ? */
  private isPlayingSe(storage: string): boolean {
    return this.activeSeChannels().some((entry) => entry.storage === storage);
  }

  /**
   * Alloue un canal pour un SE (#358) :
   * - boucle : canal dédié au storage, réutilisé si la même boucle est relancée ;
   * - one-shot : premier canal libre du pool, sinon le one-shot le plus ancien (jamais une boucle) ;
   * - pool saturé de boucles : canal d'extension `se:8+` pour ne jamais couper une ambiance.
   */
  private allocateSeChannel(storage: string, loop: boolean): AudioChannel {
    const entries = this.activeSeChannels().filter((entry) => entry.channel.startsWith("se:"));
    if (loop) {
      const same = entries.find((entry) => entry.loop && entry.storage === storage);
      if (same) return same.channel;
    }
    const used = new Set(entries.map((entry) => entry.channel));
    for (let i = 0; i < SE_CHANNEL_COUNT; i++) {
      const channel = seChannel(i);
      if (!used.has(channel)) return channel;
    }
    const oneShots = entries.filter((entry) => !entry.loop);
    if (oneShots.length > 0) {
      // Le plus ancien one-shot (ordre de lancement), jamais une boucle d'ambiance.
      let oldest = oneShots[0]!;
      for (const entry of oneShots) {
        if ((this.seStartedAt.get(entry.channel) ?? 0) < (this.seStartedAt.get(oldest.channel) ?? 0)) oldest = entry;
      }
      return oldest.channel;
    }
    let index = SE_CHANNEL_COUNT;
    while (used.has(seChannel(index))) index++;
    return seChannel(index);
  }

  /** Enregistre/actualise l'occupation d'un canal (pool + voix). */
  private recordSeChannel(channel: AudioChannel, storage: string, loop: boolean, volume: number): void {
    const entries = this.activeSeChannels();
    const existing = entries.find((entry) => entry.channel === channel);
    if (existing) {
      existing.storage = storage;
      existing.loop = loop;
      existing.volume = volume;
    } else {
      entries.push({ channel, storage, loop, volume });
    }
    this.seStartedAt.set(channel, ++this.seSequence);
    this.state.se = storage;
  }

  /**
   * Libère un canal SE à la fin de lecture (callback du player). Idempotent : utilisé aussi par
   * `@sestop` et la restauration.
   */
  releaseSeChannel(channel: AudioChannel): void {
    const entries = this.activeSeChannels();
    const index = entries.findIndex((entry) => entry.channel === channel);
    if (index >= 0) entries.splice(index, 1);
    this.seStartedAt.delete(channel);
    if (this.state.se !== null && !entries.some((entry) => entry.storage === this.state.se)) {
      this.state.se = entries.length > 0 ? entries[entries.length - 1]!.storage : null;
    }
  }

  /** Canaux actifs d'un storage (SE natif ou voix), pour @sestop/@fadese par storage. */
  private seChannelsOfStorage(storage: string): AudioChannel[] {
    return this.activeSeChannels().filter((entry) => entry.storage === storage).map((entry) => entry.channel);
  }

  private applyAudio(instruction: Instruction): RenderEvent[] {
    const events: AudioEvent[] = [];
    switch (instruction.kind) {
      case "xchgbgm": {
        // Traité par applyXchgbgm (plusieurs événements audio) ; ce cas ne devrait pas arriver.
        break;
      }
      case "play": {
        this.state.bgm = instruction.storage;
        this.state.bgmPaused = false;
        events.push({
          kind: "play",
          channel: "bgm",
          storage: instruction.storage,
          loop: true,
          volume: (instruction.volume ?? 100) / 100,
        });
        break;
      }
      case "playstop": {
        this.state.bgm = null;
        this.state.bgmPaused = false;
        events.push({ kind: "stop", channel: "bgm", fadeOut: instruction.time });
        break;
      }
      case "playpause": {
        // Sans BGM en cours, ou déjà en pause : sans effet.
        if (this.state.bgm === null || this.state.bgmPaused) break;
        this.state.bgmPaused = true;
        events.push({ kind: "pause", channel: "bgm", fadeOut: instruction.time });
        break;
      }
      case "playresume": {
        const volume = instruction.volume / 100;
        if (this.state.bgm !== null) {
          this.state.bgmPaused = false;
          events.push({ kind: "resume", channel: "bgm", volume, fadeIn: instruction.time });
        } else if (instruction.storage) {
          // Rien à reprendre mais la piste est nommée : on la lance en fondu.
          this.state.bgm = instruction.storage;
          this.state.bgmPaused = false;
          events.push({ kind: "play", channel: "bgm", storage: instruction.storage, loop: true, volume, fadeIn: instruction.time });
        }
        break;
      }
      case "fadebgm": {
        // Ne pas nullifier state.bgm : on fonde le volume, la BGM continue
        // de jouer (silencieuse si volume=0) et reste préservée pour
        // reduceAudio/sauvegarde (doc §9 : fade vers volume cible).
        events.push({ kind: "fade", channel: "bgm", volume: (instruction.volume ?? 0) / 100, time: instruction.time });
        break;
      }
      case "se":
      case "seact": {
        const storage = instruction.storage;
        const loop = instruction.kind === "se" ? (instruction.loop ?? false) : instruction.loop;
        const volume = (instruction.kind === "se" ? (instruction.volume ?? 100) : instruction.volume) / 100;
        const delay = instruction.delay;
        const fadeIn = instruction.kind === "se" ? undefined : instruction.fadeIn;
        // #358 : une voix Steam passe par `voice` (volume voix, pas de coupure d'ambiance).
        const channel: AudioChannel = isVoiceStorage(storage) ? "voice" : this.allocateSeChannel(storage, loop);
        this.recordSeChannel(channel, storage, loop, volume);
        events.push({
          kind: "play",
          channel,
          storage,
          loop,
          volume,
          ...(delay !== undefined ? { delay } : {}),
          ...(fadeIn !== undefined ? { fadeIn } : {}),
        });
        break;
      }
      case "sestop": {
        if (instruction.storage) {
          // KAG : stoppe le(s) buffer(s) correspondant au storage ; aucun si introuvable.
          const channels = this.seChannelsOfStorage(instruction.storage);
          for (const channel of channels) {
            events.push({ kind: "stop", channel, fadeOut: instruction.time });
            this.releaseSeChannel(channel);
          }
        } else {
          // KAG : sans buf ni storage, arrête tous les SE.
          events.push({ kind: "stop", channel: "allSe", fadeOut: instruction.time });
          for (const channel of this.activeSeChannels().map((entry) => entry.channel)) this.seStartedAt.delete(channel);
          this.state.seChannels = [];
          this.state.se = null;
        }
        break;
      }
      case "fadese": {
        if (instruction.storage) {
          // KAG : `getsebuf` par storage ; introuvable = sans effet.
          const channel = this.seChannelsOfStorage(instruction.storage)[0];
          if (channel) {
            events.push({ kind: "fade", channel, volume: instruction.volume / 100, time: instruction.time });
            const entry = this.activeSeChannels().find((candidate) => candidate.channel === channel);
            if (entry) entry.volume = instruction.volume / 100;
          }
        }
        // Sans storage, le moteur ne trouve pas de buffer (`se[void]`) : sans effet.
        break;
      }
    }
    return events.map((event): RenderEvent => ({ kind: "audio", event }));
  }

  private applyQuake(instruction: Extract<Instruction, { kind: "quake" }>): RenderEvent {
    const quake: QuakeSpec = {
      time: instruction.time,
      hmax: instruction.hmax,
      vmax: instruction.vmax,
    };
    return { kind: "quake", quake };
  }

  /**
   * @shake / @swing : secousse d'écran (override `tagex.tjs`). Le port applique l'oscillation à la
   * scène entière (approximation : `storage`/`page`/`actmode` visent un calque dans le moteur).
   */
  private applyScreenShake(instruction: Extract<Instruction, { kind: "shake" | "swing" }>): RenderEvent {
    if (instruction.kind === "shake") {
      const shake: ScreenShakeSpec = {
        mode: "shake",
        vmax: instruction.vmax,
        hmax: instruction.hmax,
        cycle: instruction.cycle,
        time: instruction.time ?? null,
      };
      return { kind: "screenShake", shake };
    }
    const shake: ScreenShakeSpec = {
      mode: "swing",
      minCycle: instruction.minCycle,
      maxCycle: Math.max(instruction.minCycle, instruction.maxCycle),
      minVibration: instruction.minVibration,
      maxVibration: Math.max(instruction.minVibration, instruction.maxVibration),
      rate: instruction.rate,
      time: instruction.time ?? null,
    };
    return { kind: "screenShake", shake };
  }

  /**
   * @noiseact (noiseplugin.tjs `kt.noiseact`) : action sur les propriétés du bruit. Approximation :
   * seules `opacity`, `monocro`, `visible` et `status` sont rendues ; `absolute`/`type` sont
   * parsés puis ignorés (le bruit du port est une surcouche plein écran). Un fondu n'est joué que
   * si l'opacité est définie à plusieurs keyframes.
   */
  private applyNoiseAct(instruction: Extract<Instruction, { kind: "noiseact" }>): RenderEvent {
    const frames = instruction.keyframes;
    // Sans keyframe exploitable, l'action ne change rien (le tag est un no-op dans le moteur).
    if (frames.length === 0) return { kind: "effect", effect: this.state.effect ?? null };
    const current = this.state.effect?.kind === "noise" ? this.state.effect : null;
    const lastDefined = <T,>(get: (frame: PluginKeyframe) => T | undefined): T | undefined => {
      for (let i = frames.length - 1; i >= 0; i--) {
        const value = get(frames[i]!);
        if (value !== undefined) return value;
      }
      return undefined;
    };
    const targetOpacity = lastDefined((frame) => frame.opacity) ?? current?.opacity ?? 128;
    const monocro = lastDefined((frame) => frame.monocro) ?? current?.monocro ?? false;
    const visible = lastDefined((frame) => frame.visible) ?? true;
    const status = lastDefined((frame) => frame.status) ?? "play";

    if (status === "stop" || !visible) {
      this.state.effect = null;
      return { kind: "effect", effect: null };
    }

    // Fondu seulement si l'opacité prend au moins deux valeurs distinctes dans les keyframes
    // (le carry répète souvent la même valeur, cf. corpus réel où un fondu serait un faux positif).
    const opacityFrames = frames.filter((frame) => frame.opacity !== undefined);
    const animated = new Set(opacityFrames.map((frame) => frame.opacity)).size >= 2;
    const from = animated ? opacityFrames[0]!.opacity! : (current?.opacity ?? 0);
    const time = animated
      ? Math.max(0, opacityFrames[opacityFrames.length - 1]!.time - opacityFrames[0]!.time)
      : 0;
    this.state.effect = { kind: "noise", opacity: targetOpacity, monocro };
    return { kind: "noiseAct", opacity: targetOpacity, monocro, from, time };
  }

  /**
   * @focusline (focuslineplugin.tjs) : lignes de concentration. Approximation documentée dans
   * `docs/KAG_MAHOYO_SEMANTICS.md` : lignes radiales en canvas autour de (`cx`, `cy`), nombre dans
   * `[minLines, maxLines]`, longueur dans `[minLength, maxLength]`, apparition sur `appear` ms.
   */
  private applyFocusLine(instruction: Extract<Instruction, { kind: "focusline" }>): RenderEvent {
    if (instruction.status === "stop") {
      this.state.effect = null;
      return { kind: "effect", effect: null };
    }
    const effect: EffectState = {
      kind: "focusline",
      cx: instruction.cx,
      cy: instruction.cy,
      minLength: instruction.minLength,
      maxLength: instruction.maxLength,
      minLines: instruction.minLines,
      maxLines: instruction.maxLines,
      appear: instruction.appear,
      color: instruction.color,
      opacity: instruction.opacity,
    };
    this.state.effect = effect;
    return { kind: "effect", effect };
  }

  private applyTextbox(instruction: Instruction): RenderEvent | null {
    let visible: boolean | undefined;
    let time = 300;
    let frame: boolean | undefined;
    let frameImage: string | undefined;

    if (instruction.kind === "textoff") {
      visible = false;
      time = instruction.time;
    } else if (instruction.kind === "texton") {
      visible = true;
      time = 300;
    } else if (instruction.kind === "position") {
      if (instruction.visible !== undefined) visible = instruction.visible;
      frameImage = instruction.frame;
    } else if (instruction.kind === "invisibleframe") {
      frame = false;
    } else if (instruction.kind === "visibleframe") {
      frame = true;
    }

    // Copie : l'événement émis ne doit pas être modifié par les commandes suivantes.
    const state = { ...this.buildTextboxState() };
    if (visible !== undefined) state.visible = visible;
    if (frame !== undefined) state.frame = frame;
    if (frameImage !== undefined) state.frameImage = frameImage;
    this.state.textbox = state;

    return { kind: "textbox", state, time };
  }

  private applyEffect(instruction: Extract<Instruction, { kind: "noise" | "haze" | "stophaze" }>): RenderEvent {
    const effect: EffectState | null =
      instruction.kind === "noise"
        ? { kind: "noise", opacity: instruction.opacity, monocro: instruction.monocro }
        : instruction.kind === "haze"
          ? { kind: "haze", power: instruction.power, delta: instruction.delta, omega: instruction.omega }
          : null;
    this.state.effect = effect;
    return { kind: "effect", effect };
  }

  private applyStaffroll(instruction: Instruction): RenderEvent | null {
    if (instruction.kind === "staffrollinit") {
      this.state.staffroll = {
        lines: [],
        face: instruction.face,
        running: false,
        height: 10000,
        time: 60000,
        elapsed: 0,
      };
    } else if (instruction.kind === "staffrolltext") {
      if (!this.state.staffroll) {
        this.state.staffroll = {
          lines: [],
          running: false,
          height: 10000,
          time: 60000,
          elapsed: 0,
        };
      }
      this.state.staffroll.lines.push({
        text: instruction.text,
        y: instruction.y,
        size: instruction.size,
        face: instruction.face ?? this.state.staffroll.face,
        cmx: instruction.cmx,
        color: this.state.textStyle?.color,
      });
    } else if (instruction.kind === "staffrollstart") {
      if (this.state.staffroll) {
        this.state.staffroll.running = true;
        this.state.staffroll.height = instruction.height;
        this.state.staffroll.time = instruction.time;
        this.state.staffroll.elapsed = 0;
      }
    } else if (instruction.kind === "staffrollsetting") {
      // Le plugin d'origine stocke la couleur mais ne la peint jamais : on conserve la
      // valeur dans l'état (fidélité de sauvegarde) sans effet visuel (#286).
      if (!this.state.staffroll) {
        this.state.staffroll = {
          lines: [],
          running: false,
          height: 10000,
          time: 60000,
          elapsed: 0,
        };
      }
      if (instruction.bgcolor !== undefined) this.state.staffroll.bgcolor = instruction.bgcolor;
    } else if (instruction.kind === "staffrolluninit") {
      // Termine/libère l'affichage des crédits.
      this.state.staffroll = undefined;
    }
    return { kind: "staffroll", state: this.buildStaffrollState() };
  }

  private applyEval(instruction: Extract<Instruction, { kind: "eval" }>): RenderEvent[] {
    this.evaluateExpression(instruction.expression);
    return [];
  }

  /** Index suivant d'une instruction de contrôle aplatie (#80), ou null si ce n'en est pas une. */
  private flatControlTarget(instruction: Instruction, currentIndex: number): number | null {
    if (instruction.kind === "jumpIndex") return instruction.target;
    if (instruction.kind === "jumpIfNot") {
      return instruction.cond === undefined || !this.evaluateCondition(instruction.cond)
        ? instruction.target
        : currentIndex + 1;
    }
    return null;
  }

  private applyJump(instruction: Extract<Instruction, { kind: "jump" }>): StopReason | null {
    // Inter-script jump: @jump storage=other.ks [target=*label]
    if (instruction.storage) {
      return { kind: "loadScript", file: instruction.storage, label: instruction.target, pushCallStack: false };
    }
    // Intra-script jump: @jump target=*label
    if (instruction.target) {
      const pageIdx = this.context.script.labels[instruction.target];
      if (pageIdx !== undefined) {
        this.frames = [];
        this.macroParams = {};
        this.context.pc = pageIdx;
        this.context.instructionIndex = this.context.script.labelInstructionIndex[instruction.target] ?? 0;
        this.context.segmentIndex = 0;
        this.pendingContextChange = true;
      } else {
        this.onWarning(`unknown label: ${instruction.target}`);
      }
    }
    return null;
  }

  private applyCall(instruction: Extract<Instruction, { kind: "call" }>): StopReason | null {
    // Inter-script call: @call storage=other.ks [target=*label]
    if (instruction.storage) {
      return { kind: "loadScript", file: instruction.storage, label: instruction.target, pushCallStack: true };
    }
    // Intra-script call: @call target=*label
    if (instruction.target) {
      const pageIdx = this.context.script.labels[instruction.target];
      if (pageIdx !== undefined) {
        // (#80) Aplati : le retour reprend exactement après le @call, y compris dans une macro.
        // On sauvegarde l'état d'exécution de la frame courante ; @return le restaure et reprend
        // l'instruction suivante de la frame (ou de la page si aucun frame).
        const currentFrame = this.frames.length > 0
          ? this.frames[this.frames.length - 1]
          : undefined;
        if (currentFrame) currentFrame.index += 1;
        const savedFrames = this.frames.map((frame) => ({ ...frame, instructions: [...frame.instructions] }));
        const savedMacroParams = this.macroParams;
        this.callStack.push({
          ...this.context,
          instructionIndex: this.context.instructionIndex + (currentFrame ? 0 : 1),
          segmentIndex: 0,
          savedFrames,
          savedMacroParams,
        });
        this.frames = [];
        this.macroParams = {};
        this.context.pc = pageIdx;
        this.context.instructionIndex = this.context.script.labelInstructionIndex[instruction.target] ?? 0;
        this.context.segmentIndex = 0;
        this.pendingContextChange = true;
        return null;
      }
    }
    this.onWarning(`unknown call target: ${instruction.target ?? instruction.storage ?? "?"}`);
    return null;
  }

  private applyReturn(): void {
    const prevContext = this.callStack.pop();
    if (prevContext !== undefined) {
      const { savedFrames, savedMacroParams, ...context } = prevContext;
      this.context = context;
      this.frames = (savedFrames as typeof this.frames | undefined) ?? [];
      this.macroParams = savedMacroParams ?? {};
      this.pendingContextChange = true;
      return;
    }
    // Sans appelant, le script a été lancé par le player (ou, dans le jeu
    // d'origine, par le plugin « tracer ») : @return le termine et lui rend la
    // main. Sans cela, un @return au milieu d'un script laisse l'exécution
    // continuer dans le code qui suit (ex. sections étiquetées d'un script système).
    this.frames = [];
    this.macroParams = {};
    this.context.pc = this.context.script.pages.length;
    this.context.instructionIndex = 0;
    this.context.segmentIndex = 0;
    this.pendingContextChange = true;
  }

  /**
   * Page visée par une commande (même règle que `resolvePage`, appliquée aux commandes
   * visuelles) ; null pour les commandes qui ne touchent aucune page.
   */
  /** Nom de commande d'origine d'une instruction (pour l'audit/diagnostic). */
  private commandNameOf(instruction: Instruction): string {
    if (instruction.kind === "raw" || instruction.kind === "noop") return instruction.command;
    return instruction.kind;
  }

  /** Construit et émet une entrée de journal (#318). Aucun coût si `onJournal` est null. */
  private emitJournalEntry(
    instruction: Instruction,
    command: string,
    position: { scriptName: string; page: number; instruction: number },
    result: { events: readonly RenderEvent[]; stop?: StopReason },
  ): void {
    if (!this.onJournal) return;
    const occurrence = (this.journalCounts.get(command) ?? 0) + 1;
    this.journalCounts.set(command, occurrence);
    const durationMs = journalDurationMs(instruction, result.stop);
    const speedFactor = this.journalSpeedFactor > 0 ? this.journalSpeedFactor : 1;
    const keyframes =
      instruction.kind === "bgact"
        ? normalizeJournalKeyframes(instruction.keyframes)
        : instruction.kind === "animate"
          ? normalizeJournalKeyframes(instruction.def.keyframes)
          : undefined;
    this.onJournal({
      occurrence,
      command,
      position,
      params: journalParams(instruction),
      page: this.resolvedPageOf(instruction),
      durationMs,
      speedFactor,
      effectiveDurationMs: durationMs === null ? null : durationMs / speedFactor,
      transition: journalTransition(instruction, result.events),
      ...(keyframes === undefined ? {} : { keyframes }),
      fore: summarizePage(this.state.fore),
      back: summarizePage(this.state.back),
    });
  }

  private resolvedPageOf(instruction: Instruction): PageLayer | null {
    switch (instruction.kind) {
      case "bg":
        return this.resolvePage("bg", instruction.page);
      case "fg":
        return this.resolvePage("fg", instruction.page);
      case "chgfg":
        return this.resolvePage("chgfg", instruction.page);
      case "partbg":
        return this.resolvePage("partbg", instruction.page);
      case "clall":
        return this.resolvePage("clall", instruction.page);
      case "clfg":
        return this.resolvePage("clfg", instruction.page);
      case "bgact":
        return this.resolvePage("bgact", instruction.page);
      case "animate":
        return this.resolvePage(
          instruction.def.isMove ? "movefg" : instruction.def.isPartbg ? "partbgact" : "fgact",
          instruction.def.page,
        );
      case "trans":
        return "fore";
      case "backlay":
        // Copie fore → back (doc §2) : la page modifiée est back.
        return "back";
      default:
        return null;
    }
  }

  private applyInstruction(instruction: Instruction): { events: RenderEvent[]; stop?: StopReason } {
    const events: RenderEvent[] = [];

    // Evaluate cond= on instructions that support it (early-return if false).
    // @jump cond=, @eval cond=, @trans cond=, and raw commands with cond=.
    const cond = this.getCond(instruction);
    if (cond !== undefined && !this.evaluateCondition(cond)) {
      return { events };
    }

    switch (instruction.kind) {
      case "bg": {
        const res = this.applyBg(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "bgact": {
        const ev = this.applyBgact(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "fg": {
        const res = this.applyFg(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "chgfg": {
        const res = this.applyChgfg(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "infg":
        events.push(...this.applyInfg(instruction));
        break;
      case "outfg":
        events.push(...this.applyOutfg(instruction));
        break;
      case "layopt": {
        const ev = this.applyLayopt(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "bindbg": {
        // Les deux pages partagent le drapeau : le port n'affiche qu'une page à la fois et le
        // paramètre `page` de @bindbg ne doit pas laisser un drapeau contraire sur l'autre.
        const changed = this.state.fore.bindChildren !== instruction.enabled;
        this.state.fore.bindChildren = instruction.enabled;
        this.state.back.bindChildren = instruction.enabled;
        if (changed) events.push(this.emitScene({ method: "none" }));
        break;
      }
      case "partbg": {
        const res = this.applyPartbg(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "animate":
        events.push(...this.applyAnimate(instruction));
        break;
      case "clall": {
        const ev = this.applyClall(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "clfg": {
        const ev = this.applyClfg(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "backlay":
        events.push(...this.applyBacklay(instruction));
        break;
      case "trans": {
        const res = this.applyTrans(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "play":
      case "playstop":
      case "playpause":
      case "playresume":
      case "fadebgm":
      case "se":
      case "seact":
      case "sestop":
      case "fadese": {
        events.push(...this.applyAudio(instruction));
        break;
      }
      case "playtimeline": {
        const res = this.applyPlaytimeline(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "xchgbgm":
        events.push(...this.applyXchgbgm(instruction));
        break;
      case "clickskip":
        this.state.clickSkipEnabled = instruction.enabled;
        events.push({ kind: "skipSetting", clickSkip: instruction.enabled });
        break;
      case "effectskip":
        this.state.effectSkipEnabled = instruction.enabled;
        events.push({ kind: "skipSetting", effectSkip: instruction.enabled });
        break;
      case "cancelskip":
        events.push({ kind: "cancelSkip" });
        break;
      case "quake":
        events.push(this.applyQuake(instruction));
        break;
      case "stopquake":
        events.push({ kind: "quake", quake: null });
        break;
      case "shake":
      case "swing":
        events.push(this.applyScreenShake(instruction));
        break;
      case "stopswing":
        events.push({ kind: "screenShake", shake: null });
        break;
      case "noiseact":
        events.push(this.applyNoiseAct(instruction));
        break;
      case "focusline":
        events.push(this.applyFocusLine(instruction));
        break;
      case "stopfocusline":
      case "clearfocusline":
        this.state.effect = null;
        events.push({ kind: "effect", effect: null });
        break;
      case "lockquickmenu":
      case "unlockquickmenu": {
        const locked = instruction.kind === "lockquickmenu";
        this.state.quickMenuLocked = locked;
        events.push({ kind: "quickMenu", locked });
        break;
      }
      case "current":
        // @current : couche de message courante (approximation mono-textbox, aucun rendu dédié).
        if (instruction.layer !== undefined) {
          this.state.messageLayer = instruction.layer === "message1" ? 1 : 0;
        }
        break;
      case "store":
        // @store : état persisté + événement pour que le HUD désactive Sauvegarder/Charger.
        this.state.saveLoadEnabled = instruction.enabled;
        events.push({ kind: "store", enabled: instruction.enabled });
        break;
      case "pauseautomode":
      case "resumeautomode": {
        const paused = instruction.kind === "pauseautomode";
        this.state.autoModePaused = paused;
        events.push({ kind: "autoMode", paused });
        break;
      }
      case "cm":
      case "cm4pg":
        // Vidage explicite de la fenêtre de texte (le réglage de fin de page ne s'applique pas :
        // `force`). @cm4pg n'ajoute que la copie des drapeaux de cache du moteur, invisible ici.
        events.push({ kind: "clearText", force: true });
        break;
      case "textoff":
      case "texton":
      case "position":
      case "invisibleframe":
      case "visibleframe": {
        const ev = this.applyTextbox(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "noise":
      case "haze":
      case "stophaze":
        events.push(this.applyEffect(instruction));
        break;
      case "stopnoise":
        // Arrête le bruit (et uniquement le bruit).
        this.state.effect = null;
        events.push({ kind: "effect", effect: null });
        break;
      case "stopaction":
        // Arrête toutes les animations de calques.
        events.push({ kind: "stopAnimation" });
        break;
      case "action": {
        const res = this.applyAction(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "removeaction":
        events.push(...this.applyRemoveaction(instruction));
        break;
      case "pauseaction":
      case "resumeaction":
        events.push(...this.applyPauseAction(instruction));
        break;
      case "pauseploy":
      case "resumeploy":
        events.push(...this.applyPausePloys(instruction));
        break;
      case "beginfallnote":
      case "fallnoteopt":
      case "endfallnote":
        events.push(...this.applyFallnote(instruction));
        break;
      case "stoptrans":
        // Termine immédiatement la transition en cours.
        events.push({ kind: "stopTransition" });
        break;
      case "beginploy":
        // Le début d'une séquence ploy ne change rien : la bulle apparaît au @ploysay.
        break;
      case "endploy":
        this.state.ploy = null;
        events.push({ kind: "ploy", ploy: null });
        break;
      case "ploysay": {
        const ploy: PloyState = { mode: instruction.mode, ox: instruction.ox, oy: instruction.oy };
        this.state.ploy = ploy;
        events.push({ kind: "ploy", ploy: { ...ploy } });
        break;
      }
      case "font":
        // Fusionne : seuls les attributs renseignés changent le style courant.
        this.state.textStyle = { ...(this.state.textStyle ?? {}), ...instruction.style };
        break;
      case "resetfont":
        // Sans @font préalable, aucun effet.
        this.state.textStyle = null;
        break;
      case "chgpartbg": {
        const res = this.applyChgpartbg(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "dispclock": {
        const res = this.applyDispclock(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "tickclock": {
        const res = this.applyTickclock(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "setdefaultmessageaction":
        events.push(this.applyTextAction(instruction.type));
        break;
      case "resetdefaultmessageaction":
        events.push(this.applyTextAction(null));
        break;
      case "staffrollinit":
      case "staffrolltext":
      case "staffrollstart":
      case "staffrollsetting":
      case "staffrolluninit": {
        const ev = this.applyStaffroll(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "iscript":
      case "endscript":
        // JavaScript inline non supporté.
        break;
      case "eval":
        events.push(...this.applyEval(instruction));
        break;
      case "jump": {
        const stop = this.applyJump(instruction);
        if (stop) return { events, stop };
        break;
      }
      case "call": {
        const stop = this.applyCall(instruction);
        if (stop) return { events, stop };
        break;
      }
      case "return":
        this.applyReturn();
        break;
      case "image": {
        const res = this.applyImage(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "stop":
        // @s : le moteur attend une sélection (bouton/lien) ; le port n'implémente pas encore
        // les boutons de choice-map, on attend un clic (approximation documentée).
        return { events, stop: { kind: "click", style: "line" } };
      case "noop":
        // Commande KAG standard volontairement sans effet (fermeture de bloc orpheline).
        break;
      case "wait":
        return { events, stop: { kind: "wait", time: instruction.time, skippable: instruction.skippable ?? true } };
      case "waitfor": {
        // @wt (#253) : après une transition explicite nowait, backlay fore→back sauf noback=1.
        if (instruction.what === "transition" && this.state.transitionBacklayPending) {
          if (!instruction.noback) this.backlayFromFore();
          this.state.transitionBacklayPending = false;
        }
        return { events, stop: { kind: "waitFor", what: instruction.what, skippable: instruction.skippable ?? true } };
      }
      case "text":
      case "break":
        // Traités dans step() car le texte peut s'arrêter sur [l].
        break;
      case "conditional": {
        // Évalue les branches dans l'ordre et empile la première dont la
        // condition est vraie (ou la branche @else sans condition).
        // Top-level @if needs a return index for @call inside it (resume after @endif).
        const returnIndex = this.frames.length === 0 ? this.context.instructionIndex + 1 : undefined;
        for (const branch of instruction.branches) {
          if (branch.cond === undefined || this.evaluateCondition(branch.cond)) {
            if (branch.instructions.length > 0) {
              this.pushFrame(branch.instructions, undefined, returnIndex);
            }
            break;
          }
        }
        break;
      }
      case "macrodef": {
        // Enregistre la macro (raw tokens) pour une utilisation ultérieure.
        this.macros.set(instruction.name, instruction.rawTokens);
        break;
      }
      case "raw": {
        // Si la commande correspond à une macro définie, on l'expanse sans
        // compter comme une commande raw inconnue.
        const macro = this.macros.get(instruction.command);
        if (macro) {
          // Substitute %param|default in macro tokens with call-site args.
          const expanded = this.expandMacroTokens(macro, instruction.args);
          // Parse the substituted tokens into instructions.
          const instructions = this.parseRawTokens(expanded);
          if (instructions.length > 0) {
            // Build macro params for the duration of the frame.
            const params = this.buildMacroParams(instruction.args);
            // Top-level macros need a return index for @call inside them.
            const returnIndex = this.frames.length === 0 ? this.context.instructionIndex + 1 : undefined;
            this.pushFrame(instructions, params, returnIndex);
          }
          break;
        }
        // Commande inconnue : tolérée mais bruyante (AGENTS.md §6).
        // On prévient via onWarning et on compte pour détecter les régressions.
        this.rawCount++;
        this.onWarning(`commande non gérée: @${instruction.command}`);
        break;
      }
    }

    return { events };
  }

  /**
   * Réaffiche la textbox masquée par `@textoff` (ou `@position visible=false`)
   * quand un texte lisible arrive (#159). Sans cela le texte qui suit un
   * `@textoff` restait invisible, `@texton` étant presque absent du corpus.
   * Ne fait rien si la boîte est déjà visible ; le masquage par l'utilisateur
   * (`userHidden`) est géré côté renderer et n'est pas touché.
   */
  private revealTextboxForText(segments: readonly TextSegment[], events: RenderEvent[]): void {
    if (this.buildTextboxState().visible) return;
    const readable = segments.some(
      (seg) =>
        ("text" in seg && seg.text.trim().length > 0) || "graph" in seg || "emoji" in seg,
    );
    if (!readable) return;
    const state = { ...this.buildTextboxState(), visible: true };
    this.state.textbox = state;
    events.push({ kind: "textbox", state, time: TEXTBOX_REVEAL_MS });
  }

  private processText(instruction: Extract<Instruction, { kind: "text" }>): { events: RenderEvent[]; stop?: StopReason } {
    const events: RenderEvent[] = [];
    const segments = this.expandEmojiSegments(instruction.segments);
    this.revealTextboxForText(segments.slice(this.context.segmentIndex), events);
    let index = this.context.segmentIndex;
    let pending: TextSegment[] = [];
    const flush = (): void => {
      if (pending.length > 0) {
        events.push({ kind: "text", segments: this.withTextStyle(pending) });
        pending = [];
      }
    };
    while (index < segments.length) {
      const seg = segments[index++]!;
      if ("pause" in seg && seg.pause) {
        flush();
        this.context.segmentIndex = index;
        return { events, stop: { kind: "click", style: "line" } };
      }
      if ("lineBreak" in seg && seg.lineBreak) {
        flush();
        events.push({ kind: "lineBreak" });
        continue;
      }
      pending.push(seg);
    }
    flush();
    this.context.instructionIndex += 1;
    this.context.segmentIndex = 0;
    return { events };
  }

  /**
   * Exécute le runtime jusqu'au prochain point d'arrêt.
   */
  step(): Step {
    const events: RenderEvent[] = [];

    // Reprise après un arrêt : la fin de page qui suit reste à acquitter même
    // si l'arrêt portait sur la dernière instruction de la page (#136, B7).
    let resumedAfterStop = this.resumedAfterStop;
    this.resumedAfterStop = false;

    // Consume any stale context-change flag from a previous step.
    this.pendingContextChange = false;

    // Reprendre une éventuelle frame suspendue (branche @if ou macro).
    const initialFrameStop = this.drainFrames(events);
    this.pendingContextChange = false;
    if (initialFrameStop) {
      return this.makeStep(events, initialFrameStop);
    }

    while (this.context.pc < this.context.script.pages.length) {
      const page = this.context.script.pages[this.context.pc];
      const instructions = page.instructions;

      // Début de page : vider la textbox. Si le texte est la première instruction
      // et qu'on reprend après un [l] (segmentIndex > 0), la page est déjà
      // commencée : ne rien effacer (#142).
      if (this.context.instructionIndex === 0 && this.context.segmentIndex === 0) {
        events.push({ kind: "clearText" });
      }

      let contextChanged = false;
      // Track whether the inner loop has any instructions to process.
      // If not (e.g., returned from @call past the end of the page),
      // we should advance to the next page without stopping.
      const hadInstructions =
        this.context.instructionIndex < instructions.length || resumedAfterStop;
      resumedAfterStop = false;

      while (this.context.instructionIndex < instructions.length) {
        const instruction = instructions[this.context.instructionIndex];
        const flatTarget = this.flatControlTarget(instruction, this.context.instructionIndex);
        if (flatTarget !== null) {
          this.context.instructionIndex = flatTarget;
          continue;
        }

        if (instruction.kind === "text") {
          const result = this.processText(instruction);
          events.push(...result.events);
          if (result.stop) {
            // Pause sans rien de nouveau à lire : on ne bloque pas (#136, B8).
            if (this.isDeadPause(result.stop, events)) continue;
            return this.makeStep(events, result.stop);
          }
          continue;
        }

        if (instruction.kind === "break") {
          events.push({ kind: "lineBreak" });
          this.context.instructionIndex += 1;
          continue;
        }

        if (this.onCommand) this.onCommand(this.commandNameOf(instruction));
        const tracePosition = this.onTrace || this.onJournal ? this.buildPosition() : null;
        const result = this.applyInstruction(instruction);
        if (this.onTrace && tracePosition) {
          this.onTrace({
            instruction,
            position: tracePosition,
            page: this.resolvedPageOf(instruction),
            events: result.events,
            fore: structuredClone(this.state.fore),
            back: structuredClone(this.state.back),
          });
        }
        if (this.onJournal && tracePosition) {
          const command = this.commandNameOf(instruction);
          if (JOURNAL_COMMANDS.has(command)) this.emitJournalEntry(instruction, command, tracePosition, result);
        }
        events.push(...result.events);
        if (result.stop) {
          this.context.instructionIndex += 1;
          // A loadScript from a top-level instruction must discard pending frames (B7).
          if (result.stop.kind === "loadScript") {
            this.frames = [];
          }
          return this.makeStep(events, result.stop);
        }

        // Si le contexte a changé (call/return), on note le changement et on
        // recommence la boucle externe avec les nouvelles instructions.
        // On n'incrémente PAS instructionIndex : le nouveau contexte porte
        // déjà l'index de reprise (0 pour un call, l'index empilé pour un return).
        if (this.pendingContextChange) {
          this.pendingContextChange = false;
          contextChanged = true;
          break;
        }

        this.context.instructionIndex += 1;

        // Exécuter les éventuelles frames créées par @if ou une macro.
        const frameStop = this.drainFrames(events);
        if (frameStop) {
          return this.makeStep(events, frameStop);
        }
        // Si drainFrames a changé le contexte (jump/call depuis une frame),
        // on sort de la boucle interne pour recommencer avec les nouvelles instructions.
        if (this.pendingContextChange) {
          this.pendingContextChange = false;
          contextChanged = true;
          break;
        }
        // The flag has been consumed by this point.
        this.pendingContextChange = false;
      }

      // La boucle interne s'est terminée par un changement de contexte :
      // on continue la boucle externe sans incrémenter pc.
      if (contextChanged) {
        continue;
      }

      // Fin de page : arrêt sur [p].
      this.context.pc += 1;
      this.context.instructionIndex = 0;
      this.context.segmentIndex = 0;

      // Si on n'a traité aucune instruction sur cette page (retour de @call
      // après la dernière instruction), on continue sans s'arrêter.
      if (!hadInstructions && this.context.pc < this.context.script.pages.length) {
        continue;
      }

      if (this.context.pc >= this.context.script.pages.length && this.callStack.length > 0) {
        this.context = this.callStack.pop()!;
        continue;
      }

      return this.makeStep(events, { kind: "click", style: "page" });
    }

    // Fin du script : le verrou du menu rapide et la suspension de l'auto ne survivent pas
    // au script qui les a posés (dans le jeu d'origine, le prochain arrêt du tracer les lève).
    if (this.state.quickMenuLocked) {
      this.state.quickMenuLocked = false;
      events.push({ kind: "quickMenu", locked: false });
    }
    if (this.state.autoModePaused) {
      this.state.autoModePaused = false;
      events.push({ kind: "autoMode", paused: false });
    }
    return this.makeStep(events, { kind: "end" });
  }

  /**
   * Charger un script externe et l'empiler sur la call stack.
   * @param pushCallStack true pour @call (empile l'adresse de retour), false pour @jump (saut permanent)
   * @param label label optionnel dans le script cible
   */
  async loadScript(storage: string, label?: string, pushCallStack: boolean = true): Promise<boolean> {
    if (!this.scriptLoader) {
      this.onWarning(`scriptLoader not set, cannot load: ${storage}`);
      return false;
    }

    const script = await this.scriptLoader(storage);
    if (!script) {
      this.onWarning(`failed to load script: ${storage}`);
      return false;
    }

    if (pushCallStack) {
      // instructionIndex has already been incremented by step() before we get here.
      this.callStack.push({ ...this.context });
    }
    this.context = { script, pc: 0, instructionIndex: 0, scriptName: storage, segmentIndex: 0 };

    // Jump to label within the loaded script if specified.
    if (label) {
      const pageIdx = script.labels[label];
      if (pageIdx !== undefined) {
        this.context.pc = pageIdx;
        this.context.instructionIndex = script.labelInstructionIndex[label] ?? 0;
      } else {
        this.onWarning(`label not found in ${storage}: ${label}`);
      }
    }
    // Nouveau contexte : le stop loadScript ne compte pas comme un arrêt en fin de page.
    this.resumedAfterStop = false;
    return true;
  }

  jump(label: string): boolean {
    const target = this.context.script.labels[label];
    if (target === undefined) return false;
    this.resumedAfterStop = false;
    this.context.pc = target;
    this.context.instructionIndex = this.context.script.labelInstructionIndex[label] ?? 0;
    this.context.segmentIndex = 0;
    return true;
  }

  // ── Save/Load ──

  getSaveData(): RuntimeSaveData {
    return {
      scriptName: this.context.scriptName,
      pc: this.context.pc,
      instructionIndex: this.context.instructionIndex,
      segmentIndex: this.context.segmentIndex,
      state: {
        fore: structuredClone(this.state.fore),
        back: structuredClone(this.state.back),
        bgm: this.state.bgm,
        bgmPaused: this.state.bgmPaused ?? false,
        se: this.state.se,
        seChannels: this.state.seChannels ? structuredClone(this.state.seChannels) : [],
        variables: structuredClone(this.state.variables),
        evalGlobal: structuredClone(this.state.evalGlobal),
        textbox: this.state.textbox ? { ...this.state.textbox } : undefined,
        effect: this.state.effect,
        textStyle: this.state.textStyle ? { ...this.state.textStyle } : null,
        ploy: this.state.ploy ? { ...this.state.ploy } : null,
        quickMenuLocked: this.state.quickMenuLocked ?? false,
        saveLoadEnabled: this.state.saveLoadEnabled ?? true,
        messageLayer: this.state.messageLayer ?? 0,
        autoModePaused: this.state.autoModePaused ?? false,
        clockHour: this.state.clockHour,
        clockMinute: this.state.clockMinute,
        staffroll: this.state.staffroll
          ? structuredClone(this.state.staffroll)
          : undefined,
      },
      callStack: this.callStack.map((ctx) => ({
        scriptName: ctx.scriptName,
        pc: ctx.pc,
        instructionIndex: ctx.instructionIndex,
        segmentIndex: ctx.segmentIndex,
      })),
      macros: Object.fromEntries(this.macros),
    };
  }

  async loadSaveData(data: RuntimeSaveData, scripts: Map<string, ParsedScript>): Promise<boolean> {
    const script = scripts.get(data.scriptName);
    if (!script) return false;

    this.context = {
      script,
      pc: data.pc,
      instructionIndex: data.instructionIndex,
      scriptName: data.scriptName,
      segmentIndex: data.segmentIndex,
    };

    // Restaurer les variables — gérer l'ancien format plat (Record<string, unknown>).
    const vars = data.state.variables;
    const normalizedVars = isScopedVariables(vars)
      ? structuredClone(vars)
      : { f: structuredClone(vars), sf: {}, tf: {} };

    this.state = {
      ...data.state,
      seChannels: data.state.seChannels?.map((entry) => ({ ...entry })) ?? [],
      fore: structuredClone(data.state.fore),
      back: structuredClone(data.state.back),
      variables: normalizedVars,
      evalGlobal: data.state.evalGlobal ?? {},
      effect: data.state.effect,
      textStyle: data.state.textStyle ? { ...data.state.textStyle } : null,
      ploy: data.state.ploy ? { ...data.state.ploy } : null,
      quickMenuLocked: data.state.quickMenuLocked ?? false,
      saveLoadEnabled: data.state.saveLoadEnabled ?? true,
      messageLayer: data.state.messageLayer ?? 0,
      autoModePaused: data.state.autoModePaused ?? false,
      staffroll: data.state.staffroll
        ? structuredClone(data.state.staffroll)
        : undefined,
    };
    // La séquence de lancement est reconstruite depuis l'ordre sauvegardé (réutilisation du
    // plus ancien one-shot après un load).
    this.seStartedAt = new Map();
    this.seSequence = 0;
    for (const entry of this.state.seChannels ?? []) this.seStartedAt.set(entry.channel, ++this.seSequence);

    // Restore the call stack with resolved script objects.
    this.callStack = data.callStack
      .map((entry) => {
        const s = scripts.get(entry.scriptName);
        if (!s) return null;
        return { script: s, pc: entry.pc, instructionIndex: entry.instructionIndex, scriptName: entry.scriptName, segmentIndex: entry.segmentIndex };
      })
      .filter((ctx): ctx is ScriptContext => ctx !== null);

    // Restore macro definitions.
    if (data.macros) {
      this.macros = new Map(Object.entries(data.macros));
    } else {
      this.macros = new Map();
    }

    return true;
  }
}
