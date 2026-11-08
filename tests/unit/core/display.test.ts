import { describe, it, expect } from "vitest";
import { computeViewportScale, parseWindowSize, WINDOW_SIZE_OPTIONS } from "@/core/display.js";

describe("échelle du viewport (#177)", () => {
  it("adapte le jeu à la fenêtre", () => {
    expect(computeViewportScale(1920, 1080, { fullscreen: false, mode: "fit", windowSize: "fit" })).toBe(1.5);
    expect(computeViewportScale(1000, 1000, { fullscreen: false, mode: "fit", windowSize: "fit" })).toBeCloseTo(0.78125);
  });

  it("plein écran : fit, fill (recadrage) et 1:1", () => {
    expect(computeViewportScale(2000, 1000, { fullscreen: true, mode: "fit", windowSize: "fit" })).toBeCloseTo(1.3889, 3);
    expect(computeViewportScale(2000, 1000, { fullscreen: true, mode: "fill", windowSize: "fit" })).toBe(1.5625);
    expect(computeViewportScale(2000, 1000, { fullscreen: true, mode: "none", windowSize: "fit" })).toBe(1);
  });

  it("plafonne la taille d'affichage en fenêtré", () => {
    expect(computeViewportScale(1920, 1080, { fullscreen: false, mode: "fit", windowSize: "1280x720" })).toBe(1);
    expect(computeViewportScale(1920, 1080, { fullscreen: false, mode: "fit", windowSize: "640x360" })).toBe(0.5);
    // Une fenêtre plus petite que le préréglage garde l'ajustement.
    expect(computeViewportScale(800, 450, { fullscreen: false, mode: "fit", windowSize: "1920x1080" })).toBeCloseTo(0.625);
  });

  it("parse les résolutions", () => {
    expect(parseWindowSize("fit")).toBeNull();
    expect(parseWindowSize("1280x720")).toEqual({ width: 1280, height: 720 });
    expect(WINDOW_SIZE_OPTIONS.map((o) => o.value)).toContain("1920x1080");
  });
});
