/**
 * Pan et zoom de la carte du flowchart (FLOW-06, #202 ; docs/ANALYSE_HUD_ORIGINAL.md §7.5).
 *
 * Deux couches :
 * - des fonctions **pures** (sans DOM) qui calculent la vue (zoom + défilement) : testables telles quelles ;
 * - `attachViewport`, qui branche pointeur, molette, pincement et clavier sur la région défilante.
 *
 * Principe : la région `.mh-flow-scroll` garde son défilement natif (barres, PageUp/PageDown, lecteurs d'écran,
 * molette = pan). Le zoom met à l'échelle un `sizer` (taille `contenu × zoom`, centré) qui contient la scène
 * (`transform: scale`). La vue est donc `{ scale, x, y }` où `x`/`y` valent `scrollLeft`/`scrollTop`.
 */

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 3;
/** Facteur d'un cran de zoom (boutons, `+` / `-`). */
export const ZOOM_STEP = 1.25;
/** Déplacement d'une flèche du clavier, en pixels d'écran. */
export const KEY_PAN_STEP = 96;
/** Distance (px) à partir de laquelle un appui devient un glissement (sinon c'est un clic). */
export const DRAG_THRESHOLD = 5;
/** Sensibilité de `Ctrl` + molette (et du pincement du pavé tactile) : `exp(-delta * k)` ; un cran de souris (100) ≈ ×1,25. */
export const WHEEL_ZOOM_RATE = Math.log(ZOOM_STEP) / 100;

export type Point = { x: number; y: number };
/** Vue : zoom et défilement (px d'écran, depuis le coin haut-gauche du contenu). */
export type View = { scale: number; x: number; y: number };
/** Tailles utiles aux calculs : contenu (unités de la mise en page, zoom 1) et zone visible (`clientWidth/Height`). */
export type Metrics = { contentW: number; contentH: number; viewW: number; viewH: number };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Décalage horizontal du contenu quand il est plus étroit que la zone visible (le `sizer` est centré). */
export function contentOffsetX(m: Metrics, scale: number): number {
  return Math.max(0, (m.viewW - m.contentW * scale) / 2);
}

/** Borne le défilement à l'intérieur du contenu mis à l'échelle. */
export function clampScroll(x: number, y: number, m: Metrics, scale: number): Point {
  const maxX = Math.max(0, m.contentW * scale - m.viewW);
  const maxY = Math.max(0, m.contentH * scale - m.viewH);
  return { x: Math.min(maxX, Math.max(0, x)), y: Math.min(maxY, Math.max(0, y)) };
}

/** Déplace la vue (`dx`/`dy` en px d'écran : positif = vers la droite / le bas du contenu). */
export function panBy(view: View, dx: number, dy: number, m: Metrics): View {
  return { scale: view.scale, ...clampScroll(view.x + dx, view.y + dy, m, view.scale) };
}

/**
 * Change le zoom en gardant fixe, à l'écran, le point du contenu situé sous `anchor` (coordonnées relatives à la
 * zone visible). Sans `anchor`, le centre de la zone visible.
 */
export function zoomAround(view: View, nextScale: number, m: Metrics, anchor?: Point): View {
  const scale = clampScale(nextScale);
  const a = anchor ?? { x: m.viewW / 2, y: m.viewH / 2 };
  const cx = (view.x + a.x - contentOffsetX(m, view.scale)) / view.scale;
  const cy = (view.y + a.y) / view.scale;
  const next = clampScroll(cx * scale + contentOffsetX(m, scale) - a.x, cy * scale - a.y, m, scale);
  return { scale, ...next };
}

/** Vue qui amène le centre d'un nœud (unités de la mise en page) au centre de la zone visible. */
export function centerOn(node: { x: number; y: number; width: number; height: number }, scale: number, m: Metrics): View {
  const s = clampScale(scale);
  const x = (node.x + node.width / 2) * s + contentOffsetX(m, s) - m.viewW / 2;
  const y = (node.y + node.height / 2) * s - m.viewH / 2;
  return { scale: s, ...clampScroll(x, y, m, s) };
}

/**
 * Pincement : à partir de la vue et des deux contacts au début du geste, calcule la vue pour les contacts actuels.
 * Le zoom suit le rapport des distances ; le point du contenu sous le milieu initial suit le milieu actuel (le
 * glissement à deux doigts déplace donc aussi la carte).
 */
export function pinchView(start: { view: View; a: Point; b: Point }, now: { a: Point; b: Point }, m: Metrics): View {
  const d0 = Math.hypot(start.b.x - start.a.x, start.b.y - start.a.y);
  const d1 = Math.hypot(now.b.x - now.a.x, now.b.y - now.a.y);
  const scale = clampScale(d0 > 0 ? start.view.scale * (d1 / d0) : start.view.scale);
  const mid0 = { x: (start.a.x + start.b.x) / 2, y: (start.a.y + start.b.y) / 2 };
  const mid1 = { x: (now.a.x + now.b.x) / 2, y: (now.a.y + now.b.y) / 2 };
  const cx = (start.view.x + mid0.x - contentOffsetX(m, start.view.scale)) / start.view.scale;
  const cy = (start.view.y + mid0.y) / start.view.scale;
  const next = clampScroll(cx * scale + contentOffsetX(m, scale) - mid1.x, cy * scale - mid1.y, m, scale);
  return { scale, ...next };
}

/** Facteur de zoom d'un événement de molette (`Ctrl` + molette ou pincement du pavé tactile). */
export function wheelZoomFactor(e: { deltaY: number; deltaMode?: number }): number {
  // deltaMode : 0 = pixels, 1 = lignes, 2 = pages.
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
  const limited = Math.max(-300, Math.min(300, px));
  return Math.exp(-limited * WHEEL_ZOOM_RATE);
}

export type KeyAction =
  | { type: "pan"; dx: number; dy: number }
  | { type: "zoom"; factor: number }
  | { type: "reset-zoom" }
  | { type: "home" }
  | { type: "end" };

/** Action clavier de la carte, ou `null` (touche ignorée, y compris avec Ctrl/Alt/Méta : zoom du navigateur). */
export function keyAction(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): KeyAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const step = e.shiftKey ? KEY_PAN_STEP * 3 : KEY_PAN_STEP;
  switch (e.key) {
    case "ArrowLeft":
      return { type: "pan", dx: -step, dy: 0 };
    case "ArrowRight":
      return { type: "pan", dx: step, dy: 0 };
    case "ArrowUp":
      return { type: "pan", dx: 0, dy: -step };
    case "ArrowDown":
      return { type: "pan", dx: 0, dy: step };
    case "+":
    case "=":
      return { type: "zoom", factor: ZOOM_STEP };
    case "-":
    case "_":
      return { type: "zoom", factor: 1 / ZOOM_STEP };
    case "0":
      return { type: "reset-zoom" };
    case "Home":
      return { type: "home" };
    case "End":
      return { type: "end" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Mémoire du zoom (réouverture de l'écran)
// ---------------------------------------------------------------------------

let rememberedScale = 1;

/** Zoom à restaurer à l'ouverture de l'écran (1 la première fois). */
export function getRememberedScale(): number {
  return rememberedScale;
}

export function setRememberedScale(scale: number): void {
  rememberedScale = clampScale(scale);
}

// ---------------------------------------------------------------------------
// Branchement DOM
// ---------------------------------------------------------------------------

export type ViewportOptions = {
  /** Zone défilante (`.mh-flow-scroll`). */
  scroller: HTMLElement;
  /** Conteneur de la taille `contenu × zoom` (centré) ; reçoit `width`/`height`. */
  sizer: HTMLElement;
  /** Scène mise à l'échelle (`transform: scale`). */
  stage: HTMLElement;
  /** Taille du contenu à l'échelle 1 (unités de la mise en page). */
  content: { width: number; height: number };
  /** Zoom initial ; défaut : zoom mémorisé. */
  initialScale?: number;
  /** Mouvement réduit (défaut : `matchMedia("(prefers-reduced-motion: reduce)")`). */
  prefersReducedMotion?: () => boolean;
  /** Appelé à chaque changement de zoom (affichage du pourcentage, mémorisation). */
  onScaleChange?: (scale: number) => void;
};

export interface ViewportController {
  getScale(): number;
  zoomBy(factor: number, anchor?: Point): void;
  setScale(scale: number, anchor?: Point): void;
  resetZoom(): void;
  /** Centre un nœud (zoom conservé). `smooth` : défilement animé, sauf mouvement réduit. */
  centerOn(node: { x: number; y: number; width: number; height: number }, smooth?: boolean): void;
  dispose(): void;
}

function systemPrefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function attachViewport(options: ViewportOptions): ViewportController {
  const { scroller, sizer, stage, content } = options;
  const reduced = options.prefersReducedMotion ?? systemPrefersReducedMotion;
  let scale = clampScale(options.initialScale ?? getRememberedScale());
  const ac = new AbortController();
  const { signal } = ac;

  const metrics = (): Metrics => ({ contentW: content.width, contentH: content.height, viewW: scroller.clientWidth, viewH: scroller.clientHeight });
  const current = (): View => ({ scale, x: scroller.scrollLeft, y: scroller.scrollTop });
  const anchorOf = (clientX: number, clientY: number): Point => {
    const r = scroller.getBoundingClientRect();
    return { x: clientX - r.left - scroller.clientLeft, y: clientY - r.top - scroller.clientTop };
  };

  const applyScale = (): void => {
    sizer.style.width = `${content.width * scale}px`;
    sizer.style.height = `${content.height * scale}px`;
    stage.style.transform = `scale(${scale})`;
    scroller.dataset.zoom = String(Math.round(scale * 100));
  };
  const apply = (view: View): void => {
    const changed = view.scale !== scale;
    scale = view.scale;
    if (changed) {
      applyScale();
      setRememberedScale(scale);
      options.onScaleChange?.(scale);
    }
    scroller.scrollLeft = view.x;
    scroller.scrollTop = view.y;
  };
  applyScale();
  setRememberedScale(scale);

  // ── Zoom ──
  const setScale = (next: number, anchor?: Point): void => apply(zoomAround(current(), next, metrics(), anchor));
  const zoomBy = (factor: number, anchor?: Point): void => setScale(scale * factor, anchor);

  // ── Glissement (souris, doigt, stylet) et pincement ──
  const pointers = new Map<number, Point>();
  let drag: { id: number; startX: number; startY: number; scrollX: number; scrollY: number; active: boolean } | null = null;
  let pinch: { view: View; ids: [number, number]; a: Point; b: Point } | null = null;
  let suppressClick = false;

  const endGesture = (): void => {
    scroller.classList.remove("is-panning");
  };

  signal.addEventListener("abort", endGesture);

  scroller.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Barre de défilement (hors contenu) : le navigateur s'en charge.
      const at = anchorOf(e.clientX, e.clientY);
      if (at.x >= scroller.clientWidth || at.y >= scroller.clientHeight) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, scrollX: scroller.scrollLeft, scrollY: scroller.scrollTop, active: false };
      } else if (pointers.size === 2) {
        const [first, second] = [...pointers.keys()] as [number, number];
        const a = anchorOf(pointers.get(first)!.x, pointers.get(first)!.y);
        const b = anchorOf(pointers.get(second)!.x, pointers.get(second)!.y);
        pinch = { view: current(), ids: [first, second], a, b };
        drag = null;
        suppressClick = true;
        scroller.classList.add("is-panning");
      }
    },
    { signal },
  );

  scroller.addEventListener(
    "pointermove",
    (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) {
        const pa = pointers.get(pinch.ids[0]);
        const pb = pointers.get(pinch.ids[1]);
        if (!pa || !pb) return;
        apply(pinchView(pinch, { a: anchorOf(pa.x, pa.y), b: anchorOf(pb.x, pb.y) }, metrics()));
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.active = true;
        suppressClick = true;
        scroller.classList.add("is-panning");
        try {
          scroller.setPointerCapture(e.pointerId);
        } catch {
          // Contact déjà relâché ou environnement sans capture : le glissement continue tant que le pointeur reste sur la carte.
        }
      }
      const next = clampScroll(drag.scrollX - dx, drag.scrollY - dy, metrics(), scale);
      scroller.scrollLeft = next.x;
      scroller.scrollTop = next.y;
    },
    { signal },
  );

  const release = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (pinch && (e.pointerId === pinch.ids[0] || e.pointerId === pinch.ids[1])) {
      pinch = null;
      // Le doigt restant ne reprend pas le glissement : il faudrait un nouvel appui.
      drag = null;
    }
    if (drag?.id === e.pointerId) drag = null;
    if (pointers.size === 0) {
      endGesture();
      if (suppressClick) setTimeout(() => (suppressClick = false), 0);
    }
  };
  scroller.addEventListener("pointerup", release, { signal });
  scroller.addEventListener("pointercancel", release, { signal });

  // Un glissement ne doit pas être pris pour un clic sur le nœud sous le pointeur.
  scroller.addEventListener(
    "click",
    (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    },
    { capture: true, signal },
  );

  // ── Molette : défilement natif ; Ctrl + molette (et pincement du pavé tactile) = zoom sous le curseur ──
  scroller.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(wheelZoomFactor(e), anchorOf(e.clientX, e.clientY));
    },
    { passive: false, signal },
  );

  // ── Clavier (la région a le focus) ──
  scroller.addEventListener(
    "keydown",
    (e) => {
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      switch (action.type) {
        case "pan":
          apply(panBy(current(), action.dx, action.dy, metrics()));
          break;
        case "zoom":
          zoomBy(action.factor);
          break;
        case "reset-zoom":
          setScale(1);
          break;
        case "home":
          apply({ scale, ...clampScroll(0, 0, metrics(), scale) });
          break;
        case "end":
          apply({ scale, ...clampScroll(0, Number.MAX_SAFE_INTEGER, metrics(), scale) });
          break;
      }
    },
    { signal },
  );

  return {
    getScale: () => scale,
    zoomBy,
    setScale,
    resetZoom: () => setScale(1),
    centerOn(node, smooth = false) {
      const target = centerOn(node, scale, metrics());
      if (smooth && !reduced() && typeof scroller.scrollTo === "function") {
        scroller.scrollTo({ left: target.x, top: target.y, behavior: "smooth" });
      } else {
        apply(target);
      }
    },
    dispose: () => ac.abort(),
  };
}
