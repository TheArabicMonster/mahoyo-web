import type { AssetResolver } from "@/core/asset-resolver.js";
import type {
  AssetRef,
  Awaitable,
  EffectState,
  Ms,
  PloyState,
  RenderEvent,
  SceneState,
  SpriteState,
  StaffrollState,
  StageSnapshot,
  TextboxState,
  TimelineLayerState,
} from "@/kag/events.js";
import type { AnimationDef, AnimKeyframe, TextSegment } from "@/kag/types.js";
import type { DisplaySettings, RunOptions, StageRenderer, StageRendererDeps } from "./types.js";
import { compileAction, resolveKeyframes, type DiscreteChange } from "./action-compiler.js";
import { PARTBG_INNER_ORIGIN, partbgInnerTransform, partbgWrapperTransform, spriteTransform } from "./transform-helpers.js";
import { textStyleToCss } from "./text-style.js";
import { cssUrl } from "./css-url.js";
import { fitTextBox, textBoxHeight, TEXT_FIT_DEFAULTS } from "./text-fit.js";
import { cssEasing, easeProgress } from "@/core/easing.js";

/**
 * Facteur d'agrandissement du stage : le jeu travaille en 1024×576, le viewport fait 1280×720.
 * Toute `transform` posée en ligne sur `.mh-stage` doit le conserver, sinon l'écran retombe
 * à 1024×576 (80 %), collé en haut à gauche, avec des bandes noires à droite et en bas.
 */
const STAGE_SCALE = 1.25;

/** Taille nominale du texte en rem (avant `fontScale`), hauteur de ligne et marge verticale (CSS ci-dessous). */
const TEXT_REM = 1.5;
const TEXT_LINE_HEIGHT = 1.6;
const TEXT_PADDING_Y = 20;
/** Hauteur du stage en repère logique (1024×576), repli quand le conteneur n'a pas de mise en page. */
const STAGE_HEIGHT = 576;

/**
 * Motif de pluie (traitement « rain1 » d'un calque de timeline) : traits obliques
 * clairsemés, dessinés ici (aucun asset du jeu), qui défilent vers le bas en boucle.
 * Deux motifs de tailles différentes donnent un peu de profondeur.
 */
function rainTile(width: number, height: number, drops: readonly [number, number][], length: number, alpha: number): string {
  const lines = drops
    .map(([x, y]) => `<line x1='${x}' y1='${y}' x2='${x - length / 5}' y2='${y + length}'/>`)
    .join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'><g stroke='rgba(225,235,255,${alpha})' stroke-width='1'>${lines}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const RAIN_TILE_NEAR = rainTile(160, 200, [[20, 10], [70, 60], [130, 25], [45, 120], [100, 140], [150, 95], [10, 170]], 26, 0.45);
const RAIN_TILE_FAR = rainTile(96, 120, [[12, 8], [50, 40], [80, 85], [30, 95]], 14, 0.3);

/** Un caractère à afficher, avec son annotation ruby et son style CSS éventuels. */
type TextUnit = {
  char: string;
  ruby?: string;
  css?: Record<string, string>;
  /** Indice du segment d'origine : les caractères d'un même ruby partagent un groupe. */
  group: number;
};

/**
 * Implémentation DOM de StageRenderer.
 *
 * Hypothèses simplificatrices (documentées dans docs/agents/A-QUESTIONS.md) :
 * - `universal` = crossfade (rule/vague ignorés).
 * - Les animations se résolvent immédiatement en mode instant ; sinon elles
 *   tournent en CSS et peuvent être attendues via `waitFor("animation")`.
 * - Les effets `noise`/`haze` sont rendus par des calques CSS approximatifs.
 */
export class DomStageRenderer implements StageRenderer {
  private resolver: AssetResolver;
  private root: HTMLElement | null = null;

  private container: HTMLElement | null = null;
  private bgEl: HTMLElement | null = null;
  private spritesEl: HTMLElement | null = null;
  /** Calque(s) overlay pour le crossfade de fond (transition non-bloquante). */
  private bgOverlays: HTMLElement[] = [];
  /** Image du fond quand il est zoomé ou tourné (sinon `null` : le fond est un `background-image`). */
  private bgImgEl: HTMLImageElement | null = null;
  private effectsEl: HTMLElement | null = null;
  private textboxEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private indicatorEl: HTMLElement | null = null;
  private waitEl: HTMLElement | null = null;

  private settings: DisplaySettings = {
    textSpeed: 30,
    autoDelay: 2000,
    fontScale: 1,
    textboxOpacity: 0.8,
  };

  private userHidden = false;
  private currentScene: SceneState = { bg: null, sprites: [], effect: null };
  private text: TextSegment[] = [];
  private textbox: TextboxState = { visible: true, frame: true };
  /** Bulle « ploy » active (@ploysay) ; exposée sur la textbox en attributs data-*. */
  private ploy: PloyState | null = null;
  private staffroll: StaffrollState | null = null;

  private typewriterTimer: ReturnType<typeof setTimeout> | null = null;
  private typewriterResolve: (() => void) | null = null;
  private typewriterHurry = false;
  /** Nombre d'unités de texte déjà révélées (anti re-type après [l]). */
  private typedUnits = 0;

  private transitionPromise: Promise<void> | null = null;
  private transitionResolve: (() => void) | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Panoramique du fond en cours (`bgMove` d'une timeline) : positions de départ et
   * d'arrivée, début (`performance.now()`) et durée. Sert à reprendre la position
   * courante quand un fondu enchaîné commence avant la fin du mouvement.
   */
  private bgMotion: {
    fromLeft: number;
    fromTop: number;
    toLeft: number;
    toTop: number;
    start: number;
    time: number;
    accel: number;
  } | null = null;
  /** Fin (`performance.now()`) de la transition de zoom/rotation du fond en cours. */
  private bgTransformEnd = 0;
  /** Tailles des images de fond déjà chargées (pivot du zoom/rotation), par URL. */
  private bgSizes = new Map<string, { w: number; h: number }>();

  private animations = new Map<string, AnimationController>();
  /**
   * Animations en attente : démarrées quand le sprite cible est créé.
   * Cas typique : @fgact page=back émet l'évent animate AVANT que @trans
   * ne copie le sprite sur la page fore (où il devient visible/DOM).
   */
  private pendingAnimations = new Map<string, { def: AnimationDef; opts: RunOptions }>();
  /**
   * Sprites courants par id (réconciliation, pas de innerHTML="").
   * Clé = SpriteState.id. Pour un sprite simple → <img>. Pour un partbg →
   * <div class="mh-stage-partbg"> (wrapper overflow:hidden + <img> interne).
   * Permet aux éléments DOM de survivre entre scènes (et donc aux animations
   * CSS/WAAPI qui y tournent).
   */
  private spriteEls = new Map<string, HTMLElement>();
  /** Conteneur des calques de timeline (entre le fond et les sprites). */
  private timelineEl: HTMLElement | null = null;
  /** Calques de timeline par id : `<div>` positionné qui contient l'`<img>`. */
  private timelineLayerEls = new Map<string, HTMLElement>();
  private quakeTimer: ReturnType<typeof setTimeout> | null = null;
  private quakeResolve: (() => void) | null = null;

  private staffrollTimer: ReturnType<typeof setTimeout> | null = null;
  private staffrollResolve: (() => void) | null = null;

  constructor(deps: StageRendererDeps) {
    this.resolver = deps.resolver;
  }

  mount(root: HTMLElement): void {
    if (this.root) throw new Error("DomStageRenderer déjà monté");
    this.root = root;
    this.injectStyles();

    this.container = document.createElement("div");
    this.container.className = "mh-stage";

    const stage = document.createElement("div");
    stage.className = "mh-stage-scene";
    stage.id = "stage";

    this.bgEl = document.createElement("div");
    this.bgEl.className = "mh-stage-bg";
    this.bgEl.id = "stage-bg";

    this.timelineEl = document.createElement("div");
    this.timelineEl.className = "mh-stage-tl";
    this.timelineEl.id = "stage-timeline";

    this.spritesEl = document.createElement("div");
    this.spritesEl.className = "mh-stage-sprites";
    this.spritesEl.id = "stage-sprites";

    this.effectsEl = document.createElement("div");
    this.effectsEl.className = "mh-stage-effects";
    this.effectsEl.id = "stage-effects";

    stage.append(this.bgEl, this.timelineEl, this.spritesEl, this.effectsEl);

    this.textboxEl = document.createElement("div");
    this.textboxEl.className = "mh-stage-textbox";
    this.textboxEl.id = "textbox";

    const frame = document.createElement("div");
    frame.className = "mh-stage-textbox-frame";
    frame.id = "textbox-frame";

    this.textEl = document.createElement("div");
    this.textEl.className = "mh-stage-text";
    this.textEl.id = "text";

    this.indicatorEl = document.createElement("div");
    this.indicatorEl.className = "mh-stage-indicator";
    this.indicatorEl.id = "textbox-indicator";

    this.textboxEl.append(frame, this.textEl, this.indicatorEl);

    this.waitEl = document.createElement("div");
    this.waitEl.className = "mh-stage-wait";
    this.waitEl.setAttribute("aria-hidden", "true");

    this.container.append(stage, this.textboxEl, this.waitEl);
    root.appendChild(this.container);

    this.applyTextbox();
  }

  async apply(events: readonly RenderEvent[], opts: RunOptions): Promise<void> {
    if (!this.container) throw new Error("DomStageRenderer non monté");

    const hasText = events.some((e) => e.kind === "text" || e.kind === "lineBreak");
    const hadText = this.text.length > 0;

    for (const event of events) {
      if (event.kind === "audio") continue;
      await this.applyEvent(event, opts);
    }

    if (hasText || (hadText && events.some((e) => e.kind === "clearText"))) {
      return this.runTypewriter(opts);
    }
    return Promise.resolve();
  }

  async waitFor(what: Exclude<Awaitable, "audio">, target: string | undefined, signal: AbortSignal): Promise<void> {
    let promise: Promise<void> | null = null;
    switch (what) {
      case "transition":
        promise = this.transitionPromise;
        break;
      case "animation":
        if (target) {
          promise = this.animations.get(target)?.promise ?? null;
        } else {
          // @wact sans cible : attend toutes les animations non-loop.
          // Les loops tournent en arrière-plan (clignotements, etc.) et
          // ne doivent pas bloquer le jeu (doc §7).
          const nonLoop = [...this.animations.values()].filter((c) => !c.isLoop);
          if (nonLoop.length > 0) {
            promise = Promise.all(nonLoop.map((c) => c.promise)).then(() => {});
          }
        }
        break;
      case "quake":
        promise = this.quakeResolve && this.quakePromise ? this.quakePromise() : null;
        break;
    }
    if (!promise) return;
    if (signal.aborted) return;
    await Promise.race([promise, new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))]).catch(() => {});
  }

  hurry(): void {
    // Typewriter : non-sticky. Si le typewriter tourne, on le termine
    // immédiatement (rendu complet + resolve) sans laisser de flag persistant.
    if (this.typewriterResolve) {
      if (this.typewriterTimer) {
        clearTimeout(this.typewriterTimer);
        this.typewriterTimer = null;
      }
      const units = this.buildTextUnits();
      this.renderTextUpTo(units, units.length);
      this.typedUnits = units.length;
      const resolve = this.typewriterResolve;
      this.typewriterResolve = null;
      this.typewriterHurry = false;
      resolve();
    }
    // Termine la transition courante immédiatement (clear timer + overlays + resolve).
    this.finishTransition();
    for (const ctrl of this.animations.values()) ctrl.hurry();
    if (this.quakeResolve) {
      this.quakeResolve();
      this.quakeResolve = null;
    }
  }

  setClickIndicator(style: "line" | "page" | null): void {
    if (!this.indicatorEl) return;
    this.indicatorEl.textContent = style === "page" ? "▼" : style === "line" ? "▽" : "";
    this.indicatorEl.style.visibility = style ? "visible" : "hidden";
  }

  setWaitIndicator(active: boolean): void {
    if (!this.waitEl) return;
    this.waitEl.classList.toggle("mh-stage-wait-on", active);
    if (!active) this.waitEl.classList.remove("mh-stage-wait-nudge");
  }

  nudgeWaitIndicator(): void {
    const el = this.waitEl;
    if (!el || !el.classList.contains("mh-stage-wait-on")) return;
    // Relance l'animation même si un clic précédent l'a déjà déclenchée.
    el.classList.remove("mh-stage-wait-nudge");
    void el.offsetWidth;
    el.classList.add("mh-stage-wait-nudge");
  }

  setUserHidden(hidden: boolean): void {
    this.userHidden = hidden;
    this.applyTextbox();
  }

  async restore(snapshot: StageSnapshot, signal: AbortSignal): Promise<void> {
    this.finishTransition();
    this.clearBgOverlays();
    this.clearTimers();
    this.spriteEls.clear();
    this.pendingAnimations.clear();
    this.spritesEl!.innerHTML = "";
    this.clearTimelineLayers();
    this.currentScene = snapshot.scene;
    this.text = [...snapshot.text];
    this.typedUnits = this.buildTextUnits().length;
    this.textbox = snapshot.textbox;
    this.staffroll = snapshot.staffroll;
    this.renderScene(true);
    this.renderText(true);
    this.applyTextbox();
    if (signal.aborted) return;
  }

  async preload(assets: readonly AssetRef[], signal?: AbortSignal): Promise<void> {
    const urls = assets.map((a) => this.resolveAsset(a));
    await Promise.all(
      urls.map(
        (url, i) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => {
              this.resolver.reportMissing("image", assets[i]!);
              resolve();
            };
            if (signal?.aborted) return resolve();
            img.src = url;
            signal?.addEventListener("abort", () => resolve(), { once: true });
          }),
      ),
    );
  }

  async captureThumbnail(maxWidth: number): Promise<Blob | null> {
    if (!this.container) return null;
    const canvas = document.createElement("canvas");
    const rect = this.container.getBoundingClientRect();
    const scale = maxWidth / rect.width;
    canvas.width = maxWidth;
    canvas.height = rect.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/webp", 0.85);
    });
  }

  setSettings(settings: Readonly<DisplaySettings>): void {
    this.settings = { ...settings };
    this.applyTextbox();
    if (this.textEl) {
      this.textEl.style.fontSize = `${TEXT_REM * settings.fontScale}rem`;
      this.fitText(this.buildTextUnits(), this.typedUnits);
    }
  }

  clear(): void {
    this.finishTransition();
    this.clearBgOverlays();
    this.clearTimers();
    this.spriteEls.clear();
    this.pendingAnimations.clear();
    this.spritesEl!.innerHTML = "";
    this.clearTimelineLayers();
    this.currentScene = { bg: null, sprites: [], effect: null };
    this.text = [];
    this.typedUnits = 0;
    this.textbox = { visible: true, frame: true };
    this.staffroll = null;
    this.renderScene(true);
    this.renderText(true);
    this.applyTextbox();
  }

  dispose(): void {
    this.clearTimers();
    this.finishTransition();
    this.clearBgOverlays();
    this.spriteEls.clear();
    this.clearTimelineLayers();
    if (this.container && this.root) {
      this.root.removeChild(this.container);
    }
    this.root = null;
    this.container = null;
  }

  /** Termine immédiatement la transition courante (si any) sans attendre. */
  private finishTransition(): void {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    const resolve = this.transitionResolve;
    this.transitionResolve = null;
    this.transitionPromise = null;
    this.clearBgOverlays();
    if (resolve) resolve();
  }

  // ── Interne ──

  private injectStyles(): void {
    if (document.getElementById("mh-stage-styles")) return;
    const style = document.createElement("style");
    style.id = "mh-stage-styles";
    style.textContent = `
      .mh-stage {
        position: absolute;
        left: 0;
        top: 0;
        width: 1024px;
        height: 576px;
        transform: scale(${STAGE_SCALE});
        transform-origin: 0 0;
        overflow: hidden;
        font-family: inherit;
      }
      .mh-stage-scene {
        position: absolute;
        inset: 0;
        z-index: 0;
      }
      .mh-stage-bg {
        position: absolute;
        inset: 0;
        background-size: auto;
        background-position: 50% 50%;
        background-repeat: no-repeat;
        z-index: 0;
      }
      .mh-stage-tl {
        position: absolute;
        inset: 0;
        z-index: 8;
        pointer-events: none;
      }
      .mh-stage-tl-layer {
        position: absolute;
        transform: translate(-50%, -50%);
      }
      .mh-stage-tl-layer > img {
        display: block;
      }
      .mh-stage-tl-rain::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image: url("${RAIN_TILE_NEAR}"), url("${RAIN_TILE_FAR}");
        background-size: 160px 200px, 96px 120px;
        animation: mh-tl-rain 0.6s linear infinite;
      }
      @keyframes mh-tl-rain {
        from { background-position: 0 0, 0 0; }
        to { background-position: -40px 200px, -12px 120px; }
      }
      .mh-stage-sprites {
        position: absolute;
        inset: 0;
        z-index: 10;
      }
      .mh-stage-sprite {
        position: absolute;
        transform: translate(-50%, -50%);
      }
      .mh-stage-effects {
        position: absolute;
        inset: 0;
        z-index: 20;
        pointer-events: none;
      }
      .mh-stage-noise {
        position: absolute;
        inset: 0;
        opacity: 0;
        pointer-events: none;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }
      .mh-stage-haze {
        position: absolute;
        inset: 0;
        opacity: 0;
        pointer-events: none;
        background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.4), transparent 60%);
        animation: mh-haze-pulse 2s ease-in-out infinite;
      }
      @keyframes mh-haze-pulse {
        0%, 100% { opacity: 0.2; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.05); }
      }
      .mh-stage-textbox {
        position: absolute;
        left: 10%;
        right: 10%;
        bottom: 5%;
        /* Hauteur fixe (#163) : la boîte ne change jamais de position ni de taille, seule la police s'adapte. */
        height: ${TEXT_FIT_DEFAULTS.boxHeightRatio * 100}%;
        z-index: 30;
        transition: opacity 0.3s ease;
        pointer-events: auto;
      }
      .mh-stage-textbox-frame {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.7);
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 8px;
      }
      .mh-stage-text {
        position: relative;
        padding: ${TEXT_PADDING_Y}px 24px;
        color: #fff;
        font-size: ${TEXT_REM}rem;
        line-height: ${TEXT_LINE_HEIGHT};
        white-space: pre-wrap;
      }
      .mh-stage-indicator {
        position: absolute;
        right: 24px;
        bottom: 16px;
        color: #fff;
        font-size: 1.2rem;
        animation: mh-indicator-blink 1s infinite;
      }
      .mh-stage-wait {
        position: absolute;
        right: 20px;
        bottom: 20px;
        width: 18px;
        height: 18px;
        box-sizing: border-box;
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.85);
        border-top-color: transparent;
        mix-blend-mode: difference;
        z-index: 40;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .mh-stage-wait-on {
        opacity: 0.7;
        animation: mh-wait-spin 1.2s linear infinite;
      }
      .mh-stage-wait-on.mh-stage-wait-nudge {
        animation: mh-wait-spin 1.2s linear infinite, mh-wait-nudge 0.35s ease-out;
      }
      @keyframes mh-wait-spin {
        to { rotate: 360deg; }
      }
      @keyframes mh-wait-nudge {
        0% { scale: 1.9; opacity: 1; }
        100% { scale: 1; opacity: 0.7; }
      }
      @keyframes mh-indicator-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    `;
    document.head.appendChild(style);
  }

  private async applyEvent(event: RenderEvent, opts: RunOptions): Promise<void> {
    switch (event.kind) {
      case "scene": {
        const oldScene = this.currentScene;
        this.currentScene = event.scene;
        const transitionTime = event.transition.method === "none" ? 0 : event.transition.time;
        // Non-bloquant : on démarre la transition et on rend la main.
        // waitFor("transition") permettra au player d'attendre sa fin.
        this.startTransition(oldScene, event.scene, transitionTime, opts);
        break;
      }
      case "text": {
        this.text.push(...event.segments);
        break;
      }
      case "lineBreak": {
        this.text.push({ text: "\n" });
        break;
      }
      case "clearText": {
        this.text = [];
        this.typedUnits = 0;
        break;
      }
      case "textbox": {
        this.textbox = event.state;
        this.applyTextbox();
        break;
      }
      case "ploy": {
        this.ploy = event.ploy;
        this.applyPloy();
        break;
      }
      case "effect": {
        this.currentScene = { ...this.currentScene, effect: event.effect };
        this.renderEffect();
        break;
      }
      case "bgMove": {
        this.moveBackground(event.left, event.top, opts.instant ? 0 : event.time, event);
        break;
      }
      case "timelineLayer": {
        this.applyTimelineLayer(event.layer, opts.instant ? 0 : event.time, event.accel ?? 0);
        break;
      }
      case "timelineLayerClear": {
        this.clearTimelineLayers();
        break;
      }
      case "animate": {
        this.startAnimation(event.target, event.def, opts);
        break;
      }
      case "stopAnimation": {
        if (event.target) this.stopAnimation(event.target);
        else {
          for (const [id] of this.animations) this.stopAnimation(id);
        }
        break;
      }
      case "stopTransition": {
        this.finishTransition();
        break;
      }
      case "quake": {
        if (event.quake) this.startQuake(event.quake, opts);
        else this.stopQuake();
        break;
      }
      case "staffroll": {
        this.staffroll = event.state;
        this.renderStaffroll(opts);
        break;
      }
      case "audio":
        break;
    }
  }

  /** Démarre une animation en attente ciblant ce sprite (cas @fgact page=back). */
  private maybeStartPending(id: string, el: HTMLElement): void {
    const pending = this.pendingAnimations.get(id);
    if (!pending) return;
    this.pendingAnimations.delete(id);
    queueMicrotask(() => {
      if (this.animations.has(id)) return;
      const innerEl = pending.def.isPartbg ? el.querySelector<HTMLElement>(".mh-stage-partbg-img") : null;
      const ctrl = new AnimationController(pending.def, id, el, this.resolver, () => this.stopAnimation(id), innerEl);
      this.animations.set(id, ctrl);
    });
  }

  /**
   * Réconcilie les sprites de la scène courante avec le DOM.
   *
   * On garde un `Map<id, HTMLImageElement>` : les sprites dont l'id persiste
   * sont mis à jour (position/opacity/src) sans être recréés — c'est
   * indispensable pour que les animations CSS/WAAPI qui ciblent un calque
   * survivent entre deux scènes. Les sprites absents de la nouvelle scène
   * sont retirés ; les nouveaux sont créés et insérés dans l'ordre z.
   */
  private renderScene(instant: boolean): void {
    if (!this.bgEl || !this.spritesEl) return;
    const bg = this.currentScene.bg;
    // Fond zoomé ou tourné : l'image est un <img> enfant (voir `renderTransformedBg`).
    const { bgZoomX = 100, bgZoomY = 100, bgRotate = 0 } = this.currentScene;
    const transformedBg = bg !== null && (bgZoomX !== 100 || bgZoomY !== 100 || bgRotate !== 0);
    this.bgImgEl?.remove();
    this.bgImgEl = null;
    this.bgEl.style.backgroundImage = bg && !transformedBg ? cssUrl(this.resolver.background(bg)) : "none";
    this.bgEl.style.backgroundColor = bg ? "" : "#000";
    // Un nouveau fond interrompt le panoramique en cours et perd le zoom/la rotation du précédent.
    this.bgMotion = null;
    this.bgTransformEnd = 0;
    this.bgEl.style.removeProperty("transition");
    this.bgEl.style.removeProperty("transform");
    this.bgEl.style.removeProperty("transform-origin");
    // Positionnement natif (repère 1024×576) : left/top explicites sinon centrage.
    if (bg) {
      const left = this.currentScene.bgLeft;
      const top = this.currentScene.bgTop;
      this.bgEl.style.backgroundPosition =
        left !== undefined && top !== undefined ? `${left}px ${top}px` : "50% 50%";
      if (transformedBg) this.renderTransformedBg(bg, left, top, bgZoomX, bgZoomY, bgRotate);
    }

    const sprites = [...this.currentScene.sprites].sort((a, b) => a.z - b.z);
    const seen = new Set<string>();

    for (const s of sprites) {
      seen.add(s.id);
      const isPartbg = !!s.crop;
      let el = this.spriteEls.get(s.id);
      // Si le type a changé (partbg ↔ sprite simple), on recrée l'élément.
      if (el && isPartbg !== el.classList.contains("mh-stage-partbg")) {
        el.remove();
        this.stopAnimation(s.id);
        this.spriteEls.delete(s.id);
        el = undefined;
      }

      if (isPartbg) {
        // ── Partbg : div width×height overflow:hidden + <img> interne ──
        let wrapper = el as HTMLElement | undefined;
        if (!wrapper) {
          wrapper = document.createElement("div");
          wrapper.className = "mh-stage-partbg";
          wrapper.dataset.spriteId = s.id;
          if (s.partbgId) wrapper.dataset.partbgId = s.partbgId;
          const innerImg = document.createElement("img");
          innerImg.className = "mh-stage-partbg-img";
          innerImg.alt = "";
          wrapper.appendChild(innerImg);
          this.spriteEls.set(s.id, wrapper);
          el = wrapper;
          this.maybeStartPending(s.id, wrapper);
        }
        const crop = s.crop!;
        const innerImg = wrapper.querySelector<HTMLImageElement>(".mh-stage-partbg-img");
        wrapper.style.position = "absolute";
        wrapper.style.left = `${s.x}px`;
        wrapper.style.top = `${s.y}px`;
        wrapper.style.width = `${crop.width}px`;
        wrapper.style.height = `${crop.height}px`;
        wrapper.style.overflow = "hidden";
        wrapper.style.opacity = String(s.opacity);
        wrapper.style.zIndex = String(s.z);
        wrapper.style.transform = partbgWrapperTransform();
        // Fond derrière le crop (bgstorage).
        if (crop.bgStorage) {
          wrapper.style.backgroundImage = cssUrl(this.resolver.background(crop.bgStorage));
          wrapper.style.backgroundSize = "auto";
          wrapper.style.backgroundPosition = "0 0";
        } else {
          wrapper.style.backgroundImage = "none";
        }
        // Image interne translatée + scalée.
        if (innerImg) {
          const src = this.resolver.image(s.storage);
          if (innerImg.src !== src && !innerImg.src.endsWith(src)) innerImg.src = src;
          innerImg.style.position = "absolute";
          innerImg.style.left = "0";
          innerImg.style.top = "0";
          innerImg.style.transform = partbgInnerTransform({
            srcleft: crop.srcLeft,
            srctop: crop.srcTop,
            srczoomx: crop.srcZoomX,
            srczoomy: crop.srcZoomY,
          });
          innerImg.style.transformOrigin = PARTBG_INNER_ORIGIN;
        }
        this.spritesEl.appendChild(wrapper);
      } else {
        // ── Sprite simple : <img> ──
        let img = el as HTMLImageElement | undefined;
        if (!img || img.tagName !== "IMG") {
          img = document.createElement("img");
          img.className = "mh-stage-sprite";
          img.alt = "";
          img.dataset.spriteId = s.id;
          if (s.partbgId) img.dataset.partbgId = s.partbgId;
          this.spriteEls.set(s.id, img);
          el = img;
          this.maybeStartPending(s.id, img);
        }
        // Mise à jour src (peut changer via @chgfg).
        const src = this.resolver.image(s.storage);
        if (img.src !== src && !img.src.endsWith(src)) img.src = src;
        img.style.left = `${s.x}px`;
        img.style.top = `${s.y}px`;
        img.style.opacity = String(s.opacity);
        img.style.zIndex = String(s.z);
        // Zoom et rotation autour du centre (`@fg zoom=… rotate=…`) ; neutre : le CSS de la classe suffit.
        if (s.zoomx !== undefined || s.zoomy !== undefined || s.rotate !== undefined) {
          img.style.transform = spriteTransform({
            zoomx: (s.zoomx ?? 100) / 100,
            zoomy: (s.zoomy ?? 100) / 100,
            rotate: s.rotate ?? 0,
          });
        } else {
          img.style.removeProperty("transform");
        }
        this.spritesEl.appendChild(img);
      }
    }

    // Retire les sprites disparus (+ annule leurs animations).
    for (const [id, el] of this.spriteEls) {
      if (!seen.has(id)) {
        el.remove();
        this.spriteEls.delete(id);
        this.stopAnimation(id);
        this.pendingAnimations.delete(id);
      }
    }

    if (!instant) {
      this.bgEl.style.opacity = "0";
      void this.bgEl.offsetHeight;
      this.bgEl.style.transition = "opacity 0.3s ease";
      this.bgEl.style.opacity = "1";
    }

    this.renderEffect();
  }

  /**
   * Démarre une transition non-bloquante entre `from` et `to`.
   *
   * - Réconcilie les sprites vers `to` immédiatement (les calques persistent).
   * - Pour le crossfade de fond : on pose un overlay avec l'ancien fond par-dessus
   *   le nouveau, puis on fade out l'overlay. Le nouveau fond apparaît dessous.
   * - `transitionPromise` est résolu après `time` ms (ou immédiatement via hurry()).
   * - Si une transition était déjà en cours, on la termine d'abord (clear overlays).
   *
   * Non-await : `apply()` rend la main avant la fin de la transition.
   */
  private startTransition(from: SceneState, to: SceneState, time: Ms, opts: RunOptions): void {
    // Termine une transition précédente éventuelle (clear timer + overlays).
    this.finishTransition();
    // Position de l'ancien fond à cet instant (il peut être en plein panoramique).
    const fromPos = this.bgPositionNow(from);
    // Zoom et rotation de l'ancien fond (renderScene les remet à zéro pour le nouveau).
    const fromTransform = this.bgEl ? { transform: this.bgEl.style.transform, origin: this.bgEl.style.transformOrigin } : null;

    // Image de l'ancien fond s'il était zoomé ou tourné : elle passe dans l'overlay (sinon `renderScene` la retire).
    const fromImg = this.bgImgEl;
    this.bgImgEl = null;

    this.currentScene = to;

    if (opts.instant || time <= 0) {
      fromImg?.remove();
      this.renderScene(true);
      return;
    }

    // Rend la nouvelle scène (sprites réconciliés + nouveau fond).
    this.renderScene(true);
    if (!this.bgEl) {
      fromImg?.remove();
      return;
    }

    // Overlay avec l'ancien fond, par-dessus, qui fade out.
    const oldBg = from.bg;
    if (oldBg) {
      const overlay = document.createElement("div");
      overlay.className = "mh-stage-bg mh-stage-bg-overlay";
      overlay.style.cssText = this.bgEl.style.cssText;
      overlay.style.backgroundImage = fromImg ? "none" : cssUrl(this.resolver.background(oldBg));
      if (fromImg) overlay.appendChild(fromImg);
      overlay.style.transition = "none";
      overlay.style.backgroundPosition = fromPos ? `${fromPos.left}px ${fromPos.top}px` : "50% 50%";
      overlay.style.transform = fromTransform?.transform ?? "";
      overlay.style.transformOrigin = fromTransform?.origin ?? "";
      overlay.style.zIndex = "5";
      overlay.style.opacity = "1";
      this.bgEl.parentElement?.appendChild(overlay);
      this.bgOverlays.push(overlay);

      requestAnimationFrame(() => {
        // L'ancien fond poursuit son panoramique pendant qu'il s'efface.
        const moving = fromPos && fromPos.remaining > 0;
        overlay.style.transition = moving
          ? `opacity ${time}ms ease, background-position ${fromPos.remaining}ms ${cssEasing(fromPos.accel, fromPos.progress)}`
          : `opacity ${time}ms ease`;
        overlay.style.opacity = "0";
        if (moving) overlay.style.backgroundPosition = `${fromPos.toLeft}px ${fromPos.toTop}px`;
      });
    } else {
      fromImg?.remove();
    }

    // Promise résolu à la fin de la transition (ou via hurry/finishTransition).
    this.transitionPromise = new Promise<void>((resolve) => {
      this.transitionResolve = resolve;
      this.transitionTimer = setTimeout(() => {
        this.onTransitionEnd();
        resolve();
      }, time);
    });
  }

  /**
   * Position du fond `scene` à cet instant : interpolée pendant un panoramique,
   * sinon sa position explicite ; null si le fond est centré.
   */
  private bgPositionNow(scene: SceneState): {
    left: number;
    top: number;
    toLeft: number;
    toTop: number;
    remaining: number;
    accel: number;
    /** Fraction (0..1) du temps déjà écoulée. */
    progress: number;
  } | null {
    const m = this.bgMotion;
    if (m) {
      const elapsed = Math.min(Math.max(performance.now() - m.start, 0), m.time);
      const k = m.time > 0 ? elapsed / m.time : 1;
      const e = easeProgress(m.accel, k);
      return {
        left: m.fromLeft + (m.toLeft - m.fromLeft) * e,
        top: m.fromTop + (m.toTop - m.fromTop) * e,
        toLeft: m.toLeft,
        toTop: m.toTop,
        remaining: m.time - elapsed,
        accel: m.accel,
        progress: k,
      };
    }
    if (scene.bgLeft === undefined || scene.bgTop === undefined) return null;
    return { left: scene.bgLeft, top: scene.bgTop, toLeft: scene.bgLeft, toTop: scene.bgTop, remaining: 0, accel: 0, progress: 1 };
  }

  /**
   * Fond posé avec `zoom=`/`rotate=` (`@bg`) : zoom et rotation autour du centre de l'image, placée
   * en (`left`, `top`) comme un fond ordinaire (sans position : centrée sur l'écran).
   *
   * Un `background-image` ne peut pas servir : il est rogné aux 1024×576 de la boîte du fond, alors
   * qu'un zoom montre ce qui dépasse. L'image est donc un <img> à sa taille d'origine, dont le centre
   * est le pivot, ce qui évite d'avoir à connaître sa taille.
   */
  private renderTransformedBg(
    bg: string,
    left: number | undefined,
    top: number | undefined,
    zoomx: number,
    zoomy: number,
    rotate: number,
  ): void {
    if (!this.bgEl) return;
    const img = document.createElement("img");
    img.className = "mh-stage-bg-img";
    img.alt = "";
    img.draggable = false;
    img.src = this.resolver.background(bg);
    img.style.position = "absolute";
    img.style.maxWidth = "none";
    const scale = `rotate(${rotate}deg) scale(${zoomx / 100}, ${zoomy / 100})`;
    if (left !== undefined && top !== undefined) {
      img.style.left = `${left}px`;
      img.style.top = `${top}px`;
      img.style.transform = scale;
    } else {
      img.style.left = "50%";
      img.style.top = "50%";
      img.style.transform = `translate(-50%, -50%) ${scale}`;
    }
    img.style.transformOrigin = "50% 50%";
    this.bgEl.appendChild(img);
    this.bgImgEl = img;
  }

  /**
   * Zoom (%) et rotation (degrés) du fond : transform CSS autour du centre de l'image, placée
   * en (left, top). La taille de l'image vient du cache (chargée à la demande) ; en attendant,
   * le centre de l'écran sert de pivot, ce qui convient aux fonds de la taille de l'écran.
   */
  private bgTransformCss(left: number, top: number, zoomx: number, zoomy: number, rotate: number): { transform: string; origin: string } {
    const url = this.currentScene.bg ? this.resolver.background(this.currentScene.bg) : null;
    const size = url ? this.bgSizes.get(url) : undefined;
    if (url && !size && typeof Image !== "undefined") {
      const img = new Image();
      img.onload = () => {
        this.bgSizes.set(url, { w: img.naturalWidth, h: img.naturalHeight });
        // Le fond est toujours celui-là et immobile : repose le pivot exact.
        if (this.bgEl && !this.bgMotion && this.currentScene.bg && this.resolver.background(this.currentScene.bg) === url) {
          const sc = this.currentScene;
          this.bgEl.style.transformOrigin = `${(sc.bgLeft ?? left) + img.naturalWidth / 2}px ${(sc.bgTop ?? top) + img.naturalHeight / 2}px`;
        }
      };
      img.src = url;
    }
    return {
      transform: `rotate(${rotate}deg) scale(${zoomx / 100}, ${zoomy / 100})`,
      origin: size ? `${left + size.w / 2}px ${top + size.h / 2}px` : "512px 288px",
    };
  }

  /**
   * Panoramique : fait glisser le fond affiché jusqu'à (left, top) en `time` ms, en ligne droite
   * ou avec l'accélération `accel` ; avec `zoomx`/`zoomy`/`rotate`, il est aussi zoomé et tourné
   * dans le même temps.
   */
  private moveBackground(
    left: number,
    top: number,
    time: Ms,
    opts: { accel?: number; zoomx?: number; zoomy?: number; rotate?: number } = {},
  ): void {
    const from = this.bgPositionNow(this.currentScene);
    const accel = opts.accel ?? 0;
    const transformed = opts.zoomx !== undefined || opts.zoomy !== undefined || opts.rotate !== undefined;
    this.currentScene = { ...this.currentScene, bgLeft: left, bgTop: top };
    this.bgMotion = null;
    const el = this.bgEl;
    if (!el || !this.currentScene.bg) return;
    const target = transformed ? this.bgTransformCss(left, top, opts.zoomx ?? 100, opts.zoomy ?? 100, opts.rotate ?? 0) : null;
    // Une transition de zoom/rotation encore en cours repart de la valeur affichée.
    const live = performance.now() < this.bgTransformEnd ? getComputedStyle(el) : null;
    const liveTransform = live ? { transform: live.transform, origin: live.transformOrigin } : null;
    el.style.transition = "none";
    this.bgTransformEnd = 0;
    if (time <= 0 || !from) {
      el.style.backgroundPosition = `${left}px ${top}px`;
      if (target) {
        el.style.transform = target.transform;
        el.style.transformOrigin = target.origin;
      }
      return;
    }
    // Repart de la position courante (un panoramique précédent peut être en cours).
    el.style.backgroundPosition = `${from.left}px ${from.top}px`;
    if (target) {
      if (liveTransform) {
        el.style.transform = liveTransform.transform;
        el.style.transformOrigin = liveTransform.origin;
      } else if (!el.style.transform) {
        el.style.transform = "rotate(0deg) scale(1, 1)";
        el.style.transformOrigin = target.origin;
      }
    }
    void el.offsetHeight;
    const easing = cssEasing(accel);
    const parts = [`background-position ${time}ms ${easing}`];
    if (target) parts.push(`transform ${time}ms ${easing}`, `transform-origin ${time}ms ${easing}`);
    el.style.transition = parts.join(", ");
    el.style.backgroundPosition = `${left}px ${top}px`;
    if (target) {
      el.style.transform = target.transform;
      el.style.transformOrigin = target.origin;
      this.bgTransformEnd = performance.now() + time;
    }
    this.bgMotion = { fromLeft: from.left, fromTop: from.top, toLeft: left, toTop: top, start: performance.now(), time, accel };
  }

  /**
   * Calque de timeline : pose son état (`time` = 0) ou le fait glisser (position, opacité,
   * zoom et rotation) par une transition CSS, en ligne droite ou avec l'accélération `accel`.
   * Une transition interrompue repart de la valeur affichée à cet instant.
   */
  private applyTimelineLayer(layer: TimelineLayerState, time: Ms, accel = 0): void {
    if (!this.timelineEl) return;
    let el = this.timelineLayerEls.get(layer.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "mh-stage-tl-layer";
      el.dataset.layerId = layer.id;
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      el.appendChild(img);
      this.timelineEl.appendChild(el);
      this.timelineLayerEls.set(layer.id, el);
    }
    const img = el.firstElementChild as HTMLImageElement;
    const src = this.resolver.image(layer.storage);
    if (img.getAttribute("src") !== src) img.src = src;
    el.style.zIndex = String(layer.z);
    el.classList.toggle("mh-stage-tl-rain", layer.rain === true);
    if (time > 0) {
      // Fige d'abord l'état courant (posé juste avant, au même instant) comme départ.
      void el.offsetWidth;
      const easing = cssEasing(accel);
      el.style.transition = `left ${time}ms ${easing}, top ${time}ms ${easing}, opacity ${time}ms ${easing}, transform ${time}ms ${easing}`;
    } else {
      el.style.transition = "none";
    }
    el.style.left = `${layer.x}px`;
    el.style.top = `${layer.y}px`;
    el.style.opacity = String(layer.opacity);
    // Zoom et rotation autour du point d'ancrage (centre de l'image par défaut) ; la liste de
    // fonctions est toujours la même pour que la transition interpole terme à terme.
    el.style.transform = `translate(-50%, -50%) rotate(${layer.rotate ?? 0}deg) scale(${(layer.zoomx ?? 100) / 100}, ${(layer.zoomy ?? 100) / 100})`;
    el.style.transformOrigin = layer.afx !== undefined && layer.afy !== undefined ? `${layer.afx}px ${layer.afy}px` : "50% 50%";
  }

  private clearTimelineLayers(): void {
    for (const el of this.timelineLayerEls.values()) el.remove();
    this.timelineLayerEls.clear();
  }

  private onTransitionEnd(): void {
    this.transitionTimer = null;
    this.transitionResolve = null;
    this.transitionPromise = null;
    this.clearBgOverlays();
  }

  private clearBgOverlays(): void {
    for (const el of this.bgOverlays) el.remove();
    this.bgOverlays = [];
  }

  private renderEffect(): void {
    if (!this.effectsEl) return;
    this.effectsEl.innerHTML = "";
    const effect = this.currentScene.effect;
    if (!effect) return;
    if (effect.kind === "noise") {
      const el = document.createElement("div");
      el.className = "mh-stage-noise";
      el.style.opacity = String(effect.opacity > 1 ? effect.opacity / 255 : effect.opacity);
      if (effect.monocro) el.style.filter = "grayscale(100%)";
      this.effectsEl.appendChild(el);
    } else if (effect.kind === "haze") {
      const el = document.createElement("div");
      el.className = "mh-stage-haze";
      el.style.opacity = String(Math.min(1, effect.power / 20));
      this.effectsEl.appendChild(el);
    }
  }

  private startAnimation(target: string, def: AnimationDef, opts: RunOptions): void {
    this.stopAnimation(target);
    if (opts.instant) {
      // Mode instant : applique l'état final de l'animation sans la jouer.
      this.applyAnimationFinal(def);
      return;
    }
    // Récupère l'élément sprite persistant (réconciliation PR 5).
    const el = this.spriteEls.get(target) ?? this.findPartbgEl(def);
    if (!el) {
      // Sprite pas encore rendu (cas @fgact page=back avant @trans) :
      // on diffère le démarrage jusqu'à la création de l'élément.
      this.pendingAnimations.set(target, { def, opts });
      return;
    }
    const innerEl = def.isPartbg ? el.querySelector<HTMLElement>(".mh-stage-partbg-img") : null;
    const ctrl = new AnimationController(def, target, el, this.resolver, () => this.stopAnimation(target), innerEl);
    this.animations.set(target, ctrl);
  }

  /** Applique l'état final d'une animation sur le sprite cible (mode instant). */
  private applyAnimationFinal(def: AnimationDef): void {
    if (def.keyframes.length === 0) return;
    const resolved = resolveKeyframes(def.keyframes);
    const last = resolved[resolved.length - 1];
    const el = this.spriteEls.get(def.id ?? def.storage) ?? this.findPartbgEl(def);
    if (!el) return;
    const isPartbg = !!def.isPartbg;
    if (isPartbg) {
      // Le wrapper partbg peut aussi animer center/vcenter/opacity/zoom/rotate.
      this.applyKeyframeToElement(last, el, false);
      const inner = el.querySelector<HTMLElement>(".mh-stage-partbg-img");
      if (inner) this.applyKeyframeToElement(last, inner, true);
    } else {
      this.applyKeyframeToElement(last, el, false);
    }
  }

  private applyKeyframeToElement(last: AnimKeyframe, el: HTMLElement, isInner: boolean): void {
    if (!isInner) {
      if (last.center !== undefined) el.style.left = `${last.center}px`;
      if (last.vcenter !== undefined) el.style.top = `${last.vcenter}px`;
      if (last.opacity !== undefined) el.style.opacity = String(last.opacity);
      if (last.zoomx !== undefined || last.zoomy !== undefined || last.rotate !== undefined) {
        el.style.transform = spriteTransform({
          zoomx: last.zoomx ?? 1,
          zoomy: last.zoomy ?? 1,
          rotate: last.rotate,
        });
      }
    } else {
      if (last.srcleft !== undefined || last.srctop !== undefined || last.srczoomx !== undefined || last.srczoomy !== undefined) {
        el.style.transform = partbgInnerTransform({
          srcleft: last.srcleft,
          srctop: last.srctop,
          srczoomx: last.srczoomx,
          srczoomy: last.srczoomy,
        });
      }
    }
  }

  /** Pour @fgact sur un partbg (PR 7) : recherche l'élément partbg par id. */
  private findPartbgEl(def: AnimationDef): HTMLElement | null {
    if (!def.partbgid || !this.container) return null;
    return this.container.querySelector(`[data-partbg-id="${def.partbgid}"]`) as HTMLElement | null;
  }

  private stopAnimation(target: string): void {
    const ctrl = this.animations.get(target);
    if (ctrl) {
      ctrl.cancel();
      this.animations.delete(target);
    }
  }

  private startQuake(spec: { hmax: number; vmax: number; time?: Ms | null }, opts: RunOptions): void {
    this.stopQuake();
    if (opts.instant) return;
    if (!this.container) return;

    const start = performance.now();
    const duration = spec.time ?? null;
    this.quakePromise = () =>
      new Promise<void>((resolve) => {
        this.quakeResolve = resolve;
        const tick = () => {
          if (!this.container) return;
          const dx = (Math.random() - 0.5) * 2 * spec.hmax;
          const dy = (Math.random() - 0.5) * 2 * spec.vmax;
          // Décalage en pixels écran (1280×720), puis agrandissement : `scale` reste obligatoire.
          this.container.style.transform = `translate(${dx}px, ${dy}px) scale(${STAGE_SCALE})`;
          const elapsed = performance.now() - start;
          if (duration !== null && elapsed >= duration) {
            this.stopQuake();
            resolve();
            return;
          }
          this.quakeTimer = setTimeout(tick, 40);
        };
        tick();
      });
    this.quakePromise();
  }

  private quakePromise: (() => Promise<void>) | null = null;

  private stopQuake(): void {
    if (this.quakeTimer) clearTimeout(this.quakeTimer);
    this.quakeTimer = null;
    if (this.container) this.container.style.transform = "";
    if (this.quakeResolve) {
      this.quakeResolve();
      this.quakeResolve = null;
    }
  }

  private renderStaffroll(opts: RunOptions): void {
    if (!this.container || !this.staffroll) return;
    if (opts.instant) return;

    const el = document.createElement("div");
    el.className = "mh-stage-staffroll";
    el.style.cssText = "position:absolute;left:0;right:0;top:720px;z-index:25;text-align:center;color:#fff;";
    for (const line of this.staffroll.lines) {
      const p = document.createElement("p");
      p.textContent = line.text;
      p.style.fontSize = `${line.size}px`;
      el.appendChild(p);
    }
    this.container.appendChild(el);

    const time = this.staffroll.time;
    this.staffrollPromise = new Promise((resolve) => {
      this.staffrollResolve = resolve;
      el.style.transition = `transform ${time}ms linear`;
      requestAnimationFrame(() => {
        el.style.transform = `translateY(-${this.staffroll!.height + 720}px)`;
      });
      setTimeout(() => {
        el.remove();
        resolve();
      }, time);
    });
  }

  private staffrollPromise: Promise<void> | null = null;

  /**
   * Expose la bulle « ploy » sur la textbox (data-ploy-mode, --ploy-ox, --ploy-oy).
   * La géométrie de la bulle dépend d'un plugin d'origine non porté : on ne
   * dessine rien, mais l'état est disponible pour le style.
   */
  private applyPloy(): void {
    if (!this.textboxEl) return;
    if (this.ploy) {
      this.textboxEl.dataset.ployMode = this.ploy.mode;
      this.textboxEl.style.setProperty("--ploy-ox", `${this.ploy.ox}px`);
      this.textboxEl.style.setProperty("--ploy-oy", `${this.ploy.oy}px`);
    } else {
      delete this.textboxEl.dataset.ployMode;
      this.textboxEl.style.removeProperty("--ploy-ox");
      this.textboxEl.style.removeProperty("--ploy-oy");
    }
  }

  private applyTextbox(): void {
    if (!this.textboxEl || !this.textbox) return;
    const hidden = this.userHidden || !this.textbox.visible;
    this.textboxEl.style.opacity = hidden ? "0" : "1";
    const frame = this.textboxEl.querySelector(".mh-stage-textbox-frame") as HTMLElement | null;
    if (frame) {
      frame.style.opacity = String(this.settings.textboxOpacity);
      frame.style.display = this.textbox.frame ? "block" : "none";
    }
  }

  /**
   * Unité de rendu typewriter : un caractère + annotation ruby optionnelle.
   * Construit à partir de TextSegment[] : un segment { text, ruby } produit
   * une unité par caractère (chacune portant le ruby), un segment plain
   * produit une unité par caractère sans ruby.
   */
  private buildTextUnits(): TextUnit[] {
    const units: TextUnit[] = [];
    this.text.forEach((seg, group) => {
      if (!("text" in seg)) return; // pause
      const ruby = "ruby" in seg ? seg.ruby : undefined;
      const css = seg.style ? textStyleToCss(seg.style) : undefined;
      for (const char of Array.from(seg.text)) {
        units.push({ char, ruby, css, group });
      }
    });
    return units;
  }

  /** Reconstruit le DOM de la textbox jusqu'à n unités (inclu) avec ruby. */
  private renderTextUpTo(units: TextUnit[], n: number): void {
    if (!this.textEl) return;
    this.textEl.replaceChildren();
    const frag = document.createDocumentFragment();
    const limit = Math.min(n, units.length);
    for (let i = 0; i < limit; i++) {
      const u = units[i];
      const hasCss = u.css !== undefined && Object.keys(u.css).length > 0;
      let node: Node;
      if (u.ruby) {
        // Un ruby couvre plusieurs caractères : une seule balise <ruby>, la lecture
        // posée une fois sur le groupe (le typewriter n'en révèle qu'une partie au début).
        let base = u.char;
        while (i + 1 < limit && units[i + 1]!.ruby && units[i + 1]!.group === u.group) {
          i++;
          base += units[i]!.char;
        }
        const ruby = document.createElement("ruby");
        ruby.textContent = base;
        const rt = document.createElement("rt");
        rt.textContent = u.ruby;
        ruby.appendChild(rt);
        node = ruby;
      } else if (hasCss) {
        node = document.createElement("span");
        node.textContent = u.char;
      } else {
        node = document.createTextNode(u.char);
      }
      if (hasCss && node instanceof HTMLElement) {
        for (const [prop, value] of Object.entries(u.css!)) node.style.setProperty(prop, value);
      }
      frag.appendChild(node);
    }
    this.textEl.appendChild(frag);
  }

  /**
   * Ajuste la taille de la police à la page entière (voir `text-fit.ts`) dans la boîte fixe, puis
   * affiche les `keep` premières unités. Tout se fait avant le prochain rendu : pas de
   * clignotement. Sans mise en page (jsdom), la hauteur mesurée est nulle et rien ne change.
   */
  private fitText(units: TextUnit[], keep: number): void {
    const textEl = this.textEl;
    const boxEl = this.textboxEl;
    if (!textEl || !boxEl) return;
    this.renderTextUpTo(units, units.length);
    const nominalRem = TEXT_REM * this.settings.fontScale;
    // Mesure à zone libre : sans plafond ni défilement hérités de la page précédente.
    textEl.style.maxHeight = "";
    textEl.style.overflowY = "";
    const fit = fitTextBox({
      ...TEXT_FIT_DEFAULTS,
      boxHeight: boxEl.clientHeight || textBoxHeight(this.container?.clientHeight || STAGE_HEIGHT),
      measureHeight: (scale) => {
        textEl.style.fontSize = `${nominalRem * scale}rem`;
        return textEl.offsetHeight;
      },
    });
    textEl.style.fontSize = `${nominalRem * fit.scale}rem`;
    if (fit.overflow) {
      textEl.style.maxHeight = `${fit.maxHeight}px`;
      textEl.style.overflowY = "auto";
    }
    boxEl.dataset.textFit = fit.overflow ? "overflow" : fit.scale < 1 ? "shrunk" : "nominal";
    if (keep < units.length) this.renderTextUpTo(units, keep);
  }

  private renderText(instant: boolean): void {
    if (!this.textEl) return;
    const units = this.buildTextUnits();
    if (instant) {
      this.fitText(units, units.length);
      this.typedUnits = units.length;
      return;
    }
    // Non-instant : le typewriter gère la révélation progressive.
  }

  private runTypewriter(opts: RunOptions): Promise<void> {
    return new Promise((resolve) => {
      this.typewriterResolve = resolve;
      const units = this.buildTextUnits();
      // Anti re-type : on continue depuis typedUnits (déjà révélées).
      const startUnit = Math.min(this.typedUnits, units.length);
      // Taille et position de la page entière avant de la révéler : pas de saut en cours de frappe.
      this.fitText(units, startUnit);

      if (opts.instant || this.settings.textSpeed <= 0 || this.typewriterHurry) {
        this.renderTextUpTo(units, units.length);
        this.typedUnits = units.length;
        this.typewriterResolve = null;
        this.typewriterHurry = false;
        resolve();
        return;
      }
      this.typewriterHurry = false;

      let i = startUnit;
      const step = () => {
        if (!this.textEl) return;
        if (this.typewriterHurry) {
          this.renderTextUpTo(units, units.length);
          this.typedUnits = units.length;
          this.typewriterResolve = null;
          resolve();
          return;
        }
        i++;
        this.renderTextUpTo(units, i);
        if (i >= units.length) {
          this.typedUnits = units.length;
          this.typewriterResolve = null;
          resolve();
          return;
        }
        this.typewriterTimer = setTimeout(step, this.settings.textSpeed);
      };
      step();
    });
  }

  /** Accès test-only au compteur d'unités tapées. */
  typedUnitsExposed(): number {
    return this.typedUnits;
  }

  private clearTimers(): void {
    if (this.typewriterTimer) clearTimeout(this.typewriterTimer);
    if (this.quakeTimer) clearTimeout(this.quakeTimer);
    if (this.staffrollTimer) clearTimeout(this.staffrollTimer);
    for (const ctrl of this.animations.values()) ctrl.cancel();
    this.animations.clear();
  }

  private resolveAsset(ref: AssetRef): string {
    return this.resolver.image(ref);
  }
}

/**
 * Contrôleur d'animation basé sur Web Animations API.
 *
 * - Compile le `AnimationDef` via `compileAction` (keyframes WAAPI + discrete).
 * - Lance `el.animate(...)` sur le sprite persistant (réconciliation PR 5).
 * - Props discrètes (storage/effect/contrast/visible/type/absolute) appliquées
 *   au bon instant via setTimeout.
 * - `loop` → iterations: Infinity. `hurry()` épargne les loops (elles
 *   continuent en arrière-plan) mais résout le promise (pour @wact skip).
 * - `cancel()` (via @stopaction) annule tout.
 *
 * Fallback : si `el.animate` n'existe pas (jsdom), on simule via setTimeout
 * (pas d'animation visuelle, juste la timing + discrete).
 */
class AnimationController {
  promise: Promise<void>;
  /** Accès en lecture au flag loop (pour waitFor("animation") global : on n'attend pas les loops). */
  readonly isLoop: boolean;
  private resolveFn: () => void = () => {};
  private animation: Animation | null = null;
  private innerAnimation: Animation | null = null;
  private discreteTimers: ReturnType<typeof setTimeout>[] = [];
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;

  constructor(
    def: AnimationDef,
    private target: string,
    private el: HTMLElement | null,
    private resolver: AssetResolver,
    private onDone: () => void,
    private innerEl?: HTMLElement | null,
  ) {
    this.isLoop = !!def.loop;
    this.promise = new Promise((resolve) => {
      this.resolveFn = resolve;
    });
    this.run(def);
  }

  private run(def: AnimationDef): void {
    const compiled = compileAction(def);
    if (!compiled) {
      // Duration <= 0 : applique l'état final puis termine.
      this.applyDiscrete(def, 0);
      this.finish();
      return;
    }

    // Changements discrets programmés.
    this.scheduleDiscrete(compiled.discrete, def);

    const hasWAAPI = this.el && typeof this.el.animate === "function";
    if (hasWAAPI) {
      // WAAPI : animation wrapper.
      if (compiled.keyframes.wrapper.length > 0) {
        this.animation = this.el!.animate(compiled.keyframes.wrapper, {
          duration: compiled.duration,
          iterations: compiled.iterations,
          fill: "forwards",
        });
      }
      // WAAPI : animation image interne (partbg).
      if (this.innerEl && compiled.keyframes.inner.length > 0) {
        this.innerAnimation = this.innerEl.animate(compiled.keyframes.inner, {
          duration: compiled.duration,
          iterations: compiled.iterations,
          fill: "forwards",
        });
      }
      if (!this.isLoop) {
        // Le promise doit se résoudre même si aucun keyframe WAAPI n'a été
        // généré (props discrètes uniquement). On s'appuie sur la première
        // animation disponible (wrapper, puis inner), sinon on fallback sur
        // un setTimeout pour ne pas lever une exception sur un null.
        if (this.animation) {
          this.animation.onfinish = () => this.finish();
        } else if (this.innerAnimation) {
          this.innerAnimation.onfinish = () => this.finish();
        } else {
          this.fallbackTimer = setTimeout(() => this.finish(), compiled.duration);
        }
      } else {
        // Loop : le promise n'est jamais résolu naturellement (animation infinie).
        // On résout seulement via hurry()/cancel().
      }
    } else {
      // Fallback jsdom : setTimeout pour la durée.
      this.fallbackTimer = setTimeout(() => this.finish(), compiled.duration);
    }
  }

  /** Applique les changements discrets selon leur timing absolu. */
  private scheduleDiscrete(discrete: DiscreteChange[], def: AnimationDef): void {
    for (const change of discrete) {
      if (change.time <= 0) {
        // Immédiat.
        this.applyDiscreteChange(change, def);
      } else {
        const t = setTimeout(() => this.applyDiscreteChange(change, def), change.time);
        this.discreteTimers.push(t);
      }
    }
  }

  /** Applique tous les changements discrets d'un def jusqu'à un temps donné (fallback). */
  private applyDiscrete(def: AnimationDef, _upToTime: number): void {
    const compiled = compileAction(def);
    if (!compiled) return;
    for (const change of compiled.discrete) {
      this.applyDiscreteChange(change, def);
    }
  }

  private applyDiscreteChange(change: DiscreteChange, def: AnimationDef): void {
    if (!this.el) return;
    switch (change.field) {
      case "storage": {
        const src = this.resolver.image(change.value as string);
        if ((this.el as HTMLImageElement).src !== src) (this.el as HTMLImageElement).src = src;
        break;
      }
      case "absolute":
        this.el.style.zIndex = String(change.value);
        break;
      case "visible":
        this.el.style.visibility = change.value ? "visible" : "hidden";
        break;
      case "effect":
      case "contrast":
      case "type":
        // Effets de filtre non gérés ici (PR futur). No-op silencieux.
        break;
    }
  }

  /** Termine l'animation (résout le promise + onDone). Idempotent. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    this.resolveFn();
    this.onDone();
  }

  /**
   * Hurry : résout le promise (pour @wact skip) mais ÉPARGNE les loops
   * (l'animation WAAPI continue en arrière-plan). Pour les animations non-loop,
   * on termine réellement (finish de l'animation WAAPI).
   */
  hurry(): void {
    this.clearTimers();
    if (this.isLoop) {
      // Loop : on résout le promise sans arrêter l'animation.
      this.resolveFn();
    } else {
      // Non-loop : termine immédiatement (jump à la fin).
      // L'inner est terminé avant le wrapper : le finish du wrapper déclenche
      // onfinish -> finish() -> onDone, ce qui annule le contrôleur et
      // empêcherait d'atteindre l'inner si on le faisait après.
      if (this.innerAnimation) {
        try {
          this.innerAnimation.finish();
        } catch {
          this.innerAnimation.cancel();
        }
      }
      if (this.animation) {
        try {
          this.animation.finish();
        } catch {
          this.animation.cancel();
        }
      }
      this.finish();
    }
  }

  /** Cancel (@stopaction) : annule tout (loops y compris). */
  cancel(): void {
    this.clearTimers();
    this.finished = true;
    if (this.animation) {
      // Preserve the visual state produced by the animation before cancelling,
      // otherwise WAAPI reverts to the pre-animation style (doc §8).
      try {
        if (typeof (this.animation as Animation & { commitStyles?: () => void }).commitStyles === "function") {
          (this.animation as Animation & { commitStyles: () => void }).commitStyles();
        }
      } catch {
        // ignore (jsdom, animation déjà terminée, etc.)
      }
      this.animation.cancel();
      this.animation = null;
    }
    if (this.innerAnimation) {
      try {
        if (typeof (this.innerAnimation as Animation & { commitStyles?: () => void }).commitStyles === "function") {
          (this.innerAnimation as Animation & { commitStyles: () => void }).commitStyles();
        }
      } catch {
        // ignore (jsdom, animation déjà terminée, etc.)
      }
      try {
        this.innerAnimation.cancel();
      } catch {
        // ignore
      }
      this.innerAnimation = null;
    }
    this.resolveFn();
  }

  private clearTimers(): void {
    for (const t of this.discreteTimers) clearTimeout(t);
    this.discreteTimers = [];
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }
}

export function createDomStageRenderer(deps: StageRendererDeps): DomStageRenderer {
  return new DomStageRenderer(deps);
}
