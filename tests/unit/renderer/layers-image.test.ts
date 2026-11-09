import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { SceneState } from "@/kag/events.js";

/**
 * Rendu des calques image (#283) : visibilité (`@layopt visible=0`) et suivi des panoramiques
 * du fond (`@bindbg`). Les positions logiques ne changent pas ; le décalage de `@bindbg` est
 * visuel (propriété CSS `translate`), ce que l'on vérifie sur les éléments DOM.
 */
const sig = () => new AbortController().signal;
const scene = (over: Partial<SceneState> = {}): SceneState => ({
  bg: "black",
  bgLeft: 0,
  bgTop: 0,
  sprites: [{ id: "a", storage: "sprite", x: 100, y: 200, z: 1000, opacity: 1 }],
  effect: null,
  ...over,
});

describe("DomStageRenderer — calques image (#283)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const sprite = () => root.querySelector<HTMLElement>('[data-sprite-id="a"]')!;

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

  it("@bindbg : pendant un panoramique, les calques suivent le fond (translate du delta)", async () => {
    await renderer.apply([{ kind: "scene", scene: scene({ bindChildren: true }), transition: { method: "none" } }], {
      instant: true,
      signal: sig(),
    });
    await renderer.apply([{ kind: "bgMove", left: 50, top: 10, time: 0 }], { instant: false, signal: sig() });
    expect(sprite().style.getPropertyValue("translate")).toBe("50px 10px");
    // Un deuxième panoramique cumule le décalage.
    await renderer.apply([{ kind: "bgMove", left: 80, top: 10, time: 0 }], { instant: false, signal: sig() });
    expect(sprite().style.getPropertyValue("translate")).toBe("80px 10px");
  });

  it("sans @bindbg, les calques ne suivent pas le fond", async () => {
    await renderer.apply([{ kind: "scene", scene: scene(), transition: { method: "none" } }], {
      instant: true,
      signal: sig(),
    });
    await renderer.apply([{ kind: "bgMove", left: 50, top: 10, time: 0 }], { instant: false, signal: sig() });
    expect(sprite().style.getPropertyValue("translate")).toBe("");
  });

  it("un nouveau fond rebase les positions : le décalage @bindbg est réinitialisé", async () => {
    await renderer.apply([{ kind: "scene", scene: scene({ bindChildren: true }), transition: { method: "none" } }], {
      instant: true,
      signal: sig(),
    });
    await renderer.apply([{ kind: "bgMove", left: 50, top: 10, time: 0 }], { instant: false, signal: sig() });
    expect(sprite().style.getPropertyValue("translate")).toBe("50px 10px");
    await renderer.apply(
      [{ kind: "scene", scene: scene({ bg: "white", bindChildren: true }), transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    expect(sprite().style.getPropertyValue("translate")).toBe("");
  });

  it("@layopt visible=0 masque le sprite sans le retirer", async () => {
    await renderer.apply(
      [{ kind: "scene", scene: scene({ sprites: [{ id: "a", storage: "sprite", x: 100, y: 200, z: 1000, opacity: 1, visible: false }] }), transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    expect(root.querySelector('[data-sprite-id="a"]')).not.toBeNull();
    expect(sprite().style.visibility).toBe("hidden");

    await renderer.apply(
      [{ kind: "scene", scene: scene({ sprites: [{ id: "a", storage: "sprite", x: 100, y: 200, z: 1000, opacity: 1, visible: true }] }), transition: { method: "none" } }],
      { instant: true, signal: sig() },
    );
    expect(sprite().style.visibility).toBe("");
  });
});
