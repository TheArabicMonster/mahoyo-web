// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachViewport,
  centerOn,
  clampScale,
  clampScroll,
  DRAG_THRESHOLD,
  getRememberedScale,
  keyAction,
  KEY_PAN_STEP,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  pinchView,
  setRememberedScale,
  wheelZoomFactor,
  zoomAround,
  ZOOM_STEP,
  type Metrics,
  type ViewportController,
} from "@/ui/flowchart-viewport.js";

// Contenu 800 x 5000, zone visible 1000 x 500 (plus large que le contenu à l'échelle 1 : il est centré).
const M: Metrics = { contentW: 800, contentH: 5000, viewW: 1000, viewH: 500 };

describe("fonctions pures", () => {
  it("borne le zoom et ignore les valeurs invalides", () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it("borne le défilement au contenu mis à l'échelle (pas de défilement horizontal si le contenu tient)", () => {
    expect(clampScroll(-10, -10, M, 1)).toEqual({ x: 0, y: 0 });
    expect(clampScroll(500, 99999, M, 1)).toEqual({ x: 0, y: 4500 });
    expect(clampScroll(5000, 0, M, 2)).toEqual({ x: 600, y: 0 }); // 1600 - 1000
  });

  it("panBy déplace la vue puis borne", () => {
    expect(panBy({ scale: 1, x: 0, y: 100 }, 0, 50, M)).toEqual({ scale: 1, x: 0, y: 150 });
    expect(panBy({ scale: 1, x: 0, y: 100 }, 0, -500, M)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(panBy({ scale: 2, x: 100, y: 0 }, 40, 0, M)).toEqual({ scale: 2, x: 140, y: 0 });
  });

  it("zoomAround garde fixe le point du contenu sous l'ancre", () => {
    const view = { scale: 1, x: 0, y: 1000 };
    const anchor = { x: 300, y: 200 };
    const next = zoomAround(view, 2, M, anchor);
    expect(next.scale).toBe(2);
    // Point du contenu sous l'ancre avant : x = 300 - offset(100) = 200, y = 1200.
    // Après : x = (next.x + 300 - offset(0)) / 2, y = (next.y + 200) / 2.
    expect((next.x + anchor.x - 0) / 2).toBeCloseTo(200);
    expect((next.y + anchor.y) / 2).toBeCloseTo(1200);
  });

  it("zoomAround sans ancre zoome sur le centre de la zone visible et respecte les bornes", () => {
    const view = { scale: 1, x: 0, y: 1000 };
    const next = zoomAround(view, 99, M);
    expect(next.scale).toBe(MAX_SCALE);
    const centerBefore = (1000 + 250) / 1;
    expect((next.y + 250) / MAX_SCALE).toBeCloseTo(centerBefore);
  });

  it("centerOn amène le centre du nœud au centre de la zone visible", () => {
    const node = { x: 360, y: 2000, width: 64, height: 40 }; // centre (392, 2020)
    const v = centerOn(node, 1, M);
    expect(v).toEqual({ scale: 1, x: 0, y: 2020 - 250 });
    const w = centerOn(node, 2, M);
    // x : centre 784 - 500 = 284 ; y : 4040 - 250
    expect(w).toEqual({ scale: 2, x: 284, y: 3790 });
    // Un nœud près du bord haut ne dépasse pas.
    expect(centerOn({ x: 0, y: 0, width: 64, height: 40 }, 1, M).y).toBe(0);
  });

  it("pinchView : zoom selon le rapport des distances, ancré sur le milieu des doigts", () => {
    const start = { view: { scale: 1, x: 0, y: 1000 }, a: { x: 400, y: 250 }, b: { x: 600, y: 250 } };
    // Doigts qui s'écartent de 200 à 400 px, même milieu (500, 250) : point du contenu (400, 1250) sous le milieu.
    const v = pinchView(start, { a: { x: 300, y: 250 }, b: { x: 700, y: 250 } }, M);
    expect(v).toEqual({ scale: 2, x: 300, y: 2250 });
    // Si le milieu glisse de 50 px vers la droite, la carte suit les doigts.
    const moved = pinchView(start, { a: { x: 350, y: 250 }, b: { x: 750, y: 250 } }, M);
    expect(moved.scale).toBe(2);
    expect(moved.x).toBe(250);
    // Doigts qui se rapprochent : dézoom, borné.
    expect(pinchView(start, { a: { x: 499, y: 250 }, b: { x: 501, y: 250 } }, M).scale).toBe(MIN_SCALE);
  });

  it("wheelZoomFactor : un cran de souris (100) vaut un cran de zoom, le sens est conservé", () => {
    expect(wheelZoomFactor({ deltaY: -100 })).toBeCloseTo(ZOOM_STEP);
    expect(wheelZoomFactor({ deltaY: 100 })).toBeCloseTo(1 / ZOOM_STEP);
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1 })).toBeCloseTo(wheelZoomFactor({ deltaY: -48 }));
    expect(wheelZoomFactor({ deltaY: -100000 })).toBeLessThan(2); // un seul événement ne fait pas exploser le zoom
    expect(wheelZoomFactor({ deltaY: 0 })).toBe(1);
  });

  it("keyAction : flèches, +/-, 0, Début, Fin ; ignore les touches avec Ctrl, Alt ou Méta", () => {
    expect(keyAction({ key: "ArrowDown" })).toEqual({ type: "pan", dx: 0, dy: KEY_PAN_STEP });
    expect(keyAction({ key: "ArrowLeft", shiftKey: true })).toEqual({ type: "pan", dx: -KEY_PAN_STEP * 3, dy: 0 });
    expect(keyAction({ key: "+" })).toEqual({ type: "zoom", factor: ZOOM_STEP });
    expect(keyAction({ key: "=" })).toEqual({ type: "zoom", factor: ZOOM_STEP });
    expect(keyAction({ key: "-" })).toEqual({ type: "zoom", factor: 1 / ZOOM_STEP });
    expect(keyAction({ key: "0" })).toEqual({ type: "reset-zoom" });
    expect(keyAction({ key: "Home" })).toEqual({ type: "home" });
    expect(keyAction({ key: "End" })).toEqual({ type: "end" });
    expect(keyAction({ key: "+", ctrlKey: true })).toBeNull();
    expect(keyAction({ key: "Home", metaKey: true })).toBeNull();
    expect(keyAction({ key: "a" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Branchement DOM (jsdom n'a pas de mise en page : taille et défilement sont simulés)
// ---------------------------------------------------------------------------

type Rig = { scroller: HTMLElement; sizer: HTMLElement; stage: HTMLElement; ctl: ViewportController; scale: ReturnType<typeof vi.fn> };

function rig(opts: { initialScale?: number; reduced?: boolean } = {}): Rig {
  const scroller = document.createElement("div");
  const sizer = document.createElement("div");
  const stage = document.createElement("div");
  sizer.appendChild(stage);
  scroller.appendChild(sizer);
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, "clientWidth", { value: M.viewW, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: M.viewH, configurable: true });
  scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}) });
  const scale = vi.fn();
  const ctl = attachViewport({
    scroller,
    sizer,
    stage,
    content: { width: M.contentW, height: M.contentH },
    initialScale: opts.initialScale,
    prefersReducedMotion: () => opts.reduced ?? false,
    onScaleChange: scale,
  });
  return { scroller, sizer, stage, ctl, scale };
}

const ptr = (type: string, init: { id?: number; x?: number; y?: number; pointerType?: string; button?: number } = {}) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: init.id ?? 1,
    pointerType: init.pointerType ?? "mouse",
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
    button: init.button ?? 0,
  });

beforeEach(() => setRememberedScale(1));
afterEach(() => {
  document.body.replaceChildren();
  setRememberedScale(1);
});

describe("attachViewport", () => {
  it("pose la taille et l'échelle du contenu et mémorise le zoom", () => {
    const r = rig({ initialScale: 1.5 });
    expect(r.sizer.style.width).toBe("1200px");
    expect(r.sizer.style.height).toBe("7500px");
    expect(r.stage.style.transform).toBe("scale(1.5)");
    expect(getRememberedScale()).toBe(1.5);
    r.ctl.dispose();
  });

  it("sans zoom demandé, reprend le zoom mémorisé (conservé à la réouverture)", () => {
    const first = rig({ initialScale: 2 });
    first.ctl.zoomBy(1 / ZOOM_STEP);
    first.ctl.dispose();
    document.body.replaceChildren();
    const second = rig();
    expect(second.ctl.getScale()).toBeCloseTo(2 / ZOOM_STEP);
    expect(second.stage.style.transform).toBe(`scale(${2 / ZOOM_STEP})`);
  });

  it("Ctrl + molette zoome sous le curseur ; sans Ctrl, la molette reste native", () => {
    const r = rig();
    r.scroller.scrollTop = 1000;
    const plain = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true, clientX: 300, clientY: 200 });
    r.scroller.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(r.ctl.getScale()).toBe(1);

    const zoom = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true, clientX: 300, clientY: 200 });
    r.scroller.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(r.ctl.getScale()).toBeCloseTo(ZOOM_STEP);
    // Le point du contenu sous le curseur ne bouge pas : y = (1000 + 200) = 1200 avant.
    expect((r.scroller.scrollTop + 200) / r.ctl.getScale()).toBeCloseTo(1200);
    expect(r.sizer.style.width).toBe(`${800 * r.ctl.getScale()}px`);
    expect(r.scale).toHaveBeenCalledTimes(1);
  });

  it("le glissement (souris) fait défiler dans le sens inverse du geste, après le seuil", () => {
    const r = rig();
    r.scroller.scrollTop = 1000;
    r.scroller.dispatchEvent(ptr("pointerdown", { x: 500, y: 300 }));
    r.scroller.dispatchEvent(ptr("pointermove", { x: 500, y: 300 - (DRAG_THRESHOLD - 1) }));
    expect(r.scroller.scrollTop).toBe(1000); // sous le seuil : c'est encore un clic
    expect(r.scroller.classList.contains("is-panning")).toBe(false);
    r.scroller.dispatchEvent(ptr("pointermove", { x: 480, y: 220 }));
    expect(r.scroller.scrollTop).toBe(1080); // la carte suit la main : -80 px => +80 de défilement
    expect(r.scroller.classList.contains("is-panning")).toBe(true);
    r.scroller.dispatchEvent(ptr("pointerup", { x: 480, y: 220 }));
    expect(r.scroller.classList.contains("is-panning")).toBe(false);
  });

  it("le glissement ne dépasse jamais les bords", () => {
    const r = rig();
    r.scroller.dispatchEvent(ptr("pointerdown", { x: 500, y: 300 }));
    r.scroller.dispatchEvent(ptr("pointermove", { x: 500, y: 450 })); // vers le bas : la carte monte, déjà en haut
    expect(r.scroller.scrollTop).toBe(0);
    expect(r.scroller.scrollLeft).toBe(0);
  });

  it("un clic simple traverse ; un glissement n'envoie pas de clic au nœud sous le pointeur", () => {
    const r = rig();
    const onClick = vi.fn();
    r.stage.addEventListener("click", onClick);
    r.scroller.dispatchEvent(ptr("pointerdown", { x: 500, y: 300 }));
    r.scroller.dispatchEvent(ptr("pointerup", { x: 500, y: 300 }));
    r.stage.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);

    r.scroller.dispatchEvent(ptr("pointerdown", { x: 500, y: 300 }));
    r.scroller.dispatchEvent(ptr("pointermove", { x: 400, y: 300 }));
    r.scroller.dispatchEvent(ptr("pointerup", { x: 400, y: 300 }));
    r.stage.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    // Le clic suivant redevient normal.
    r.stage.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("ignore le clic droit et le milieu de la souris", () => {
    const r = rig();
    r.scroller.scrollTop = 1000;
    r.scroller.dispatchEvent(ptr("pointerdown", { x: 500, y: 300, button: 2 }));
    r.scroller.dispatchEvent(ptr("pointermove", { x: 500, y: 100 }));
    expect(r.scroller.scrollTop).toBe(1000);
  });

  it("le glissement tactile (un doigt) fait défiler", () => {
    const r = rig();
    r.scroller.scrollTop = 1000;
    r.scroller.dispatchEvent(ptr("pointerdown", { id: 7, x: 500, y: 300, pointerType: "touch" }));
    r.scroller.dispatchEvent(ptr("pointermove", { id: 7, x: 500, y: 250, pointerType: "touch" }));
    expect(r.scroller.scrollTop).toBe(1050);
  });

  it("le pincement à deux doigts zoome (ancré sur leur milieu) et ne glisse pas", () => {
    const r = rig();
    r.scroller.scrollTop = 1000;
    r.scroller.dispatchEvent(ptr("pointerdown", { id: 1, x: 400, y: 250, pointerType: "touch" }));
    r.scroller.dispatchEvent(ptr("pointerdown", { id: 2, x: 600, y: 250, pointerType: "touch" }));
    r.scroller.dispatchEvent(ptr("pointermove", { id: 1, x: 300, y: 250, pointerType: "touch" }));
    r.scroller.dispatchEvent(ptr("pointermove", { id: 2, x: 700, y: 250, pointerType: "touch" }));
    expect(r.ctl.getScale()).toBeCloseTo(2);
    // Point du contenu sous le milieu (500, 250) : (400, 1000 + 250) avant => reste sous le milieu.
    expect((r.scroller.scrollTop + 250) / 2).toBeCloseTo(1250);
    expect((r.scroller.scrollLeft + 500) / 2).toBeCloseTo(400);
    r.scroller.dispatchEvent(ptr("pointerup", { id: 2, pointerType: "touch" }));
    const top = r.scroller.scrollTop;
    // Le doigt restant ne déclenche pas un glissement.
    r.scroller.dispatchEvent(ptr("pointermove", { id: 1, x: 100, y: 100, pointerType: "touch" }));
    expect(r.scroller.scrollTop).toBe(top);
  });

  it("ignore un appui sur la barre de défilement", () => {
    const r = rig();
    r.scroller.scrollTop = 1000;
    r.scroller.dispatchEvent(ptr("pointerdown", { x: 1005, y: 300 })); // au-delà de clientWidth
    r.scroller.dispatchEvent(ptr("pointermove", { x: 1005, y: 100 }));
    expect(r.scroller.scrollTop).toBe(1000);
  });

  it("clavier : flèches, +/-, 0, Début, Fin", () => {
    const r = rig();
    const key = (k: string, extra: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra });
      r.scroller.dispatchEvent(e);
      return e;
    };
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(r.scroller.scrollTop).toBe(KEY_PAN_STEP);
    key("ArrowUp");
    expect(r.scroller.scrollTop).toBe(0);
    key("+");
    expect(r.ctl.getScale()).toBeCloseTo(ZOOM_STEP);
    key("-");
    key("-");
    expect(r.ctl.getScale()).toBeCloseTo(1 / ZOOM_STEP);
    key("0");
    expect(r.ctl.getScale()).toBe(1);
    key("End");
    expect(r.scroller.scrollTop).toBe(4500);
    key("Home");
    expect(r.scroller.scrollTop).toBe(0);
    // Ctrl + « + » reste au navigateur.
    expect(key("+", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(r.ctl.getScale()).toBe(1);
  });

  it("le zoom reste dans les bornes", () => {
    const r = rig();
    for (let i = 0; i < 30; i++) r.ctl.zoomBy(ZOOM_STEP);
    expect(r.ctl.getScale()).toBe(MAX_SCALE);
    for (let i = 0; i < 60; i++) r.ctl.zoomBy(1 / ZOOM_STEP);
    expect(r.ctl.getScale()).toBe(MIN_SCALE);
  });

  it("centerOn : amène le nœud au centre ; défilement animé seulement sans mouvement réduit", () => {
    const node = { x: 360, y: 2000, width: 64, height: 40 };
    const plain = rig();
    plain.ctl.centerOn(node);
    expect(plain.scroller.scrollTop).toBe(1770);

    const scrollTo = vi.fn();
    const smooth = rig({ reduced: false });
    smooth.scroller.scrollTo = scrollTo as unknown as typeof smooth.scroller.scrollTo;
    smooth.ctl.centerOn(node, true);
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 1770, behavior: "smooth" });

    const calm = rig({ reduced: true });
    const calmScrollTo = vi.fn();
    calm.scroller.scrollTo = calmScrollTo as unknown as typeof calm.scroller.scrollTo;
    calm.ctl.centerOn(node, true);
    expect(calmScrollTo).not.toHaveBeenCalled();
    expect(calm.scroller.scrollTop).toBe(1770);
  });

  it("dispose retire les écouteurs", () => {
    const r = rig();
    r.ctl.dispose();
    r.scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    expect(r.ctl.getScale()).toBe(1);
  });
});
