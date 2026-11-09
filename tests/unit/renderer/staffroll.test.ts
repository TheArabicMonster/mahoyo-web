/**
 * Rendu des crédits de fin (#286) : overlay unique, lignes aux offsets cumulés du moteur,
 * défilement, attente de `@wstaffroll` et libération par `@staffrolluninit`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDomStageRenderer } from "@/renderer/stage-renderer.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { RenderEvent, StaffrollState } from "@/kag/events.js";

describe("DomStageRenderer — crédits de fin (#286)", () => {
  let root: HTMLElement;
  let renderer: ReturnType<typeof createDomStageRenderer>;
  const sig = () => new AbortController().signal;

  const state = (overrides: Partial<StaffrollState> = {}): StaffrollState => ({
    lines: [
      { text: "Ligne 1", y: 100, size: 19 },
      { text: "Ligne 2", y: 40, size: 14, color: "#123456" },
    ],
    face: "serif",
    running: false,
    height: 5000,
    time: 10000,
    elapsed: 0,
    ...overrides,
  });

  const event = (staffroll: StaffrollState | null): RenderEvent => ({ kind: "staffroll", state: staffroll });

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

  it("construit un overlay unique avec les lignes aux offsets cumulés (comme currentPos += y)", async () => {
    await renderer.apply([event(state())], { instant: false, signal: sig() });
    const overlays = root.querySelectorAll(".mh-stage-staffroll");
    expect(overlays).toHaveLength(1);
    const lines = [...overlays[0]!.querySelectorAll(".mh-stage-staffroll-line")] as HTMLElement[];
    expect(lines.map((l) => l.textContent)).toEqual(["Ligne 1", "Ligne 2"]);
    // y cumulés : 100 puis 100 + 40 = 140.
    expect(lines[0]!.style.top).toBe("100px");
    expect(lines[1]!.style.top).toBe("140px");
    expect(lines[0]!.style.color).toBe("rgb(255, 255, 255)");
    expect(lines[1]!.style.color).toBe("rgb(18, 52, 86)");
    expect(lines[1]!.style.fontSize).toBe("14px");
  });

  it("le champ bgcolor (paramètre mort du plugin) n'est pas peint", async () => {
    await renderer.apply([event(state({ bgcolor: "#000000" }))], { instant: false, signal: sig() });
    const overlay = root.querySelector(".mh-stage-staffroll") as HTMLElement;
    // Aucune couleur de fond appliquée : le décor de la scène reste visible (comportement moteur).
    expect(overlay.style.backgroundColor).toBe("");
  });

  it("le défilement démarre à @staffrollstart et @wstaffroll attend sa fin", async () => {
    vi.useFakeTimers();
    await renderer.apply([event(state())], { instant: false, signal: sig() });
    await renderer.apply([event(state({ running: true }))], { instant: false, signal: sig() });
    const inner = root.querySelector(".mh-stage-staffroll-inner") as HTMLElement;
    expect(inner.style.transition).toContain("10000ms");
    const waiting = renderer.waitFor("staffroll", undefined, sig());
    let waitDone = false;
    void waiting.then(() => {
      waitDone = true;
    });
    vi.advanceTimersByTime(10000);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(waitDone).toBe(true);
    expect(inner.style.transform).toBe("translateY(-5000px)");
  });

  it("@staffrolluninit retire l'overlay et libère une attente en cours", async () => {
    vi.useFakeTimers();
    await renderer.apply([event(state({ running: true }))], { instant: false, signal: sig() });
    const waiting = renderer.waitFor("staffroll", undefined, sig());
    let done = false;
    void waiting.then(() => {
      done = true;
    });
    await renderer.apply([event(null)], { instant: false, signal: sig() });
    await Promise.resolve();
    expect(done).toBe(true);
    expect(root.querySelector(".mh-stage-staffroll")).toBeNull();
  });

  it("instant : aucun overlay et attente résolue immédiatement", async () => {
    await renderer.apply([event(state({ running: true }))], { instant: true, signal: sig() });
    expect(root.querySelector(".mh-stage-staffroll")).toBeNull();
    await renderer.waitFor("staffroll", undefined, sig()); // ne doit pas bloquer
  });

  it("un second @staffrollinit remplace l'overlay précédent (pas de doublons)", async () => {
    vi.useFakeTimers();
    await renderer.apply([event(state({ running: true }))], { instant: false, signal: sig() });
    await renderer.apply(
      [
        event(state()),
        event(state({ lines: [{ text: "Nouvelle ligne", y: 10, size: 16 }] })),
      ],
      { instant: false, signal: sig() },
    );
    const overlays = root.querySelectorAll(".mh-stage-staffroll");
    expect(overlays).toHaveLength(1);
    expect(overlays[0]!.querySelectorAll(".mh-stage-staffroll-line")).toHaveLength(1);
  });
});
