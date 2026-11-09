import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDomStageRenderer, STAGE_SCALE } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from "@/renderer/types.js";

/**
 * Effets d'écran plugin (#281) au rendu : `screenShake` (`@shake`/`@swing`), `noiseAct`
 * (`@noiseact`) et `focusline` (`@focusline`). jsdom ne fournit pas de canvas 2D : on vérifie
 * l'élément et ses styles, pas les pixels ; les animations sont observées via leurs styles CSS.
 */
const display = (over: Partial<DisplaySettings> = {}): DisplaySettings => ({
  ...DEFAULT_DISPLAY_SETTINGS,
  ...over,
});
const sig = () => new AbortController().signal;
const reducedMotion = (matches: boolean) =>
  ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

describe("DomStageRenderer — effets plugin (#281)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const container = () => root.querySelector(".mh-stage") as HTMLElement;

  beforeEach(() => {
    // jsdom ne fournit pas de canvas 2D : on évite le message « not implemented » du contexte.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
  });
  afterEach(() => {
    renderer.dispose();
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("@shake : oscillation avec l'agrandissement 1.25 conservé, arrêt propre", async () => {
    await renderer.apply(
      [{ kind: "screenShake", shake: { mode: "shake", vmax: 3, hmax: 2, cycle: 100, time: null } }],
      { instant: false, signal: sig() },
    );
    expect(container().style.transform).toMatch(
      new RegExp(`^translate\\(-?[\\d.e-]+px, -?[\\d.e-]+px\\) scale\\(${STAGE_SCALE}\\)$`),
    );
    await renderer.apply([{ kind: "screenShake", shake: null }], { instant: false, signal: sig() });
    expect(container().style.transform).toBe("");
  });

  it("@swing : oscillation aléatoire, bornes respectées entre deux ticks", async () => {
    await renderer.apply(
      [
        {
          kind: "screenShake",
          shake: { mode: "swing", minCycle: 100, maxCycle: 200, minVibration: 2, maxVibration: 4, rate: 1, time: null },
        },
      ],
      { instant: false, signal: sig() },
    );
    expect(container().style.transform).toMatch(/scale\(1\.25\)$/);
    await renderer.apply([{ kind: "screenShake", shake: null }], { instant: false, signal: sig() });
    expect(container().style.transform).toBe("");
  });

  it("secousses désactivées par « effets spéciaux » et par prefers-reduced-motion", async () => {
    renderer.setSettings(display({ specialEffects: false }));
    await renderer.apply(
      [{ kind: "screenShake", shake: { mode: "shake", vmax: 3, hmax: 2, cycle: 100, time: null } }],
      { instant: false, signal: sig() },
    );
    expect(container().style.transform).toBe("");

    renderer.setSettings(display({ specialEffects: true }));
    vi.stubGlobal("matchMedia", (query: string) => reducedMotion(query.includes("reduced-motion")));
    await renderer.apply(
      [{ kind: "screenShake", shake: { mode: "shake", vmax: 3, hmax: 2, cycle: 100, time: null } }],
      { instant: false, signal: sig() },
    );
    expect(container().style.transform).toBe("");
  });

  it("@noiseact : surcouche de bruit animée (fondu, monocro)", async () => {
    await renderer.apply([{ kind: "noiseAct", opacity: 50, monocro: true, from: 0, time: 250 }], {
      instant: false,
      signal: sig(),
    });
    const noise = root.querySelector<HTMLElement>(".mh-stage-noise")!;
    expect(noise).not.toBeNull();
    expect(noise.style.transition).toContain("250ms");
    expect(Number(noise.style.opacity)).toBeCloseTo(50 / 255, 3);
    expect(noise.style.filter).toBe("grayscale(100%)");
  });

  it("@noiseact instantané (time=0) : pas de transition", async () => {
    await renderer.apply([{ kind: "noiseAct", opacity: 128, monocro: false, from: 0, time: 0 }], {
      instant: false,
      signal: sig(),
    });
    const noise = root.querySelector<HTMLElement>(".mh-stage-noise")!;
    expect(noise.style.transition).toBe("none");
    expect(noise.style.filter).toBe("");
  });

  it("@focusline : canvas de lignes radiales, apparition puis retrait", async () => {
    vi.useFakeTimers();
    const effect = {
      kind: "focusline" as const,
      cx: 512,
      cy: 288,
      minLength: 200,
      maxLength: 421,
      minLines: 25,
      maxLines: 50,
      appear: 800,
      color: "#ffffff",
      opacity: 80 / 255,
    };
    await renderer.apply([{ kind: "effect", effect }], { instant: false, signal: sig() });
    const canvas = root.querySelector<HTMLCanvasElement>(".mh-stage-focusline")!;
    expect(canvas).not.toBeNull();
    expect(canvas.dataset.effect).toBe("focusline");
    expect(canvas.style.transition).toContain("800ms");
    expect(Number(canvas.style.opacity)).toBe(0);
    vi.advanceTimersByTime(0);
    expect(Number(canvas.style.opacity)).toBeCloseTo(80 / 255, 3);
    await renderer.apply([{ kind: "effect", effect: null }], { instant: false, signal: sig() });
    expect(root.querySelector(".mh-stage-focusline")).toBeNull();
  });

  it("@focusline sous prefers-reduced-motion : lignes statiques, sans fondu", async () => {
    vi.stubGlobal("matchMedia", (query: string) => reducedMotion(query.includes("reduced-motion")));
    const effect = {
      kind: "focusline" as const,
      cx: 100,
      cy: 200,
      minLength: 50,
      maxLength: 100,
      minLines: 4,
      maxLines: 8,
      appear: 2000,
      color: "#cfeff0",
      opacity: 0.5,
    };
    await renderer.apply([{ kind: "effect", effect }], { instant: false, signal: sig() });
    const canvas = root.querySelector<HTMLCanvasElement>(".mh-stage-focusline")!;
    expect(canvas.style.transition).toBe("none");
    expect(Number(canvas.style.opacity)).toBeCloseTo(0.5, 3);
  });
});
