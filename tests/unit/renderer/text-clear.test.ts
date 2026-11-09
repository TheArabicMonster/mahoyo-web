import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from "@/renderer/types.js";

/**
 * Vidage du texte (#86) : un `clearText` explicite (`@cm`/`@cm4pg`, `force: true`) efface toujours
 * la fenêtre, alors qu'un `clearText` implicite de changement de page reste soumis au réglage
 * « Effacement du texte au changement de page » (#177).
 */
const display = (over: Partial<DisplaySettings> = {}): DisplaySettings => ({
  ...DEFAULT_DISPLAY_SETTINGS,
  ...over,
});
const sig = () => new AbortController().signal;

describe("DomStageRenderer — vidage du texte @cm/@cm4pg (#86)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const text = () => root.querySelector(".mh-stage-text") as HTMLElement;

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

  it("clearText forcé (@cm) efface le texte même si le réglage de page est désactivé", async () => {
    renderer.setSettings(display({ clearTextOnPageChange: false }));
    await renderer.apply([{ kind: "text", segments: [{ text: "Bonjour" }] }], { instant: true, signal: sig() });
    expect(text().textContent).toContain("Bonjour");
    await renderer.apply([{ kind: "clearText", force: true }], { instant: true, signal: sig() });
    expect(text().textContent).toBe("");
  });

  it("clearText implicite respecte toujours le réglage de changement de page", async () => {
    renderer.setSettings(display({ clearTextOnPageChange: false }));
    await renderer.apply([{ kind: "text", segments: [{ text: "Conservé" }] }], { instant: true, signal: sig() });
    await renderer.apply([{ kind: "clearText" }], { instant: true, signal: sig() });
    expect(text().textContent).toContain("Conservé");
  });

  it("clearText implicite efface quand le réglage est actif (défaut)", async () => {
    await renderer.apply([{ kind: "text", segments: [{ text: "À vider" }] }], { instant: true, signal: sig() });
    await renderer.apply([{ kind: "clearText" }], { instant: true, signal: sig() });
    expect(text().textContent).toBe("");
  });
});
