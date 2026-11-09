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
  AnimationDef,
  Instruction,
  Layer,
  Page,
  ParsedScript,
  TextSegment,
  TextStyle,
  Token,
} from "./types.js";
import { parseCommand } from "./parser.js";
import { lookupTimeline, type TimelineBg, type TimelineData } from "@/core/timeline.js";
import type { PageLayer } from "./types.js";
import type {
  AssetRef,
  AudioChannel,
  AudioEvent,
  EffectState,
  Ms,
  PloyState,
  Position,
  QuakeSpec,
  RenderEvent,
  SceneState,
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
  bgEffect?: string;
  bgBrightness?: number;
  bgContrast?: number;
  bgBlurX?: number;
  bgBlurY?: number;
  layers: Layer[];
};

/** Zoom (%) et rotation (degrés) qui s'appliquent à un fond ou un calque. */
type TransformValues = { zoomx?: number; zoomy?: number; rotate?: number };

/** Valeurs neutres : un zoom de 100 % ou une rotation de 0° ne s'écrivent pas dans l'état. */
const NEUTRAL_ZOOM = 100;
const NEUTRAL_ROTATE = 0;

/**
 * Applique à `target` les zoom/rotation précisés dans `patch` (ceux qui sont `undefined` ne
 * changent rien). Une valeur neutre retire le champ : l'état ne porte que ce qui modifie l'image.
 */
function patchTransform(
  target: { zoomx?: number; zoomy?: number; rotate?: number },
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
  return fields;
}

export type RuntimeState = {
  fore: PageState;
  back: PageState;
  bgm: string | null;
  /** La BGM est en pause (@playpause) : une reprise (@playresume) la relance. */
  bgmPaused?: boolean;
  se: string | null;
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
    lines: { text: string; y: number; size: number; face?: string; cmx?: number }[];
    face?: string;
    running: boolean;
    height: number;
    time: number;
    elapsed: number;
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
  /** Avance automatique suspendue (@pauseautomode) ; absent = non suspendue. */
  autoModePaused?: boolean;
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
    event.kind !== "autoMode"
  );
}

/** Durée des fondus enchaînés entre deux fonds d'une timeline (ms). */
const TIMELINE_FADE_MS = 1500;

/** Durée du fondu qui réaffiche la textbox quand un texte arrive (ms, #159). */
const TEXTBOX_REVEAL_MS = 300;

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
    autoModePaused: false,
  };
}

export class Runtime {
  private context: ScriptContext;
  private callStack: ScriptContext[] = [];
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

  /** Macros définies par @macro/@endmacro. */
  private macros: Map<string, Token[]> = new Map();

  /** Current macro parameter map (exposed as `mp` in expressions). */
  private macroParams: Record<string, unknown> = {};

  /** Minimal kag proxy for TJS expressions that reference kag.*. */
  private kagProxy = {
    con: { crashAction: "" },
    flags: {},
    /** Un SE est-il en cours ? Approximation : le dernier SE lancé n'a pas été arrêté. */
    isplayingse: (storage: string): boolean => this.state.se === storage,
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
    return instructions;
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
    const segments = instruction.segments;
    const startIdx = frame.segmentIndex;

    let pauseIndex = -1;
    for (let i = startIdx; i < segments.length; i++) {
      const seg = segments[i];
      if (seg && "pause" in seg && (seg as { pause: boolean }).pause) {
        pauseIndex = i;
        break;
      }
    }

    if (pauseIndex === -1) {
      const remaining = this.withTextStyle(segments.slice(startIdx));
      if (remaining.length > 0) {
        events.push({ kind: "text", segments: remaining });
      }
      frame.segmentIndex = 0;
      frame.index += 1;
      return { events };
    }

    const before = this.withTextStyle(segments.slice(startIdx, pauseIndex));
    if (before.length > 0) {
      events.push({ kind: "text", segments: before });
    }
    frame.segmentIndex = pauseIndex + 1;
    return { events, stop: { kind: "click", style: "line" } };
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
    if (layer.partbgId) sprite.partbgId = layer.partbgId;
    if (layer.zoomx !== undefined) sprite.zoomx = layer.zoomx;
    if (layer.zoomy !== undefined) sprite.zoomy = layer.zoomy;
    if (layer.rotate !== undefined) sprite.rotate = layer.rotate;
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
    return scene;
  }

  private buildEffectState(): EffectState | null {
    return this.state.effect ?? null;
  }

  private buildTextboxState(): TextboxState {
    return this.state.textbox ?? { visible: true, frame: true };
  }

  private buildStaffrollState(): StaffrollState {
    if (!this.state.staffroll) return null;
    return {
      lines: this.state.staffroll.lines,
      face: this.state.staffroll.face,
      running: this.state.staffroll.running,
      height: this.state.staffroll.height,
      time: this.state.staffroll.time,
      elapsed: this.state.staffroll.elapsed,
    };
  }

  private makeTransition(time: number, rule?: string): TransitionSpec {
    if (!rule || rule === "crossfade") {
      return time > 0 ? { method: "crossfade", time } : { method: "none" };
    }
    return { method: "universal", time, rule, vague: 32 };
  }

  private emitScene(transition: TransitionSpec): RenderEvent {
    return {
      kind: "scene",
      scene: this.buildSceneState("fore"),
      transition,
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
    if (!first) return null;
    const page = this.resolvePage("bgact", instruction.page);
    const target = this.getPageState(page);
    if (!target.background) return null;
    if (first.left !== undefined && first.top !== undefined) {
      target.bgLeft = first.left;
      target.bgTop = first.top;
    }
    this.patchBgTransform(target, {
      zoomx: first.zoomx !== undefined ? first.zoomx * 100 : undefined,
      zoomy: first.zoomy !== undefined ? first.zoomy * 100 : undefined,
      rotate: first.rotate,
    });
    if (page === "back") return null;
    return this.emitScene({ method: "none" });
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
    const key = instruction.id ?? instruction.storage;
    let found = false;
    target.layers = target.layers.map((l) => {
      if (l.id !== key && (instruction.id === undefined || l.storage !== key)) return l;
      found = true;
      const changed: Layer = { ...l, storage: instruction.storage, id: instruction.id ?? l.id };
      patchTransform(changed, instruction);
      // `@chgfg` change l'image mais conserve position/z/opacité : les attributs d'apparence
      // ne sont remplacés que s'ils sont précisés (contrairement à `@fg`, nouvelle image).
      patchAppearance(changed, instruction);
      return changed;
    });
    if (!found) {
      // Calque inexistant : on en crée un par défaut (centré).
      const id = instruction.id ?? instruction.storage;
      const created: Layer = {
        id,
        storage: instruction.storage,
        center: 512,
        vcenter: 288,
        index: instruction.index ?? 1,
        opacity: 1,
      };
      patchTransform(created, instruction);
      clearAppearance(created);
      patchAppearance(created, instruction);
      target.layers.push(created);
    }
    return this.revealLayerChange(page, instruction);
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

    if (page === "fore") {
      events.push(this.emitScene({ method: "none" }));
    }
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

  private applyTrans(instruction: Extract<Instruction, { kind: "trans" }>): { events: RenderEvent[]; stop?: StopReason } {
    // fore = clone(back) ; back conservé (sémantique KAG exchange=false).
    this.state.fore = { ...bgFieldsOf(this.state.back), layers: this.state.back.layers.slice() };
    const events: RenderEvent[] = [this.emitScene(this.makeTransition(instruction.time, instruction.rule))];
    if (!instruction.nowait) {
      return { events, stop: { kind: "waitFor", what: "transition", skippable: instruction.canskip ?? true } };
    }
    return { events };
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
        events.push({ kind: "bgMove", left: bg.left, top: bg.top, time: 0, zoomx: bg.zoomx ?? 100, zoomy: bg.zoomy ?? 100, rotate: bg.rotate ?? 0 });
      }
      entries.push({ at: bg.at, order: order++, events });
    }

    // Panoramiques : chacun déplace le fond affiché à son instant. L'état final reçoit
    // la position atteinte par le dernier panoramique du dernier fond.
    const lastBgAt = previous?.at ?? 0;
    for (const m of scene.moves ?? []) {
      const move: RenderEvent = { kind: "bgMove", left: m.left, top: m.top, time: m.time };
      if (m.accel) move.accel = m.accel;
      if (m.zoomx !== undefined) move.zoomx = m.zoomx;
      if (m.zoomy !== undefined) move.zoomy = m.zoomy;
      if (m.rotate !== undefined) move.rotate = m.rotate;
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
      const event: RenderEvent = { kind: "timelineLayer", layer, time: k.time };
      if (k.accel) event.accel = k.accel;
      entries.push({ at: k.at, order: order++, events: [event] });
    }
    for (const effect of unsupportedEffects) this.onWarning(`effet de calque non pris en charge : ${effect}`);

    for (const a of scene.audio) {
      const channel = a.channel === "bgm" ? "bgm" : "se:0";
      let event: AudioEvent;
      if (a.action === "play" && a.storage) {
        if (a.channel === "bgm") {
          this.state.bgm = a.storage;
        } else {
          this.state.se = a.storage;
        }
        event = { kind: "play", channel, storage: a.storage, loop: a.loop, volume: a.volume };
      } else {
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

  private applyAudio(instruction: Instruction): RenderEvent | null {
    let event: AudioEvent | null = null;
    switch (instruction.kind) {
      case "play": {
        this.state.bgm = instruction.storage;
        this.state.bgmPaused = false;
        event = {
          kind: "play",
          channel: "bgm",
          storage: instruction.storage,
          loop: true,
          volume: (instruction.volume ?? 100) / 100,
        };
        break;
      }
      case "playstop": {
        this.state.bgm = null;
        this.state.bgmPaused = false;
        event = { kind: "stop", channel: "bgm", fadeOut: instruction.time };
        break;
      }
      case "playpause": {
        // Sans BGM en cours, ou déjà en pause : sans effet.
        if (this.state.bgm === null || this.state.bgmPaused) break;
        this.state.bgmPaused = true;
        event = { kind: "pause", channel: "bgm", fadeOut: instruction.time };
        break;
      }
      case "playresume": {
        const volume = instruction.volume / 100;
        if (this.state.bgm !== null) {
          this.state.bgmPaused = false;
          event = { kind: "resume", channel: "bgm", volume, fadeIn: instruction.time };
        } else if (instruction.storage) {
          // Rien à reprendre mais la piste est nommée : on la lance en fondu.
          this.state.bgm = instruction.storage;
          this.state.bgmPaused = false;
          event = { kind: "play", channel: "bgm", storage: instruction.storage, loop: true, volume, fadeIn: instruction.time };
        }
        break;
      }
      case "fadebgm": {
        // Ne pas nullifier state.bgm : on fonde le volume, la BGM continue
        // de jouer (silencieuse si volume=0) et reste préservée pour
        // reduceAudio/sauvegarde (doc §9 : fade vers volume cible).
        event = {
          kind: "fade",
          channel: "bgm",
          volume: (instruction.volume ?? 0) / 100,
          time: instruction.time,
        };
        break;
      }
      case "se": {
        this.state.se = instruction.storage;
        event = {
          kind: "play",
          channel: "se:0",
          storage: instruction.storage,
          loop: instruction.loop ?? false,
          volume: (instruction.volume ?? 100) / 100,
          delay: instruction.delay,
        };
        break;
      }
      case "seact": {
        // @seact = SE avec délai et fondu
        // On utilise se:0 pour l'instant (même limitation que @se).
        this.state.se = instruction.storage;
        event = {
          kind: "play",
          channel: "se:0",
          storage: instruction.storage,
          loop: instruction.loop,
          volume: instruction.volume / 100,
          fadeIn: instruction.fadeIn,
          delay: instruction.delay,
        };
        break;
      }
      case "sestop": {
        this.state.se = null;
        event = {
          kind: "stop",
          channel: instruction.storage ? ("se:0" as AudioChannel) : "allSe",
          fadeOut: instruction.time,
        };
        break;
      }
      case "fadese": {
        event = {
          kind: "fade",
          channel: "se:0",
          volume: instruction.volume / 100,
          time: instruction.time,
        };
        break;
      }
    }
    return event ? { kind: "audio", event } : null;
  }

  private applyQuake(instruction: Extract<Instruction, { kind: "quake" }>): RenderEvent {
    const quake: QuakeSpec = {
      time: instruction.time,
      hmax: instruction.hmax,
      vmax: instruction.vmax,
    };
    return { kind: "quake", quake };
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
      });
    } else if (instruction.kind === "staffrollstart") {
      if (this.state.staffroll) {
        this.state.staffroll.running = true;
        this.state.staffroll.height = instruction.height;
        this.state.staffroll.time = instruction.time;
        this.state.staffroll.elapsed = 0;
      }
    }
    return { kind: "staffroll", state: this.buildStaffrollState() };
  }

  private applyEval(instruction: Extract<Instruction, { kind: "eval" }>): RenderEvent[] {
    this.evaluateExpression(instruction.expression);
    return [];
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
        // Push return address: same page, instruction AFTER the @call.
        // If called from a frame, use the frame's returnIndex (the instruction
        // after the @endif / macro) to avoid resuming inside the block.
        const currentFrame = this.frames.length > 0
          ? this.frames[this.frames.length - 1]
          : undefined;
        const hasUnfinishedFrame = this.frames.some(
          (f) => f.index < f.instructions.length - 1,
        );
        if (hasUnfinishedFrame) {
          this.onWarning("@call inside @if/macro skips remaining instructions until @endif/endmacro");
        }
        const returnIndex = currentFrame?.returnIndex ?? this.context.instructionIndex + 1;
        this.callStack.push({
          ...this.context,
          instructionIndex: returnIndex,
          segmentIndex: 0,
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
      this.context = prevContext;
      this.frames = [];
      this.macroParams = {};
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
        const ev = this.applyAudio(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "playtimeline": {
        const res = this.applyPlaytimeline(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "quake":
        events.push(this.applyQuake(instruction));
        break;
      case "stopquake":
        events.push({ kind: "quake", quake: null });
        break;
      case "lockquickmenu":
      case "unlockquickmenu": {
        const locked = instruction.kind === "lockquickmenu";
        this.state.quickMenuLocked = locked;
        events.push({ kind: "quickMenu", locked });
        break;
      }
      case "pauseautomode":
      case "resumeautomode": {
        const paused = instruction.kind === "pauseautomode";
        this.state.autoModePaused = paused;
        events.push({ kind: "autoMode", paused });
        break;
      }
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
      case "staffrollinit":
      case "staffrolltext":
      case "staffrollstart": {
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
      case "wait":
        return { events, stop: { kind: "wait", time: instruction.time, skippable: instruction.skippable ?? true } };
      case "waitfor":
        return { events, stop: { kind: "waitFor", what: instruction.what, skippable: instruction.skippable ?? true } };
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
    const readable = segments.some((seg) => "text" in seg && seg.text.trim().length > 0);
    if (!readable) return;
    const state = { ...this.buildTextboxState(), visible: true };
    this.state.textbox = state;
    events.push({ kind: "textbox", state, time: TEXTBOX_REVEAL_MS });
  }

  private processText(instruction: Extract<Instruction, { kind: "text" }>): { events: RenderEvent[]; stop?: StopReason } {
    const events: RenderEvent[] = [];
    const segments = instruction.segments;
    const startIdx = this.context.segmentIndex;
    this.revealTextboxForText(segments.slice(startIdx), events);

    // Find the next pause after our current position.
    let pauseIndex = -1;
    for (let i = startIdx; i < segments.length; i++) {
      const seg = segments[i];
      if (seg && "pause" in seg && (seg as { pause: boolean }).pause) {
        pauseIndex = i;
        break;
      }
    }

    if (pauseIndex === -1) {
      // No pause: consume all remaining text and move to next instruction.
      const remaining = this.withTextStyle(segments.slice(startIdx));
      if (remaining.length > 0) {
        events.push({ kind: "text", segments: remaining });
      }
      this.context.instructionIndex += 1;
      this.context.segmentIndex = 0;
      return { events };
    }

    // Emit text up to the pause [l], save position for next step.
    const before = this.withTextStyle(segments.slice(startIdx, pauseIndex));
    if (before.length > 0) {
      events.push({ kind: "text", segments: before });
    }
    this.context.segmentIndex = pauseIndex + 1;
    return { events, stop: { kind: "click", style: "line" } };
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

        const tracePosition = this.onTrace ? this.buildPosition() : null;
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
        variables: structuredClone(this.state.variables),
        evalGlobal: structuredClone(this.state.evalGlobal),
        textbox: this.state.textbox ? { ...this.state.textbox } : undefined,
        effect: this.state.effect,
        textStyle: this.state.textStyle ? { ...this.state.textStyle } : null,
        ploy: this.state.ploy ? { ...this.state.ploy } : null,
        quickMenuLocked: this.state.quickMenuLocked ?? false,
        autoModePaused: this.state.autoModePaused ?? false,
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
      fore: structuredClone(data.state.fore),
      back: structuredClone(data.state.back),
      variables: normalizedVars,
      evalGlobal: data.state.evalGlobal ?? {},
      effect: data.state.effect,
      textStyle: data.state.textStyle ? { ...data.state.textStyle } : null,
      ploy: data.state.ploy ? { ...data.state.ploy } : null,
      quickMenuLocked: data.state.quickMenuLocked ?? false,
      autoModePaused: data.state.autoModePaused ?? false,
      staffroll: data.state.staffroll
        ? structuredClone(data.state.staffroll)
        : undefined,
    };

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
