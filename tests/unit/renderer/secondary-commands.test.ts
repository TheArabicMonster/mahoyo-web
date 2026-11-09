/**
 * Rendu des commandes visuelles secondaires (#85) : point d'ancrage des aiguilles d'horloge
 * (`afx`/`afy`) et action continue des messages (`@setdefaultmessageaction type=swing`).
 */
// Registre des approximations (#295) — test figé :
// approx:message-actions-non-swing — seule l'action « swing » est rendue (tests ci-dessous).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent, SceneState } from "@/kag/events.js";

describe("DomStageRenderer — commandes visuelles secondaires (#85)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const sig = () => new AbortController().signal;

  const scene = (sprites: SceneState["sprites"]): RenderEvent =>
    ({ kind: "scene", scene: { bg: null, sprites, effect: null }, transition: { method: "none" } }) as RenderEvent;

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

  it("applique le pivot afx/afy des aiguilles et la rotation/zoom", async () => {
    await renderer.apply(
      [
        scene([
          {
            id: "clock1",
            storage: "im03lロビー時計(短針x2)",
            x: 948,
            y: 450,
            z: 1200,
            opacity: 1,
            rotate: 90,
            afx: 69,
            afy: 621,
            zoomx: 80,
            zoomy: 80,
          },
        ]),
      ],
      { instant: true, signal: sig() },
    );
    const img = root.querySelector(".mh-stage-sprite") as HTMLImageElement;
    expect(img.style.transformOrigin).toBe("69px 621px");
    expect(img.style.transform).toContain("rotate(90deg)");
    expect(img.style.transform).toContain("scale(0.8, 0.8)");
  });

  it("retire le pivot quand le calque n'a plus d'ancrage", async () => {
    const base = { id: "l1", storage: "a", x: 10, y: 20, z: 100, opacity: 1 } as const;
    await renderer.apply([scene([{ ...base, afx: 5, afy: 6 }])], { instant: true, signal: sig() });
    const img = root.querySelector(".mh-stage-sprite") as HTMLImageElement;
    expect(img.style.transformOrigin).toBe("5px 6px");
    await renderer.apply([scene([{ ...base }])], { instant: true, signal: sig() });
    expect(img.style.transformOrigin).toBe("");
  });

  it("action « swing » : caractères animés en CSS (approximation du moteur)", async () => {
    await renderer.apply(
      [
        { kind: "textbox", state: { visible: true, frame: true, action: "swing" }, time: 0 },
        { kind: "text", segments: [{ text: "abc" }] },
      ],
      { instant: true, signal: sig() },
    );
    const spans = [...root.querySelectorAll(".mh-stage-text-swing")] as HTMLElement[];
    expect(spans).toHaveLength(3);
    expect(spans[0]!.style.animationDelay).toMatch(/^-?\d+(\.\d+)?s$/);
    expect(spans.map((s) => s.textContent).join("")).toBe("abc");
  });

  it("reset de l'action : le texte n'est plus animé", async () => {
    const textEvent = { kind: "text", segments: [{ text: "abc" }] } as RenderEvent;
    await renderer.apply(
      [{ kind: "textbox", state: { visible: true, frame: true, action: "swing" }, time: 0 }, textEvent],
      { instant: true, signal: sig() },
    );
    expect(root.querySelectorAll(".mh-stage-text-swing")).toHaveLength(3);
    await renderer.apply(
      [{ kind: "textbox", state: { visible: true, frame: true }, time: 0 }],
      { instant: true, signal: sig() },
    );
    expect(root.querySelectorAll(".mh-stage-text-swing")).toHaveLength(0);
  });
});
