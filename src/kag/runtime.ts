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
} from "./types.js";
import type { PageLayer } from "./types.js";
import type {
  AssetRef,
  AudioChannel,
  AudioEvent,
  EffectState,
  Ms,
  Position,
  QuakeSpec,
  RenderEvent,
  SceneState,
  SpriteState,
  StaffrollState,
  Step,
  StopReason,
  TextboxState,
  TransitionSpec,
} from "./events.js";

export type RuntimeSaveData = {
  scriptName: string;
  pc: number;
  instructionIndex: number;
  state: RuntimeState;
  callStack: { scriptName: string; pc: number; instructionIndex: number }[];
};

export type PageState = {
  background: string;
  layers: Layer[];
};

export type RuntimeState = {
  fore: PageState;
  back: PageState;
  bgm: string | null;
  se: string | null;
  variables: Record<string, unknown>;
  staffroll?: {
    lines: { text: string; y: number; size: number; face?: string; cmx?: number }[];
    face?: string;
    running: boolean;
    height: number;
    time: number;
    elapsed: number;
  };
  textbox?: TextboxState;
  /** Effet visuel actuellement appliqué sur la scène. */
  effect?: EffectState | null;
};

export type ScriptContext = {
  script: ParsedScript;
  pc: number;
  instructionIndex: number;
  scriptName: string;
};

export function createRuntimeState(): RuntimeState {
  return {
    fore: { background: "", layers: [] },
    back: { background: "", layers: [] },
    bgm: null,
    se: null,
    variables: {},
    staffroll: { lines: [], running: false, height: 10000, time: 60000, elapsed: 0 },
    textbox: { visible: true, frame: true },
    effect: null,
  };
}

export class Runtime {
  private context: ScriptContext;
  private callStack: ScriptContext[] = [];
  private state: RuntimeState;

  /** Callback pour charger un script par son nom de fichier. */
  public scriptLoader: ((storage: string) => Promise<ParsedScript | null>) | null = null;

  public onWarning: (message: string) => void = console.warn;

  constructor(
    script: ParsedScript,
    scriptName: string = "main",
    initialState: RuntimeState = createRuntimeState(),
  ) {
    this.context = { script, pc: 0, instructionIndex: 0, scriptName };
    this.state = initialState;
  }

  get currentPage(): Page | null {
    return this.context.script.pages[this.context.pc] ?? null;
  }

  get currentScriptName(): string {
    return this.context.scriptName;
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
    return {
      position: this.buildPosition(segment),
      events,
      stop,
    };
  }

  private getPageState(page?: PageLayer): PageState {
    return page === "back" ? this.state.back : this.state.fore;
  }

  private layerToSprite(layer: Layer): SpriteState {
    return {
      id: String(layer.index),
      storage: layer.storage,
      x: layer.center,
      y: layer.vcenter,
      z: layer.index,
      opacity: layer.opacity,
    };
  }

  private buildSceneState(page: PageLayer = "fore"): SceneState {
    const target = page === "back" ? this.state.back : this.state.fore;
    return {
      bg: target.background || null,
      sprites: target.layers.map((l) => this.layerToSprite(l)),
      effect: this.buildEffectState(),
    };
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

  private applyBg(instruction: Extract<Instruction, { kind: "bg" }>): RenderEvent | null {
    const target = this.getPageState(instruction.page);
    target.background = instruction.storage;
    if (instruction.page === "back") return null;
    return this.emitScene(this.makeTransition(instruction.time, instruction.rule));
  }

  private applyFg(instruction: Extract<Instruction, { kind: "fg" }>): RenderEvent | null {
    const target = this.getPageState(instruction.page);
    const layer: Layer = {
      storage: instruction.storage,
      center: instruction.center,
      vcenter: instruction.vcenter,
      index: instruction.index,
      opacity: instruction.opacity ?? 1,
    };
    target.layers = target.layers.filter((l) => l.index !== layer.index);
    target.layers.push(layer);
    if (instruction.page === "back") return null;
    return this.emitScene({ method: "none" });
  }

  private applyAnimate(instruction: Extract<Instruction, { kind: "animate" }>): RenderEvent[] {
    const def = instruction.def;
    const target = this.getPageState(def.page);
    const lastFrame = def.keyframes[def.keyframes.length - 1];
    const firstFrame = def.keyframes[0];
    const layer: Layer = {
      storage: def.storage,
      center: lastFrame?.center ?? firstFrame?.center ?? 512,
      vcenter: lastFrame?.vcenter ?? firstFrame?.vcenter ?? 288,
      index: parseInt(def.id ?? "1"),
      opacity: lastFrame?.opacity ?? firstFrame?.opacity ?? 1,
    };
    target.layers = target.layers.filter((l) => l.storage !== layer.storage);
    target.layers.push(layer);

    const events: RenderEvent[] = [];
    if (!def.page || def.page === "fore") {
      events.push(this.emitScene({ method: "none" }));
    }
    events.push({ kind: "animate", target: String(layer.index), def });
    return events;
  }

  private applyClall(instruction: Extract<Instruction, { kind: "clall" }>): RenderEvent | null {
    const target = this.getPageState(instruction.page);
    target.layers = [];
    if (instruction.page === "back") return null;
    return this.emitScene({ method: "none" });
  }

  private applyClfg(instruction: Extract<Instruction, { kind: "clfg" }>): RenderEvent | null {
    const target = this.getPageState(instruction.page);
    if (instruction.storage) {
      target.layers = target.layers.filter((l) => l.storage !== instruction.storage);
    } else if (instruction.index !== undefined) {
      target.layers = target.layers.filter((l) => l.index !== instruction.index);
    }
    if (instruction.page === "back") return null;
    return this.emitScene({ method: "none" });
  }

  private applyBacklay(instruction: Extract<Instruction, { kind: "backlay" }>): RenderEvent[] {
    const storage = instruction.storage;
    if (!storage || storage === "fg") {
      this.state.back.layers = this.state.fore.layers.slice();
    }
    if (!storage || storage === "bg") {
      this.state.back.background = this.state.fore.background;
    }
    return [];
  }

  private applyTrans(instruction: Extract<Instruction, { kind: "trans" }>): RenderEvent {
    this.state.fore = {
      background: this.state.back.background,
      layers: this.state.back.layers.slice(),
    };
    return this.emitScene(this.makeTransition(instruction.time, instruction.rule));
  }

  private buildAudioEvent(action: AudioEvent["kind"], channel: AudioChannel, args: Omit<AudioEvent & { kind: typeof action }, "kind" | "channel">): AudioEvent {
    return { kind: action, channel, ...args } as AudioEvent;
  }

  private applyAudio(instruction: Instruction): RenderEvent | null {
    let event: AudioEvent | null = null;
    switch (instruction.kind) {
      case "play": {
        this.state.bgm = instruction.storage;
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
        event = { kind: "stop", channel: "bgm" };
        break;
      }
      case "fadebgm": {
        this.state.bgm = null;
        event = { kind: "fade", channel: "bgm", volume: 0, time: instruction.time };
        break;
      }
      case "se": {
        this.state.se = instruction.storage;
        event = {
          kind: "play",
          channel: "se:0",
          storage: instruction.storage,
          loop: false,
          volume: (instruction.volume ?? 100) / 100,
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

    if (instruction.kind === "textoff") {
      visible = false;
      time = instruction.time;
    } else if (instruction.kind === "texton") {
      visible = true;
      time = 300;
    } else if (instruction.kind === "position") {
      if (instruction.visible !== undefined) visible = instruction.visible;
    } else if (instruction.kind === "invisibleframe") {
      frame = false;
    } else if (instruction.kind === "visibleframe") {
      frame = true;
    }

    const state = this.buildTextboxState();
    if (visible !== undefined) state.visible = visible;
    if (frame !== undefined) state.frame = frame;
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
    try {
      const fn = new Function("tf", `"use strict"; return (${instruction.expression});`);
      fn(this.state.variables);
    } catch (err) {
      this.onWarning(`eval failed: ${instruction.expression} — ${err}`);
    }
    return [];
  }

  private applyJump(instruction: Extract<Instruction, { kind: "jump" }>): void {
    const target = this.context.script.labels[instruction.label];
    if (target !== undefined) {
      this.context.pc = target;
      this.context.instructionIndex = 0;
    } else {
      this.onWarning(`unknown label: ${instruction.label}`);
    }
  }

  private applyCall(instruction: Extract<Instruction, { kind: "call" }>): StopReason | null {
    const target = this.context.script.labels[instruction.label];
    if (target !== undefined) {
      this.callStack.push({ ...this.context, pc: this.context.pc + 1, instructionIndex: 0 });
      this.context.pc = target;
      this.context.instructionIndex = 0;
      return null;
    }
    if (instruction.label.includes(".")) {
      return { kind: "loadScript", file: instruction.label };
    }
    this.onWarning(`unknown label: ${instruction.label}`);
    return null;
  }

  private applyReturn(): void {
    const prevContext = this.callStack.pop();
    if (prevContext !== undefined) {
      this.context = prevContext;
    }
  }

  private applyInstruction(instruction: Instruction): { events: RenderEvent[]; stop?: StopReason } {
    const events: RenderEvent[] = [];

    switch (instruction.kind) {
      case "bg": {
        const ev = this.applyBg(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "fg": {
        const ev = this.applyFg(instruction);
        if (ev) events.push(ev);
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
      case "trans":
        events.push(this.applyTrans(instruction));
        break;
      case "play":
      case "playstop":
      case "fadebgm":
      case "se":
      case "sestop":
      case "fadese": {
        const ev = this.applyAudio(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "quake":
        events.push(this.applyQuake(instruction));
        break;
      case "stopquake":
        events.push({ kind: "quake", quake: null });
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
      case "beginploy":
        // Ploy non supporté dans cette version.
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
      case "jump":
        this.applyJump(instruction);
        break;
      case "call": {
        const stop = this.applyCall(instruction);
        if (stop) return { events, stop };
        break;
      }
      case "return":
        this.applyReturn();
        break;
      case "wait":
        return { events, stop: { kind: "wait", time: instruction.time, skippable: true } };
      case "text":
      case "break":
        // Traités dans step() car le texte peut s'arrêter sur [l].
        break;
      case "raw":
        // Commande inconnue tolérée.
        break;
    }

    return { events };
  }

  private processText(instruction: Extract<Instruction, { kind: "text" }>): { events: RenderEvent[]; stop?: StopReason } {
    const events: RenderEvent[] = [];
    const segments = instruction.segments;
    const pauseIndex = segments.findIndex((seg) => "pause" in seg && seg.pause);

    if (pauseIndex === -1) {
      // Pas de pause : on consomme tout le texte et on passe à l'instruction suivante.
      if (segments.length > 0) {
        events.push({ kind: "text", segments });
      }
      this.context.instructionIndex += 1;
      return { events };
    }

    // On émet le texte jusqu'à la pause [l], on garde le reste pour la prochaine étape.
    const before = segments.slice(0, pauseIndex);
    const after = segments.slice(pauseIndex + 1);
    if (before.length > 0) {
      events.push({ kind: "text", segments: before });
    }
    instruction.segments = after;
    return { events, stop: { kind: "click", style: "line" } };
  }

  /**
   * Exécute le runtime jusqu'au prochain point d'arrêt.
   */
  step(): Step {
    const events: RenderEvent[] = [];

    while (this.context.pc < this.context.script.pages.length) {
      const page = this.context.script.pages[this.context.pc];
      const instructions = page.instructions;

      // Début de page : vider la textbox.
      if (this.context.instructionIndex === 0) {
        events.push({ kind: "clearText" });
      }

      let contextChanged = false;

      while (this.context.instructionIndex < instructions.length) {
        const instruction = instructions[this.context.instructionIndex];
        const startScriptName = this.context.scriptName;
        const startPc = this.context.pc;

        if (instruction.kind === "text") {
          const result = this.processText(instruction);
          events.push(...result.events);
          if (result.stop) {
            return this.makeStep(events, result.stop);
          }
          continue;
        }

        if (instruction.kind === "break") {
          events.push({ kind: "lineBreak" });
          this.context.instructionIndex += 1;
          continue;
        }

        const result = this.applyInstruction(instruction);
        events.push(...result.events);
        if (result.stop) {
          this.context.instructionIndex += 1;
          return this.makeStep(events, result.stop);
        }

        // Si le contexte a changé (call/return), on note le changement et on
        // recommence la boucle externe avec les nouvelles instructions.
        // On n'incrémente PAS instructionIndex : le nouveau contexte porte
        // déjà l'index de reprise (0 pour un call, l'index empilé pour un return).
        if (this.context.scriptName !== startScriptName || this.context.pc !== startPc) {
          contextChanged = true;
          break;
        }

        this.context.instructionIndex += 1;
      }

      // La boucle interne s'est terminée par un changement de contexte :
      // on continue la boucle externe sans incrémenter pc.
      if (contextChanged) {
        continue;
      }

      // Fin de page : arrêt sur [p].
      this.context.pc += 1;
      this.context.instructionIndex = 0;

      if (this.context.pc >= this.context.script.pages.length && this.callStack.length > 0) {
        this.context = this.callStack.pop()!;
        continue;
      }

      return this.makeStep(events, { kind: "click", style: "page" });
    }

    return this.makeStep(events, { kind: "end" });
  }

  /**
   * Charger un script externe et l'empiler sur la call stack.
   */
  async loadScript(storage: string): Promise<boolean> {
    if (!this.scriptLoader) {
      this.onWarning(`scriptLoader not set, cannot load: ${storage}`);
      return false;
    }

    const script = await this.scriptLoader(storage);
    if (!script) {
      this.onWarning(`failed to load script: ${storage}`);
      return false;
    }

    this.callStack.push({ ...this.context, pc: this.context.pc + 1, instructionIndex: 0 });
    this.context = { script, pc: 0, instructionIndex: 0, scriptName: storage };
    return true;
  }

  jump(label: string): boolean {
    const target = this.context.script.labels[label];
    if (target === undefined) return false;
    this.context.pc = target;
    this.context.instructionIndex = 0;
    return true;
  }

  // ── Save/Load ──

  getSaveData(): RuntimeSaveData {
    return {
      scriptName: this.context.scriptName,
      pc: this.context.pc,
      instructionIndex: this.context.instructionIndex,
      state: {
        fore: { ...this.state.fore, layers: this.state.fore.layers.slice() },
        back: { ...this.state.back, layers: this.state.back.layers.slice() },
        bgm: this.state.bgm,
        se: this.state.se,
        variables: { ...this.state.variables },
        textbox: this.state.textbox ? { ...this.state.textbox } : undefined,
      },
      callStack: this.callStack.map((ctx) => ({
        scriptName: ctx.scriptName,
        pc: ctx.pc,
        instructionIndex: ctx.instructionIndex,
      })),
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
    };
    this.state = {
      ...data.state,
      fore: { ...data.state.fore, layers: data.state.fore.layers.slice() },
      back: { ...data.state.back, layers: data.state.back.layers.slice() },
      variables: { ...data.state.variables },
    };
    this.callStack = [];
    return true;
  }
}
