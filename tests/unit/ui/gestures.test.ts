import { describe, expect, it } from "vitest";
import { DEFAULT_GESTURE_CONFIG, GestureRecognizer } from "@/ui/gestures.js";

/** WEB-01 (#203) : reconnaissance de gestes, module pur (aucun DOM, horloge injectée). */
const C = DEFAULT_GESTURE_CONFIG;
const at = (id: number, x: number, y: number, t: number) => ({ id, x, y, t });

describe("GestureRecognizer", () => {
  it("appui bref sans déplacement = tap", () => {
    const g = new GestureRecognizer();
    g.pointerDown(at(1, 100, 100, 0));
    expect(g.pointerUp(at(1, 102, 101, 120))).toBe("tap");
  });

  it("le tremblement du doigt (≤ tolérance) reste un tap", () => {
    const g = new GestureRecognizer();
    g.pointerDown(at(1, 100, 100, 0));
    g.pointerMove(at(1, 100 + C.slopPx, 100, 40));
    expect(g.pointerUp(at(1, 100, 100 + C.slopPx, 90))).toBe("tap");
  });

  it("l'appui long est dû à longPressMs, émis une seule fois, et le relâchement ne produit rien", () => {
    const g = new GestureRecognizer();
    g.pointerDown(at(1, 50, 50, 1000));
    expect(g.longPressDueAt).toBe(1000 + C.longPressMs);
    expect(g.checkLongPress(1000 + C.longPressMs - 1)).toBeNull();
    expect(g.checkLongPress(1000 + C.longPressMs)).toBe("long-press");
    expect(g.checkLongPress(1000 + C.longPressMs + 50)).toBeNull();
    expect(g.longPressDueAt).toBeNull();
    expect(g.pointerUp(at(1, 50, 50, 2000))).toBeNull();
  });

  it("un relâchement tardif sans minuteur vaut appui long (minuteur gelé en arrière-plan)", () => {
    const g = new GestureRecognizer();
    g.pointerDown(at(1, 50, 50, 0));
    expect(g.pointerUp(at(1, 50, 50, C.longPressMs + 10))).toBe("long-press");
  });

  it("un déplacement au-delà de la tolérance annule l'appui long", () => {
    const g = new GestureRecognizer();
    g.pointerDown(at(1, 50, 50, 0));
    g.pointerMove(at(1, 50, 50 + C.slopPx + 1, 100));
    expect(g.longPressDueAt).toBeNull();
    expect(g.checkLongPress(C.longPressMs + 100)).toBeNull();
  });

  it.each([
    ["swipe-up", 0, -120],
    ["swipe-down", 0, 120],
    ["swipe-left", -120, 0],
    ["swipe-right", 120, 0],
  ] as const)("%s : déplacement net et rapide", (kind, dx, dy) => {
    const g = new GestureRecognizer();
    g.pointerDown(at(1, 300, 300, 0));
    g.pointerMove(at(1, 300 + dx / 2, 300 + dy / 2, 100));
    expect(g.pointerUp(at(1, 300 + dx, 300 + dy, 200))).toBe(kind);
  });

  it("un balayage trop court, trop lent ou trop en diagonale n'est pas reconnu", () => {
    const g = new GestureRecognizer();
    g.pointerDown(at(1, 300, 300, 0));
    expect(g.pointerUp(at(1, 300, 300 - (C.swipeMinPx - 5), 100))).toBeNull(); // trop court
    g.pointerDown(at(2, 300, 300, 0));
    expect(g.pointerUp(at(2, 300, 180, C.swipeMaxMs + 1))).toBeNull(); // trop lent
    g.pointerDown(at(3, 300, 300, 0));
    expect(g.pointerUp(at(3, 380, 220, 150))).toBeNull(); // diagonale
  });

  it("un second doigt invalide le geste (pincement) jusqu'à ce que tous soient levés", () => {
    const g = new GestureRecognizer();
    g.pointerDown(at(1, 300, 300, 0));
    g.pointerDown(at(2, 340, 300, 10));
    expect(g.longPressDueAt).toBeNull();
    expect(g.pointerUp(at(2, 340, 100, 100))).toBeNull();
    expect(g.pointerUp(at(1, 300, 100, 120))).toBeNull();
    // Nouveau doigt seul : tout refonctionne.
    g.pointerDown(at(3, 10, 10, 500));
    expect(g.pointerUp(at(3, 10, 10, 560))).toBe("tap");
  });

  it("pointercancel abandonne le geste sans rien produire", () => {
    const g = new GestureRecognizer();
    g.pointerDown(at(1, 10, 10, 0));
    g.pointerCancel(1);
    expect(g.longPressDueAt).toBeNull();
    expect(g.pointerUp(at(1, 10, 10, 50))).toBeNull();
  });

  it("une configuration personnalisée est respectée", () => {
    const g = new GestureRecognizer({ ...C, longPressMs: 200 });
    g.pointerDown(at(1, 0, 0, 0));
    expect(g.checkLongPress(200)).toBe("long-press");
  });
});
