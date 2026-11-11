/** La transition attend le décodage de la nouvelle image de fond (#362). */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent, SceneState } from "@/kag/events.js";

const ensureDecoded = vi.fn();
vi.mock("@/renderer/image-decode.js", () => ({
  ensureDecoded: (...args: unknown[]) => ensureDecoded(...args),
  DECODED_CACHE_LIMIT: 24,
}));

import { createDomStageRenderer } from "@/renderer/stage-renderer.js";

const scene = (bg: string | null): SceneState => ({ bg, sprites: [], effect: null });

function sceneEvent(bg: string, time: number): RenderEvent {
  return { kind: "scene", scene: scene(bg), transition: { method: "crossfade", time } } as RenderEvent;
}

describe("DomStageRenderer — décodage avant transition (#362)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;

  beforeEach(() => {
    ensureDecoded.mockReset();
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
  });

  it("n'ouvre pas la transition avant la fin du décodage, puis l'applique", async () => {
    const signal = new AbortController().signal;
    await renderer.apply([sceneEvent("bg01", 0)], { instant: true, signal });
    const before = (root.querySelector(".mh-stage-bg") as HTMLElement).style.backgroundImage;

    let resolveDecode!: () => void;
    ensureDecoded.mockImplementation(() => new Promise<void>((resolve) => (resolveDecode = resolve)));
    const transition = renderer.apply([sceneEvent("bg02", 500)], { instant: false, signal });
    await Promise.resolve();
    // L'ancienne image reste affichée pendant l'attente (aucun écran noir).
    const bg = root.querySelector(".mh-stage-bg") as HTMLElement;
    expect(bg.style.backgroundImage).toBe(before);
    expect(ensureDecoded).toHaveBeenCalledWith("/assets/bg/bg02.webp", expect.any(AbortSignal), expect.objectContaining({ timeoutMs: 1000 }));

    resolveDecode();
    await transition;
    expect(bg.style.backgroundImage).toContain("bg02");
  });

  it("en instantané (skip/restauration), n'attend pas le décodage", async () => {
    ensureDecoded.mockImplementation(() => new Promise<void>(() => {}));
    await renderer.apply([sceneEvent("bg03", 500)], { instant: true, signal: new AbortController().signal });
    expect(ensureDecoded).not.toHaveBeenCalled();
    expect((root.querySelector(".mh-stage-bg") as HTMLElement).style.backgroundImage).toContain("bg03");
  });
});
