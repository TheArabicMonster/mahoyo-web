/**
 * Placement en pixels absolus (#315) : boîte, transform, crop partbg, clip partbgid.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { partbgClipRect, resolvePlacement, type PlacementParams } from "@/renderer/sprite-placement.js";

const STAGE = { width: 1024, height: 576 };
const IMG = { width: 800, height: 600 };

const place = (params: PlacementParams, image = IMG, stage = STAGE) => resolvePlacement(params, image, stage);

describe("resolvePlacement — boîte et ancrage (#315)", () => {
  it("ancre le sprite par son centre (center/vcenter = centre, pas coin)", () => {
    const p = place({ center: 512, vcenter: 288 });
    expect(p).toMatchObject({ x: 112, y: -12, width: 800, height: 600 });
  });

  it("respecte center/vcenter explicites (cas @chgfg corrigé)", () => {
    const p = place({ center: 300, vcenter: 200 });
    expect(p).toMatchObject({ x: -100, y: -100, width: 800, height: 600 });
  });

  it("utilise le centre du stage sans center/vcenter", () => {
    const p = place({}, { width: 200, height: 100 });
    expect(p).toMatchObject({ x: 412, y: 238 });
  });

  it("ne clampe pas une image plus grande que l'écran (débordement géré par le clip/overflow)", () => {
    const p = place({ center: 512, vcenter: 288 }, { width: 2048, height: 1152 });
    expect(p).toMatchObject({ x: -512, y: -288, width: 2048, height: 1152 });
  });

  it("applique zoom/rotation par transform autour du centre, sans translate(-50%)", () => {
    const p = place({ center: 512, vcenter: 288, zoomx: 150, zoomy: 50, rotate: 30 });
    expect(p.transform).toBe("rotate(30deg) scale(1.5, 0.5)");
    expect(p.transformOrigin).toBe("50% 50%");
  });

  it("utilise afx/afy comme pivot absolu du moteur", () => {
    const p = place({ center: 500, vcenter: 300, afx: 600, afy: 400, rotate: 45 }, { width: 100, height: 100 });
    expect(p.x).toBe(450);
    expect(p.y).toBe(250);
    expect(p.transformOrigin).toBe("150px 150px");
  });

  it("ne met aucun transform quand zoom/rotation sont neutres", () => {
    const p = place({ center: 512, vcenter: 288 });
    expect(p.transform).toBe("");
    expect(p.transformOrigin).toBe("50% 50%");
    expect(p.inner).toBeNull();
    expect(p.clip).toBeNull();
  });
});

describe("resolvePlacement — crop @partbg", () => {
  const crop = { width: 400, height: 300, srcLeft: 120, srcTop: 60, srcZoomX: 200, srcZoomY: 200 };

  it("la boîte du wrapper est le rectangle du crop, centré sur center/vcenter", () => {
    const p = place({ center: 512, vcenter: 288, crop });
    expect(p).toMatchObject({ x: 312, y: 138, width: 400, height: 300 });
    expect(p.inner).toMatchObject({ x: -120, y: -60, width: 800, height: 600, transform: "scale(2, 2)" });
  });

  it("l'image interne est posée en (-srcleft, -srctop), sans décalage -50%", () => {
    const p = place({ center: 0, vcenter: 0, crop: { ...crop, srcLeft: -30, srcTop: 0, srcZoomX: 50, srcZoomY: 100 } });
    expect(p.inner).toMatchObject({ x: 30, y: 0, transform: "scale(0.5, 1)" });
  });

  it("gère un crop plus grand que l'image source (srcZoom < 100)", () => {
    const p = place({ center: 512, vcenter: 288, crop: { ...crop, width: 1024, height: 576, srcZoomX: 50, srcZoomY: 50 } });
    expect(p).toMatchObject({ width: 1024, height: 576 });
    expect(p.inner!.transform).toBe("scale(0.5, 0.5)");
  });
});

describe("resolvePlacement — clip partbgid (#315)", () => {
  it("clippe au rectangle du partbg parent, intersection stage", () => {
    const clipRect = partbgClipRect({ center: 512, vcenter: 288, crop: { width: 300, height: 200 } });
    expect(clipRect).toEqual({ x: 362, y: 188, width: 300, height: 200 });
    const p = place({ center: 512, vcenter: 288, clipRect });
    expect(p.clip).toEqual(clipRect);
  });

  it("intersecte le clip avec le stage (aucun sprite hors stage)", () => {
    const p = place({ center: 100, vcenter: 300, clipRect: { x: -50, y: 100, width: 300, height: 200 } });
    expect(p.clip).toEqual({ x: 0, y: 100, width: 250, height: 200 });
  });

  it("retourne null si le clip est entièrement hors du stage", () => {
    const p = place({ center: 512, vcenter: 288, clipRect: { x: 2000, y: 0, width: 100, height: 100 } });
    expect(p.clip).toBeNull();
  });
});
