/**
 * Minimal KAG3 runtime with fore/back layer model and multi-script support.
 *
 * KiriKiri uses a dual-buffer system:
 * - "fore" page: what's currently displayed
 * - "back" page: where changes are prepared before a transition
 * - @trans copies back → fore with a visual transition
 *
 * Multi-script:
 * - @call storage=xxx.ks loads another script file
 * - @return goes back to the calling script
 * - The runtime uses a callback (scriptLoader) to fetch scripts asynchronously
 */

import type { AnimationDef, Instruction, Layer, Page, ParsedScript, TextSegment } from "./types.js";
import type { PageLayer } from "./types.js";

export type PendingAudioAction =
  | { action: "stopBgm"; time?: number }
  | { action: "fadeBgm"; time: number }
  | { action: "stopSe"; storage?: string; time?: number }
  | { action: "fadeSe"; storage?: string; time: number; volume: number };

export type PendingQuake = {
  vmax: number;
  hmax: number;
  time: number;
  interval: number;
};

export type PendingTextbox = {
  visible: boolean;
  time: number;
};

export type PendingFrame = {
  visible: boolean;
};

export type PendingEffect =
  | { kind: "noise"; opacity: number; monocro?: boolean }
  | { kind: "haze"; power: number; delta: number; omega: number }
  | { kind: "stophaze" };

export type RuntimeSaveData = {
  scriptName: string;
  pc: number;
  state: RuntimeState;
  callStack: { scriptName: string; pc: number }[];
};

export type { Layer };

export type PageState = {
  background: string;
  layers: Layer[];
};

export type StaffrollLine = {
  text: string;
  y: number;
  size: number;
  face?: string;
  cmx?: number;
};

export type RuntimeState = {
  fore: PageState;
  back: PageState;
  bgm: string | null;
  se: string | null;
  variables: Record<string, unknown>;
  staffroll?: {
    lines: StaffrollLine[];
    face?: string;
    running: boolean;
    height: number;
    time: number;
    elapsed: number;
  };
};

export type ScriptContext = {
  script: ParsedScript;
  pc: number;
  scriptName: string;
};
export type RuntimeSnapshot = {
  page: number;
  totalPages: number;
  label?: string;
  scriptName: string;
  segments: TextSegment[];
  text: string;
  state: RuntimeState;
  /** L'état "fore" qui doit être rendu */
  display: PageState;
  /** S'il y a eu une transition @trans sur cette page */
  transition: boolean;
  /** Une demande de chargement de script est en attente */
  pendingScriptLoad?: string;
  /** Une animation est en attente pour le renderer */
  pendingAnimation?: AnimationDef | null;
  /** Une action audio est en attente pour le renderer */
  pendingAudioAction?: PendingAudioAction | null;
  /** Un tremblement d'écran est en attente pour le renderer */
  pendingQuake?: PendingQuake | null;
  /** La visibilité de la textbox est en attente pour le renderer */
  pendingTextbox?: PendingTextbox | null;
  /** La visibilité de la bordure de la textbox est en attente pour le renderer */
  pendingFrame?: PendingFrame | null;
  /** Un effet visuel est en attente pour le renderer */
  pendingEffect?: PendingEffect | null;
  /** Temps d'attente demandé par @wait (ms), 0 = pas de wait */
  waitTime?: number;
  waiting: boolean;
};

export function createRuntimeState(): RuntimeState {
  return {
    fore: { background: "", layers: [] },
    back: { background: "", layers: [] },
    bgm: null,
    se: null,
    variables: {},
    staffroll: { lines: [], running: false, height: 10000, time: 60000, elapsed: 0 },
  };
}

export class Runtime {
  private context: ScriptContext;
  private callStack: ScriptContext[] = [];
  private state: RuntimeState;

  /** Callback pour charger un script par son nom de fichier */
  public scriptLoader: ((storage: string) => Promise<ParsedScript | null>) | null = null;

  public onWarning: (message: string) => void = console.warn;

  /** Animation en attente pour le renderer */
  public pendingAnimation: AnimationDef | null = null;

  /** Action audio en attente pour le renderer */
  public pendingAudioAction: PendingAudioAction | null = null;

  /** Tremblement d'écran en attente pour le renderer */
  public pendingQuake: PendingQuake | null = null;

  /** Visibilité de la textbox en attente pour le renderer */
  public pendingTextbox: PendingTextbox | null = null;

  /** Visibilité de la bordure de la textbox en attente pour le renderer */
  public pendingFrame: PendingFrame | null = null;

  /** Effet visuel en attente pour le renderer */
  public pendingEffect: PendingEffect | null = null;

  /** Temps d'attente demandé par @wait (ms) */
  public waitTime: number = 0;

  constructor(script: ParsedScript, scriptName: string = "main", initialState: RuntimeState = createRuntimeState()) {
    this.context = { script, pc: 0, scriptName };
    this.state = initialState;
  }

  get currentPage(): Page | null {
    return this.context.script.pages[this.context.pc] ?? null;
  }

  get currentScriptName(): string {
    return this.context.scriptName;
  }

  private pcChanged = false;

  private getPageState(page?: PageLayer): PageState {
    if (page === "back") return this.state.back;
    return this.state.fore;
  }

  private applyInstruction(instruction: Instruction): boolean | string {
    // Retourne true si une transition @trans a eu lieu
    // Retourne une string si un chargement de script est nécessaire
    switch (instruction.kind) {
      case "bg": {
        const target = this.getPageState(instruction.page);
        target.background = instruction.storage;
        break;
      }
      case "fg": {
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
        break;
      }
      case "animate": {
        // Pour le runtime, on place le sprite à la position finale de l'animation
        const def = instruction.def;
        const target = this.getPageState(def.page);
        const lastFrame = def.keyframes[def.keyframes.length - 1];
        // Première keyframe pour la position initiale
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
        if (!def.page || def.page === "fore") {
          this.state.back.layers = target.layers.slice();
        }
        // Exposer l'animation pour le renderer
        this.pendingAnimation = def;
        break;
      }
      case "clall": {
        const target = this.getPageState(instruction.page);
        target.layers = [];
        break;
      }
      case "clfg": {
        const target = this.getPageState(instruction.page);
        if (instruction.storage) {
          target.layers = target.layers.filter((l) => l.storage !== instruction.storage);
        } else if (instruction.index !== undefined) {
          target.layers = target.layers.filter((l) => l.index !== instruction.index);
        }
        break;
      }
      case "backlay": {
        const storage = instruction.storage;
        if (!storage || storage === "fg") {
          this.state.back.layers = this.state.fore.layers.slice();
        }
        if (!storage || storage === "bg") {
          this.state.back.background = this.state.fore.background;
        }
        break;
      }
      case "trans": {
        this.state.fore = {
          background: this.state.back.background,
          layers: this.state.back.layers.slice(),
        };
        return true;
      }
      case "play":
        this.state.bgm = instruction.storage;
        break;
      case "playstop":
        this.state.bgm = null;
        this.pendingAudioAction = { action: "stopBgm" };
        break;
      case "fadebgm":
        this.state.bgm = null;
        this.pendingAudioAction = { action: "fadeBgm", time: instruction.time };
        break;
      case "se":
        this.state.se = instruction.storage;
        break;
      case "sestop":
        this.state.se = null;
        this.pendingAudioAction = {
          action: "stopSe",
          storage: instruction.storage,
          time: instruction.time,
        };
        break;
      case "fadese":
        this.pendingAudioAction = {
          action: "fadeSe",
          storage: instruction.storage,
          time: instruction.time,
          volume: instruction.volume,
        };
        break;
      case "quake":
        this.pendingQuake = {
          vmax: instruction.vmax,
          hmax: instruction.hmax,
          time: instruction.time,
          interval: instruction.interval,
        };
        break;
      case "stopquake":
        this.pendingQuake = null;
        break;
      case "textoff":
        this.pendingTextbox = { visible: false, time: instruction.time };
        break;
      case "texton":
        this.pendingTextbox = { visible: true, time: 300 };
        break;
      case "position":
        if (instruction.visible !== undefined) {
          this.pendingTextbox = { visible: instruction.visible, time: 300 };
        }
        break;
      case "invisibleframe":
        this.pendingFrame = { visible: false };
        break;
      case "visibleframe":
        this.pendingFrame = { visible: true };
        break;
      case "noise":
        this.pendingEffect = {
          kind: "noise",
          opacity: instruction.opacity,
          monocro: instruction.monocro,
        };
        break;
      case "haze":
        this.pendingEffect = {
          kind: "haze",
          power: instruction.power,
          delta: instruction.delta,
          omega: instruction.omega,
        };
        break;
      case "stophaze":
        this.pendingEffect = { kind: "stophaze" };
        break;
      case "beginploy":
        // Séquence ploy non supportée dans ce PoC
        break;
      case "staffrollinit":
        this.state.staffroll = {
          lines: [],
          face: instruction.face,
          running: false,
          height: 10000,
          time: 60000,
          elapsed: 0,
        };
        break;
      case "staffrolltext":
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
        break;
      case "staffrollstart":
        if (this.state.staffroll) {
          this.state.staffroll.running = true;
          this.state.staffroll.height = instruction.height;
          this.state.staffroll.time = instruction.time;
          this.state.staffroll.elapsed = 0;
        }
        break;
      case "iscript":
      case "endscript":
        // JavaScript inline non supporté dans ce PoC
        break;
      case "eval": {
        try {
          const fn = new Function("tf", `"use strict"; return (${instruction.expression});`);
          fn(this.state.variables);
        } catch (err) {
          this.onWarning(`eval failed: ${instruction.expression} — ${err}`);
        }
        break;
      }
      case "jump": {
        const target = this.context.script.labels[instruction.label];
        if (target !== undefined) {
          this.context.pc = target;
          this.pcChanged = true;
        } else {
          this.onWarning(`unknown label: ${instruction.label}`);
        }
        break;
      }
      case "call": {
        // @call peut avoir soit target=*label, soit storage=xxx.ks
        // La commande "call" dans le parser met label = target nettoyé
        // Si c'est un appel vers un label dans le même script
        const target = this.context.script.labels[instruction.label];
        if (target !== undefined) {
          // Sauvegarder le contexte courant et sauter
          this.callStack.push({ ...this.context, pc: this.context.pc + 1 });
          this.context.pc = target;
          this.pcChanged = true;
        } else {
          this.onWarning(`unknown label: ${instruction.label}`);
        }
        break;
      }
      case "return": {
        const prevContext = this.callStack.pop();
        if (prevContext !== undefined) {
          this.context = prevContext;
          this.pcChanged = true;
        }
        break;
      }
      case "wait":
        this.waitTime = instruction.time;
        break;
      case "raw":
      case "text":
      case "break":
        break;
    }
    return false;
  }

  private executePage(page: Page): RuntimeSnapshot {
    const segments: TextSegment[] = [];
    const textParts: string[] = [];
    let hasTransition = false;

    for (const instruction of page.instructions) {
      if (instruction.kind === "text") {
        segments.push(...instruction.segments);
        for (const seg of instruction.segments) {
          if ("text" in seg) textParts.push(seg.text);
        }
      } else if (instruction.kind === "break") {
        segments.push({ text: "\n" });
        textParts.push("\n");
      } else if (instruction.kind === "call" && instruction.label.includes(".")) {
        // @call storage=xxx.ks — le label contient un "." c'est un nom de fichier
        // Signaler le besoin de charger un script
        return {
          page: this.context.pc,
          totalPages: this.context.script.pages.length,
          label: page.label,
          scriptName: this.context.scriptName,
          segments,
          text: textParts.join("").trim(),
          state: this.state,
          display: { ...this.state.fore, layers: this.state.fore.layers.slice() },
          transition: hasTransition,
          pendingScriptLoad: instruction.label,
          waiting: true,
        };
      } else {
        const result = this.applyInstruction(instruction);
        if (result === true) hasTransition = true;
      }
    }

    const anim = this.pendingAnimation;
    this.pendingAnimation = null;
    const audioAction = this.pendingAudioAction;
    this.pendingAudioAction = null;
    const quake = this.pendingQuake;
    this.pendingQuake = null;
    const textbox = this.pendingTextbox;
    this.pendingTextbox = null;
    const frame = this.pendingFrame;
    this.pendingFrame = null;
    const effect = this.pendingEffect;
    this.pendingEffect = null;
    const wait = this.waitTime;
    this.waitTime = 0;
    return {
      page: this.context.pc,
      totalPages: this.context.script.pages.length,
      label: page.label,
      scriptName: this.context.scriptName,
      segments,
      text: textParts.join("").trim(),
      state: this.state,
      display: { ...this.state.fore, layers: this.state.fore.layers.slice() },
      transition: hasTransition,
      pendingAnimation: anim,
      pendingAudioAction: audioAction,
      pendingQuake: quake,
      pendingTextbox: textbox,
      pendingFrame: frame,
      pendingEffect: effect,
      waitTime: wait,
      waiting: true,
    };
  }

  /**
   * Charger un script externe et l'empiler sur la call stack.
   * Appelé par le player quand pendingScriptLoad est détecté.
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

    // Sauvegarder le contexte courant (pc + 1 pour reprendre après @call)
    this.callStack.push({ ...this.context, pc: this.context.pc + 1 });
    this.context = { script, pc: 0, scriptName: storage };
    this.pcChanged = true;
    return true;
  }

  next(): RuntimeSnapshot | null {
    if (this.context.pc >= this.context.script.pages.length) {
      // Fin du script courant — vérifier s'il y a un contexte parent
      if (this.callStack.length > 0) {
        this.context = this.callStack.pop()!;
        this.pcChanged = true;
        return this.next();
      }
      return null;
    }
    this.pcChanged = false;
    const page = this.context.script.pages[this.context.pc];
    const snapshot = this.executePage(page);
    if (!this.pcChanged && !snapshot.pendingScriptLoad) {
      this.context.pc += 1;
    }
    return snapshot;
  }

  jump(label: string): boolean {
    const target = this.context.script.labels[label];
    if (target === undefined) return false;
    this.context.pc = target;
    return true;
  }

  // ── Save/Load ──

  getSaveData(): RuntimeSaveData {
    return {
      scriptName: this.context.scriptName,
      pc: this.context.pc,
      state: {
        fore: { ...this.state.fore, layers: this.state.fore.layers.slice() },
        back: { ...this.state.back, layers: this.state.back.layers.slice() },
        bgm: this.state.bgm,
        se: this.state.se,
        variables: { ...this.state.variables },
      },
      callStack: this.callStack.map((ctx) => ({
        scriptName: ctx.scriptName,
        pc: ctx.pc,
      })),
    };
  }

  async loadSaveData(data: RuntimeSaveData, scripts: Map<string, ParsedScript>): Promise<boolean> {
    const script = scripts.get(data.scriptName);
    if (!script) return false;

    this.context = { script, pc: data.pc, scriptName: data.scriptName };
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
