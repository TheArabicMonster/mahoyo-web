import type { AssetResolver } from "@/core/asset-resolver.js";
import type {
  AssetRef,
  Awaitable,
  EffectState,
  Ms,
  PloyState,
  RenderEvent,
  SceneState,
  ScreenShakeSpec,
  StaffrollState,
  StageSnapshot,
  TextboxState,
  TimelineLayerState,
} from "@/kag/events.js";
import type { AnimationDef, AnimKeyframe, TextSegment } from "@/kag/types.js";
import {
  DEFAULT_DISPLAY_SETTINGS,
  type DisplaySettings,
  type RunOptions,
  type StageRenderer,
  type StageRendererDeps,
} from "./types.js";
import { compileAction, resolveKeyframes, type DiscreteChange } from "./action-compiler.js";
import { PARTBG_INNER_ORIGIN, partbgInnerTransform, partbgWrapperTransform, spriteTransform } from "./transform-helpers.js";
import {
  applyAppearance,
  feBlendModeForLayerType,
  isEnvironmentEffect,
  type Appearance,
  type SvgFilterRegistry,
} from "./appearance.js";
import type { EnvColorEffect, EnvColorTable } from "@/kag/envcolor.js";
import { textStyleToCss } from "./text-style.js";
import { cssUrl } from "./css-url.js";
import {
  dimmedUnitCount,
  fitTextBox,
  frameTextAreaHeight,
  FRAME_TEXT_AREA,
  FRAME_TEXT_LINE_HEIGHT,
  FRAME_TEXT_REM,
  textBoxHeight,
  TEXT_FIT_DEFAULTS,
} from "./text-fit.js";
import { CLICK_GLYPHS, frameImageOpacity, indicatorOffset, resolveFrameStyle, type FrameStyle } from "./text-frame.js";
import { cssEasing, easeProgress } from "@/core/easing.js";

/**
 * Facteur d'agrandissement du stage : le jeu travaille en 1024×576, le viewport fait 1280×720.
 * Toute `transform` posée en ligne sur `.mh-stage` doit le conserver, sinon l'écran retombe
 * à 1024×576 (80 %), collé en haut à gauche, avec des bandes noires à droite et en bas.
 */
export const STAGE_SCALE = 1.25;

/** Taille nominale du texte en rem (avant `fontScale`), hauteur de ligne et marge verticale (CSS ci-dessous). */
const TEXT_REM = 1.5;
const TEXT_LINE_HEIGHT = 1.6;
const TEXT_PADDING_Y = 20;
/** Style « cadre image » : taille et interligne du texte dans `text-fit.ts` (FRAME_TEXT_REM, #182). */
const FRAME_TEXT_LETTER_SPACING = "0.06em";
/** Opacité du texte déjà lu de la page (capture : ~120 sur un fond à ~30, soit 40 %). */
const READ_TEXT_OPACITY = 0.4;
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
  /** Image inline `[graph]` (emoji) : une seule unité de frappe, rendue en `<img>`. */
  graph?: { storage: string; alt?: string };
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
/**
 * Défauts de placement d'un fond sans `left`/`top`, repris du moteur : le tag étendu `@bg`
 * (`data/override/tagex.tjs`) pose `left = (scWidth - imageWidth) / 2` et
 * `top = scHeight - imageHeight + 48` — X centré, bas de l'image 48 px sous le bas de l'écran.
 * Sans `top`, un fond de 1050 px de haut est donc décalé de 189 px par rapport à un centrage
 * vertical (issue #249). Exprimés en CSS, ils ne demandent pas la taille de l'image.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

const BG_BOTTOM_MARGIN = 48;

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

  private settings: DisplaySettings = { ...DEFAULT_DISPLAY_SETTINGS };

  private userHidden = false;
  private currentScene: SceneState = { bg: null, sprites: [], effect: null };
  private text: TextSegment[] = [];
  private textbox: TextboxState = { visible: true, frame: true };
  /** Style courant de la fenêtre de message (#173) : cadre image plein écran, ou ancienne boîte. */
  private frameStyle: FrameStyle = { mode: "image", image: null };
  /** Images de cadre déjà demandées, et celles qui n'ont pas pu être chargées (repli sur la boîte). */
  private frameRequested = new Set<string>();
  private frameFailed = new Set<string>();
  /** Indicateur d'attente affiché (`[l]` ou fin de page), `null` sinon. */
  private clickStyle: "line" | "page" | null = null;
  /** Unités de la page déjà lues (avant le dernier clic) : affichées atténuées (#173). */
  private readUnits = 0;
  /** Bulle « ploy » active (@ploysay) ; exposée sur la textbox en attributs data-*. */
  private ploy: PloyState | null = null;
  private staffroll: StaffrollState | null = null;

  private typewriterTimer: ReturnType<typeof setTimeout> | null = null;
  private typewriterResolve: (() => void) | null = null;
  private typewriterHurry = false;
  /** Action continue des messages (`@setdefaultmessageaction`, ex. « swing ») ; null = aucune. */
  private textAction: string | null = null;
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
  /** Décalage courant des calques liés au fond (`@bindbg`), par id de sprite. */
  private bindOffsets = new Map<string, { x: number; y: number }>();
  private quakeTimer: ReturnType<typeof setTimeout> | null = null;
  private quakeResolve: (() => void) | null = null;
  private shakeTimer: ReturnType<typeof setTimeout> | null = null;
  private shakeResolve: (() => void) | null = null;

  private staffrollTimer: ReturnType<typeof setTimeout> | null = null;
  private staffrollResolve: (() => void) | null = null;
  /** Overlay des crédits (un seul à la fois) et son contenu défilant. */
  /** Overlay des particules de notes (@beginfallnote, approximation #282). */
  private fallnoteEl: HTMLElement | null = null;
  /** Taux d'émission courant des particules (`@fallnoteopt rate=`). */
  private fallnoteRate = 1;
  private staffrollEl: HTMLElement | null = null;
  private staffrollInner: HTMLElement | null = null;
  /** Vrai dès que l'animation de défilement a été lancée pour l'état courant. */
  private staffrollRunning = false;
  private staffrollPromise: Promise<void> | null = null;
  private staffrollAnimation: Animation | null = null;

  /** Filtres SVG à la demande (mono<rrggbb>, teintes, luminosité/contraste, flou anisotrope). */
  private svgFilters: SVGSVGElement | null = null;
  private filterIds = new Map<string, string>();
  private filterCounter = 0;
  /** Effets non appliqués déjà signalés (un avertissement par nom). */
  private warnedEffects = new Set<string>();
  private readonly filterRegistry: SvgFilterRegistry;
  /** Effets d'ambiance du jeu (`envcolor.ksc`, données installées par le pipeline). */
  private readonly envEffects?: EnvColorTable;

  constructor(deps: StageRendererDeps) {
    this.resolver = deps.resolver;
    this.envEffects = deps.envEffects;
    this.filterRegistry = {
      monoFilter: (color) => this.svgFilter(`mono:${color}`, (filter) => {
        const flood = document.createElementNS(SVG_NS, "feFlood");
        flood.setAttribute("flood-color", color);
        const composite = document.createElementNS(SVG_NS, "feComposite");
        composite.setAttribute("in", "flood");
        composite.setAttribute("in2", "SourceAlpha");
        composite.setAttribute("operator", "in");
        // Conserve l'alpha multiplicatif de la source.
        const merge = document.createElementNS(SVG_NS, "feComposite");
        merge.setAttribute("operator", "arithmetic");
        merge.setAttribute("k1", "0");
        merge.setAttribute("k2", "1");
        merge.setAttribute("k3", "1");
        merge.setAttribute("k4", "0");
        filter.append(flood, composite, merge);
      }),
      channelFilter: (channel) => this.svgFilter(`channel:${channel}`, (filter) => {
        const matrix = document.createElementNS(SVG_NS, "feColorMatrix");
        matrix.setAttribute("type", "matrix");
        const luma = "0.2126 0.7152 0.0722 0 0";
        const blank = "0 0 0 0 0";
        const rows = channel === "red" ? [luma, blank, blank] : channel === "green" ? [blank, luma, blank] : [blank, blank, luma];
        matrix.setAttribute("values", [...rows, "0 0 0 1 0"].join(" "));
        filter.appendChild(matrix);
      }),
      brightnessContrastFilter: (brightness, factor) =>
        this.svgFilter(`bc:${brightness}:${factor}`, (filter) => {
          const transfer = document.createElementNS(SVG_NS, "feComponentTransfer");
          const intercept = 0.5 * (1 - factor) + brightness / 255;
          for (const channel of ["R", "G", "B"]) {
            const func = document.createElementNS(SVG_NS, `feFunc${channel}`);
            func.setAttribute("type", "linear");
            func.setAttribute("slope", String(factor));
            func.setAttribute("intercept", String(intercept));
            transfer.appendChild(func);
          }
          filter.appendChild(transfer);
        }),
      blurFilter: (sx, sy) => this.svgFilter(`blur:${sx}:${sy}`, (filter) => {
        const blur = document.createElementNS(SVG_NS, "feGaussianBlur");
        blur.setAttribute("stdDeviation", `${sx} ${sy}`);
        filter.appendChild(blur);
      }),
      envFilter: (name, effect) => this.svgFilter(`env:${name}`, (filter) => {
        this.buildEnvColorFilter(filter, effect);
      }),
    };
  }

  /**
   * Construit le filtre SVG d'un effet d'ambiance, dans l'ordre du moteur
   * (`AnimationLayer.override.tjs`, `applyColorCorrection_in_onPaint`) :
   * niveaux de gris → correction gamma par canal → calques de couleur translucides
   * (chacun mélangé sur le résultat précédent avec son mode de fusion).
   */
  private buildEnvColorFilter(filter: SVGFilterElement, effect: EnvColorEffect): void {
    let previous: string | null = null;
    const append = (element: SVGElement, result: string): void => {
      if (previous !== null) element.setAttribute("in", previous);
      element.setAttribute("result", result);
      filter.appendChild(element);
      previous = result;
    };

    if (effect.grayscale) {
      const matrix = document.createElementNS(SVG_NS, "feColorMatrix");
      matrix.setAttribute("type", "saturate");
      matrix.setAttribute("values", "0");
      append(matrix, "env-grayscale");
    }

    const neutralGamma =
      [effect.rGamma, effect.gGamma, effect.bGamma].every((gamma) => gamma === 1) &&
      [effect.rFloor, effect.gFloor, effect.bFloor].every((floor) => floor === 0) &&
      [effect.rCeil, effect.gCeil, effect.bCeil].every((ceil) => ceil === 255);
    if (!neutralGamma) {
      const transfer = document.createElementNS(SVG_NS, "feComponentTransfer");
      const channels = [
        ["R", effect.rGamma, effect.rFloor, effect.rCeil],
        ["G", effect.gGamma, effect.gFloor, effect.gCeil],
        ["B", effect.bGamma, effect.bFloor, effect.bCeil],
      ] as const;
      for (const [channel, gamma, floor, ceil] of channels) {
        const func = document.createElementNS(SVG_NS, `feFunc${channel}`);
        func.setAttribute("type", "gamma");
        // Le moteur applique pow(x, 1/gamma) puis remet à l'échelle [floor, ceil].
        func.setAttribute("amplitude", String((ceil - floor) / 255));
        func.setAttribute("exponent", String(1 / gamma));
        func.setAttribute("offset", String(floor / 255));
        transfer.appendChild(func);
      }
      append(transfer, "env-gamma");
    }

    effect.blends.forEach((blend, index) => {
      const flood = document.createElementNS(SVG_NS, "feFlood");
      flood.setAttribute("flood-color", `rgb(${blend.r}, ${blend.g}, ${blend.b})`);
      flood.setAttribute("flood-opacity", String(blend.alpha / 255));
      const floodResult = `env-color-${index}`;
      flood.setAttribute("result", floodResult);
      filter.appendChild(flood);

      const blended = document.createElementNS(SVG_NS, "feBlend");
      // Source = couleur du calque, backdrop = image déjà corrigée (sémantique vérifiée de feBlend).
      blended.setAttribute("in", floodResult);
      blended.setAttribute("in2", previous ?? "SourceGraphic");
      blended.setAttribute("mode", feBlendModeForLayerType(blend.layerType));
      append(blended, `env-blend-${index}`);
    });

    // Aucune correction : filtre identité (une primitive est requise par <filter>).
    if (previous === null) {
      const matrix = document.createElementNS(SVG_NS, "feColorMatrix");
      matrix.setAttribute("type", "matrix");
      matrix.setAttribute("values", "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0");
      filter.appendChild(matrix);
    }
  }

  /** Crée (une fois par clé) un filtre SVG et retourne `url(#id)`. */
  private svgFilter(key: string, build: (filter: SVGFilterElement) => void): string {
    const existing = this.filterIds.get(key);
    if (existing) return `url(#${existing})`;
    if (!this.svgFilters) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.style.position = "absolute";
      svg.style.width = "0";
      svg.style.height = "0";
      svg.style.overflow = "hidden";
      svg.appendChild(document.createElementNS(SVG_NS, "defs"));
      (this.container ?? this.root)?.appendChild(svg);
      this.svgFilters = svg;
    }
    const defs = this.svgFilters.firstElementChild as SVGDefsElement;
    const id = `mh-filter-${++this.filterCounter}`;
    const filter = document.createElementNS(SVG_NS, "filter") as SVGFilterElement;
    filter.setAttribute("id", id);
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", "100%");
    filter.setAttribute("height", "100%");
    build(filter);
    defs.appendChild(filter);
    this.filterIds.set(key, id);
    return `url(#${id})`;
  }

  /** Apparence d'un calque (undefined = défauts : aucun filtre, pas de blend). Signale une fois
   * les effets d'ambiance du jeu (`envcolor.ksc`) qui ne sont pas appliqués. */
  private appearanceWithWarning(s: {
    type?: number;
    effect?: string;
    brightness?: number;
    contrast?: number;
    blurx?: number;
    blury?: number;
  }): Appearance | undefined {
    if (
      s.type === undefined &&
      s.effect === undefined &&
      s.brightness === undefined &&
      s.contrast === undefined &&
      s.blurx === undefined &&
      s.blury === undefined
    ) {
      return undefined;
    }
    const envApplied = s.effect !== undefined && this.envEffects?.has(s.effect) === true;
    if (!envApplied && isEnvironmentEffect(s.effect) && !this.warnedEffects.has(s.effect!)) {
      this.warnedEffects.add(s.effect!);
      console.warn(`[renderer] effet d'ambiance non appliqué (données du jeu non installées) : ${s.effect}`);
    }
    return { type: s.type, effect: s.effect, brightness: s.brightness, contrast: s.contrast, blurx: s.blurx, blury: s.blury };
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
    this.indicatorEl.style.visibility = "hidden";
    this.loadClickGlyphs();

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
      case "staffroll":
        // Rien en cours (déjà terminé ou jamais lancé) : résout immédiatement.
        promise = this.staffrollPromise;
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
    // Skip des crédits (jamais déclenché par un clic car @wstaffroll est non-skippable,
    // mais cohérent avec un arrêt forcé de session).
    this.completeStaffroll();
  }

  setClickIndicator(style: "line" | "page" | null): void {
    if (!this.indicatorEl) return;
    const previous = this.clickStyle;
    this.clickStyle = style;
    this.indicatorEl.textContent = style === "page" ? "▼" : style === "line" ? "▽" : "";
    this.indicatorEl.style.visibility = style ? "visible" : "hidden";
    if (style) this.indicatorEl.dataset.style = style;
    else delete this.indicatorEl.dataset.style;
    // La taille de l'icône dépend du style affiché (glyphe de secours ou bande chargée) : replacer.
    this.placeIndicator();
    // Fin d'une attente : le texte affiché jusqu'ici devient « lu » et s'atténue (#173).
    if (previous && !style && !this.typewriterResolve) {
      const units = this.buildTextUnits();
      if (units.length !== this.readUnits) {
        this.readUnits = units.length;
        this.renderTextUpTo(units, this.typedUnits);
      }
    }
  }

  /**
   * Charge les bandes d'animation des indicateurs (`linebreak_a`, `pagebreak_a`) par l'AssetResolver.
   * Tant qu'une bande n'est pas chargée (ou si elle manque), l'indicateur garde son glyphe ▽/▼.
   */
  private loadClickGlyphs(): void {
    const el = this.indicatorEl;
    if (!el || typeof Image === "undefined") return;
    for (const [style, glyph] of Object.entries(CLICK_GLYPHS)) {
      const url = this.resolver.image(glyph.storage);
      el.style.setProperty(`--mh-glyph-${style}`, cssUrl(url));
      const img = new Image();
      img.onload = () => {
        el.classList.add(`mh-glyph-${style}-ok`);
        // La bande chargée a une taille connue : recentrer l'indicateur si c'est le style courant.
        if (this.clickStyle === style) this.placeIndicator();
      };
      img.onerror = () => this.resolver.reportMissing("image", glyph.storage);
      img.src = url;
    }
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
    // La sauvegarde ne garde pas la limite du texte lu : la page restaurée s'affiche en entier.
    this.readUnits = 0;
    this.textbox = snapshot.textbox;
    this.staffroll = snapshot.staffroll;
    this.renderScene(true);
    this.renderText(true);
    this.applyTextbox();
    // Restaure l'overlay des crédits éventuel (sans relancer le défilement : approximation).
    this.renderStaffroll({ instant: false, signal });
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
      this.textEl.style.fontFamily = settings.fontFamily;
      // Le fondu du texte lu est piloté par deux variables CSS (#177).
      this.textEl.style.setProperty("--mh-read-opacity", String(settings.readFade ? settings.readFadeOpacity : 1));
      this.textEl.style.setProperty("--mh-read-duration", `${settings.readFade ? settings.readFadeDuration : 0}ms`);
      this.textEl.dataset.textAnimation = settings.textAnimation;
      this.textEl.style.fontSize = `${this.nominalTextRem()}rem`;
      this.fitText(this.buildTextUnits(), this.typedUnits);
    }
    this.renderEffect();
  }

  clear(): void {
    this.resetBindOffsets();
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
    this.readUnits = 0;
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
    this.svgFilters?.remove();
    this.svgFilters = null;
    this.filterIds.clear();
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
        /* Pas de boîte ni de contexte d'empilement : les calques se composent directement dans
           le contexte du stage, ce qui permet aux modes de fusion (mix-blend-mode) de se mélanger
           au fond et aux calques inférieurs, comme dans le moteur. */
        display: contents;
      }
      .mh-stage-sprite {
        position: absolute;
        transform: translate(-50%, -50%);
      }
      .mh-stage-effects {
        position: absolute;
        inset: 0;
        /* Au-dessus des calques (z-index moteur jusqu'à ~90000) et sous la boîte de texte. */
        z-index: 900000;
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
        z-index: 1000000;
        transition: opacity 0.3s ease;
        pointer-events: auto;
      }
      /* Ancienne boîte (#163), repli quand l'image de cadre manque : position et hauteur fixes. */
      .mh-stage-textbox[data-frame-style="box"] {
        left: 10%;
        right: 10%;
        bottom: 5%;
        height: ${TEXT_FIT_DEFAULTS.boxHeightRatio * 100}%;
      }
      .mh-stage-textbox-frame {
        position: absolute;
        inset: 0;
      }
      .mh-stage-textbox[data-frame-style="box"] .mh-stage-textbox-frame {
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
      /*
       * Cadre image (#173) : l'image txtwindowNN (1024x576) couvre la scène, le texte est posé dessus
       * sans boîte, dans la zone mesurée sur le jeu d'origine (voir FRAME_TEXT_AREA).
       */
      .mh-stage-textbox[data-frame-style="image"] {
        inset: 0;
      }
      .mh-stage-textbox[data-frame-style="image"] .mh-stage-textbox-frame {
        background-size: 100% 100%;
        background-repeat: no-repeat;
      }
      .mh-stage-textbox[data-frame-style="image"] .mh-stage-text {
        position: absolute;
        left: ${FRAME_TEXT_AREA.left * 100}%;
        right: ${FRAME_TEXT_AREA.right * 100}%;
        top: ${FRAME_TEXT_AREA.top * 100}%;
        padding: 0;
        font-size: ${FRAME_TEXT_REM}rem;
        line-height: ${FRAME_TEXT_LINE_HEIGHT};
        letter-spacing: ${FRAME_TEXT_LETTER_SPACING};
        text-shadow: 0 0 3px rgba(0,0,0,0.85), 1px 1px 2px rgba(0,0,0,0.7);
      }
      /* [graph] (#284) : image inline dans le flux de texte (emoji), hauteur alignée sur la ligne. */
      .mh-stage-graph {
        display: inline-block;
        vertical-align: -0.15em;
        height: 1.05em;
        width: auto;
        object-fit: contain;
        margin: 0 0.04em;
      }
      /* Particules @beginfallnote (#282) : notes de papier génériques qui tombent. */
      .mh-stage-fallnote {
        position: absolute;
        inset: 0;
        z-index: 100000;
        pointer-events: none;
        overflow: hidden;
      }
      .mh-stage-fallnote-note {
        position: absolute;
        top: -8%;
        display: block;
        background: rgba(255, 252, 235, 0.92);
        border: 1px solid rgba(120, 100, 70, 0.55);
        border-radius: 1px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
        animation: mh-fallnote-fall linear infinite;
      }
      @keyframes mh-fallnote-fall {
        0% { transform: translateY(0) rotate(3deg); opacity: 0.9; }
        100% { transform: translateY(115vh) rotate(210deg); opacity: 0.7; }
      }
      @media (prefers-reduced-motion: reduce) {
        .mh-stage-fallnote-note { animation: none; display: none; }
      }
      .mh-stage-text-swing {
        display: inline-block;
        animation: mh-text-swing 2.2s ease-in-out infinite;
      }
      @keyframes mh-text-swing {
        0%, 100% { transform: translateY(0) rotate(-1.5deg); }
        50% { transform: translateY(-1px) rotate(1.5deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .mh-stage-text-swing { animation: none; }
      }
      .mh-stage-text-read {
        opacity: var(--mh-read-opacity, ${READ_TEXT_OPACITY});
        transition: opacity var(--mh-read-duration, 300ms) ease;
      }
      .mh-stage-text[data-text-animation="fade"].mh-stage-text-appear {
        animation: mh-text-appear 220ms ease;
      }
      @keyframes mh-text-appear {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .mh-stage-indicator {
        color: #fff;
        animation: mh-indicator-blink 1s infinite;
      }
      .mh-stage-textbox[data-frame-style="box"] .mh-stage-indicator {
        position: absolute;
        right: 24px;
        bottom: 16px;
        font-size: 1.2rem;
      }
      /*
       * Cadre image : l'indicateur est hors du flux, positionné sur le dernier caractère par
       * placeIndicator (#175). Il n'élargit donc pas la ligne et ne peut pas la faire passer
       * à la ligne suivante.
       */
      .mh-stage-textbox[data-frame-style="image"] .mh-stage-indicator {
        position: absolute;
        display: block;
        letter-spacing: 0;
        font-size: 0.8em;
        line-height: 1;
        margin: 0;
        pointer-events: none;
      }
      .mh-stage-textbox[data-frame-style="image"] .mh-stage-indicator:not([data-style]) {
        display: none;
      }
      .mh-stage-textbox[data-frame-style="image"] .mh-stage-indicator.mh-glyph-line-ok[data-style="line"],
      .mh-stage-textbox[data-frame-style="image"] .mh-stage-indicator.mh-glyph-page-ok[data-style="page"] {
        color: transparent;
        font-size: 0;
        background-repeat: no-repeat;
        background-position: 0 0;
        animation: none;
        text-shadow: none;
      }
      .mh-stage-textbox[data-frame-style="image"] .mh-stage-indicator.mh-glyph-line-ok[data-style="line"] {
        width: ${CLICK_GLYPHS.line.width}px;
        height: ${CLICK_GLYPHS.line.height}px;
        background-image: var(--mh-glyph-line);
        animation: mh-glyph-line 2s steps(${CLICK_GLYPHS.line.frames}) infinite;
      }
      .mh-stage-textbox[data-frame-style="image"] .mh-stage-indicator.mh-glyph-page-ok[data-style="page"] {
        width: ${CLICK_GLYPHS.page.width}px;
        height: ${CLICK_GLYPHS.page.height}px;
        background-image: var(--mh-glyph-page);
        animation: mh-glyph-page 2s steps(${CLICK_GLYPHS.page.frames}) infinite;
      }
      @keyframes mh-glyph-line {
        to { background-position: -${CLICK_GLYPHS.line.width * CLICK_GLYPHS.line.frames}px 0; }
      }
      @keyframes mh-glyph-page {
        to { background-position: -${CLICK_GLYPHS.page.width * CLICK_GLYPHS.page.frames}px 0; }
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
        // Un `@bg` rebase les coordonnées : les calques liés au fond repartent de leur position.
        if (
          oldScene.bg !== event.scene.bg ||
          oldScene.bgLeft !== event.scene.bgLeft ||
          oldScene.bgTop !== event.scene.bgTop
        ) {
          this.resetBindOffsets();
        }
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
        // Réglage d'origine « Effacement du texte au changement de page » (#177) : il ne
        // s'applique qu'aux clearText implicites de changement de page, pas à @cm/@cm4pg (force).
        if (!event.force && !this.settings.clearTextOnPageChange) break;
        this.text = [];
        this.typedUnits = 0;
        this.readUnits = 0;
        this.textEl?.replaceChildren();
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
      case "pauseAnimation": {
        if (event.target) this.animations.get(event.target)?.pause();
        else for (const ctrl of this.animations.values()) ctrl.pause();
        break;
      }
      case "resumeAnimation": {
        if (event.target) this.animations.get(event.target)?.resume();
        else for (const ctrl of this.animations.values()) ctrl.resume();
        break;
      }
      case "fallnote": {
        this.applyFallnote(event, opts);
        break;
      }
      case "stopTransition": {
        this.finishTransition();
        break;
      }
      case "quake": {
        if (event.quake && this.settings.specialEffects) this.startQuake(event.quake, opts);
        else if (!event.quake) this.stopQuake();
        break;
      }
      case "screenShake": {
        // @shake / @swing / @stopswing (HUD-16 lot plugin #281) : oscillation de la scène, sans
        // attente. Désactivée par le réglage « effets spéciaux » et par prefers-reduced-motion.
        if (event.shake && this.settings.specialEffects) this.startScreenShake(event.shake, opts);
        else this.stopScreenShake();
        break;
      }
      case "noiseAct": {
        this.animateNoise(event, opts);
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
    // Apparence du fond (`@bg type=/effect=/blur/brightness/contrast`).
    applyAppearance(
      this.bgEl,
      bg
        ? this.appearanceWithWarning({
            type: this.currentScene.bgType,
            effect: this.currentScene.bgEffect,
            brightness: this.currentScene.bgBrightness,
            contrast: this.currentScene.bgContrast,
            blurx: this.currentScene.bgBlurX,
            blury: this.currentScene.bgBlurY,
          })
        : undefined,
      this.filterRegistry,
    );
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
      // Défauts du moteur : X centré, Y = bas de l'image à 48 px sous le bas de l'écran
      // (`@bg` de `data/override/tagex.tjs`, issue #249). Chaque axe est indépendant : `left=`
      // seul n'impose pas le centrage vertical.
      this.bgEl.style.backgroundPosition =
        `${left !== undefined ? `${left}px` : "50%"} ${top !== undefined ? `${top}px` : "calc(100% + 48px)"}`;
      if (transformedBg) this.renderTransformedBg(bg, left, top, bgZoomX, bgZoomY, bgRotate);
    }

    const sprites = [...this.currentScene.sprites].sort((a, b) => a.z - b.z);
    const seen = new Set<string>();

    for (const s of sprites) {
      seen.add(s.id);
      // Calque sans image (placeholder d'animation : `@fg storage=` vide ou
      // `@movefg` sur un calque pas encore créé) : rien à afficher. Sans ce
      // garde-fou, le resolver produit une URL vide (`/assets/image/.webp`) et le
      // DOM reçoit un `<img>` cassé. Le calque réapparaîtra si `@chgfg`/`@fg` lui
      // donne ensuite une image.
      if (!s.storage.trim()) {
        const stale = this.spriteEls.get(s.id);
        if (stale) {
          this.stopAnimation(s.id);
          stale.remove();
          this.spriteEls.delete(s.id);
        }
        continue;
      }
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
        wrapper.style.visibility = s.visible === false ? "hidden" : "";
        wrapper.style.transform = partbgWrapperTransform();
        applyAppearance(wrapper, this.appearanceWithWarning(s), this.filterRegistry, this.envEffects);
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
        img.style.visibility = s.visible === false ? "hidden" : "";
        applyAppearance(img, this.appearanceWithWarning(s), this.filterRegistry, this.envEffects);
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
        // Point d'ancrage du zoom/rotation (aiguilles d'horloge : afx/afy du moteur).
        if (s.afx !== undefined && s.afy !== undefined) img.style.transformOrigin = `${s.afx}px ${s.afy}px`;
        else img.style.removeProperty("transform-origin");
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
    // Mêmes défauts que le fond non transformé (`background-position: 50% calc(100% + 48px)`) :
    // X centré si `left`
    // est omis, bas de l'image à 48 px sous le bas de l'écran si `top` est omis. Chaque axe est
    // indépendant (issue #249).
    const centeredX = left === undefined;
    if (left !== undefined) img.style.left = `${left}px`;
    else img.style.left = "50%";
    if (top !== undefined) img.style.top = `${top}px`;
    else img.style.bottom = `-${BG_BOTTOM_MARGIN}px`;
    img.style.transform = centeredX ? `translateX(-50%) ${scale}` : scale;
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
  /**
   * `@bindbg` (approximation) : pendant un panoramique du fond (`bgMove`), les sprites de la page
   * sont translatés du même delta. Le décalage est visuel (propriété CSS `translate`, animée en
   * WAAPI quand c'est possible) ; les positions logiques sauvegardées ne sont pas modifiées.
   * Le décalage courant est conservé quand `@bindbg enabled=0` (le calque cesse simplement de suivre).
   */
  private followBackground(dx: number, dy: number, time: Ms, accel: number): void {
    if ((dx === 0 && dy === 0) || !this.spritesEl) return;
    const easing = cssEasing(accel);
    for (const [id, el] of this.spriteEls) {
      const from = this.bindOffsets.get(id) ?? { x: 0, y: 0 };
      const to = { x: from.x + dx, y: from.y + dy };
      this.bindOffsets.set(id, to);
      const fromCss = `${from.x}px ${from.y}px`;
      const toCss = `${to.x}px ${to.y}px`;
      const animatable = el as HTMLElement & { animate?: (kf: Keyframe[], opts: KeyframeAnimationOptions) => Animation };
      if (time > 0 && typeof animatable.animate === "function") {
        try {
          animatable.animate([{ translate: fromCss }, { translate: toCss }], { duration: time, easing, fill: "forwards" });
          continue;
        } catch {
          // Pas de WAAPI exploitable : repli sur la transformation finale.
        }
      }
      el.style.setProperty("translate", toCss);
    }
  }

  /** Réinitialise les décalages `@bindbg` (nouvelle scène rebasée, clear, dispose). */
  private resetBindOffsets(): void {
    this.bindOffsets.clear();
    for (const el of this.spriteEls.values()) el.style.removeProperty("translate");
  }

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
    // @bindbg : les calques de la page suivent le panoramique du fond (approximation visuelle).
    if (this.currentScene.bindChildren && from) {
      this.followBackground(left - from.left, top - from.top, time, accel);
    }
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
    // Réglage d'origine « Affichage des effets spéciaux » (#177).
    if (!this.settings.specialEffects) return;
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
    } else if (effect.kind === "focusline") {
      this.renderFocusLines(effect);
    }
  }

  /**
   * `@focusline` (focuslineplugin.tjs) : approximation en canvas de lignes radiales convergeant
   * vers (`cx`, `cy`). Le nombre de lignes et leur longueur sont tirés dans les bornes du tag, et
   * l'apparition est un fondu CSS de `appear` ms (instantané sous `prefers-reduced-motion`).
   */
  private renderFocusLines(effect: Extract<EffectState, { kind: "focusline" }>): void {
    if (!this.effectsEl) return;
    const canvas = document.createElement("canvas");
    canvas.className = "mh-stage-focusline";
    canvas.width = 1024;
    canvas.height = 576;
    canvas.dataset.effect = "focusline";
    const reduced = this.prefersReducedMotion();
    const appear = reduced ? 0 : Math.max(0, effect.appear);
    canvas.style.cssText =
      "position:absolute;left:0;top:0;width:1024px;height:576px;pointer-events:none;" +
      `opacity:${reduced ? effect.opacity : 0};` +
      `transition:${appear > 0 ? `opacity ${appear}ms linear` : "none"};`;
    this.effectsEl.appendChild(canvas);
    this.drawFocusLines(canvas, effect);
    if (!reduced) {
      // Laisse la feuille de style appliquer l'opacité 0 avant de lancer le fondu.
      setTimeout(() => {
        canvas.style.opacity = String(effect.opacity);
      }, 0);
    }
  }

  /** Dessine les lignes radiales de `@focusline` sur le canvas (1024×576, repère de la scène). */
  private drawFocusLines(canvas: HTMLCanvasElement, effect: Extract<EffectState, { kind: "focusline" }>): void {
    // jsdom ne fournit pas de contexte 2D : l'élément reste présent (état observable) sans tracé.
    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx) return;
    const minLines = Math.max(0, Math.min(effect.minLines, effect.maxLines));
    const maxLines = Math.max(effect.minLines, effect.maxLines);
    const count = Math.round(minLines + Math.random() * Math.max(0, maxLines - minLines));
    const minLength = Math.max(0, Math.min(effect.minLength, effect.maxLength));
    const maxLength = Math.max(effect.minLength, effect.maxLength);
    ctx.clearRect(0, 0, 1024, 576);
    ctx.strokeStyle = effect.color;
    ctx.lineCap = "round";
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const inner = 24 + Math.random() * 80;
      const length = minLength + Math.random() * Math.max(0, maxLength - minLength);
      ctx.globalAlpha = Math.min(1, Math.max(0, effect.opacity * (0.35 + Math.random() * 0.65)));
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(effect.cx + Math.cos(angle) * inner, effect.cy + Math.sin(angle) * inner);
      ctx.lineTo(effect.cx + Math.cos(angle) * (inner + length), effect.cy + Math.sin(angle) * (inner + length));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Apparence de départ d'un calque animé : celle de la scène courante (les props discrètes des
   * keyframes s'y appliquent ensuite dans l'ordre du script).
   */
  private currentAnimationAppearance(target: string): Appearance {
    const sprite = this.currentScene?.sprites.find((s) => s.id === target);
    return sprite
      ? {
          type: sprite.type,
          effect: sprite.effect,
          brightness: sprite.brightness,
          contrast: sprite.contrast,
          blurx: sprite.blurx,
          blury: sprite.blury,
        }
      : {};
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
    const ctrl = new AnimationController(
      def,
      target,
      el,
      this.resolver,
      () => this.stopAnimation(target),
      innerEl,
      this.currentAnimationAppearance(target),
      (element, appearance) => applyAppearance(element, appearance, this.filterRegistry, this.envEffects),
    );
    this.animations.set(target, ctrl);
  }

  /** Applique l'état final d'une animation sur le sprite cible (mode instant). */
  private applyAnimationFinal(def: AnimationDef): void {
    if (def.keyframes.length === 0) return;
    const resolved = resolveKeyframes(def.keyframes);
    const last = resolved[resolved.length - 1];
    const el = this.spriteEls.get(def.id ?? def.storage) ?? this.findPartbgEl(def);
    if (!el) return;
    const appearance: Appearance = {
      type: last.type !== undefined ? Number(last.type) : def.keyframes[0]?.type !== undefined ? Number(def.keyframes[0]!.type) : undefined,
      effect: last.effect ?? def.keyframes[0]?.effect,
      contrast: last.contrast ?? def.keyframes[0]?.contrast,
      brightness: last.brightness ?? def.keyframes[0]?.brightness,
      blurx: last.blurx ?? def.keyframes[0]?.blurx,
      blury: last.blury ?? def.keyframes[0]?.blury,
    };
    applyAppearance(el, appearance, this.filterRegistry, this.envEffects);
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

  /**
   * `@beginfallnote`/`@fallnoteopt`/`@endfallnote` (fallnoteplugin.tjs) : approximation de la
   * pluie de notes par des particules CSS (`fallnote-particles`, registre #296). Le taux `rate`
   * module la vitesse de chute ; l'overlay est retiré à `@endfallnote` (et sur restore/clear).
   */
  private applyFallnote(event: Extract<RenderEvent, { kind: "fallnote" }>, opts: RunOptions): void {
    if (!event.active) {
      this.stopFallnote();
      return;
    }
    if (event.rate !== undefined) this.fallnoteRate = event.rate;
    if (opts.instant) {
      // Saut/chargement : l'effet continu reste visible mais sans animation.
      this.fallnoteEl?.setAttribute("data-instant", "1");
    }
    if (!this.container) return;
    if (!this.fallnoteEl) {
      const overlay = document.createElement("div");
      overlay.className = "mh-stage-fallnote";
      // Particules déterministes (pas de Math.random : rendu reproductible et testable).
      const count = 18;
      for (let i = 0; i < count; i++) {
        const note = document.createElement("span");
        note.className = "mh-stage-fallnote-note";
        const size = 7 + (i % 3) * 2;
        note.style.left = `${(i * 61) % 100}%`;
        note.style.width = `${size}px`;
        note.style.height = `${size * 1.35}px`;
        note.style.animationDelay = `${-((i * 0.37) % 4).toFixed(2)}s`;
        note.style.animationDuration = `${(3.2 + (i % 5) * 0.65).toFixed(2)}s`;
        overlay.appendChild(note);
      }
      this.container.appendChild(overlay);
      this.fallnoteEl = overlay;
    }
    this.fallnoteEl.dataset.rate = String(this.fallnoteRate);
  }

  private stopFallnote(): void {
    this.fallnoteEl?.remove();
    this.fallnoteEl = null;
  }

  private stopAnimation(target: string): void {
    const ctrl = this.animations.get(target);
    if (ctrl) {
      ctrl.cancel();
      this.animations.delete(target);
    }
  }

  private startQuake(spec: { hmax: number; vmax: number; time?: Ms | null }, opts: RunOptions): void {
    this.stopScreenShake();
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

  /**
   * Secousse d'écran `@shake` (sinusoïdale) ou `@swing` (aléatoire continue), approximée par une
   * oscillation de la scène entière (même transformation que `@quake`). `time: null` = continue
   * jusqu'à `@stopswing`/`@stopquake`/fin de session. Sans effet sous `prefers-reduced-motion`.
   */
  private startScreenShake(spec: ScreenShakeSpec, opts: RunOptions): void {
    this.stopScreenShake();
    this.stopQuake();
    if (opts.instant || !this.container || !this.settings.specialEffects) return;
    if (this.prefersReducedMotion()) return;

    const start = performance.now();
    const duration = spec.time;
    const rate = spec.mode === "swing" ? Math.max(0.1, spec.rate) : 1;
    let cycleStart = 0;
    let cycleLength = 0;
    let ampX = 0;
    let ampY = 0;

    const nextSwingCycle = (now: number): void => {
      if (spec.mode !== "swing") return;
      cycleStart = now;
      cycleLength = spec.minCycle + Math.random() * Math.max(0, spec.maxCycle - spec.minCycle);
      const vibration = spec.minVibration + Math.random() * Math.max(0, spec.maxVibration - spec.minVibration);
      const angle = Math.random() * Math.PI * 2;
      ampX = Math.cos(angle) * vibration;
      ampY = Math.sin(angle) * vibration;
    };

    this.shakeResolve = () => {};
    const tick = (): void => {
      if (!this.container) return;
      const now = performance.now();
      const elapsed = now - start;
      let dx = 0;
      let dy = 0;
      if (spec.mode === "shake") {
        const phase = (elapsed / Math.max(1, spec.cycle)) * Math.PI * 2;
        dx = Math.sin(phase) * spec.hmax;
        dy = Math.sin(phase) * spec.vmax;
      } else {
        if (elapsed >= cycleStart + cycleLength) nextSwingCycle(elapsed);
        const local = cycleLength > 0 ? (elapsed - cycleStart) / cycleLength : 0;
        const phase = local * Math.PI * 2 * rate;
        dx = Math.sin(phase) * ampX;
        dy = Math.sin(phase) * ampY;
      }
      this.container.style.transform = `translate(${dx}px, ${dy}px) scale(${STAGE_SCALE})`;
      if (duration !== null && elapsed >= duration) {
        this.stopScreenShake();
        return;
      }
      this.shakeTimer = setTimeout(tick, 16);
    };
    nextSwingCycle(0);
    tick();
  }

  private stopScreenShake(): void {
    if (this.shakeTimer) clearTimeout(this.shakeTimer);
    this.shakeTimer = null;
    if (this.shakeResolve) {
      this.shakeResolve();
      this.shakeResolve = null;
    }
    // Ne pas écraser la transformation si un `@quake` a repris la main entre-temps.
    if (this.container && !this.quakeTimer) this.container.style.transform = "";
  }

  /** `prefers-reduced-motion` : pas d'effet agressif (secousses, apparition animée). */
  private prefersReducedMotion(): boolean {
    try {
      return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  /**
   * `@noiseact` : animation des propriétés du bruit (approximation — seules opacité et monocro
   * sont rendues ; la durée vient des keyframes, voir runtime `applyNoiseAct`).
   */
  private animateNoise(event: Extract<RenderEvent, { kind: "noiseAct" }>, opts: RunOptions): void {
    const effect = { kind: "noise" as const, opacity: event.opacity, monocro: event.monocro };
    this.currentScene = { ...this.currentScene, effect };
    if (!this.settings.specialEffects || !this.effectsEl) return;
    let el = this.effectsEl.querySelector<HTMLElement>(".mh-stage-noise");
    if (!el) {
      el = document.createElement("div");
      el.className = "mh-stage-noise";
      this.effectsEl.appendChild(el);
    }
    const from = event.from > 1 ? event.from / 255 : event.from;
    const target = event.opacity > 1 ? event.opacity / 255 : event.opacity;
    const time = opts.instant || this.prefersReducedMotion() ? 0 : event.time;
    el.style.transition = time > 0 ? `opacity ${time}ms linear` : "none";
    el.style.opacity = String(Math.min(1, Math.max(0, from)));
    el.style.filter = event.monocro ? "grayscale(100%)" : "";
    // Reflow pour partir de la valeur de départ, puis cible (transition CSS si time > 0).
    void el.offsetWidth;
    el.style.opacity = String(Math.min(1, Math.max(0, target)));
  }

  /**
   * Crédits de fin (`@staffrollinit`/`@staffrolltext`/`@staffrollstart`, `@staffrolluninit`).
   *
   * Fidélité au plugin d'origine (`data/scenario/staffrollplugin.tjs`) :
   * - chaque `@staffrolltext` est positionné à la somme cumulée de ses `y` dans un grand
   *   conteneur (`currentPos += y`) ;
   * - `@staffrollstart` lance un défilement linéaire de `height` pixels pendant `time` ms ;
   * - `@staffrolluninit` retire l'overlay et libère l'attente de `@wstaffroll` ;
   * - `@staffrollsetting bgcolor` est mémorisé par le runtime mais **jamais peint** (le plugin
   *   d'origine ne consomme pas cette valeur : aucun effet, documenté #286).
   * Le fond reste donc celui de la scène (noir/blanc posé par le script).
   */
  private renderStaffroll(opts: RunOptions): void {
    if (!this.container) return;
    const state = this.staffroll;
    if (!state) {
      this.finishStaffroll();
      return;
    }
    // Avant le départ (ou si l'overlay n'existe pas encore), on reconstruit le contenu ; les
    // @staffrolltext arrivent tous avant @staffrollstart. Un nouvel @staffrollinit pendant un
    // défilement interrompt l'ancien (le plugin appelle uninit dans son init).
    if (!state.running || !this.staffrollEl) {
      if (this.staffrollRunning) this.completeStaffroll();
      this.clearStaffrollOverlay();
      if (opts.instant) return;
      this.buildStaffrollOverlay(state);
    }
    if (state.running && !this.staffrollRunning) {
      this.startStaffrollScroll(state);
    }
  }

  /** Construit l'overlay et positionne les lignes aux offsets cumulés du moteur. */
  private buildStaffrollOverlay(state: StaffrollState): void {
    if (!this.container) return;
    const overlay = document.createElement("div");
    overlay.className = "mh-stage-staffroll";
    // Au-dessus des calques (z moteur max ~90 000) et de la boîte de texte (1 000 000) :
    // le plugin d'origine utilise absolute=2000000-5.
    overlay.style.cssText =
      "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2000000;";
    const inner = document.createElement("div");
    inner.className = "mh-stage-staffroll-inner";
    inner.style.cssText = "position:absolute;left:0;right:0;top:0;will-change:transform;";
    let offset = 0;
    for (const line of state.lines) {
      offset += line.y;
      const p = document.createElement("p");
      p.className = "mh-stage-staffroll-line";
      p.textContent = line.text;
      p.style.cssText = `position:absolute;left:0;right:0;top:${offset}px;margin:0;text-align:center;font-size:${line.size}px;color:${line.color ?? "#ffffff"};white-space:pre-wrap;`;
      if (line.face) p.style.fontFamily = line.face;
      inner.appendChild(p);
    }
    overlay.appendChild(inner);
    this.container.appendChild(overlay);
    this.staffrollEl = overlay;
    this.staffrollInner = inner;
    this.staffrollRunning = false;
  }

  /**
   * Lance le défilement et arme la résolution de `@wstaffroll`.
   * Utilise la Web Animations API (`element.animate`) comme les autres animations du rendu ;
   * repli transition CSS + minuterie quand `animate` n'existe pas (jsdom).
   */
  private startStaffrollScroll(state: StaffrollState): void {
    if (!this.staffrollInner) return;
    this.staffrollRunning = true;
    const inner = this.staffrollInner;
    const time = Math.max(0, state.time);
    const height = Math.max(0, state.height);
    const endTransform = `translateY(-${height}px)`;
    this.staffrollPromise = new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        this.staffrollTimer = null;
        this.staffrollResolve = null;
        this.staffrollPromise = null;
        this.staffrollRunning = false;
        resolve();
      };
      this.staffrollResolve = settle;
      if (time === 0) {
        inner.style.transform = endTransform;
        settle();
        return;
      }
      if (typeof inner.animate === "function") {
        this.staffrollAnimation = inner.animate(
          [{ transform: "translateY(0px)" }, { transform: endTransform }],
          { duration: time, easing: "linear", fill: "forwards" },
        );
        this.staffrollAnimation.onfinish = () => settle();
        // Filet de sécurité (animation interrompue/onglet en arrière-plan).
        this.staffrollTimer = setTimeout(settle, time + 100);
      } else {
        inner.style.transition = `transform ${time}ms linear`;
        inner.style.transform = endTransform;
        this.staffrollTimer = setTimeout(settle, time);
      }
    });
  }

  /** Termine immédiatement le défilement (skip), sans retirer l'overlay (attendu par uninit). */
  private completeStaffroll(): void {
    if (this.staffrollTimer) {
      clearTimeout(this.staffrollTimer);
      this.staffrollTimer = null;
    }
    this.staffrollAnimation?.cancel();
    this.staffrollAnimation = null;
    if (this.staffrollInner) {
      this.staffrollInner.style.transition = "none";
      this.staffrollInner.style.transform = `translateY(-${Math.max(0, this.staffroll?.height ?? 0)}px)`;
    }
    const resolve = this.staffrollResolve;
    this.staffrollResolve = null;
    this.staffrollPromise = null;
    this.staffrollRunning = false;
    if (resolve) resolve();
  }

  /** Retire l'overlay et libère les attentes (fin de générique ou disposition). */
  private finishStaffroll(): void {
    this.completeStaffroll();
    this.clearStaffrollOverlay();
  }

  private clearStaffrollOverlay(): void {
    if (this.staffrollTimer) {
      clearTimeout(this.staffrollTimer);
      this.staffrollTimer = null;
    }
    this.staffrollAnimation?.cancel();
    this.staffrollAnimation = null;
    this.staffrollEl?.remove();
    this.staffrollEl = null;
    this.staffrollInner = null;
    this.staffrollRunning = false;
  }

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
    const action = this.textbox.action ?? null;
    const actionChanged = action !== this.textAction;
    this.textAction = action;
    const hidden = this.userHidden || !this.textbox.visible;
    this.textboxEl.style.opacity = hidden ? "0" : "1";
    const style = resolveFrameStyle(this.textbox, this.frameFailed);
    const modeChanged = style.mode !== this.frameStyle.mode;
    this.frameStyle = style;
    this.textboxEl.dataset.frameStyle = style.mode;
    const frame = this.textboxEl.querySelector(".mh-stage-textbox-frame") as HTMLElement | null;
    if (frame) {
      if (style.mode === "box") {
        frame.style.backgroundImage = "";
        frame.style.opacity = String(this.settings.textboxOpacity);
        frame.style.display = this.textbox.frame ? "block" : "none";
      } else {
        frame.style.opacity = String(frameImageOpacity(this.settings.textboxOpacity));
        frame.style.display = style.image ? "block" : "none";
        frame.style.backgroundImage = style.image ? cssUrl(this.resolver.image(style.image)) : "";
        if (style.image) this.requestFrameImage(style.image);
      }
    }
    if (modeChanged) this.fitText(this.buildTextUnits(), this.typedUnits);
    // Action continue des messages : re-rendu du texte déjà affiché (animation CSS par caractère).
    if (actionChanged) this.renderTextUpTo(this.buildTextUnits(), this.typedUnits);
    this.placeIndicator();
  }

  /**
   * Vérifie qu'une image de cadre existe (AssetResolver). En cas d'échec, la fenêtre repasse à
   * l'ancienne boîte pour que le texte reste lisible sur la scène.
   */
  private requestFrameImage(storage: string): void {
    if (this.frameRequested.has(storage) || typeof Image === "undefined") return;
    this.frameRequested.add(storage);
    const img = new Image();
    img.onerror = () => {
      this.resolver.reportMissing("image", storage);
      this.frameFailed.add(storage);
      this.applyTextbox();
    };
    img.src = this.resolver.image(storage);
  }

  /** Taille nominale de la police (rem) du style courant, `fontScale` compris. */
  private nominalTextRem(): number {
    const base = this.frameStyle.mode === "image" ? FRAME_TEXT_REM : TEXT_REM;
    return base * this.settings.fontScale;
  }

  /** Hauteur disponible pour le texte, en pixels du repère de la scène. */
  private textAreaHeight(): number {
    const boxEl = this.textboxEl;
    if (this.frameStyle.mode === "image") {
      return frameTextAreaHeight(boxEl?.clientHeight || this.container?.clientHeight || STAGE_HEIGHT);
    }
    return boxEl?.clientHeight || textBoxHeight(this.container?.clientHeight || STAGE_HEIGHT);
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
      if ("graph" in seg) {
        // Image inline : une seule unité (la frappe ne la coupe jamais au milieu).
        units.push({ char: "", graph: seg.graph, group });
        return;
      }
      if ("emoji" in seg) {
        // Marqueur interne : le runtime doit l'avoir converti en graph ; repli textuel sinon.
        units.push({ char: seg.emoji.alt, group });
        return;
      }
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
    const wasEmpty = this.textEl.childNodes.length === 0;
    this.textEl.replaceChildren();
    const frag = document.createDocumentFragment();
    const limit = Math.min(n, units.length);
    // Texte déjà lu de la page : regroupé dans un span atténué (#173).
    const dim = dimmedUnitCount(this.readUnits, limit);
    const readEl = dim > 0 ? document.createElement("span") : null;
    if (readEl) {
      readEl.className = "mh-stage-text-read";
      frag.appendChild(readEl);
    }
    const swing = this.textAction === "swing";
    for (let i = 0; i < limit; i++) {
      const parent: Node = readEl && i < dim ? readEl : frag;
      const u = units[i];
      const hasCss = u.css !== undefined && Object.keys(u.css).length > 0;
      let node: Node;
      if (u.graph) {
        const img = document.createElement("img");
        img.className = "mh-stage-graph";
        img.alt = u.graph.alt ?? "";
        img.src = this.resolver.image(u.graph.storage);
        node = img;
      } else if (u.ruby) {
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
      } else if (hasCss || swing) {
        node = document.createElement("span");
        node.textContent = u.char;
        if (swing) {
          // Approximation de l'action continue « swing » du moteur (oscillation par caractère).
          (node as HTMLElement).className = "mh-stage-text-swing";
          (node as HTMLElement).style.animationDelay = `${(-(i % 17) * 0.12).toFixed(2)}s`;
        }
      } else {
        node = document.createTextNode(u.char);
      }
      if (hasCss && node instanceof HTMLElement) {
        for (const [prop, value] of Object.entries(u.css!)) node.style.setProperty(prop, value);
      }
      parent.appendChild(node);
    }
    this.textEl.appendChild(frag);
    if (wasEmpty && limit > 0 && this.settings.textAnimation === "fade") {
      // Relance l'animation d'apparition à chaque nouvelle page (#177).
      this.textEl.classList.remove("mh-stage-text-appear");
      void this.textEl.offsetWidth;
      this.textEl.classList.add("mh-stage-text-appear");
    }
    this.placeIndicator();
  }

  /** Cadre image : l'indicateur suit le texte ; ancienne boîte : il reste dans le coin de la boîte. */
  private placeIndicator(): void {
    const el = this.indicatorEl;
    const textEl = this.textEl;
    if (!el || !textEl || !this.textboxEl) return;
    if (this.frameStyle.mode === "box") {
      el.style.left = "";
      el.style.top = "";
      if (el.parentNode !== this.textboxEl || el !== this.textboxEl.lastChild) {
        this.textboxEl.appendChild(el);
      }
      return;
    }
    if (el.parentNode !== textEl || el !== textEl.lastChild) textEl.appendChild(el);

    // L'indicateur est hors du flux : on le centre sur la boîte du dernier caractère (#175).
    const node = this.lastVisibleTextNode();
    if (!node?.data) return;
    let end = node.data.length;
    while (end > 0 && /\s/.test(node.data[end - 1]!)) end--;
    if (end === 0 || typeof document.createRange !== "function") return;
    const range = document.createRange();
    range.setStart(node, end - 1);
    range.setEnd(node, end);
    const rects = typeof range.getClientRects === "function" ? range.getClientRects() : [];
    const char = rects[rects.length - 1];
    const textRect = textEl.getBoundingClientRect();
    // Largeur logique du contenu : `clientWidth` exclut la barre de défilement d'une page qui
    // déborde ; la largeur calculée, elle, reste fiable pour retrouver l'échelle de la scène.
    const computedWidth = Number.parseFloat(getComputedStyle(textEl).width);
    const logicalWidth = computedWidth > 0 ? computedWidth : textEl.clientWidth;
    if (!char || char.width === 0 || char.height === 0 || textRect.width === 0 || logicalWidth <= 0) {
      return;
    }
    const height = el.offsetHeight || CLICK_GLYPHS.page.height;
    const pos = indicatorOffset(char, textRect, textRect.width / logicalWidth, height);
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  }

  /** Dernier nœud de texte visible, hors indicateur et hors furigana (`rt`/`rp`). */
  private lastVisibleTextNode(): Text | null {
    if (!this.textEl) return null;
    const indicator = this.indicatorEl;
    const walker = document.createTreeWalker(this.textEl, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!(node instanceof Text)) continue;
      if (indicator?.contains(node)) continue;
      const parent = node.parentElement;
      if (parent && (parent.tagName === "RT" || parent.tagName === "RP")) continue;
      if (/\S/.test(node.data)) last = node;
    }
    return last;
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
    const nominalRem = this.nominalTextRem();
    // Mesure à zone libre : sans plafond ni défilement hérités de la page précédente.
    textEl.style.maxHeight = "";
    textEl.style.overflowY = "";
    const fit = fitTextBox({
      ...TEXT_FIT_DEFAULTS,
      boxHeight: this.textAreaHeight(),
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
    // La police finale peut avoir changé : replacer l'indicateur sur le dernier caractère.
    this.placeIndicator();
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
      const units = this.buildTextUnits();
      // Anti re-type : on continue depuis typedUnits (déjà révélées).
      const startUnit = Math.min(this.typedUnits, units.length);
      // Taille et position de la page entière avant de la révéler : pas de saut en cours de frappe.
      this.fitText(units, startUnit);
      const speed = opts.textSpeed ?? this.settings.textSpeedUnread;

      /** Résout la frappe en cours : fin normale, hurry, ou annulation. */
      const settle = (): void => {
        opts.signal.removeEventListener("abort", onAbort);
        this.typewriterResolve = null;
        resolve();
      };
      /**
       * Annulation (retour au titre, chargement) : on arrête la frappe sans attendre la fin de la
       * page. `RunOptions.signal` garantit que les promesses se résolvent à l'abort ; sans cela
       * `Player.endSession()` restait suspendu à la frappe en cours, donc le retour au titre ne
       * rendait pas la main tant que toute la page n'était pas tapée (#231).
       */
      const onAbort = (): void => {
        if (this.typewriterTimer) {
          clearTimeout(this.typewriterTimer);
          this.typewriterTimer = null;
        }
        this.typewriterHurry = false;
        settle();
      };

      // `hurry()` résout via ce champ : il passe par `settle`, qui retire l'écouteur d'abort.
      this.typewriterResolve = settle;
      if (opts.signal.aborted) {
        settle();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });

      if (opts.instant || speed <= 0 || this.typewriterHurry) {
        this.renderTextUpTo(units, units.length);
        this.typedUnits = units.length;
        this.typewriterHurry = false;
        settle();
        return;
      }
      this.typewriterHurry = false;

      let i = startUnit;
      const step = () => {
        if (!this.textEl) return;
        if (this.typewriterHurry) {
          this.renderTextUpTo(units, units.length);
          this.typedUnits = units.length;
          settle();
          return;
        }
        i++;
        this.renderTextUpTo(units, i);
        if (i >= units.length) {
          this.typedUnits = units.length;
          settle();
          return;
        }
        this.typewriterTimer = setTimeout(step, speed);
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
    if (this.shakeTimer) {
      clearTimeout(this.shakeTimer);
      this.shakeTimer = null;
    }
    if (this.shakeResolve) {
      this.shakeResolve();
      this.shakeResolve = null;
    }
    if (this.container && !this.quakeTimer) this.container.style.transform = "";
    if (this.staffrollTimer) clearTimeout(this.staffrollTimer);
    this.staffrollTimer = null;
    const staffrollResolve = this.staffrollResolve;
    this.staffrollResolve = null;
    this.staffrollPromise = null;
    this.staffrollAnimation?.cancel();
    this.staffrollAnimation = null;
    if (staffrollResolve) staffrollResolve();
    this.stopFallnote();
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
    /** Apparence courante du calque, mise à jour par les props discrètes (`-effect`, `-type`…). */
    private appearance: Appearance = {},
    private applyAppearanceSink?: (el: HTMLElement, appearance: Appearance) => void,
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
    this.scheduleDiscrete(compiled.discrete);

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
  private scheduleDiscrete(discrete: DiscreteChange[]): void {
    for (const change of discrete) {
      if (change.time <= 0) {
        // Immédiat.
        this.applyDiscreteChange(change);
      } else {
        const t = setTimeout(() => this.applyDiscreteChange(change), change.time);
        this.discreteTimers.push(t);
      }
    }
  }

  /** Applique tous les changements discrets d'un def jusqu'à un temps donné (fallback). */
  private applyDiscrete(def: AnimationDef, _upToTime: number): void {
    const compiled = compileAction(def);
    if (!compiled) return;
    for (const change of compiled.discrete) {
      this.applyDiscreteChange(change);
    }
  }

  private applyDiscreteChange(change: DiscreteChange): void {
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
        this.appearance.effect = String(change.value) === "" ? undefined : String(change.value);
        this.applyAppearanceSink?.(this.el, this.appearance);
        break;
      case "type": {
        const type = Number(change.value);
        this.appearance.type = Number.isFinite(type) ? type : undefined;
        this.applyAppearanceSink?.(this.el, this.appearance);
        break;
      }
      case "contrast":
        this.appearance.contrast = Number(change.value);
        this.applyAppearanceSink?.(this.el, this.appearance);
        break;
      case "brightness":
        this.appearance.brightness = Number(change.value);
        this.applyAppearanceSink?.(this.el, this.appearance);
        break;
      case "blurx":
        this.appearance.blurx = Number(change.value);
        this.applyAppearanceSink?.(this.el, this.appearance);
        break;
      case "blury":
        this.appearance.blury = Number(change.value);
        this.applyAppearanceSink?.(this.el, this.appearance);
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

  /**
   * Pause (@pauseaction) : suspend les animations WAAPI en cours. Le fallback `setTimeout`
   * (jsdom sans `Element.animate`) ne peut pas être suspendu finement : aucun effet (documenté).
   */
  pause(): void {
    this.animation?.pause();
    this.innerAnimation?.pause();
  }

  /** Relance (@resumeaction) une animation suspendue par `pause()`. */
  resume(): void {
    this.animation?.play();
    this.innerAnimation?.play();
  }

  /** Cancel (@stopaction/@removeaction) : annule tout (loops y compris), conserve l'état courant. */
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
