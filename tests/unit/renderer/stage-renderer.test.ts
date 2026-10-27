import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent, StageSnapshot } from "@/kag/events.js";

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
    // bgstorage derrière le crop.
    expect(wrapper.style.backgroundImage).toContain("black.webp");

    const innerImg = wrapper.querySelector(".mh-stage-partbg-img") as HTMLImageElement;
    expect(innerImg).not.toBeNull();
    // Image translatée de -srcLeft et scalée (zoom 100% = scale(1,1)).
    expect(innerImg.style.transform).toContain("translate(542px");
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
    expect(inner1.style.transform).toContain("translate(542px");

    await renderer.apply(
      [{ kind: "scene", scene: { bg: null, sprites: [cropSprite(300, 100)], effect: null }, transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    const w2 = root.querySelector(".mh-stage-partbg") as HTMLElement;
    const inner2 = w2.querySelector(".mh-stage-partbg-img") as HTMLImageElement;
    expect(w2).toBe(w1);
    expect(w2.style.left).toBe("300px");
    expect(inner2.style.transform).toContain("translate(100px");
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
    expect(inner1.style.transform).toContain("translate(542px");

    // 2. @partbgact instant : applique l'état final (srcleft=-100).
    await renderer.apply(
      [{
        kind: "animate",
        target: "im02",
        def: {
          storage: "im02",
          isPartbg: true,
          keyframes: [
            { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, srcleft: 542, srctop: 0, srczoomx: 100, srczoomy: 100 },
            { time: 30000, duration: 30000, interp: "l", easing: "linear", accel: 0, srcleft: -100, srctop: 0, srczoomx: 100, srczoomy: 100 },
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
});
