import { getPerfProbe } from "@/core/perf-probe.js";
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
  type StageReviewState,
} from "./types.js";
import { compileAction, resolveKeyframes, type DiscreteChange } from "./action-compiler.js";
import { sampleTrack } from "./easing-track.js";

/** Nom de storage lisible depuis une URL d'asset (diagnostic mode revue #400). */
function decodeStorageName(url: string): string {
  const file = url.split("/").pop() ?? "";
  try {
    return decodeURIComponent(file).replace(/\.(png|jpe?g|webp)$/i, "");
  } catch {
    return file;
  }
}
import { PARTBG_INNER_ORIGIN, partbgInnerTransform, partbgWrapperTransform, spriteTransform } from "./transform-helpers.js";
import { partbgClipRect, resolvePlacement, spriteAnchorSize, type ImageSize, type Rect } from "./sprite-placement.js";
import { storageKey } from "@/core/storage-key.js";
import { DecodableImage, decodeImage, ensureDecoded, type InflightDecodes } from "./image-decode.js";
import { DecodedImageCache, decodedCacheLimitBytes } from "./image-cache.js";
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
  frameTextAreaHeight,
  FRAME_TEXT_AREA,
  FRAME_TEXT_LINE_HEIGHT,
  FRAME_TEXT_REM,
  textBoxHeight,
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
/**
 * Style « cadre image » : taille et interligne du texte dans `text-fit.ts` (FRAME_TEXT_REM, #182).
 * Pas de `letter-spacing` : le moteur a `defaultPitch = 1` (pas) et la capture originale mesure
 * un pas de glyphe de 1 em (#319/#320) ; un tracking ajouterait +6 % de largeur par caractère.
 */
const FRAME_TEXT_LETTER_SPACING = "0";
/** Opacité du texte déjà lu de la page (capture : ~120 sur un fond à ~30, soit 40 %). */
const READ_TEXT_OPACITY = 0.4;
/** Hauteur du stage en repère logique (1024×576), repli quand le conteneur n'a pas de mise en page. */
const STAGE_WIDTH = 1024;
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
  /**
   * Groupe d'annotation ruby : les unités d'un même groupe (caractères et/ou image) sont réunies
   * dans un seul élément `<ruby>` — le moteur dessine le ruby au-dessus de l'image (#300).
   */
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

/** Repère logique du stage (référence des placements sprites, #315). */
const STAGE_SIZE = { width: 1024, height: 576 } as const;

export class DomStageRenderer implements StageRenderer {
  private resolver: AssetResolver;
  /** Dimensions natives des images (manifeste généré au build, #315) ; clé = storage normalisé. */
  private imageDimensions: Record<string, ImageSize>;
  private root: HTMLElement | null = null;

  private container: HTMLElement | null = null;
  private bgEl: HTMLElement | null = null;
  private spritesEl: HTMLElement | null = null;
  /** Calque(s) overlay pour le crossfade de fond (transition non-bloquante). */
  private bgOverlays: HTMLElement[] = [];
  /** Image du fond quand il est zoomé ou tourné (sinon `null` : les calques <img> double tampon). */
  private bgImgEl: HTMLImageElement | null = null;
  /** Double tampon du fond (#373) : deux <img>, l'une affichée, l'autre préparée. */
  private bgLayers: [HTMLImageElement | null, HTMLImageElement | null] = [null, null];
  private bgActiveLayer = 0;
  private effectsEl: HTMLElement | null = null;
  private textboxEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private indicatorEl: HTMLElement | null = null;
  private waitEl: HTMLElement | null = null;
  /** Zone de texte dédiée sous la scène en portrait (#210, décision propriétaire 4). */
  private dockEl: HTMLElement | null = null;
  private portraitLayout = false;
  /** Sonde scene-ready (#360) : no-op sauf `?perf=1`. */
  private readonly perf = getPerfProbe();
  private perfBgUrl: string | null = null;
  /** Échelle courante de la scène (1.25 en paysage, largeur réelle/1024 en portrait). */
  private sceneScale = STAGE_SCALE;
  private readonly onViewportResize = (): void => this.applyLayout();

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
  /**
   * Éléments d'une unité de texte rendue (un `<span>` par caractère/ruby/graph), avec l'index
   * d'unité à partir duquel ils sont révélés. La page est mise en page **en entier** une fois,
   * puis la frappe ne change que `visibility` : aucun reflow pendant la frappe (#314).
   */
  private textUnitEls: { el: HTMLSpanElement; revealAt: number }[] = [];
  /** Index d'unité → wrapper (révélation ciblée, un seul span modifié par caractère tapé). */
  private unitByIndex = new Map<number, HTMLSpanElement>();
  /** Nœud lecteur d'écran : texte **complet** de la page, annoncé une fois (jamais par caractère). */
  private srEl: HTMLElement | null = null;
  /** La première mise en page attend `document.fonts.ready` (#314). */
  private fontsReady = false;
  private fontsRelayoutQueued = false;
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

  /** Le marqueur `mh:boot:first-text` n'est posé qu'une fois (#385). */
  private firstTextMarked = false;
  /** Dernier id de transition de scène appliqué (#317) : même id = mise à jour sans cut. */
  private lastTransitionId: number | undefined = undefined;
  /** Propriétaires de pistes : un couple (cible, propriété) = une seule animation (#317). */
  private trackAnimations = new Map<string, Animation>();

  private transitionPromise: Promise<void> | null = null;
  private transitionResolve: (() => void) | null = null;
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Diagnostic mode revue (#400) : durée et instant de la transition en cours. */
  private transitionInfo: { method: string; timeMs: number; startedAt: number } | null = null;

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
  /** Références des images préchargées/décodées (plafonnées), pour ne pas perdre le décodage. */
  /** Décodages en cours partagés : une seule Image par URL, cache alimenté au succès (#386). */
  private readonly decodeInflight: InflightDecodes = new Map();
  /** Cache décodé LRU borné en octets (PERF-05 / #368) ; conserve les décodages entre scènes. */
  private readonly decodedImages = new DecodedImageCache({
    limitBytes: decodedCacheLimitBytes(),
  });
  /** Attente de décodage en cours : un clic/skip l'abandonne (transition non retardée). */
  private pendingDecodeAbort: AbortController | null = null;

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
    this.imageDimensions = deps.imageDimensions ?? {};
    // Stats du cache décodé dans window.__mhPerf.summary() (#368) : no-op sans ?perf=1.
    this.perf.setImageCacheStats(() => this.decodedImages.stats());
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
    for (let i = 0; i < 2; i++) {
      const layer = document.createElement("img");
      layer.className = "mh-stage-bg-layer";
      layer.alt = "";
      layer.draggable = false;
      layer.dataset.back = i === 0 ? "true" : "false";
      layer.dataset.front = i === 1 ? "true" : "false";
      layer.style.display = "none";
      this.bgEl.appendChild(layer);
      this.bgLayers[i as 0 | 1] = layer;
    }

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

    this.textEl.setAttribute("aria-hidden", "true");
    this.srEl = document.createElement("p");
    this.srEl.className = "mh-stage-text-sr";
    this.srEl.setAttribute("aria-live", "polite");
    this.srEl.setAttribute("aria-atomic", "true");

    this.textboxEl.append(frame, this.textEl, this.indicatorEl, this.srEl);
    // La mise en page dépend des polices chargées (#314) : on la refait une fois `fonts.ready`.
    if (typeof document !== "undefined" && "fonts" in document && document.fonts) {
      void document.fonts.ready.then(() => {
        this.fontsReady = true;
        if (this.fontsRelayoutQueued && !this.typewriterResolve) this.relayoutText();
        this.fontsRelayoutQueued = false;
      });
    } else {
      this.fontsReady = true;
    }

    this.waitEl = document.createElement("div");
    this.waitEl.className = "mh-stage-wait";
    this.waitEl.setAttribute("aria-hidden", "true");

    this.container.append(stage, this.textboxEl, this.waitEl);

    // Portrait (#210) : le texte quitte la scène et passe dans une zone dédiée sous le 16:9.
    this.dockEl = document.createElement("div");
    this.dockEl.className = "mh-portrait-dock";
    this.dockEl.id = "portrait-text-dock";

    root.append(this.container, this.dockEl);
    window.addEventListener("resize", this.onViewportResize);
    window.addEventListener("orientationchange", this.onViewportResize);
    this.applyLayout();
    this.applyTextbox();
  }

  /**
   * Applique la disposition portrait/paysage (#210). En paysage, rien ne change : la scène
   * 1024×576 est mise à l'échelle `STAGE_SCALE` et la boîte de texte reste dans la scène. En
   * portrait, la scène 16:9 occupe la largeur en haut et la boîte de texte est déplacée dans une
   * zone dédiée sous la scène (aucune superposition), à taille réelle.
   */
  private applyLayout(): void {
    if (!this.root || !this.container || !this.dockEl || !this.textboxEl || !this.waitEl) return;
    const portrait = window.innerHeight > window.innerWidth;
    if (portrait === this.portraitLayout) {
      if (portrait) this.layoutPortrait();
      else {
        this.dockEl.style.display = "none";
        this.container.style.removeProperty("transform");
      }
      return;
    }
    this.portraitLayout = portrait;
    if (portrait) {
      this.layoutPortrait();
    } else {
      this.root.removeAttribute("data-layout");
      this.sceneScale = STAGE_SCALE;
      this.container.style.removeProperty("transform");
      this.dockEl.style.display = "none";
      this.container.append(this.textboxEl, this.waitEl);
      // #320 : plus d'autoshrink — on remet en page le texte de la page à la taille constante.
      this.relayoutText();
    }
    this.applyTextbox();
  }

  /** Transformation de base de la scène (sans secousse) selon la disposition courante. */
  private baseStageTransform(): string {
    return this.portraitLayout ? `scale(${this.sceneScale})` : "";
  }

  private layoutPortrait(): void {
    if (!this.root || !this.container || !this.dockEl || !this.textboxEl || !this.waitEl) return;
    // 1 px CSS = 1 px logique : la scène 1024×576 est réduite à la largeur réelle. On lit
    // `window.innerWidth` en priorité : au retour paysage→portrait, le listener du renderer peut
    // passer avant la mise à jour de la taille inline du #viewport faite par le player, et
    // `root.clientWidth` vaudrait encore 1280 (scène trop large, #98).
    const width = window.innerWidth || this.root.clientWidth || STAGE_WIDTH;
    const sceneScale = width / STAGE_WIDTH;
    this.root.dataset.layout = "portrait";
    this.sceneScale = sceneScale;
    this.container.style.transform = `scale(${sceneScale})`;
    this.container.style.transformOrigin = "0 0";
    const sceneHeight = STAGE_HEIGHT * sceneScale;
    this.dockEl.style.top = `${sceneHeight}px`;
    this.dockEl.style.display = "block";
    if (this.textboxEl.parentElement !== this.dockEl) this.dockEl.append(this.textboxEl);
    if (this.waitEl.parentElement !== this.dockEl) this.dockEl.append(this.waitEl);
    // #320 : plus d'autoshrink — on remet en page le texte de la page à la taille constante.
    this.relayoutText();
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

  hurryText(): void {
    if (!this.typewriterResolve) return;
    if (this.typewriterTimer) {
      clearTimeout(this.typewriterTimer);
      this.typewriterTimer = null;
    }
    const units = this.buildTextUnits();
    this.layoutText(units, units.length);
    this.typedUnits = units.length;
    const resolve = this.typewriterResolve;
    this.typewriterResolve = null;
    this.typewriterHurry = false;
    resolve();
  }

  hurry(): void {
    // #362 : un clic/skip annule l'attente de décodage d'image et laisse partir la transition.
    this.pendingDecodeAbort?.abort();
    this.pendingDecodeAbort = null;
    // Typewriter : non-sticky. Si le typewriter tourne, on le termine
    // immédiatement (rendu complet + resolve) sans laisser de flag persistant.
    if (this.typewriterResolve) {
      if (this.typewriterTimer) {
        clearTimeout(this.typewriterTimer);
        this.typewriterTimer = null;
      }
      const units = this.buildTextUnits();
      this.layoutText(units, units.length);
      this.typedUnits = units.length;
      const resolve = this.typewriterResolve;
      this.typewriterResolve = null;
      this.typewriterHurry = false;
      resolve();
    }
    // Termine la transition courante immédiatement (clear timer + overlays + resolve).
    this.finishTransition();
    // Pistes (#317) : skip = currentTime à la fin, puis état final figé.
    for (const animation of this.trackAnimations.values()) {
      try {
        animation.finish();
        animation.commitStyles();
      } catch {
        /* WAAPI indisponible */
      }
    }
    this.trackAnimations.clear();
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
        this.applyReadEffects();
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

  /**
   * Prépare une image (lookahead, #386) : le décodage est mutualisé avec les transitions et le
   * cache n'est alimenté qu'après succès. `decode: false` ne fait que charger/référencer.
   */
  async prepare(url: string, opts: { decode?: boolean } = {}): Promise<void> {
    if (!url) return;
    await ensureDecoded(url, undefined, {
      cache: this.decodedImages,
      inflight: this.decodeInflight,
      fetchPriority: "low",
      timeoutMs: 5000,
    });
    if (opts.decode === false) return;
  }

  async preload(assets: readonly AssetRef[], signal?: AbortSignal): Promise<void> {
    const urls = assets.map((a) => this.resolveAsset(a));
    await Promise.all(
      urls.map(async (url, i) => {
        const size = this.imageSizeOf(assets[i]!);
        if (size) this.decodedImages.noteDimensions(url, size.width, size.height);
        // #386 : cache alimenté uniquement après décodage réussi ; un échec/timeout n'est pas un hit.
        const image = await decodeImage(url, signal, {
          cache: this.decodedImages,
          inflight: this.decodeInflight,
          fetchPriority: "low",
          timeoutMs: 5000,
        });
        if (!image) this.resolver.reportMissing("image", assets[i]!);
      }),
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
      this.relayoutText();
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
    this.textUnitEls = [];
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
    window.removeEventListener("resize", this.onViewportResize);
    window.removeEventListener("orientationchange", this.onViewportResize);
    if (this.container && this.root) {
      this.root.removeChild(this.container);
    }
    this.dockEl?.remove();
    this.dockEl = null;
    this.root = null;
    this.container = null;
  }

  /** Termine immédiatement la transition courante (si any) sans attendre. */
  /** Lecture seule pour le mode revue (#400). */
  reviewState(): StageReviewState {
    const timelineLayers: StageReviewState["timelineLayers"] = [];
    for (const element of this.timelineLayerEls.values()) {
      const image = element.querySelector("img");
      timelineLayers.push({
        id: element.dataset.layerId ?? "",
        storage: image ? decodeStorageName(image.getAttribute("src") ?? "") : "",
        x: Number.parseFloat(element.style.left) || 0,
        y: Number.parseFloat(element.style.top) || 0,
        opacity: Number.parseFloat(element.style.opacity),
        z: Number.parseInt(element.style.zIndex, 10) || 0,
      });
    }
    return {
      transition: this.transitionInfo && this.transitionPromise
        ? { method: this.transitionInfo.method, timeMs: this.transitionInfo.timeMs, elapsedMs: Date.now() - this.transitionInfo.startedAt }
        : null,
      timelineLayers,
    };
  }

  private finishTransition(): void {
    this.transitionInfo = null;
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
        overflow: hidden;
      }
      /* Double tampon (#373) : deux <img> de fond, placement identique au background-image
         (object-fit:none + object-position), fondu d'opacité composité. */
      .mh-stage-bg-layer {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: none;
        object-position: 50% 50%;
        pointer-events: none;
      }
      .mh-stage-bg-layer[data-back="true"] { z-index: 0; }
      .mh-stage-bg-layer[data-front="true"] { z-index: 1; }
      .mh-stage-bg-img { position: absolute; max-width: none; }
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
      /* Portrait (#210) : zone de texte dédiée sous la scène 16:9, à taille réelle. */
      .mh-portrait-dock {
        display: none;
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2;
        overflow: hidden;
        background: #07090b;
        border-top: 1px solid #263238;
      }
      [data-layout="portrait"] .mh-stage {
        transform-origin: 0 0;
      }
      [data-layout="portrait"] .mh-portrait-dock { display: block; }
      [data-layout="portrait"] .mh-stage-textbox {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        transition: none;
      }
      /* Le cadre image du 16:9 ne s'applique pas à la zone dédiée : panneau opaque lisible. */
      [data-layout="portrait"] .mh-stage-textbox-frame { display: none !important; }
      [data-layout="portrait"] .mh-stage-text {
        position: absolute;
        inset: 0;
        /* Réserve la barre d'actions tactile (#203) en bas du dock, + encoche (#98). */
        padding: 1.5rem 1.6rem calc(5rem + env(safe-area-inset-bottom, 0px));
        font-size: 1.7rem;
        line-height: 1.6;
        letter-spacing: 0;
        text-shadow: none;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }
      [data-layout="portrait"] .mh-stage-wait {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
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
        height: ${(textBoxHeight(STAGE_HEIGHT) / STAGE_HEIGHT) * 100}%;
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
        /* Police constante (#314) : la zone est découpée comme la couche de message du moteur,
           aucun autoshrink ni barre de défilement ; les pages sont gérées par le script. */
        overflow: hidden;
      }
      /*
       * Cadre image (#173) : l'image txtwindowNN (1024x576) couvre la scène, le texte est posé dessus
       * sans boîte, dans la zone mesurée sur le jeu d'origine (voir FRAME_TEXT_AREA).
       */
      /* Accessibilité (#314) : la couche visuelle est aria-hidden, le texte complet de la page est
         exposé une seule fois dans ce nœud lecteur d'écran (et sélectionnable/copiable). */
      .mh-stage-text-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: pre-wrap;
        border: 0;
      }
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
      /* Frappe sans reflow (#314) : la page entière est mise en page, les unités non encore
         révélées sont seulement invisibles (visibility préserve les retours à la ligne). */
      .mh-text-unit {
        display: inline;
      }
      /* « swing » (#314) : les caractères d'un même mot restent solidaires (pas de coupure
         entre deux lettres) ; l'oscillation s'applique par caractère à l'intérieur. */
      .mh-text-unit-word {
        white-space: nowrap;
      }
      .mh-text-unit.mh-text-unit-hidden {
        visibility: hidden;
      }
      .mh-text-unit[data-read="1"] {
        opacity: var(--mh-read-opacity, ${READ_TEXT_OPACITY});
        transition: opacity var(--mh-read-duration, 300ms) ease;
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
      /*
       * Accessibilité (#211, WEB-06 ; docs/DESIGN.md §10) : plus aucune animation ni transition de la
       * scène sous prefers-reduced-motion — indicateur de clic (clignotement et glyphes animés),
       * voile de brume, attente (rotation), et fondus de la boîte de texte / du texte lu. Les règles
       * plus spécifiques des glyphes image sont reprises ici pour l'emporter sans « !important ».
       */
      @media (prefers-reduced-motion: reduce) {
        .mh-stage-haze,
        .mh-stage-indicator,
        .mh-stage-textbox[data-frame-style="image"] .mh-stage-indicator.mh-glyph-line-ok[data-style="line"],
        .mh-stage-textbox[data-frame-style="image"] .mh-stage-indicator.mh-glyph-page-ok[data-style="page"],
        .mh-stage-wait-on,
        .mh-stage-wait-on.mh-stage-wait-nudge {
          animation: none;
        }
        .mh-stage-textbox,
        .mh-stage-text-read,
        .mh-stage-wait {
          transition: none;
        }
        .mh-stage-text-appear,
        .mh-stage-text[data-text-animation="fade"].mh-stage-text-appear {
          animation: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /** Attend le décodage du fond (1 s max) avant la transition, annulable par clic/skip (#362). */
  /**
   * Retient le décodage d'une image affichée (fond, sprite, calque) dans le cache LRU (#368).
   * Fire-and-forget et **sans attendre** : en skip/instantané, aucune transition n'est bloquée
   * (#362) ; une image déjà en cache est servie sans re-décodage (hit).
   * - `element` fourni (sprite/calque déjà dans le DOM) : on garde la référence de l'élément ;
   * - sinon (fond CSS) : une image de référence est créée pour conserver le décodage.
   */
  private cacheDecodedForDisplay(url: string, storage?: string, element?: HTMLImageElement): void {
    if (!url) return;
    const size = storage ? this.imageSizeOf(storage) : null;
    if (size) this.decodedImages.noteDimensions(url, size.width, size.height);
    if (this.decodedImages.has(url)) {
      this.decodedImages.get(url); // hit + réordonne la LRU
      return;
    }
    // #386 : ne jamais insérer dans le cache avant décodage. L'image affichée (ou une référence
    // Image pour un fond CSS) est décodée en tâche de fond ; le cache n'est alimenté qu'au succès.
    const img = element ?? (typeof Image === "function" ? new Image() : null);
    if (!img) return;
    void ensureDecoded(url, undefined, {
      cache: this.decodedImages,
      inflight: this.decodeInflight,
      createImage: () => img as unknown as DecodableImage,
      fetchPriority: element ? "low" : "high",
      timeoutMs: 5000,
    });
  }

  private async waitForBackgroundDecoded(storage: string, signal: AbortSignal): Promise<void> {
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const url = this.resolver.background(storage);
    if (signal.aborted) return;
    const size = this.imageSizeOf(storage);
    if (size) this.decodedImages.noteDimensions(url, size.width, size.height);
    this.pendingDecodeAbort?.abort();
    const controller = new AbortController();
    this.pendingDecodeAbort = controller;
    const forwardAbort = () => controller.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    try {
      await ensureDecoded(url, controller.signal, {
        cache: this.decodedImages,
        inflight: this.decodeInflight,
        timeoutMs: 1000,
      });
    } finally {
      signal.removeEventListener("abort", forwardAbort);
      if (this.pendingDecodeAbort === controller) this.pendingDecodeAbort = null;
      const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
      // #385 : durée et issue de l'attente de décodage avant transition (#362).
      const outcome = signal.aborted ? "waiting" : elapsed >= 1000 ? "timeout" : "ready";
      this.perf.markTransitionWait(elapsed, outcome);
    }
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
        // (#317) Seul un **nouvel** id de transition coupe/remplace la transition en cours ; une
        // scène de même id est une mise à jour d'état (réconciliation défensive, pas de cut).
        if (event.transitionId !== undefined && event.transitionId === this.lastTransitionId) {
          this.currentScene = event.scene;
          this.renderScene(true);
          break;
        }
        this.currentScene = event.scene;
        if (event.transitionId !== undefined) this.lastTransitionId = event.transitionId;
        const transitionTime = event.transition.method === "none" ? 0 : event.transition.time;
        // #362 : attendre le décodage de la nouvelle image de fond AVANT de démarrer la transition
        // (1 s max, abandonnée par un clic/skip). L'ancienne image reste affichée pendant l'attente.
        if (!opts.instant && transitionTime > 0 && event.scene.bg && event.scene.bg !== oldScene.bg) {
          await this.waitForBackgroundDecoded(event.scene.bg, opts.signal);
          if (opts.signal.aborted) return;
        }
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
      case "track": {
        this.applyTrack(event.track, opts);
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
  /** Dimensions natives connues avant décodage (manifeste), sinon null. */
  private imageSizeOf(storage: string): ImageSize | null {
    return this.imageDimensions[storageKey(storage)] ?? null;
  }

  /**
   * Rectangle de clip d'un sprite `partbgid` : celui de son partbg parent (#315). Les sprites
   * partbgid étaient positionnés sans clip (605 hors fenêtre) ; on intersecte avec le stage.
   */
  private partbgClipFor(sprite: { partbgId?: string }): Rect | null {
    if (!sprite.partbgId) return null;
    const parent = this.currentScene.sprites.find(
      (candidate) => candidate.id === sprite.partbgId && candidate.crop,
    );
    if (!parent?.crop) return null;
    return partbgClipRect({ center: parent.x, vcenter: parent.y, crop: parent.crop });
  }

  /** Applique le clip calculé au sprite (inset relatif à sa boîte, en px du stage). */
  private applySpriteClip(el: HTMLElement, placement: { x: number; y: number; width: number; height: number; clip: Rect | null }): void {
    if (!placement.clip) {
      el.style.removeProperty("clip-path");
      return;
    }
    const top = Math.max(0, placement.clip.y - placement.y);
    const left = Math.max(0, placement.clip.x - placement.x);
    const right = Math.max(0, placement.x + placement.width - (placement.clip.x + placement.clip.width));
    const bottom = Math.max(0, placement.y + placement.height - (placement.clip.y + placement.clip.height));
    el.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
  }

  /** Calque de fond actuellement affiché (double tampon #373), null avant montage. */
  private activeBgLayer(): HTMLImageElement | null {
    return this.bgLayers[this.bgActiveLayer];
  }

  /**
   * Résout une fois le fond courant affiché **et décodé** (deux rAF), pour les tests/e2e (#373).
   * Résout immédiatement sans fond ou après au plus 1 s si le chargement échoue.
   */
  async whenReady(): Promise<void> {
    const img = this.bgImgEl ?? this.activeBgLayer();
    const paint = (): Promise<void> =>
      new Promise((resolve) => {
        if (typeof requestAnimationFrame !== "function") return resolve();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    if (!img || !img.src) return paint();
    if (img.complete && img.naturalWidth > 0) return paint();
    await new Promise<void>((resolve) => {
      const done = (): void => {
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
        resolve();
      };
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      setTimeout(done, 1000);
    });
    return paint();
  }

  private hideBgLayers(): void {
    for (const layer of this.bgLayers) {
      if (!layer) continue;
      layer.style.display = "none";
      layer.style.opacity = "0";
    }
  }

  /** Prépare le calque inactif avec le nouveau fond et le rend actif (#373). */
  private renderBgLayer(url: string, left: number | undefined, top: number | undefined, instant: boolean): void {
    const next = this.bgActiveLayer === 0 ? 1 : 0;
    const layer = this.bgLayers[next];
    if (!layer) return;
    if (layer.getAttribute("src") !== url) layer.src = url;
    layer.style.objectPosition = `${left !== undefined ? `${left}px` : "50%"} ${top !== undefined ? `${top}px` : "calc(100% + 48px)"}`;
    layer.style.removeProperty("transform");
    layer.style.removeProperty("transform-origin");
    layer.style.removeProperty("transition");
    layer.style.removeProperty("will-change");
    layer.style.display = "block";
    layer.style.opacity = "1";
    if (instant) {
      const previous = this.bgLayers[this.bgActiveLayer];
      if (previous) {
        previous.style.display = "none";
        previous.style.opacity = "0";
      }
    }
    this.bgActiveLayer = next;
  }

  private renderScene(instant: boolean): void {
    if (!this.bgEl || !this.spritesEl) return;
    const bg = this.currentScene.bg;
    // Fond zoomé ou tourné : l'image est un <img> enfant (voir `renderTransformedBg`).
    const { bgZoomX = 100, bgZoomY = 100, bgRotate = 0 } = this.currentScene;
    const transformedBg = bg !== null && (bgZoomX !== 100 || bgZoomY !== 100 || bgRotate !== 0);
    // Sonde scene-ready (#360) : marqueurs uniquement, aucune modification du chargement/rendu.
    const sceneBgUrl = bg ? this.resolver.background(bg) : null;
    if (this.perf.enabled && sceneBgUrl && sceneBgUrl !== this.perfBgUrl) {
      this.perfBgUrl = sceneBgUrl;
      this.perf.trackImage(sceneBgUrl);
    }
    // Cache décodé LRU (#368) : référence conservée, sans bloquer le rendu (même en instantané).
    if (sceneBgUrl && bg) this.cacheDecodedForDisplay(sceneBgUrl, bg);
    this.bgImgEl?.remove();
    this.bgImgEl = null;
    // #373 : le fond n'est plus peint par `background-image` mais par deux calques <img>
    // (double tampon). `background-image` reste vide ; la couleur de repli est sur le conteneur.
    this.bgEl.style.backgroundImage = "none";
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
      // Position par défaut identique au moteur (#249) : X centré, bas à 48 px sous l'écran.
      const position = `${left !== undefined ? `${left}px` : "50%"} ${top !== undefined ? `${top}px` : "calc(100% + 48px)"}`;
      this.bgEl.style.backgroundPosition = position;
      if (transformedBg) {
        // Fonds zoomés/tournés : <img> dédié (placement/transform historique de renderTransformedBg).
        this.hideBgLayers();
        this.renderTransformedBg(bg, left, top, bgZoomX, bgZoomY, bgRotate);
      } else if (sceneBgUrl) {
        this.renderBgLayer(sceneBgUrl, left, top, instant);
      }
    } else {
      this.hideBgLayers();
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
          // Réserve la taille native connue (manifeste #315) avant décodage : la transform source
          // (pivot 50 %) reste juste dès la première frame.
          const size = this.imageSizeOf(s.storage);
          if (size) {
            innerImg.style.width = `${size.width}px`;
            innerImg.style.height = `${size.height}px`;
          } else {
            innerImg.style.removeProperty("width");
            innerImg.style.removeProperty("height");
            if (!innerImg.complete) {
              innerImg.addEventListener("load", () => this.renderScene(true), { once: true });
            }
          }
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
          img.decoding = "async";
          img.alt = "";
          img.dataset.spriteId = s.id;
          if (s.partbgId) img.dataset.partbgId = s.partbgId;
          this.spriteEls.set(s.id, img);
          el = img;
          this.maybeStartPending(s.id, img);
        }
        // Mise à jour src (peut changer via @chgfg).
        const src = this.resolver.image(s.storage);
        if (img.src !== src && !img.src.endsWith(src)) {
          img.src = src;
          if (this.perf.enabled) this.perf.trackImage(src, img); // sonde #360
          this.cacheDecodedForDisplay(src, s.storage, img); // cache décodé LRU (#368)
        }
        // Dimensions natives : manifeste (#315) sinon décodage. La boîte est TOUJOURS réservée avant
        // décodage (plus de boîte 0×0 ni de translate(-50%) sur un point) ; le placement absolu et le
        // clip partbgid sont calculés par `resolvePlacement`.
        const size = this.imageSizeOf(s.storage) ?? (img.complete && img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
        if (size) {
          const placement = resolvePlacement(
            {
              center: s.x,
              vcenter: s.y,
              zoomx: s.zoomx,
              zoomy: s.zoomy,
              rotate: s.rotate,
              afx: s.afx,
              afy: s.afy,
              clipRect: this.partbgClipFor(s),
            },
            size,
            STAGE_SIZE,
          );
          img.style.width = `${size.width}px`;
          img.style.height = `${size.height}px`;
          this.applySpriteClip(img, placement);
        } else {
          // Taille inconnue : ne pas figer une boîte 0×0, re-rendre après décodage.
          img.style.removeProperty("width");
          img.style.removeProperty("height");
          img.style.removeProperty("clip-path");
          if (!img.complete) {
            img.addEventListener("load", () => this.renderScene(true), { once: true });
          }
        }
        // Ancrage effectif (center2left/center2top) : pour une image plus grande que la fenêtre,
        // l'ancre moteur est plafonnée à la view area (stage) ; le CSS centrant par translate(-50%)
        // sur la taille native, on compense de (taille native − taille de view area)/2 (#315).
        const anchor = spriteAnchorSize(size ?? { width: STAGE_WIDTH, height: STAGE_HEIGHT }, STAGE_SIZE);
        img.style.left = `${s.x + (size ? (size.width - anchor.width) / 2 : 0)}px`;
        img.style.top = `${s.y + (size ? (size.height - anchor.height) / 2 : 0)}px`;
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
      const visual: HTMLElement | null = transformedBg ? this.bgEl : this.activeBgLayer();
      if (visual) {
        visual.style.opacity = "0";
        void visual.offsetHeight;
        visual.style.transition = "opacity 0.3s ease";
        visual.style.opacity = "1";
      }
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
  /**
   * Applique une piste unifiée (#317). Un couple (cible, propriété) n'a qu'un propriétaire :
   * une nouvelle piste capture l'état courant comme départ puis `cancel()` l'ancienne ; en fin de
   * piste, `commitStyles()` fige l'état final.
   */
  private applyTrack(track: import("@/kag/events.js").TrackSpec, opts: RunOptions): void {
    // Accessibilité : `prefers-reduced-motion` = état final immédiat, via le même chemin (pas de
    // rendu parallèle) ; l'orchestrateur de pistes applique la durée 0.
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const instant = opts.instant || reducedMotion;
    const key = `${track.target}:${track.prop}`;
    const previous = this.trackAnimations.get(key);
    if (previous) {
      try {
        previous.commitStyles();
      } catch {
        /* WAAPI non disponible / déjà annulée */
      }
      previous.cancel();
      this.trackAnimations.delete(key);
    }
    const lastValues = track.keyframes[track.keyframes.length - 1];
    if (track.layer) {
      // Calque de timeline (#317) : le renderer applique la piste via la transition CSS dédiée
      // (position/opacité/zoom/rotation + accel), sans scène ni cut.
      this.applyTimelineLayer(track.layer, instant ? 0 : track.duration, track.accel ?? 0);
      return;
    }
    // Un panoramique simple (2 keyframes) reste rendu par la transition CSS historique, qui gère
    // aussi `@bindbg` et les fondus interrompus ; les pistes multi-keyframes passent par WAAPI.
    if (track.target === "bg" && track.keyframes.length <= 2) {
      this.moveBackground(lastValues?.left ?? 0, lastValues?.top ?? 0, instant ? 0 : track.duration, {
        accel: track.accel,
        zoomx: lastValues?.zoomx,
        zoomy: lastValues?.zoomy,
        rotate: lastValues?.rotate,
      });
      return;
    }
    if (track.target === "bg") {
      // État logique : le runtime possède déjà l'état final ; le renderer l'affiche.
      this.currentScene = {
        ...this.currentScene,
        ...(lastValues?.left === undefined ? {} : { bgLeft: lastValues.left }),
        ...(lastValues?.top === undefined ? {} : { bgTop: lastValues.top }),
        ...(lastValues?.zoomx === undefined ? {} : { bgZoomX: lastValues.zoomx }),
        ...(lastValues?.zoomy === undefined ? {} : { bgZoomY: lastValues.zoomy }),
        ...(lastValues?.rotate === undefined ? {} : { bgRotate: lastValues.rotate }),
      };
      // #373 : un fond normal est un calque <img> (object-position) ; un fond transformé garde
      // l'ancien chemin `background-position` sur le conteneur.
      const normalLayer = this.bgImgEl === null;
      const el = normalLayer ? this.activeBgLayer() : this.bgEl;
      if (!el || instant || track.duration <= 0 || typeof el.animate !== "function") {
        this.renderScene(true);
        return;
      }
      const frames = sampleTrack(track, 24).map((sample) => {
        const position =
          sample.values.left === undefined && sample.values.top === undefined
            ? undefined
            : `${sample.values.left ?? 0}px ${sample.values.top ?? 0}px`;
        const transform =
          sample.values.zoomx === undefined && sample.values.zoomy === undefined && sample.values.rotate === undefined
            ? undefined
            : `scale(${(sample.values.zoomx ?? 100) / 100}, ${(sample.values.zoomy ?? 100) / 100}) rotate(${sample.values.rotate ?? 0}deg)`;
        return normalLayer
          ? { offset: sample.offset, objectPosition: position, transform }
          : { offset: sample.offset, backgroundPosition: position, transform };
      });
      const animation = el.animate(frames, { duration: track.duration, easing: "linear", fill: "forwards" });
      this.trackAnimations.set(key, animation);
      animation.onfinish = () => {
        try {
          animation.commitStyles();
        } catch {
          /* ignore */
        }
        animation.cancel();
        if (this.trackAnimations.get(key) === animation) this.trackAnimations.delete(key);
      };
      return;
    }
    // Cible sprite : piste `transform`/`opacity` sur l'élément persistant.
    const sprite = this.spriteEls.get(track.target);
    if (!sprite) return;
    if (track.prop === "opacity") {
      const target = lastValues?.opacity ?? 1;
      if (instant || track.duration <= 0) {
        sprite.style.opacity = String(target);
        return;
      }
      const frames = sampleTrack(track, 24).map((sample) => ({ offset: sample.offset, opacity: sample.values.opacity ?? 1 }));
      const animation = sprite.animate(frames, { duration: track.duration, easing: "linear", fill: "forwards" });
      this.trackAnimations.set(key, animation);
      animation.onfinish = () => {
        try {
          animation.commitStyles();
        } catch {
          /* ignore */
        }
        animation.cancel();
      };
    }
  }

  private startTransition(from: SceneState, to: SceneState, time: Ms, opts: RunOptions): void {
    // Termine une transition précédente éventuelle (clear timer + overlays).
    this.finishTransition();
    this.transitionInfo = { method: "crossfade", timeMs: Math.max(0, time), startedAt: Date.now() };
    // #409 : l'overlay doit reprendre l'apparence de **l'ancienne** scène (filtre `monocro`,
    // `effect`, luminosité/contraste, opacité). On capture son style AVANT `renderScene`, qui
    // applique l'apparence de la nouvelle scène sur le conteneur : la copier après faisait
    // hériter à l'ancien fond le filtre du nouveau (transition monochrome d'un coup, flash).
    const fromBgCssText = this.bgEl?.style.cssText ?? "";
    // #409 : la transition crossfade doit aussi emporter les **calques de l'ancienne scène**
    // (sprites, partbg, calques de timeline) : sans cela ils disparaissent d'un coup au début du
    // fondu (transition « pas propre », éléments doublés/flashs). On clone leur état inline avant
    // `renderScene` ; le clone est figé (les animations WAAPI ne sont pas dupliquées) puis s'efface
    // avec l'overlay.
    const fromSpriteNodes = this.spritesEl ? [...this.spritesEl.children].map((el) => el.cloneNode(true) as HTMLElement) : [];
    const fromTimelineNodes = this.timelineEl ? [...this.timelineEl.children].map((el) => el.cloneNode(true) as HTMLElement) : [];
    // Position de l'ancien fond à cet instant (il peut être en plein panoramique).
    const fromPos = this.bgPositionNow(from);
    // #373 : l'ancien fond normal vit dans un calque <img> ; on capture son URL/placement avant
    // que renderScene ne bascule sur le nouveau calque. Le fond transformé, lui, passe par `bgImgEl`.
    const oldLayer = this.activeBgLayer();
    const fromLayer = {
      src: oldLayer?.getAttribute("src") ?? null,
      position: oldLayer?.style.objectPosition ?? null,
      transform: oldLayer?.style.transform ?? "",
      origin: oldLayer?.style.transformOrigin ?? "",
    };
    // Zoom et rotation de l'ancien fond (renderScene les remet à zéro pour le nouveau).
    const fromTransform = this.bgImgEl
      ? { transform: this.bgImgEl.style.transform, origin: this.bgImgEl.style.transformOrigin }
      : oldLayer
        ? { transform: fromLayer.transform, origin: fromLayer.origin }
        : null;

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
    const previousSpriteIds = new Set(from.sprites.map((sprite) => sprite.id));
    this.renderScene(true);
    if (!this.bgEl) {
      fromImg?.remove();
      return;
    }
    // #316 : les calques **apparus** avec la nouvelle scène (ex. `@partbg` du bureau) sont au-dessus
    // de l'overlay de l'ancien fond : sans fondu propre, ils apparaissent d'un coup (cut). On les
    // fait apparaître progressivement sur la même durée que la transition de scène.
    const addedSprites = [...this.spriteEls.entries()].filter(([id]) => !previousSpriteIds.has(id));
    if (addedSprites.length > 0) {
      for (const [id, el] of addedSprites) {
        const sprite = to.sprites.find((candidate) => candidate.id === id);
        const targetOpacity = sprite?.opacity ?? 1;
        el.style.opacity = "0";
        requestAnimationFrame(() => {
          if (!el.isConnected) return;
          el.style.transition = `opacity ${time}ms ease`;
          el.style.opacity = String(targetOpacity);
        });
      }
      setTimeout(() => {
        for (const [, el] of addedSprites) el.style.removeProperty("transition");
      }, time + 50);
    }

    // Overlay avec l'ancien fond, par-dessus, qui fade out.
    const oldBg = from.bg;
    if (oldBg) {
      const overlay = document.createElement("div");
      overlay.className = "mh-stage-bg mh-stage-bg-overlay";
      overlay.style.cssText = fromBgCssText;
      if (fromImg) {
        overlay.style.backgroundImage = "none";
        overlay.appendChild(fromImg);
      } else {
        // Ancien fond normal : sa source et son placement viennent du calque <img> capturé.
        overlay.style.backgroundImage = fromLayer.src ? `url("${fromLayer.src}")` : cssUrl(this.resolver.background(oldBg));
        overlay.style.objectPosition = "";
      }
      overlay.style.transition = "none";
      overlay.style.backgroundPosition = fromPos
        ? `${fromPos.left}px ${fromPos.top}px`
        : fromLayer.position ?? "50% 50%";
      overlay.style.transform = fromTransform?.transform ?? "";
      overlay.style.transformOrigin = fromTransform?.origin ?? "";
      overlay.style.zIndex = "999998"; // au-dessus des calques/effets, sous la boîte de texte
      overlay.style.opacity = "1";
      this.bgEl.parentElement?.appendChild(overlay);
      this.bgOverlays.push(overlay);

      // #410 : les calques de l'ancienne scène gardent **leur propre** filtre. Les mettre dans
      // l'overlay de fond (qui porte le filtre `effect`/`blur` du fond) les filtrait une seconde
      // fois : mélange flou/net et couleurs fausses pendant le fondu. Ils sont donc dans une
      // couche sœur non filtrée, au-dessus du fond, qui s'efface avec la même temporisation.
      let overlayLayers: HTMLElement | null = null;
      if (fromSpriteNodes.length > 0 || fromTimelineNodes.length > 0) {
        overlayLayers = document.createElement("div");
        overlayLayers.className = "mh-stage-bg-overlay-layers";
        overlayLayers.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;transition:none;opacity:1;z-index:999999;";
        for (const node of fromSpriteNodes) overlayLayers.appendChild(node);
        for (const node of fromTimelineNodes) overlayLayers.appendChild(node);
        this.bgEl.parentElement?.appendChild(overlayLayers);
        this.bgOverlays.push(overlayLayers);
      }

      requestAnimationFrame(() => {
        // L'ancien fond poursuit son panoramique pendant qu'il s'efface.
        const moving = fromPos && fromPos.remaining > 0;
        overlay.style.transition = moving
          ? `opacity ${time}ms ease, background-position ${fromPos.remaining}ms ${cssEasing(fromPos.accel, fromPos.progress)}`
          : `opacity ${time}ms ease`;
        overlay.style.opacity = "0";
        if (moving) overlay.style.backgroundPosition = `${fromPos.toLeft}px ${fromPos.toTop}px`;
        if (overlayLayers) {
          overlayLayers.style.transition = `opacity ${time}ms ease`;
          overlayLayers.style.opacity = "0";
        }
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
    // #373 : fond normal = calque <img> (object-position) ; fond transformé = conteneur.
    // Un fond rendu par calque <img> (cas normal, y compris zoomé par piste) porte ses
    // transformations ; seul le fond transformé posé par renderTransformedBg (`bgImgEl`) reste
    // piloté par le conteneur.
    const normalLayer = this.bgImgEl === null;
    const el = normalLayer ? this.activeBgLayer() : this.bgEl;
    if (!el || !this.currentScene.bg) return;
    const setPosition = (value: string): void => {
      if (normalLayer) el.style.objectPosition = value;
      else el.style.backgroundPosition = value;
    };
    const positionProperty = normalLayer ? "object-position" : "background-position";
    const target = transformed ? this.bgTransformCss(left, top, opts.zoomx ?? 100, opts.zoomy ?? 100, opts.rotate ?? 0) : null;
    // Une transition de zoom/rotation encore en cours repart de la valeur affichée.
    const live = performance.now() < this.bgTransformEnd ? getComputedStyle(el) : null;
    const liveTransform = live ? { transform: live.transform, origin: live.transformOrigin } : null;
    el.style.transition = "none";
    this.bgTransformEnd = 0;
    if (time <= 0 || !from) {
      setPosition(`${left}px ${top}px`);
      if (target) {
        el.style.transform = target.transform;
        el.style.transformOrigin = target.origin;
      }
      return;
    }
    // Repart de la position courante (un panoramique précédent peut être en cours).
    setPosition(`${from.left}px ${from.top}px`);
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
    const parts = [`${positionProperty} ${time}ms ${easing}`];
    if (target) parts.push(`transform ${time}ms ${easing}`, `transform-origin ${time}ms ${easing}`);
    el.style.transition = parts.join(", ");
    setPosition(`${left}px ${top}px`);
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
    if (img.getAttribute("src") !== src) {
      img.src = src;
      if (this.perf.enabled) this.perf.trackImage(src, img); // sonde #360
      this.cacheDecodedForDisplay(src, layer.storage, img); // cache décodé LRU (#368)
    }
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
          this.container.style.transform = `translate(${dx}px, ${dy}px) scale(${this.sceneScale})`;
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
    if (this.container) this.container.style.transform = this.baseStageTransform();
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
      this.container.style.transform = `translate(${dx}px, ${dy}px) scale(${this.sceneScale})`;
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
    if (this.container && !this.quakeTimer) this.container.style.transform = this.baseStageTransform();
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
    if (modeChanged) this.relayoutText();
    // Action continue des messages : re-rendu du texte déjà affiché (animation CSS par caractère).
    if (actionChanged) this.relayoutText();
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
    if (this.portraitLayout) return boxEl?.clientHeight || this.root?.clientHeight || STAGE_HEIGHT;
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
    this.text.forEach((seg, segmentIndex) => {
      // Groupe ruby partagé entre graph et caractères (#300) ; sinon le segment fait groupe.
      // Le ruby peut être porté par le segment texte ou par le sous-objet graph/emoji.
      const rubyGroup =
        "rubyGroup" in seg && seg.rubyGroup !== undefined
          ? seg.rubyGroup
          : "graph" in seg
            ? seg.graph.rubyGroup
            : "emoji" in seg
              ? seg.emoji.rubyGroup
              : undefined;
      const ruby =
        "ruby" in seg && seg.ruby !== undefined
          ? seg.ruby
          : "graph" in seg
            ? seg.graph.ruby
            : "emoji" in seg
              ? seg.emoji.ruby
              : undefined;
      const group = ruby !== undefined ? (rubyGroup ?? segmentIndex) : segmentIndex;
      if ("graph" in seg) {
        // Image inline : une seule unité (la frappe ne la coupe jamais au milieu). Le ruby
        // éventuel s'applique à l'image (le moteur la compte comme un caractère de base).
        units.push({ char: "", graph: seg.graph, ruby: seg.graph.ruby, group });
        return;
      }
      if ("emoji" in seg) {
        // Marqueur interne : le runtime doit l'avoir converti en graph ; repli textuel sinon.
        units.push({ char: seg.emoji.alt, ruby: seg.emoji.ruby, group });
        return;
      }
      if (!("text" in seg)) return; // pause
      const css = seg.style ? textStyleToCss(seg.style) : undefined;
      for (const char of Array.from(seg.text)) {
        units.push({ char, ruby, css, group });
      }
    });
    return units;
  }

  /** Reconstruit le DOM de la textbox jusqu'à n unités (inclu) avec ruby. */
  /**
   * Met en page la page **entière** une seule fois (#314) : un `<span>` par unité (caractère,
   * groupe ruby ou image `[graph]`), les unités au-delà de `revealed` étant seulement
   * `visibility:hidden`. Le wrap est donc déterministe et ne bouge plus pendant la frappe.
   */
  private layoutText(units: TextUnit[], revealed = this.typedUnits): void {
    if (!this.textEl) return;
    const wasEmpty = this.textEl.childNodes.length === 0;
    this.textEl.replaceChildren();
    this.textUnitEls = [];
    const frag = document.createDocumentFragment();
    const limit = units.length;
    const readCount = dimmedUnitCount(this.readUnits, limit);
    const swing = this.textAction === "swing";

    this.unitByIndex = new Map();
    const makeWrapper = (revealAt: number, parent: Node): HTMLSpanElement => {
      const wrapper = document.createElement("span");
      wrapper.className = "mh-text-unit";
      wrapper.dataset.unit = String(revealAt);
      if (revealAt >= revealed) wrapper.classList.add("mh-text-unit-hidden");
      if (revealAt < readCount) wrapper.dataset.read = "1";
      this.textUnitEls.push({ el: wrapper, revealAt });
      this.unitByIndex.set(revealAt, wrapper);
      parent.appendChild(wrapper);
      return wrapper;
    };

    /**
     * Typographie française (#314) : espace fine insécable avant `? ! : ;` et à l'intérieur des
     * guillemets `« »`, pour que le retour à la ligne ne sépare jamais la ponctuation du mot.
     * Seule la couche visuelle est transformée : le nœud lecteur d'écran garde le texte source.
     */
    const typographicChar = (index: number): string => {
      const unit = units[index];
      if (!unit || unit.graph || unit.ruby) return unit?.char ?? "";
      let char = unit.char;
      if (char === " ") {
        let next = index + 1;
        while (next < limit && (units[next]?.graph || units[next]?.ruby || units[next]?.char === " ")) next++;
        let prev = index - 1;
        while (prev >= 0 && (units[prev]?.graph || units[prev]?.ruby || units[prev]?.char === " ")) prev--;
        const nextChar = units[next]?.char ?? "";
        const prevChar = units[prev]?.char ?? "";
        if ("?!:;»".includes(nextChar) || prevChar === "«") char = "\u202F";
      } else if ("?!:;".includes(char)) {
        // Ponctuation orpheline (sans espace dans le script) : insécable avec le mot précédent.
        char = `\u202F${char}`;
      }
      return char;
    };

    // `swing` (#314) : les caractères d'un même mot sont regroupés dans un conteneur
    // `white-space: nowrap` pour ne jamais couper un mot pendant l'oscillation.
    let swingWord: HTMLSpanElement | null = null;
    for (let i = 0; i < limit; i++) {
      const u = units[i];
      const hasCss = u.css !== undefined && Object.keys(u.css).length > 0;
      const simpleChar = !u.graph && !u.ruby;
      const isSpace = simpleChar && (u.char ?? "").trim() === "";
      let parent: Node = frag;
      if (swing && simpleChar && !isSpace) {
        if (!swingWord) {
          swingWord = document.createElement("span");
          swingWord.className = "mh-text-unit-word";
          frag.appendChild(swingWord);
        }
        parent = swingWord;
      } else {
        swingWord = null;
      }
      const wrapper = makeWrapper(i, parent);
      let node: Node;
      if (u.ruby) {
        // Un ruby couvre une ou plusieurs unités : une seule balise <ruby>, la lecture posée une
        // fois sur le groupe. La base peut mêler texte et image inline (`[ruby…][graph]`, #300).
        const ruby = document.createElement("ruby");
        // Les caractères de texte consécutifs sont regroupés dans un seul nœud (comme avant
        // #300) ; une image inline interrompt le texte et s'insère à sa place dans la base.
        let buffer = "";
        const flushBuffer = (): void => {
          if (buffer.length > 0) {
            ruby.appendChild(document.createTextNode(buffer));
            buffer = "";
          }
        };
        while (true) {
          const unit = units[i]!;
          if (unit.graph) {
            flushBuffer();
            const img = document.createElement("img");
            img.className = "mh-stage-graph";
            img.alt = unit.graph.alt ?? "";
            img.src = this.resolver.image(unit.graph.storage);
            ruby.appendChild(img);
          } else {
            buffer += unit.char;
          }
          const next = i + 1 < limit ? units[i + 1] : undefined;
          if (!next || next.ruby === undefined || next.group !== u.group) break;
          i++;
        }
        flushBuffer();
        const rt = document.createElement("rt");
        rt.textContent = u.ruby;
        ruby.appendChild(rt);
        node = ruby;
      } else if (u.graph) {
        const img = document.createElement("img");
        img.className = "mh-stage-graph";
        img.alt = u.graph.alt ?? "";
        img.src = this.resolver.image(u.graph.storage);
        node = img;
      } else if (hasCss || swing) {
        const span = document.createElement("span");
        span.textContent = typographicChar(i);
        if (swing) {
          // Approximation de l'action continue « swing » du moteur (oscillation par caractère).
          span.className = "mh-stage-text-swing";
          span.style.animationDelay = `${(-(i % 17) * 0.12).toFixed(2)}s`;
        }
        node = span;
      } else {
        node = document.createTextNode(typographicChar(i));
      }
      if (hasCss && node instanceof HTMLElement) {
        for (const [prop, value] of Object.entries(u.css!)) node.style.setProperty(prop, value);
      }
      wrapper.appendChild(node);
    }
    this.textEl.appendChild(frag);

    // Lecteur d'écran : texte complet de la page, une seule fois (jamais pendant la frappe).
    if (this.srEl) {
      const plain = this.text.map((seg) => ("text" in seg ? seg.text : "graph" in seg ? (seg.graph.alt ?? "") : "")).join("");
      if (this.srEl.textContent !== plain) this.srEl.textContent = plain;
    }
    if (!this.fontsReady && !this.fontsRelayoutQueued) this.fontsRelayoutQueued = true;

    // Police **constante** (#314) : plus de fit/autoshrink ; zone découpée (overflow hidden).
    const rem = this.nominalTextRem();
    this.textEl.style.fontSize = `${rem}rem`;
    this.textEl.style.maxHeight = this.textAreaHeight() > 0 ? `${this.textAreaHeight()}px` : "";
    this.textEl.style.overflowY = "hidden";
    if (this.textboxEl) this.textboxEl.dataset.textFit = "nominal";

    if (wasEmpty && revealed > 0 && this.settings.textAnimation === "fade") {
      // Relance l'animation d'apparition à chaque nouvelle page (#177).
      this.textEl.classList.remove("mh-stage-text-appear");
      void this.textEl.offsetWidth;
      this.textEl.classList.add("mh-stage-text-appear");
    }
    this.placeIndicator();
  }

  /** Révèle les `n` premières unités sans retoucher la mise en page (visibility seule). */
  private revealTextUpTo(n: number): void {
    const limit = Math.max(0, n);
    const from = this.typedUnits;
    if (limit < from) {
      // Cas rare (restauration) : on remet l'état de visibilité complet.
      for (const unit of this.textUnitEls) {
        unit.el.classList.toggle("mh-text-unit-hidden", unit.revealAt >= limit);
      }
    } else {
      // Un seul wrapper DOM modifié par caractère révélé (#314) ; les groupes ruby partagent
      // l'index de leur premier caractère.
      for (let i = from; i < limit; i++) this.unitByIndex.get(i)?.classList.remove("mh-text-unit-hidden");
    }
    this.typedUnits = limit;
    this.placeIndicator();
  }

  /** Met à jour l'atténuation du texte déjà lu, sans re-mettre en page. */
  private applyReadEffects(): void {
    for (const unit of this.textUnitEls) {
      if (unit.revealAt < this.readUnits) unit.el.dataset.read = "1";
      else delete unit.el.dataset.read;
    }
  }

  /** Re-mise en page à taille de police/zone courante (réglages, style de cadre, action message). */
  private relayoutText(): void {
    this.layoutText(this.buildTextUnits(), this.typedUnits);
  }

  /** Rectangle du dernier caractère visible d'une unité (texte, ruby ou image graph). */
  private lastCharRect(el: HTMLElement): DOMRect | null {
    const img = el.querySelector("img.mh-stage-graph");
    if (img) {
      const rect = img.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!(node instanceof Text)) continue;
      const parent = node.parentElement;
      if (parent && (parent.tagName === "RT" || parent.tagName === "RP")) continue;
      if (/\S/.test(node.data)) last = node;
    }
    if (!last || typeof document.createRange !== "function") return null;
    let end = last.data.length;
    while (end > 0 && /\s/.test(last.data[end - 1]!)) end--;
    if (end === 0) return null;
    const range = document.createRange();
    range.setStart(last, end - 1);
    range.setEnd(last, end);
    const rects = typeof range.getClientRects === "function" ? range.getClientRects() : [];
    const rect = rects[rects.length - 1];
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
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

    // L'indicateur est hors du flux : on le centre sur la boîte du dernier caractère révélé (#175).
    const revealed = this.textUnitEls.filter((unit) => unit.revealAt < this.typedUnits);
    const lastUnit = revealed[revealed.length - 1];
    if (!lastUnit) return;
    const char = this.lastCharRect(lastUnit.el);
    if (!char) return;
    const textRect = textEl.getBoundingClientRect();
    const computedWidth = Number.parseFloat(getComputedStyle(textEl).width);
    const logicalWidth = computedWidth > 0 ? computedWidth : textEl.clientWidth;
    if (char.width === 0 || char.height === 0 || textRect.width === 0 || logicalWidth <= 0) return;
    const height = el.offsetHeight || CLICK_GLYPHS.page.height;
    const pos = indicatorOffset(char, textRect, textRect.width / logicalWidth, height);
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
  }

  private renderText(instant: boolean): void {
    if (!this.firstTextMarked && this.text.length > 0) {
      this.firstTextMarked = true;
      this.perf.markBoot("first-text");
    }
    if (!this.textEl) return;
    const units = this.buildTextUnits();
    if (instant) {
      this.typedUnits = units.length;
      this.layoutText(units, units.length);
      return;
    }
    // Non-instant : le typewriter gère la révélation progressive.
  }

  private runTypewriter(opts: RunOptions): Promise<void> {
    if (!this.firstTextMarked && this.text.length > 0) {
      this.firstTextMarked = true;
      this.perf.markBoot("first-text");
    }
    return new Promise((resolve) => {
      const units = this.buildTextUnits();
      // Anti re-type : on continue depuis typedUnits (déjà révélées).
      const startUnit = Math.min(this.typedUnits, units.length);
      // Mise en page de la page entière avant révélation : plus aucun reflow en cours de frappe.
      this.layoutText(units, startUnit);
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
        this.revealTextUpTo(units.length);
        this.typewriterHurry = false;
        settle();
        return;
      }
      this.typewriterHurry = false;

      let i = startUnit;
      const step = () => {
        if (!this.textEl) return;
        if (this.typewriterHurry) {
          this.revealTextUpTo(units.length);
          settle();
          return;
        }
        i++;
        this.revealTextUpTo(i);
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
    if (this.container && !this.quakeTimer) this.container.style.transform = this.baseStageTransform();
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
