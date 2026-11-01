/**
 * Accélération des interpolations de timeline (#125) : loi de puissance, voir `src/core/easing.ts`.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { cssEasing, easeExponent, easeProgress } from "@/core/easing.js";

describe("easeProgress", () => {
  it("accélération nulle : interpolation linéaire", () => {
    for (const t of [0, 0.25, 0.5, 1]) expect(easeProgress(0, t)).toBe(t);
  });

  it("garde les extrémités, quelle que soit l'accélération", () => {
    for (const a of [-20, -3, 2, 7, 20]) {
      expect(easeProgress(a, 0)).toBe(0);
      expect(easeProgress(a, 1)).toBe(1);
    }
  });

  it("positive : départ lent (en dessous de la droite) ; négative : arrivée douce (au-dessus)", () => {
    expect(easeProgress(3, 0.5)).toBeLessThan(0.5);
    expect(easeProgress(-3, 0.5)).toBeGreaterThan(0.5);
    // k = 1 + ln(1 + |accel|)
    expect(easeExponent(3)).toBeCloseTo(1 + Math.log(4), 10);
    expect(easeProgress(3, 0.5)).toBeCloseTo(Math.pow(0.5, 1 + Math.log(4)), 10);
    expect(easeProgress(-3, 0.5)).toBeCloseTo(1 - Math.pow(0.5, 1 + Math.log(4)), 10);
  });

  it("plus |accel| est grand, plus la courbe s'écarte de la droite, sans jamais se figer", () => {
    expect(easeProgress(20, 0.5)).toBeLessThan(easeProgress(7, 0.5));
    expect(easeProgress(7, 0.5)).toBeLessThan(easeProgress(3, 0.5));
    // accel 20 : la moitié du temps donne encore plus de 5 % du chemin (pas t^20).
    expect(easeProgress(20, 0.5)).toBeGreaterThan(0.05);
  });

  it("est monotone et ramenée dans [0, 1] hors bornes", () => {
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeProgress(7, i / 20);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(easeProgress(7, -1)).toBe(0);
    expect(easeProgress(7, 2)).toBe(1);
    expect(easeProgress(Number.NaN, 0.4)).toBe(0.4);
  });
});

describe("cssEasing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accélération nulle : linear", () => {
    expect(cssEasing(0)).toBe("linear");
  });

  it("avec linear() : échantillons de la courbe, de 0 à 1", async () => {
    vi.stubGlobal("CSS", { supports: () => true });
    vi.resetModules(); // le support est mémorisé au premier appel
    const fresh = await import("@/core/easing.js");
    const values = fresh.cssEasing(3).slice(7, -1).split(", ").map(Number);
    expect(values).toHaveLength(25);
    expect(values[0]).toBe(0);
    expect(values[24]).toBe(1);
    expect(values[12]).toBeCloseTo(easeProgress(3, 0.5), 3);
  });

  it("sans linear() : repli sur ease-in (accélération) ou ease-out (décélération)", async () => {
    vi.stubGlobal("CSS", { supports: () => false });
    vi.resetModules();
    const fresh = await import("@/core/easing.js");
    expect(fresh.cssEasing(7)).toBe("ease-in");
    expect(fresh.cssEasing(-7)).toBe("ease-out");
  });

  it("la queue d'une courbe (fond qui poursuit son mouvement) est ramenée à [0, 1]", async () => {
    vi.stubGlobal("CSS", { supports: () => true });
    vi.resetModules();
    const fresh = await import("@/core/easing.js");
    const values = fresh.cssEasing(3, 0.5).slice(7, -1).split(", ").map(Number);
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(1);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
  });
});
