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
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";

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

describe("DomStageRenderer — @dispclock time=0 rendu sur la page affichée (#297)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const sig = () => new AbortController().signal;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    renderer = createDomStageRenderer({ resolver: createAssetResolver() });
    renderer.mount(root);
  });

  afterEach(() => {
    renderer.dispose();
    root.remove();
  });

  it("affiche le fond d'horloge et les 4 aiguilles après un @dispclock time=0", async () => {
    const runtime = new Runtime(parse(lex("*page0|\n@dispclock h=3 m=0 left=-800 top=-600 time=0\n@pg\n")), "t.ks");
    const step = runtime.step();
    await renderer.apply(step.events, { instant: true, signal: sig() });

    // Les 4 aiguilles (2 réelles + 2 ombres) sont des sprites rendus, pas seulement sur back.
    const sprites = [...root.querySelectorAll<HTMLImageElement>(".mh-stage-sprite")];
    expect(sprites).toHaveLength(4);
    expect(sprites.map((sprite) => decodeURIComponent(sprite.src)).every((src) => src.includes("ロビー時計"))).toBe(true);
    // Le fond d'horloge est peint sur l'élément de fond visible.
    const bg = root.querySelector<HTMLElement>(".mh-stage-bg");
    expect(bg).not.toBeNull();
    expect(decodeURIComponent(bg!.style.backgroundImage)).toContain("ロビー時計");
  });
});
