import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import { compileAction } from "@/renderer/action-compiler.js";
import { partbgInnerTransform } from "@/renderer/transform-helpers.js";
import type { RenderEvent, StageSnapshot, TimelineLayerState } from "@/kag/events.js";

type MockAnim = {
  element: HTMLElement;
  onfinish: (() => void) | null;
  finish: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  commitStyles: ReturnType<typeof vi.fn>;
};

async function withMockAnimate<T>(
  fn: (mocks: { getAnims: () => MockAnim[] }) => Promise<T>,
): Promise<T> {
  const anims: MockAnim[] = [];
  const original = (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (
    this: HTMLElement,
    _keyframes: Keyframe[],
    _options: KeyframeAnimationOptions,
  ) {
    const anim: MockAnim = {
      element: this,
      onfinish: null,
      finish: vi.fn(() => {
        if (anim.onfinish) anim.onfinish();
      }),
      cancel: vi.fn(),
      commitStyles: vi.fn(),
    };
    anims.push(anim);
    return anim as unknown as Animation;
  };
  try {
    return await fn({ getAnims: () => anims });
  } finally {
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = original;
  }
}

describe("DomStageRenderer", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
  });

  afterEach(() => {
    renderer.dispose();
    root.remove();
  });

  it("monte le DOM de scène et de textbox", () => {
    expect(root.querySelector(".mh-stage")).not.toBeNull();
    expect(root.querySelector("#stage-bg")).not.toBeNull();
    expect(root.querySelector("#textbox")).not.toBeNull();
  });

  it("applique un background", async () => {
    const events: RenderEvent[] = [
      { kind: "scene", scene: { bg: "black", sprites: [], effect: null }, transition: { method: "none" } },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const bg = root.querySelector(".mh-stage-bg") as HTMLElement;
    expect(bg.style.backgroundImage).toContain("black.webp");
  });

  it("affiche du texte en mode instant", async () => {
    const events: RenderEvent[] = [
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "Hello" }] },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(text.textContent).toBe("Hello");
  });

  it("gère clearText", async () => {
    const events: RenderEvent[] = [
      { kind: "text", segments: [{ text: "Hello" }] },
      { kind: "clearText" },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(text.textContent).toBe("");
  });

  it("affiche l'indicateur de clic", async () => {
    renderer.setClickIndicator("line");
    const indicator = root.querySelector(".mh-stage-indicator") as HTMLElement;
    expect(indicator.textContent).toBe("▽");
    renderer.setClickIndicator("page");
    expect(indicator.textContent).toBe("▼");
    renderer.setClickIndicator(null);
    expect(indicator.style.visibility).toBe("hidden");
  });

  it("affiche et retire l'indicateur d'attente non interruptible, hors de la boîte de texte (#134)", () => {
    const wait = root.querySelector(".mh-stage-wait") as HTMLElement;
    expect(wait).not.toBeNull();
    // Hors de la textbox : visible même quand le script la masque (@textoff).
    expect(wait.closest(".mh-stage-textbox")).toBeNull();
    expect(wait.classList.contains("mh-stage-wait-on")).toBe(false);

    renderer.setWaitIndicator(true);
    expect(wait.classList.contains("mh-stage-wait-on")).toBe(true);
    renderer.setWaitIndicator(false);
    expect(wait.classList.contains("mh-stage-wait-on")).toBe(false);
  });

  it("nudgeWaitIndicator ne fait réagir que l'indicateur actif", () => {
    const wait = root.querySelector(".mh-stage-wait") as HTMLElement;
    renderer.nudgeWaitIndicator();
    expect(wait.classList.contains("mh-stage-wait-nudge")).toBe(false);

    renderer.setWaitIndicator(true);
    renderer.nudgeWaitIndicator();
    expect(wait.classList.contains("mh-stage-wait-nudge")).toBe(true);
    renderer.setWaitIndicator(false);
    expect(wait.classList.contains("mh-stage-wait-nudge")).toBe(false);
  });

  it("masque la textbox utilisateur", async () => {
    renderer.setUserHidden(true);
    const textbox = root.querySelector(".mh-stage-textbox") as HTMLElement;
    expect(textbox.style.opacity).toBe("0");
    renderer.setUserHidden(false);
    expect(textbox.style.opacity).toBe("1");
  });

  it("restaure un snapshot", async () => {
    const snapshot: StageSnapshot = {
      scene: { bg: "room", sprites: [], effect: null },
      textbox: { visible: false, frame: false },
      text: [{ text: "Restored" }],
      staffroll: null,
    };
    await renderer.restore(snapshot, new AbortController().signal);
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(text.textContent).toBe("Restored");
    const textbox = root.querySelector(".mh-stage-textbox") as HTMLElement;
    expect(textbox.style.opacity).toBe("0");
  });

  it("ignore les événements audio", async () => {
    const events: RenderEvent[] = [
      { kind: "audio", event: { kind: "play", channel: "bgm", storage: "m01", loop: true, volume: 1 } },
    ];
    await expect(renderer.apply(events, { instant: true, signal: new AbortController().signal })).resolves.toBeUndefined();
  });

  it("applique un effet noise", async () => {
    const events: RenderEvent[] = [
      { kind: "effect", effect: { kind: "noise", opacity: 0.5 } },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const effects = root.querySelector(".mh-stage-effects") as HTMLElement;
    expect(effects.children.length).toBe(1);
  });

  it("hurry termine le typewriter", async () => {
    const events: RenderEvent[] = [
      { kind: "text", segments: [{ text: "Long text here" }] },
    ];
    renderer.setSettings({ textSpeed: 1000, autoDelay: 2000, fontScale: 1, textboxOpacity: 1 });
    const promise = renderer.apply(events, { instant: false, signal: new AbortController().signal });
    // Laisse le typewriter démarrer (microtask) avant de hurry — reflète l'usage
    // réel où le player appelle hurry pendant apply (typewriterResolve set).
    await Promise.resolve();
    renderer.hurry();
    await promise;
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(text.textContent).toBe("Long text here");
  });

  it("réconcilie les sprites par id (pas de recréation DOM)", async () => {
    const scene = (sprites: { id: string; storage: string; x: number; y: number; z: number; opacity: number }[]) => ({
      bg: null,
      sprites: sprites.map((s) => ({ ...s })),
      effect: null,
    });
    const sig = () => new AbortController().signal;

    // 1ʳᵉ scène : deux sprites A et B.
    await renderer.apply(
      [{ kind: "scene", scene: scene([
        { id: "A", storage: "im01", x: 100, y: 100, z: 1, opacity: 1 },
        { id: "B", storage: "im02", x: 200, y: 200, z: 2, opacity: 1 },
      ]), transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    const spritesEl = root.querySelector("#stage-sprites") as HTMLElement;
    expect(spritesEl.children.length).toBe(2);
    const elA1 = spritesEl.querySelector('[data-sprite-id="A"]') as HTMLImageElement;
    const elB1 = spritesEl.querySelector('[data-sprite-id="B"]') as HTMLImageElement;
    expect(elA1).not.toBeNull();
    expect(elB1).not.toBeNull();
    const identityA = elA1;
    const identityB = elB1;

    // 2ᵉ scène : A déplacé (même id), B retiré, C ajouté.
    await renderer.apply(
      [{ kind: "scene", scene: scene([
        { id: "A", storage: "im01", x: 300, y: 300, z: 1, opacity: 0.5 },
        { id: "C", storage: "im03", x: 400, y: 400, z: 3, opacity: 1 },
      ]), transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    expect(spritesEl.children.length).toBe(2);
    const elA2 = spritesEl.querySelector('[data-sprite-id="A"]') as HTMLImageElement;
    const elC2 = spritesEl.querySelector('[data-sprite-id="C"]') as HTMLImageElement;
    // A est le même élément DOM (pas recréé) : position/opacité mises à jour.
    expect(elA2).toBe(identityA);
    expect(elA2.style.left).toBe("300px");
    expect(elA2.style.opacity).toBe("0.5");
    // B a été retiré.
    expect(spritesEl.querySelector('[data-sprite-id="B"]')).toBeNull();
    // C est nouveau.
    expect(elC2).not.toBeNull();
    expect(elC2.style.left).toBe("400px");
  });

  it("la transition est non-bloquante et waitFor la résout", async () => {
    const sig = () => new AbortController().signal;
    const t0 = performance.now();
    await renderer.apply(
      [{ kind: "scene", scene: { bg: "old", sprites: [], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    // Transition crossfade 100ms : apply() doit rendre la main immédiatement.
    const start = performance.now();
    await renderer.apply(
      [{ kind: "scene", scene: { bg: "newbg", sprites: [], effect: null }, transition: { method: "crossfade", time: 100 } }],
      { instant: false, signal: sig() },
    );
    const applyElapsed = performance.now() - start;
    // Non-bloquant : apply() ne doit pas attendre les 100ms de transition.
    expect(applyElapsed).toBeLessThan(60);

    // waitFor("transition") doit attendre la fin de la transition.
    const ctrl = new AbortController();
    await renderer.waitFor("transition", undefined, ctrl.signal);
    // Pas d'overlay résiduel après la transition.
    expect(root.querySelectorAll(".mh-stage-bg-overlay").length).toBe(0);
  });

  describe("panoramique du fond (bgMove, #135)", () => {
    const sig = () => new AbortController().signal;
    const bgEl = () => root.querySelector("#stage-bg") as HTMLElement;
    const showPano = () =>
      renderer.apply(
        [{ kind: "scene", scene: { bg: "pano", bgLeft: -99, bgTop: -48, sprites: [], effect: null }, transition: { method: "none" } }],
        { instant: true, signal: sig() },
      );

    afterEach(() => vi.restoreAllMocks());

    it("fait glisser le fond en ligne droite jusqu'à la position cible", async () => {
      await showPano();
      expect(bgEl().style.backgroundPosition).toBe("-99px -48px");
      await renderer.apply([{ kind: "bgMove", left: -167, top: -48, time: 5000 }], { instant: false, signal: sig() });
      expect(bgEl().style.transition).toBe("background-position 5000ms linear");
      expect(bgEl().style.backgroundPosition).toBe("-167px -48px");
    });

    it("en mode instantané (saut de la séquence), pose directement la position finale", async () => {
      await showPano();
      await renderer.apply([{ kind: "bgMove", left: -167, top: -48, time: 5000 }], { instant: true, signal: sig() });
      expect(bgEl().style.transition).toBe("none");
      expect(bgEl().style.backgroundPosition).toBe("-167px -48px");
    });

    it("panoramique accéléré : la transition porte l'accélération", async () => {
      await showPano();
      await renderer.apply([{ kind: "bgMove", left: -48, top: -149, time: 14500, accel: 20 }], { instant: false, signal: sig() });
      expect(bgEl().style.transition).toMatch(/^background-position 14500ms (linear\(0|ease-in)/);
    });

    it("un fondu en plein panoramique accéléré part de la position eased, pas de la linéaire", async () => {
      const now = vi.spyOn(performance, "now").mockReturnValue(0);
      await showPano();
      await renderer.apply([{ kind: "bgMove", left: 1, top: -48, time: 1000, accel: 3 }], { instant: false, signal: sig() });
      now.mockReturnValue(500);
      await renderer.apply(
        [{ kind: "scene", scene: { bg: "next", bgLeft: 0, bgTop: 0, sprites: [], effect: null }, transition: { method: "crossfade", time: 800 } }],
        { instant: false, signal: sig() },
      );
      const overlay = root.querySelector(".mh-stage-bg-overlay") as HTMLElement;
      // À mi-parcours, une accélération positive est en retard sur la droite : -99 + 100 * 0.5^k avec k = 1 + ln 4.
      const k = 1 + Math.log(4);
      const expected = -99 + 100 * Math.pow(0.5, k);
      expect(parseFloat(overlay.style.backgroundPosition)).toBeCloseTo(expected, 1);
      expect(parseFloat(overlay.style.backgroundPosition)).toBeLessThan(-49);
      renderer.hurry();
    });

    it("zoom et rotation du fond : transform autour du centre ; un nouveau fond les remet à zéro", async () => {
      await showPano();
      await renderer.apply([{ kind: "bgMove", left: -381, top: -613, time: 0, zoomx: 60, zoomy: 60, rotate: 315 }], { instant: false, signal: sig() });
      expect(bgEl().style.transform).toBe("rotate(315deg) scale(0.6, 0.6)");
      expect(bgEl().style.transformOrigin).toBe("512px 288px");
      await renderer.apply([{ kind: "bgMove", left: -48, top: -48, time: 2000, accel: 3, zoomx: 100, zoomy: 100, rotate: 0 }], { instant: false, signal: sig() });
      expect(bgEl().style.transition).toMatch(/transform 2000ms (linear\(0|ease-in)/);
      expect(bgEl().style.transform).toBe("rotate(0deg) scale(1, 1)");
      await showPano();
      expect(bgEl().style.transform).toBe("");
    });

    it("un fondu commencé en plein panoramique part de la position courante de l'ancien fond", async () => {
      const now = vi.spyOn(performance, "now").mockReturnValue(1000);
      await showPano();
      await renderer.apply([{ kind: "bgMove", left: -167, top: -48, time: 5000 }], { instant: false, signal: sig() });
      now.mockReturnValue(3500); // à mi-chemin
      await renderer.apply(
        [{ kind: "scene", scene: { bg: "next", bgLeft: -48, bgTop: -300, sprites: [], effect: null }, transition: { method: "crossfade", time: 2000 } }],
        { instant: false, signal: sig() },
      );
      const overlay = root.querySelector(".mh-stage-bg-overlay") as HTMLElement;
      expect(overlay.style.backgroundImage).toContain("pano");
      expect(overlay.style.backgroundPosition).toBe("-133px -48px");
      // Le nouveau fond est posé à sa propre position, sans mouvement hérité.
      expect(bgEl().style.backgroundPosition).toBe("-48px -300px");
      expect(bgEl().style.transition).toBe("");
      renderer.hurry();
    });
  });

  describe("calques de timeline (#125)", () => {
    const sig = () => new AbortController().signal;
    const layer = (over: Partial<TimelineLayerState> = {}): TimelineLayerState => ({ id: "L1", storage: "carton", x: 224, y: 217, opacity: 0, z: 3400, ...over });
    const layerEl = (id = "L1") => root.querySelector(`#stage-timeline [data-layer-id="${id}"]`) as HTMLElement | null;

    it("pose un calque centré sur (x, y), avec son ordre et son opacité, entre le fond et les sprites", async () => {
      await renderer.apply([{ kind: "timelineLayer", layer: layer(), time: 0 }], { instant: false, signal: sig() });
      const el = layerEl()!;
      expect(el.style.left).toBe("224px");
      expect(el.style.top).toBe("217px");
      expect(el.style.opacity).toBe("0");
      expect(el.style.zIndex).toBe("3400");
      expect(el.querySelector("img")!.getAttribute("src")).toContain("carton");
      const order = [...root.querySelector("#stage")!.children].map((c) => c.id);
      expect(order.indexOf("stage-timeline")).toBeGreaterThan(order.indexOf("stage-bg"));
      expect(order.indexOf("stage-timeline")).toBeLessThan(order.indexOf("stage-sprites"));
    });

    it("fondu : transition linéaire de l'opacité et de la position ; instantanée en cas de saut", async () => {
      await renderer.apply([{ kind: "timelineLayer", layer: layer(), time: 0 }], { instant: false, signal: sig() });
      await renderer.apply([{ kind: "timelineLayer", layer: layer({ opacity: 1, x: 300 }), time: 1500 }], { instant: false, signal: sig() });
      expect(layerEl()!.style.transition).toBe("left 1500ms linear, top 1500ms linear, opacity 1500ms linear, transform 1500ms linear");
      expect(layerEl()!.style.opacity).toBe("1");
      expect(layerEl()!.style.left).toBe("300px");
      await renderer.apply([{ kind: "timelineLayer", layer: layer({ opacity: 0 }), time: 1000 }], { instant: true, signal: sig() });
      expect(layerEl()!.style.transition).toBe("none");
      expect(layerEl()!.style.opacity).toBe("0");
    });

    it("accélération : le même rythme pour la position, l'opacité et le zoom", async () => {
      await renderer.apply([{ kind: "timelineLayer", layer: layer(), time: 0 }], { instant: false, signal: sig() });
      await renderer.apply([{ kind: "timelineLayer", layer: layer({ opacity: 1, y: 600 }), time: 14500, accel: 20 }], { instant: false, signal: sig() });
      const t = layerEl()!.style.transition;
      // `linear(…)` échantillonné (ou ease-in sans support) : jamais le `linear` simple.
      for (const prop of ["left", "top", "opacity", "transform"]) expect(t).toMatch(new RegExp(`${prop} 14500ms (linear\\(0|ease-in)`));
      await renderer.apply([{ kind: "timelineLayer", layer: layer(), time: 2000, accel: -3 }], { instant: false, signal: sig() });
      expect(layerEl()!.style.transition).toMatch(/top 2000ms (linear\(0|ease-out)/);
    });

    it("zoom, rotation et point d'ancrage : transform CSS autour de l'ancrage, centre par défaut", async () => {
      await renderer.apply([{ kind: "timelineLayer", layer: layer(), time: 0 }], { instant: false, signal: sig() });
      expect(layerEl()!.style.transform).toBe("translate(-50%, -50%) rotate(0deg) scale(1, 1)");
      expect(layerEl()!.style.transformOrigin).toBe("50% 50%");
      await renderer.apply([{ kind: "timelineLayer", layer: layer({ zoomx: 60, zoomy: -80, rotate: 315, afx: 121.5, afy: 204 }), time: 0 }], { instant: false, signal: sig() });
      expect(layerEl()!.style.transform).toBe("translate(-50%, -50%) rotate(315deg) scale(0.6, -0.8)");
      expect(layerEl()!.style.transformOrigin).toBe("121.5px 204px");
      // Une clé sans ces champs remet les valeurs par défaut.
      await renderer.apply([{ kind: "timelineLayer", layer: layer(), time: 0 }], { instant: false, signal: sig() });
      expect(layerEl()!.style.transform).toBe("translate(-50%, -50%) rotate(0deg) scale(1, 1)");
      expect(layerEl()!.style.transformOrigin).toBe("50% 50%");
    });

    it("pluie : classe dédiée tant que le calque la demande", async () => {
      await renderer.apply([{ kind: "timelineLayer", layer: layer({ rain: true }), time: 0 }], { instant: false, signal: sig() });
      expect(layerEl()!.classList.contains("mh-stage-tl-rain")).toBe(true);
      await renderer.apply([{ kind: "timelineLayer", layer: layer(), time: 0 }], { instant: false, signal: sig() });
      expect(layerEl()!.classList.contains("mh-stage-tl-rain")).toBe(false);
    });

    it("la fin de la séquence, clear() et restore() retirent les calques", async () => {
      const add = () => renderer.apply([{ kind: "timelineLayer", layer: layer(), time: 0 }, { kind: "timelineLayer", layer: layer({ id: "L2" }), time: 0 }], { instant: false, signal: sig() });
      await add();
      await renderer.apply([{ kind: "timelineLayerClear" }], { instant: false, signal: sig() });
      expect(root.querySelectorAll("#stage-timeline > *").length).toBe(0);
      await add();
      renderer.clear();
      expect(root.querySelectorAll("#stage-timeline > *").length).toBe(0);
      await add();
      await renderer.restore({ scene: { bg: null, sprites: [], effect: null }, textbox: { visible: true, frame: true }, text: [], staffroll: null }, sig());
      expect(root.querySelectorAll("#stage-timeline > *").length).toBe(0);
    });
  });

  describe("tremblement d'écran (#148)", () => {
    const sig = () => new AbortController().signal;
    const container = () => root.querySelector(".mh-stage") as HTMLElement;

    it("garde l'agrandissement 1.25 du stage pendant le tremblement (sinon l'écran tombe à 1024×576)", async () => {
      expect(document.getElementById("mh-stage-styles")!.textContent).toContain("transform: scale(1.25)");
      await renderer.apply([{ kind: "quake", quake: { hmax: 6, vmax: 4, time: null } }], { instant: false, signal: sig() });
      const t = container().style.transform;
      expect(t).toMatch(/^translate\(-?[\d.e-]+px, -?[\d.e-]+px\) scale\(1\.25\)$/);
      await renderer.apply([{ kind: "quake", quake: null }], { instant: false, signal: sig() });
    });

    it("l'arrêt du tremblement rend la transformation au CSS (agrandissement seul)", async () => {
      await renderer.apply([{ kind: "quake", quake: { hmax: 6, vmax: 4, time: null } }], { instant: false, signal: sig() });
      await renderer.apply([{ kind: "quake", quake: null }], { instant: false, signal: sig() });
      expect(container().style.transform).toBe("");
    });
  });

  it("hurry termine la transition immédiatement", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{ kind: "scene", scene: { bg: "old", sprites: [], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    await renderer.apply(
      [{ kind: "scene", scene: { bg: "newbg", sprites: [], effect: null }, transition: { method: "crossfade", time: 5000 } }],
      { instant: false, signal: sig() },
    );
    // Overlays présents pendant la transition.
    expect(root.querySelectorAll(".mh-stage-bg-overlay").length).toBeGreaterThan(0);
    renderer.hurry();
    // Après hurry : overlays nettoyés.
    expect(root.querySelectorAll(".mh-stage-bg-overlay").length).toBe(0);
  });

  it("rend un sprite partbg (crop wrapper overflow:hidden + img translatée)", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: "black",
          sprites: [{
            id: "pb1",
            storage: "im02空",
            x: 748,
            y: 0,
            z: 1000,
            opacity: 1,
            crop: {
              width: 522,
              height: 576,
              srcLeft: 542,
              srcTop: 0,
              srcZoomX: 100,
              srcZoomY: 100,
              bgStorage: "black",
            },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );

    const wrapper = root.querySelector(".mh-stage-partbg") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.dataset.spriteId).toBe("pb1");
    expect(wrapper.style.width).toBe("522px");
    expect(wrapper.style.height).toBe("576px");
    expect(wrapper.style.overflow).toBe("hidden");
    expect(wrapper.style.left).toBe("748px");
    expect(wrapper.style.opacity).toBe("1");
    // Le wrapper est centré sur son point d'ancrage (centre du partbg).
    expect(wrapper.style.transform).toContain("translate(-50%, -50%)");
    // bgstorage derrière le crop.
    expect(wrapper.style.backgroundImage).toContain("black.webp");

    const innerImg = wrapper.querySelector(".mh-stage-partbg-img") as HTMLImageElement;
    expect(innerImg).not.toBeNull();
    // Image translatée de -srcLeft et scalée (zoom 100% = scale(1,1)).
    expect(innerImg.style.transform).toContain("translate(-542px");
    expect(innerImg.style.transform).toContain("scale(1, 1)");
    expect(innerImg.src).toContain("im02");
  });

  it("réconcilie un partbg (pas de recréation du wrapper)", async () => {
    const sig = () => new AbortController().signal;
    const cropSprite = (x: number, srcLeft: number) => ({
      id: "pb1",
      storage: "im02空",
      x,
      y: 0,
      z: 1000,
      opacity: 1,
      crop: { width: 522, height: 576, srcLeft, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
    });
    await renderer.apply(
      [{ kind: "scene", scene: { bg: null, sprites: [cropSprite(748, 542)], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    const w1 = root.querySelector(".mh-stage-partbg") as HTMLElement;
    const inner1 = w1.querySelector(".mh-stage-partbg-img") as HTMLImageElement;
    expect(w1.style.left).toBe("748px");
    expect(inner1.style.transform).toContain("translate(-542px");

    await renderer.apply(
      [{ kind: "scene", scene: { bg: null, sprites: [cropSprite(300, 100)], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    const w2 = root.querySelector(".mh-stage-partbg") as HTMLElement;
    const inner2 = w2.querySelector(".mh-stage-partbg-img") as HTMLImageElement;
    expect(w2).toBe(w1);
    expect(w2.style.left).toBe("300px");
    expect(inner2.style.transform).toContain("translate(-100px");
  });

  it("conserve le centrage d'un sprite zoomé/rotaté (transform composé)", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{ kind: "scene", scene: { bg: null, sprites: [{ id: "sp", storage: "sp", x: 512, y: 288, z: 1000, opacity: 1 }], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    await renderer.apply(
      [{
        kind: "animate",
        target: "sp",
        def: {
          storage: "sp",
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, center: 512, vcenter: 288, opacity: 1, zoomx: 1, zoomy: 1, rotate: 0 },
            { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, center: 512, vcenter: 288, opacity: 1, zoomx: 2, zoomy: 2, rotate: 90 },
          ],
        },
      }],
      { instant: true, signal: sig() },
    );
    const el = root.querySelector('[data-sprite-id="sp"]') as HTMLElement;
    expect(el.style.transform).toContain("translate(-50%, -50%)");
    expect(el.style.transform).toContain("scale(2, 2)");
    expect(el.style.transform).toContain("rotate(90deg)");
  });

  it("le mode instant produit le même transform final que la dernière keyframe WAAPI", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{ kind: "scene", scene: { bg: null, sprites: [{ id: "sp", storage: "sp", x: 512, y: 288, z: 1000, opacity: 1 }], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );

    const def = {
      storage: "sp",
      keyframes: [
        { time: 0, duration: 0, interp: "l" as const, easing: "linear" as const, accel: 0, center: 512, vcenter: 288, opacity: 1, zoomx: 1, zoomy: 1, rotate: 0 },
        { time: 100, duration: 0, interp: "l" as const, easing: "linear" as const, accel: 0, center: 600, vcenter: 300, opacity: 1, zoomx: 2, rotate: 45 },
      ],
    };

    const compiled = compileAction({ storage: "sp", keyframes: def.keyframes });
    expect(compiled).not.toBeNull();
    const waapiLast = compiled!.keyframes.wrapper.find((k) => k.offset === 1);
    expect(waapiLast).toBeDefined();

    await renderer.apply(
      [{ kind: "animate", target: "sp", def }],
      { instant: true, signal: sig() },
    );

    const el = root.querySelector('[data-sprite-id="sp"]') as HTMLElement;
    expect(el.style.transform).toBe(waapiLast!.transform);
    // Le carry-forward + helper garantissent rotate(45deg) et zoomx=2/zoomy=1.
    expect(el.style.transform).toContain("rotate(45deg)");
    expect(el.style.transform).toContain("scale(2, 1)");
  });

  it("les 3 sites partbg produisent le même transform inner avec srczoom ≠ 100", async () => {
    const sig = () => new AbortController().signal;
    const srcLeft = 542;
    const srcTop = 120;
    const srcZoomX = 150;
    const srcZoomY = 150;
    const expected = partbgInnerTransform({
      srcleft: srcLeft,
      srctop: srcTop,
      srczoomx: srcZoomX,
      srczoomy: srcZoomY,
    });

    // Site 1 : renderScene.
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{
            id: "pb-crop",
            storage: "im02",
            x: 748,
            y: 0,
            z: 1000,
            opacity: 1,
            crop: { width: 522, height: 576, srcLeft, srcTop, srcZoomX, srcZoomY },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    const inner1 = root.querySelector(".mh-stage-partbg-img") as HTMLElement;
    expect(inner1.style.transform).toBe(expected);

    // Site 2 : applyAnimationFinal (mode instant).
    await renderer.apply(
      [{
        kind: "animate",
        target: "pb-crop",
        def: {
          storage: "im02",
          isPartbg: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: srcLeft, srctop: srcTop, srczoomx: srcZoomX, srczoomy: srcZoomY },
            { time: 100, duration: 100, interp: "l", easing: "linear", accel: 0, srcleft: srcLeft, srctop: srcTop, srczoomx: srcZoomX, srczoomy: srcZoomY },
          ],
        },
      }],
      { instant: true, signal: sig() },
    );
    const inner2 = root.querySelector(".mh-stage-partbg-img") as HTMLElement;
    expect(inner2.style.transform).toBe(expected);

    // Site 3 : compileAction (dernière keyframe WAAPI).
    const compiled = compileAction({
      storage: "im02",
      isPartbg: true,
      keyframes: [
        { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: srcLeft, srctop: srcTop, srczoomx: srcZoomX, srczoomy: srcZoomY },
        { time: 100, duration: 100, interp: "l", easing: "linear", accel: 0, srcleft: srcLeft, srctop: srcTop, srczoomx: srcZoomX, srczoomy: srcZoomY },
      ],
    });
    expect(compiled).not.toBeNull();
    const last = compiled!.keyframes.inner.find((k) => k.offset === 1);
    expect(last).toBeDefined();
    expect(last!.transform).toBe(expected);
  });

  it("@partbgact instant applique aussi les props wrapper (center/vcenter/opacity)", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{
            id: "pb-wrapper",
            storage: "im02",
            x: 748,
            y: 0,
            z: 1000,
            opacity: 1,
            crop: { width: 522, height: 576, srcLeft: 0, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );

    await renderer.apply(
      [{
        kind: "animate",
        target: "pb-wrapper",
        def: {
          storage: "im02",
          id: "pb-wrapper",
          isPartbg: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, center: 748, vcenter: 0, opacity: 1, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100 },
            { time: 100, duration: 100, interp: "l", easing: "linear", accel: 0, center: 600, vcenter: 100, opacity: 0.5, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100 },
          ],
        },
      }],
      { instant: true, signal: sig() },
    );

    const wrapper = root.querySelector(".mh-stage-partbg") as HTMLElement;
    expect(wrapper.style.left).toBe("600px");
    expect(wrapper.style.top).toBe("100px");
    expect(wrapper.style.opacity).toBe("0.5");
    // Le centrage du wrapper est préservé.
    expect(wrapper.style.transform).toContain("translate(-50%, -50%)");
  });

  it("rend le ruby via <ruby><rt>", async () => {
    const events: RenderEvent[] = [
      { kind: "clearText" },
      { kind: "text", segments: [
        { text: "あいう" },
        { text: "お", ruby: "え" },
        { text: "。" },
      ] },
    ];
    await renderer.apply(events, { instant: true, signal: new AbortController().signal });
    const textEl = root.querySelector(".mh-stage-text") as HTMLElement;
    const ruby = textEl.querySelector("ruby");
    expect(ruby).not.toBeNull();
    // Le texte visible du <ruby> contient la base "お" et l'annotation "え".
    expect(textEl.textContent).toBe("あいうおえ。");
    const baseNode = ruby?.childNodes[0];
    expect(baseNode?.textContent).toBe("お");
    const rt = ruby?.querySelector("rt");
    expect(rt?.textContent).toBe("え");
  });

  it("affiche un fond dont le nom contient des parenthèses ou des espaces", async () => {
    for (const bg of ["bg01玄関-(雨)", "image avec espace", "山城01(近)"]) {
      await renderer.apply(
        [{ kind: "scene", scene: { bg, sprites: [], effect: null }, transition: { method: "none" } }],
        { instant: true, signal: new AbortController().signal },
      );
      const el = root.querySelector("#stage-bg") as HTMLElement;
      // Un url() sans guillemets serait rejeté par le navigateur : la propriété resterait vide.
      expect(el.style.backgroundImage, bg).not.toBe("");
      expect(el.style.backgroundImage).toContain("url(");
    }
  });

  it("pose le ruby une seule fois sur une base de plusieurs caractères", async () => {
    await renderer.apply([
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "中腹", ruby: "ちゅうふく" }, { text: "に" }] },
    ], { instant: true, signal: new AbortController().signal });
    const textEl = root.querySelector(".mh-stage-text") as HTMLElement;
    const rubies = textEl.querySelectorAll("ruby");
    expect(rubies).toHaveLength(1);
    expect(rubies[0]?.childNodes[0]?.textContent).toBe("中腹");
    expect(rubies[0]?.querySelector("rt")?.textContent).toBe("ちゅうふく");
    expect(textEl.textContent).toBe("中腹ちゅうふくに");
  });

  it("garde séparés deux ruby consécutifs de segments différents", async () => {
    await renderer.apply([
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "山", ruby: "やま" }, { text: "川", ruby: "かわ" }] },
    ], { instant: true, signal: new AbortController().signal });
    const rubies = root.querySelectorAll(".mh-stage-text ruby");
    expect(rubies).toHaveLength(2);
    expect(rubies[0]?.querySelector("rt")?.textContent).toBe("やま");
    expect(rubies[1]?.querySelector("rt")?.textContent).toBe("かわ");
  });

  it("applique le style du segment à tout le groupe ruby", async () => {
    await renderer.apply([
      { kind: "clearText" },
      { kind: "text", segments: [{ text: "中腹", ruby: "ちゅうふく", style: { bold: true } }] },
    ], { instant: true, signal: new AbortController().signal });
    const ruby = root.querySelector(".mh-stage-text ruby") as HTMLElement;
    expect(ruby.style.fontWeight).toBe("bold");
    expect(root.querySelectorAll(".mh-stage-text ruby")).toHaveLength(1);
  });

  it("ne re-type pas le texte déjà révélé après un nouveau segment", async () => {
    // 1ʳᵐᵉ apply : texte court, instant.
    await renderer.apply(
      [{ kind: "text", segments: [{ text: "abc" }] }],
      { instant: true, signal: new AbortController().signal },
    );
    expect(renderer.typedUnitsExposed()).toBe(3);

    // 2ᵉ apply : nouveau segment. Le typewriter doit continuer depuis 3,
    // pas re-type depuis 0. On vérifie via un instant apply que typedUnits
    // reste cumulatif (5) et le texte est "abcde".
    await renderer.apply(
      [{ kind: "text", segments: [{ text: "de" }] }],
      { instant: true, signal: new AbortController().signal },
    );
    const textEl = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(textEl.textContent).toBe("abcde");
    expect(renderer.typedUnitsExposed()).toBe(5);
  });

  it("clearText reset typedUnits", async () => {
    await renderer.apply(
      [{ kind: "text", segments: [{ text: "hello" }] }],
      { instant: true, signal: new AbortController().signal },
    );
    expect(renderer.typedUnitsExposed()).toBe(5);
    await renderer.apply(
      [{ kind: "clearText" }, { kind: "text", segments: [{ text: "x" }] }],
      { instant: true, signal: new AbortController().signal },
    );
    expect(renderer.typedUnitsExposed()).toBe(1);
    const textEl = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(textEl.textContent).toBe("x");
  });

  it("@partbgact instant : applique l'état final sur l'image interne", async () => {
    const sig = () => new AbortController().signal;
    // 1. Pose un partbg initial (srcleft=542).
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{
            id: "im02",
            storage: "im02",
            x: 748, y: 0, z: 1000, opacity: 1,
            crop: { width: 522, height: 576, srcLeft: 542, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    const inner1 = root.querySelector(".mh-stage-partbg-img") as HTMLElement;
    expect(inner1.style.transform).toContain("translate(-542px");

    // 2. @partbgact instant : applique l'état final (srcleft=100 → translate(-100px)).
    await renderer.apply(
      [{
        kind: "animate",
        target: "im02",
        def: {
          storage: "im02",
          isPartbg: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100 },
            { time: 30000, duration: 30000, interp: "l", easing: "linear", accel: 0, srcleft: 100, srctop: 0, srczoomx: 100, srczoomy: 100 },
          ],
        },
      }],
      { instant: true, signal: sig() },
    );
    const inner2 = root.querySelector(".mh-stage-partbg-img") as HTMLElement;
    expect(inner2.style.transform).toContain("translate(-100px");
  });

  it("@partbgact non-instant : démarre l'animation et résout la promise", async () => {
    const sig = () => new AbortController().signal;
    // Pose un partbg.
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{
            id: "im02",
            storage: "im02",
            x: 748, y: 0, z: 1000, opacity: 1,
            crop: { width: 522, height: 576, srcLeft: 542, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
          }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    // Lance l'animation (durée courte pour le test).
    await renderer.apply(
      [{
        kind: "animate",
        target: "im02",
        def: {
          storage: "im02",
          isPartbg: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100 },
            { time: 100, duration: 100, interp: "l", easing: "linear", accel: 0, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100 },
          ],
        },
      }],
      { instant: false, signal: sig() },
    );
    // L'animation doit être terminée (promise résolue). Pas de crash.
    expect(root.querySelector(".mh-stage-partbg-img")).not.toBeNull();
  });

  it("waitFor('animation') sans cible attend toutes les animations non-loop", async () => {
    vi.useFakeTimers();
    const sig = () => new AbortController().signal;
    // Crée les sprites avant d'animer.
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [
            { id: "a", storage: "a", x: 0, y: 0, z: 1000, opacity: 1 },
            { id: "b", storage: "b", x: 0, y: 0, z: 1001, opacity: 1 },
          ],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );

    // Lance deux animations non-loop (durée 100 ms).
    await renderer.apply(
      [
        {
          kind: "animate",
          target: "a",
          def: {
            storage: "a",
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1, center: 0 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1, center: 100 },
            ],
          },
        },
        {
          kind: "animate",
          target: "b",
          def: {
            storage: "b",
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1, center: 0 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1, center: 100 },
            ],
          },
        },
      ],
      { instant: false, signal: sig() },
    );

    const waitPromise = renderer.waitFor("animation", undefined, sig());
    let resolved = false;
    waitPromise.then(() => { resolved = true; });

    // Immédiatement, la promise ne devrait pas être résolue.
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Avance le temps jusqu'à la fin des animations.
    vi.advanceTimersByTime(100);
    await waitPromise;
    expect(resolved).toBe(true);

    vi.useRealTimers();
  });

  it("waitFor('animation') sans cible ignore les loops", async () => {
    vi.useFakeTimers();
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{ id: "loopA", storage: "loopA", x: 0, y: 0, z: 1000, opacity: 1 }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );

    await renderer.apply(
      [{
        kind: "animate",
        target: "loopA",
        def: {
          storage: "loopA",
          loop: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 1 },
            { time: 50, duration: 0, interp: "l", easing: "linear", accel: 0, opacity: 0 },
          ],
        },
      }],
      { instant: false, signal: sig() },
    );

    const waitPromise = renderer.waitFor("animation", undefined, sig());
    // Les loops ne bloquent pas : la promise est déjà résolue (ou rejetée
    // immédiatement si aucune animation non-loop).
    await waitPromise;
    // Avance le temps : la loop tourne sans fin sans bloquer waitFor.
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
  });

  it("clear() retire tous les sprites du DOM (pas de ghost)", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [
            { id: "a", storage: "a", x: 0, y: 0, z: 1000, opacity: 1 },
            { id: "b", storage: "b", x: 0, y: 0, z: 1001, opacity: 1 },
          ],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    expect(root.querySelectorAll(".mh-stage-sprite").length).toBe(2);

    renderer.clear();
    expect(root.querySelectorAll(".mh-stage-sprite").length).toBe(0);
  });

  it("restore() retire les anciens sprites du DOM avant de rendre le snapshot", async () => {
    const sig = () => new AbortController().signal;
    await renderer.apply(
      [{
        kind: "scene",
        scene: {
          bg: null,
          sprites: [{ id: "old", storage: "old", x: 0, y: 0, z: 1000, opacity: 1 }],
          effect: null,
        },
        transition: { method: "none" },
      }],
      { instant: true, signal: sig() },
    );
    expect(root.querySelectorAll(".mh-stage-sprite").length).toBe(1);

    const snapshot: StageSnapshot = {
      scene: { bg: null, sprites: [], effect: null },
      text: [],
      textbox: { visible: true, frame: true },
      staffroll: null,
    };
    await renderer.restore(snapshot, sig());
    expect(root.querySelectorAll(".mh-stage-sprite").length).toBe(0);
  });

  it("WAAPI path: animation with only discrete props falls back to a timer and resolves", async () => {
    await withMockAnimate(async ({ getAnims }) => {
      vi.useFakeTimers();
      const sig = () => new AbortController().signal;
      await renderer.apply(
        [{
          kind: "scene",
          scene: { bg: null, sprites: [{ id: "a", storage: "a", x: 0, y: 0, z: 1000, opacity: 1 }], effect: null },
          transition: { method: "none" },
        }],
        { instant: true, signal: sig() },
      );

      const animatePromise = renderer.apply(
        [{
          kind: "animate",
          target: "a",
          def: {
            storage: "a",
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, visible: false },
            ],
          },
        }],
        { instant: false, signal: sig() },
      );

      // No continuous keyframes => no WAAPI animation should be created.
      expect(getAnims().length).toBe(0);

      const waitPromise = renderer.waitFor("animation", "a", sig());
      vi.advanceTimersByTime(100);
      await waitPromise;
      await animatePromise;
      vi.useRealTimers();
    });
  });

  it("WAAPI path: stopAnimation cancels both wrapper and inner partbg animations", async () => {
    await withMockAnimate(async ({ getAnims }) => {
      const sig = () => new AbortController().signal;
      await renderer.apply(
        [{
          kind: "scene",
          scene: {
            bg: null,
            sprites: [{
              id: "im02",
              storage: "im02",
              x: 748, y: 0, z: 1000, opacity: 1,
              crop: { width: 522, height: 576, srcLeft: 542, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
            }],
            effect: null,
          },
          transition: { method: "none" },
        }],
        { instant: true, signal: sig() },
      );

      await renderer.apply(
        [{
          kind: "animate",
          target: "im02",
          def: {
            storage: "im02",
            isPartbg: true,
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100, opacity: 1 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100, opacity: 0.5 },
            ],
          },
        }],
        { instant: false, signal: sig() },
      );

      expect(getAnims().length).toBe(2);
      const [wrapper, inner] = getAnims();

      await renderer.apply(
        [{ kind: "stopAnimation", target: "im02" }],
        { instant: true, signal: sig() },
      );

      expect(wrapper.commitStyles).toHaveBeenCalledTimes(1);
      expect(wrapper.cancel).toHaveBeenCalledTimes(1);
      expect(inner.commitStyles).toHaveBeenCalledTimes(1);
      expect(inner.cancel).toHaveBeenCalledTimes(1);
    });
  });

  it("WAAPI path: hurry finishes both wrapper and inner partbg animations", async () => {
    await withMockAnimate(async ({ getAnims }) => {
      const sig = () => new AbortController().signal;
      await renderer.apply(
        [{
          kind: "scene",
          scene: {
            bg: null,
            sprites: [{
              id: "im02",
              storage: "im02",
              x: 748, y: 0, z: 1000, opacity: 1,
              crop: { width: 522, height: 576, srcLeft: 542, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
            }],
            effect: null,
          },
          transition: { method: "none" },
        }],
        { instant: true, signal: sig() },
      );

      await renderer.apply(
        [{
          kind: "animate",
          target: "im02",
          def: {
            storage: "im02",
            isPartbg: true,
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100, opacity: 1 },
              { time: 100, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 0, srctop: 0, srczoomx: 100, srczoomy: 100, opacity: 0.5 },
            ],
          },
        }],
        { instant: false, signal: sig() },
      );

      expect(getAnims().length).toBe(2);
      const [wrapper, inner] = getAnims();

      renderer.hurry();

      expect(wrapper.finish).toHaveBeenCalledTimes(1);
      expect(inner.finish).toHaveBeenCalledTimes(1);
    });
  });

  it("injected CSS does not apply a transition to .mh-stage-sprite", () => {
    const style = document.head.querySelector("style")?.textContent ?? "";
    const match = style.match(/\.mh-stage-sprite\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain("transition");
  });
});
