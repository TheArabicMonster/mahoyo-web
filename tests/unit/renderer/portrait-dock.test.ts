/**
 * Renderer — zone de texte dédiée sous la scène en portrait (#210, décision propriétaire 4).
 *
 * En portrait, la boîte de texte quitte `.mh-stage` (16:9) et passe dans `#portrait-text-dock`
 * sous la scène, à taille réelle ; en paysage elle revient dans la scène et rien ne change.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";

function setWindowSize(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

describe("DomStageRenderer — dock portrait (#210)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer> | null = null;

  beforeEach(() => {
    setWindowSize(390, 844);
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    renderer?.dispose();
    renderer = null;
    root.remove();
    setWindowSize(1024, 768);
  });

  it("en portrait : la boîte de texte est déplacée dans le dock sous la scène", () => {
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
    const dock = root.querySelector<HTMLElement>("#portrait-text-dock")!;
    const textbox = root.querySelector<HTMLElement>("#textbox")!;
    expect(textbox.parentElement).toBe(dock);
    expect(root.dataset.layout).toBe("portrait");
    // La scène 1024×576 est réduite à la largeur réelle (390 px).
    const stage = root.querySelector<HTMLElement>(".mh-stage")!;
    expect(stage.style.transform).toBe(`scale(${390 / 1024})`);
    // Le dock commence sous la scène 16:9 (390 × 0,5625 = 219,4 px).
    expect(dock.style.top).toBe(`${576 * (390 / 1024)}px`);
  });

  it("en paysage : la boîte de texte reste dans la scène et le dock est masqué", () => {
    setWindowSize(1280, 720);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
    const textbox = root.querySelector<HTMLElement>("#textbox")!;
    expect(textbox.parentElement?.classList.contains("mh-stage")).toBe(true);
    expect(root.dataset.layout).toBeUndefined();
    const dock = root.querySelector<HTMLElement>("#portrait-text-dock")!;
    expect(dock.style.display).toBe("none");
  });

  it("un redimensionnement vers le paysage ramène la boîte dans la scène", () => {
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
    const textbox = root.querySelector<HTMLElement>("#textbox")!;
    expect(textbox.parentElement?.id).toBe("portrait-text-dock");

    setWindowSize(1280, 720);
    window.dispatchEvent(new Event("resize"));
    expect(textbox.parentElement?.classList.contains("mh-stage")).toBe(true);
    expect(root.dataset.layout).toBeUndefined();
  });
});
