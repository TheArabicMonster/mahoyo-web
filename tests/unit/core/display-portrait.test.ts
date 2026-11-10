/**
 * Disposition du viewport en portrait (#210, WEB-02).
 *
 * Paysage : repère logique 1280×720 mis à l'échelle (#177) — inchangé.
 * Portrait : viewport à la taille réelle (échelle 1), pour que les écrans système reflowent et
 * que la zone de texte dédiée sous la scène soit rendue à taille réelle (lisibilité ≥ 14 px).
 */
import { describe, it, expect } from "vitest";
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  applyViewportLayout,
  computeViewportLayout,
} from "@/core/display.js";

const OPTS = { fullscreen: false, mode: "fit" as const, windowSize: "fit" as const };

describe("computeViewportLayout (#210)", () => {
  it("paysage : conserve le repère 1280×720 et le calcul d'échelle existant", () => {
    const layout = computeViewportLayout(1280, 720, OPTS);
    expect(layout).toEqual({ portrait: false, scale: 1, width: GAME_WIDTH, height: GAME_HEIGHT });
    const half = computeViewportLayout(640, 360, OPTS);
    expect(half).toMatchObject({ portrait: false, width: GAME_WIDTH, height: GAME_HEIGHT });
    expect(half.scale).toBeCloseTo(0.5, 5);
  });

  it("portrait téléphone 390×844 : échelle 1 et viewport à la taille réelle", () => {
    expect(computeViewportLayout(390, 844, OPTS)).toEqual({
      portrait: true,
      scale: 1,
      width: 390,
      height: 844,
    });
  });

  it("portrait tablette 768×1024 : échelle 1, pas de préréglage de taille appliqué", () => {
    const layout = computeViewportLayout(768, 1024, { ...OPTS, windowSize: "640x360" });
    expect(layout).toEqual({ portrait: true, scale: 1, width: 768, height: 1024 });
  });

  it("paysage : les préréglages de fenêtre restent appliqués", () => {
    const layout = computeViewportLayout(1920, 1080, { ...OPTS, windowSize: "640x360" });
    expect(layout.portrait).toBe(false);
    expect(layout.scale).toBeCloseTo(640 / GAME_WIDTH, 5);
  });
});

describe("applyViewportLayout (#210)", () => {
  it("pose data-layout=portrait, la taille réelle et l'échelle 1", () => {
    const el = document.createElement("div");
    applyViewportLayout(el, { portrait: true, scale: 1, width: 390, height: 844 });
    expect(el.dataset.layout).toBe("portrait");
    expect(el.style.width).toBe("390px");
    expect(el.style.height).toBe("844px");
    expect(el.style.transform).toBe("scale(1)");
  });

  it("paysage : retire data-layout et applique le repère 1280×720", () => {
    const el = document.createElement("div");
    applyViewportLayout(el, { portrait: true, scale: 1, width: 390, height: 844 });
    applyViewportLayout(el, { portrait: false, scale: 0.5, width: GAME_WIDTH, height: GAME_HEIGHT });
    expect(el.dataset.layout).toBeUndefined();
    expect(el.style.width).toBe("1280px");
    expect(el.style.height).toBe("720px");
    expect(el.style.transform).toBe("scale(0.5)");
  });
});
