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
    renderer.hurry();
    await promise;
    const text = root.querySelector(".mh-stage-text") as HTMLElement;
    expect(text.textContent).toBe("Long text here");
  });
});
