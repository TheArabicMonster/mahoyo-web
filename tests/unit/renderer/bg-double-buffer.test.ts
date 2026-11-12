/**
 * Fond en <img> double tampon (PERF-07 / #373) : deux calques, placement identique au
 * background-image, ancien fond conservé pendant une transition, instantané non bloqué.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent, SceneState } from "@/kag/events.js";

const layers = (root: HTMLElement): HTMLImageElement[] => [...root.querySelectorAll<HTMLImageElement>("#stage-bg > .mh-stage-bg-layer")];
const visible = (root: HTMLElement): HTMLImageElement | null => layers(root).find((l) => l.style.display !== "none") ?? null;
const sceneEvent = (scene: Partial<SceneState> & { bg: string | null }, transition: { method: "none" | "crossfade"; time?: number } = { method: "none" }): RenderEvent =>
  ({ kind: "scene", scene: { sprites: [], effect: null, ...scene }, transition: { method: transition.method, time: transition.time ?? 0 } } as RenderEvent);

describe("DomStageRenderer — fond double tampon (#373)", () => {
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

  it("monte exactement deux calques <img> et expose whenReady", () => {
    expect(layers(root)).toHaveLength(2);
    expect(typeof renderer.whenReady).toBe("function");
  });

  it("affiche le fond normal dans un calque, plus de background-image", async () => {
    await renderer.apply([sceneEvent({ bg: "fond", bgLeft: 12, bgTop: 34 })], { instant: true, signal: new AbortController().signal });
    const bg = root.querySelector<HTMLElement>("#stage-bg")!;
    expect(bg.style.backgroundImage).toBe("none");
    const layer = visible(root)!;
    expect(layer.src).toContain("fond");
    expect(layer.style.objectPosition).toBe("12px 34px");
    // L'autre calque est masqué mais reste dans le DOM (double tampon).
    expect(layers(root).filter((l) => l.style.display === "none")).toHaveLength(1);
  });

  it("transition : prépare le nouveau calque, garde l'ancien dans l'overlay puis nettoie", async () => {
    await renderer.apply([sceneEvent({ bg: "un" })], { instant: true, signal: new AbortController().signal });
    const first = visible(root)!;
    await renderer.apply([sceneEvent({ bg: "deux" }, { method: "crossfade", time: 1000 })], { instant: false, signal: new AbortController().signal });
    // Le nouveau fond est dans un calque <img>, l'ancien passe dans l'overlay temporaire.
    expect(visible(root)!.src).toContain("deux");
    const overlay = root.querySelector<HTMLElement>(".mh-stage-bg-overlay")!;
    expect(overlay).not.toBeNull();
    expect(overlay.style.backgroundImage).toContain(first.src.split("/").pop()!.replace(/\.webp$/, ""));
    renderer.hurry();
    expect(root.querySelector(".mh-stage-bg-overlay")).toBeNull();
  });

  it("instantané : ne bloque pas et remplace le fond sans overlay", async () => {
    await renderer.apply([sceneEvent({ bg: "un" })], { instant: true, signal: new AbortController().signal });
    await renderer.apply([sceneEvent({ bg: "trois" })], { instant: true, signal: new AbortController().signal });
    expect(visible(root)!.src).toContain("trois");
    expect(root.querySelector(".mh-stage-bg-overlay")).toBeNull();
  });

  it("whenReady résout sans fond (aucune attente)", async () => {
    await renderer.apply([sceneEvent({ bg: null })], { instant: true, signal: new AbortController().signal });
    await expect(renderer.whenReady()).resolves.toBeUndefined();
  });
});
