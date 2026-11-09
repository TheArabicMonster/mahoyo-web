/**
 * Rendu des attributs d'apparence (#252) : `type=` (mix-blend-mode), `effect=` (filtres CSS/SVG),
 * `blur`, `brightness`, `contrast`, y compris les changements discrets des `@fgact`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent, SceneState } from "@/kag/events.js";
import type { EnvColorTable } from "@/kag/envcolor.js";

describe("DomStageRenderer — apparence des calques (#252)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const sig = () => new AbortController().signal;

  const show = (scene: Partial<SceneState>) =>
    renderer.apply(
      [
        {
          kind: "scene",
          scene: { bg: null, sprites: [], effect: null, ...scene },
          transition: { method: "none" },
        } as RenderEvent,
      ],
      { instant: true, signal: sig() },
    );

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
  });

  afterEach(() => {
    renderer.dispose();
    root.remove();
    vi.useRealTimers();
  });

  it("applique mono<rrggbb> (aplat SVG), luminosité/contraste et flou au sprite", async () => {
    await show({
      sprites: [
        {
          id: "l1",
          storage: "perso",
          x: 512,
          y: 288,
          z: 1600,
          opacity: 1,
          type: 16,
          effect: "monoff1313",
          brightness: -20,
          contrast: 40,
          blurx: 8,
          blury: 8,
        },
      ],
    });
    const img = root.querySelector(".mh-stage-sprite") as HTMLImageElement;
    // mono<rrggbb> : filtre SVG (feFlood) + luminosité/contraste (feComponentTransfer) + flou CSS.
    expect(img.style.filter).toContain("#mh-filter-");
    expect(img.style.filter).toContain("blur(");
    // type=16 (ltPsMultiplicative) → multiply.
    expect(img.style.mixBlendMode).toBe("multiply");
    const flood = root.querySelector("feFlood");
    expect(flood?.getAttribute("flood-color")).toBe("#ff1313");
    const blurFn = root.querySelector("feFuncR");
    expect(blurFn?.getAttribute("slope")).toBeTruthy();
  });

  it("applique grayscale/invert et les modes de fusion au sprite", async () => {
    await show({
      sprites: [
        { id: "l1", storage: "a", x: 1, y: 2, z: 10, opacity: 1, effect: "monocro", type: 17 },
        { id: "l2", storage: "b", x: 3, y: 4, z: 20, opacity: 1, effect: "nega", type: 19 },
        { id: "l3", storage: "c", x: 5, y: 6, z: 30, opacity: 1, effect: "sepia", type: 13 },
      ],
    });
    const imgs = [...root.querySelectorAll(".mh-stage-sprite")] as HTMLImageElement[];
    const bySrc = (needle: string) => imgs.find((img) => img.src.includes(needle))!;
    expect(bySrc("a.").style.filter).toBe("grayscale(1)");
    expect(bySrc("a.").style.mixBlendMode).toBe("screen");
    expect(bySrc("b.").style.filter).toBe("invert(1)");
    expect(bySrc("b.").style.mixBlendMode).toBe("hard-light");
    expect(bySrc("c.").style.filter).toBe("sepia(1)");
    expect(bySrc("c.").style.mixBlendMode).toBe("normal");
  });

  it("n'applique pas de mode de fusion pour un type sans équivalent (ltOpaque/ltSubtractive)", async () => {
    await show({
      sprites: [
        { id: "l1", storage: "a", x: 1, y: 2, z: 10, opacity: 1, effect: "nega", type: 1 },
        { id: "l2", storage: "b", x: 3, y: 4, z: 20, opacity: 1, type: 4 },
      ],
    });
    const imgs = [...root.querySelectorAll(".mh-stage-sprite")] as HTMLImageElement[];
    for (const img of imgs) expect(img.style.mixBlendMode).toBe("");
  });

  it("applique l'apparence au fond (fond + filtre)", async () => {
    await show({ bg: "pano", bgEffect: "monocro", bgBlurX: 8, bgBlurY: 8, bgBrightness: -20, bgContrast: 40 });
    const bg = root.querySelector("#stage-bg") as HTMLElement;
    expect(bg.style.filter).toContain("grayscale(1)");
    expect(bg.style.filter).toContain("#mh-filter-");
    expect(bg.style.filter).toContain("blur(");
  });

  it("applique l'apparence au wrapper d'un partbg", async () => {
    await show({
      sprites: [
        {
          id: "pb1",
          storage: "pane",
          x: 512,
          y: 288,
          z: 1000,
          opacity: 1,
          effect: "monocro",
          type: 5,
          crop: { width: 420, height: 576, srcLeft: 0, srcTop: 0, srcZoomX: 100, srcZoomY: 100 },
        },
      ],
    });
    const wrapper = root.querySelector(".mh-stage-partbg") as HTMLElement;
    expect(wrapper.style.filter).toBe("grayscale(1)");
    expect(wrapper.style.mixBlendMode).toBe("multiply");
  });

  it("retire filtre et mode de fusion quand l'apparence disparaît", async () => {
    await show({
      sprites: [{ id: "l1", storage: "a", x: 1, y: 2, z: 10, opacity: 1, effect: "monocro", type: 11 }],
    });
    const img = root.querySelector(".mh-stage-sprite") as HTMLImageElement;
    expect(img.style.filter).toBe("grayscale(1)");
    expect(img.style.mixBlendMode).toBe("screen");
    await show({ sprites: [{ id: "l1", storage: "a", x: 1, y: 2, z: 10, opacity: 1 }] });
    expect(img.style.filter).toBe("");
    expect(img.style.mixBlendMode).toBe("");
  });

  it("un effet d'ambiance du jeu (envcolor.ksc absent) n'est pas appliqué", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await show({
      sprites: [{ id: "l1", storage: "a", x: 1, y: 2, z: 10, opacity: 1, effect: "屋外深夜" }],
      bg: "b",
      bgEffect: "mh屋内曇り",
    });
    const img = root.querySelector(".mh-stage-sprite") as HTMLImageElement;
    expect(img.style.filter).toBe("");
    expect(warn).toHaveBeenCalledTimes(2);
    const warned = warn.mock.calls.map((c) => String(c[0])).join(" ");
    expect(warned).toContain("屋外深夜");
    expect(warned).toContain("mh屋内曇り");
  });

  it("applique un effet d'ambiance installé (envcolor.ksc) : gamma, calques de couleur, sans avertissement", async () => {
    const envEffects: EnvColorTable = new Map([
      [
        "屋外深夜",
        {
          rGamma: 0.74,
          rFloor: 0,
          rCeil: 255,
          gGamma: 0.8,
          gFloor: 0,
          gCeil: 255,
          bGamma: 1,
          bFloor: 0,
          bCeil: 255,
          grayscale: false,
          blends: [{ r: 22, g: 75, b: 90, alpha: 31, layerType: 2 }],
        },
      ],
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const envRoot = document.createElement("div");
    document.body.appendChild(envRoot);
    const envRenderer = createDomStageRenderer({ resolver: createAssetResolver(), envEffects });
    envRenderer.mount(envRoot);
    try {
      await envRenderer.apply(
        [
          {
            kind: "scene",
            scene: {
              bg: null,
              effect: null,
              sprites: [{ id: "l1", storage: "a", x: 1, y: 2, z: 10, opacity: 1, effect: "屋外深夜" }],
            },
            transition: { method: "none" },
          } as RenderEvent,
        ],
        { instant: true, signal: sig() },
      );
      const img = envRoot.querySelector(".mh-stage-sprite") as HTMLImageElement;
      expect(img.style.filter).toContain("#mh-filter-");
      // Gamma par canal : feFuncR amplitude (255-0)/255 = 1, exposant 1/0.74.
      const funcR = envRoot.querySelector("feFuncR") as SVGFEFuncRElement;
      expect(funcR.getAttribute("type")).toBe("gamma");
      expect(funcR.getAttribute("amplitude")).toBe("1");
      expect(Number(funcR.getAttribute("exponent"))).toBeCloseTo(1 / 0.74, 6);
      // Calque de couleur : flood rgb(22,75,90) à 31/255, mélangé en normal.
      const flood = envRoot.querySelector("feFlood") as SVGFEFloodElement;
      expect(flood.getAttribute("flood-color")).toBe("rgb(22, 75, 90)");
      expect(Number(flood.getAttribute("flood-opacity"))).toBeCloseTo(31 / 255, 6);
      const blend = envRoot.querySelector("feBlend") as SVGFEBlendElement;
      expect(blend.getAttribute("mode")).toBe("normal");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      envRenderer.dispose();
      envRoot.remove();
    }
  });

  it("les changements discrets d'une animation (@fgact) mettent à jour le filtre", async () => {
    vi.useFakeTimers();
    await renderer.apply(
      [
        {
          kind: "scene",
          scene: {
            bg: null,
            effect: null,
            sprites: [{ id: "l1", storage: "a", x: 1, y: 2, z: 10, opacity: 1, effect: "monocro" }],
          },
          transition: { method: "none" },
        } as RenderEvent,
        {
          kind: "animate",
          target: "l1",
          def: {
            storage: "a",
            loop: false,
            keyframes: [
              { time: 0, duration: 0, interp: "l", easing: "linear", accel: 0, effect: "monoff1313" },
              { time: 300, duration: 300, interp: "l", easing: "linear", accel: 0, effect: "nega" },
            ],
          },
        } as RenderEvent,
      ],
      { instant: false, signal: sig() },
    );
    const img = root.querySelector(".mh-stage-sprite") as HTMLImageElement;
    expect(img.style.filter).toContain("#mh-filter-"); // mono ff1313
    vi.advanceTimersByTime(350);
    expect(img.style.filter).toBe("invert(1)"); // -effect=nega appliqué à 300 ms
  });
});
