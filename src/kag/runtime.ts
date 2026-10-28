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
  segmentIndex: number;
  state: RuntimeState;
  callStack: { scriptName: string; pc: number; instructionIndex: number; segmentIndex: number }[];
};

export type PageState = {
  background: string;
  bgLeft?: number;
  bgTop?: number;
  layers: Layer[];
};

export type RuntimeState = {
  fore: PageState;
  back: PageState;
  bgm: string | null;
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
    return sprite;
  }

  private buildSceneState(page: PageLayer = "fore"): SceneState {
    const target = page === "back" ? this.state.back : this.state.fore;
    return {
      bg: target.background || null,
      bgLeft: target.bgLeft,
      bgTop: target.bgTop,
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

  private applyBg(instruction: Extract<Instruction, { kind: "bg" }>): { events: RenderEvent[]; stop?: StopReason } {
    const page = this.resolvePage("bg", instruction.page);
    const target = this.getPageState(page);
    // noclear=0 (défaut) : vide les calques de la page cible avant de poser le fond.
    if (!instruction.noclear) target.layers = [];
    target.background = instruction.storage;
    target.bgLeft = instruction.left;
    target.bgTop = instruction.top;

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
    this.state.fore = {
      background: this.state.back.background,
      bgLeft: this.state.back.bgLeft,
      bgTop: this.state.back.bgTop,
      layers: this.state.back.layers.slice(),
    };
    const events: RenderEvent[] = [this.emitScene(this.makeTransition(time, rule))];
    if (nowait) return { events };
    return { events, stop: { kind: "waitFor", what: "transition", skippable: canskip ?? true } };
  }

  private applyFg(instruction: Extract<Instruction, { kind: "fg" }>): RenderEvent | null {
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
    target.layers = target.layers.filter((l) => l.id !== id);
    target.layers.push(layer);
    if (page === "back") return null;
    return this.emitScene({ method: "none" });
  }

  private applyPartbg(instruction: Extract<Instruction, { kind: "partbg" }>): { events: RenderEvent[]; stop?: StopReason } {
    const page = this.resolvePage("partbg", instruction.page);
    const target = this.getPageState(page);
    const id = instruction.id ?? instruction.storage;
    // noclear=0 (défaut) : vide les partbg existants (calques avec crop) avant de poser le nouveau.
    if (!instruction.noclear) {
      target.layers = target.layers.filter((l) => !l.crop);
    }
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

  private applyChgfg(instruction: Extract<Instruction, { kind: "chgfg" }>): RenderEvent | null {
    const page = this.resolvePage("chgfg", instruction.page);
    const target = this.getPageState(page);
    const key = instruction.id ?? instruction.storage;
    let found = false;
    target.layers = target.layers.map((l) => {
      if (l.id !== key && (instruction.id === undefined || l.storage !== key)) return l;
      found = true;
      return { ...l, storage: instruction.storage, id: instruction.id ?? l.id };
    });
    if (!found) {
      // Calque inexistant : on en crée un par défaut (centré).
      const id = instruction.id ?? instruction.storage;
      target.layers.push({
        id,
        storage: instruction.storage,
        center: 512,
        vcenter: 288,
        index: instruction.index ?? 1,
        opacity: 1,
      });
    }
    if (page === "back") return null;
    return this.emitScene({ method: "none" });
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
      this.state.back.background = this.state.fore.background;
      this.state.back.bgLeft = this.state.fore.bgLeft;
      this.state.back.bgTop = this.state.fore.bgTop;
    }
    return [];
  }

  private applyTrans(instruction: Extract<Instruction, { kind: "trans" }>): { events: RenderEvent[]; stop?: StopReason } {
    // fore = clone(back) ; back conservé (sémantique KAG exchange=false).
    this.state.fore = {
      background: this.state.back.background,
      bgLeft: this.state.back.bgLeft,
      bgTop: this.state.back.bgTop,
      layers: this.state.back.layers.slice(),
    };
    const events: RenderEvent[] = [this.emitScene(this.makeTransition(instruction.time, instruction.rule))];
    if (!instruction.nowait) {
      return { events, stop: { kind: "waitFor", what: "transition", skippable: instruction.canskip ?? true } };
    }
    return { events };
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
        event = { kind: "stop", channel: "bgm", fadeOut: instruction.time };
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
    const { f, sf, tf } = this.state.variables;
    try {
      const timeline_object = { loadByData: () => {} };
      const fn = new Function(
        "f",
        "sf",
        "tf",
        "global",
        "timeline_object",
        `"use strict"; return (${instruction.expression});`,
      );
      fn(f, sf, tf, this.state.evalGlobal, timeline_object);
    } catch (err) {
      this.onWarning(`eval failed: ${instruction.expression} — ${err}`);
    }
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
        this.context.pc = pageIdx;
        this.context.instructionIndex = 0;
        this.context.segmentIndex = 0;
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
        this.callStack.push({
          ...this.context,
          instructionIndex: this.context.instructionIndex + 1,
          segmentIndex: 0,
        });
        this.context.pc = pageIdx;
        this.context.instructionIndex = 0;
        this.context.segmentIndex = 0;
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
    }
  }

  private applyInstruction(instruction: Instruction): { events: RenderEvent[]; stop?: StopReason } {
    const events: RenderEvent[] = [];

    switch (instruction.kind) {
      case "bg": {
        const res = this.applyBg(instruction);
        events.push(...res.events);
        if (res.stop) return { events, stop: res.stop };
        break;
      }
      case "fg": {
        const ev = this.applyFg(instruction);
        if (ev) events.push(ev);
        break;
      }
      case "chgfg": {
        const ev = this.applyChgfg(instruction);
        if (ev) events.push(ev);
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
      case "raw":
        // Commande inconnue : tolérée mais bruyante (AGENTS.md §6).
        // On prévient via onWarning et on compte pour détecter les régressions.
        this.rawCount++;
        this.onWarning(`commande non gérée: @${instruction.command}`);
        break;
    }

    return { events };
  }

  private processText(instruction: Extract<Instruction, { kind: "text" }>): { events: RenderEvent[]; stop?: StopReason } {
    const events: RenderEvent[] = [];
    const segments = instruction.segments;
    const startIdx = this.context.segmentIndex;

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
      const remaining = segments.slice(startIdx);
      if (remaining.length > 0) {
        events.push({ kind: "text", segments: remaining });
      }
      this.context.instructionIndex += 1;
      this.context.segmentIndex = 0;
      return { events };
    }

    // Emit text up to the pause [l], save position for next step.
    const before = segments.slice(startIdx, pauseIndex);
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

    while (this.context.pc < this.context.script.pages.length) {
      const page = this.context.script.pages[this.context.pc];
      const instructions = page.instructions;

      // Début de page : vider la textbox.
      if (this.context.instructionIndex === 0) {
        events.push({ kind: "clearText" });
      }

      let contextChanged = false;
      // Track whether the inner loop has any instructions to process.
      // If not (e.g., returned from @call past the end of the page),
      // we should advance to the next page without stopping.
      const hadInstructions = this.context.instructionIndex < instructions.length;

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
      } else {
        this.onWarning(`label not found in ${storage}: ${label}`);
      }
    }
    return true;
  }

  jump(label: string): boolean {
    const target = this.context.script.labels[label];
    if (target === undefined) return false;
    this.context.pc = target;
    this.context.instructionIndex = 0;
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
        se: this.state.se,
        variables: structuredClone(this.state.variables),
        evalGlobal: structuredClone(this.state.evalGlobal),
        textbox: this.state.textbox ? { ...this.state.textbox } : undefined,
        effect: this.state.effect,
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

    return true;
  }
}
