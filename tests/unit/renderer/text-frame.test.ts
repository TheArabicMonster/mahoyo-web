import { describe, it, expect } from "vitest";
import {
  CLICK_GLYPHS,
  DEFAULT_FRAME_IMAGE,
  DEFAULT_TEXTBOX_OPACITY,
  frameImageOpacity,
  indicatorOffset,
  INDICATOR_GAP,
  resolveFrameStyle,
} from "@/renderer/text-frame.js";
import { dimmedUnitCount, FRAME_TEXT_AREA, frameTextAreaHeight } from "@/renderer/text-fit.js";

const none = new Set<string>();

describe("resolveFrameStyle (#173)", () => {
  it("applique txtwindow02 tant qu'aucun cadre n'est posé", () => {
    expect(DEFAULT_FRAME_IMAGE).toBe("txtwindow02");
    expect(resolveFrameStyle({ visible: true, frame: true }, none)).toEqual({ mode: "image", image: "txtwindow02" });
  });

  it("suit l'image posée par @position frame=", () => {
    for (const image of ["txtwindow00", "txtwindow01", "txtwindow02"]) {
      expect(resolveFrameStyle({ visible: true, frame: true, frameImage: image }, none)).toEqual({ mode: "image", image });
    }
  });

  it("garde le texte seul sur la scène quand le cadre est masqué ou vide", () => {
    expect(resolveFrameStyle({ visible: true, frame: false, frameImage: "txtwindow01" }, none)).toEqual({ mode: "image", image: null });
    expect(resolveFrameStyle({ visible: true, frame: true, frameImage: "" }, none)).toEqual({ mode: "image", image: null });
  });

  it("revient à l'ancienne boîte quand l'image de cadre manque", () => {
    const failed = new Set(["txtwindow02"]);
    expect(resolveFrameStyle({ visible: true, frame: true }, failed)).toEqual({ mode: "box" });
    expect(resolveFrameStyle({ visible: true, frame: false }, failed)).toEqual({ mode: "box" });
    expect(resolveFrameStyle({ visible: true, frame: true, frameImage: "txtwindow01" }, failed)).toEqual({ mode: "image", image: "txtwindow01" });
  });

  it("ne dépend pas de la visibilité de la fenêtre (gérée par l'opacité)", () => {
    expect(resolveFrameStyle({ visible: false, frame: true }, none)).toEqual({ mode: "image", image: "txtwindow02" });
  });
});

describe("frameImageOpacity", () => {
  it("rend l'image telle quelle au réglage par défaut et l'éclaircit en dessous", () => {
    expect(frameImageOpacity(DEFAULT_TEXTBOX_OPACITY)).toBe(1);
    expect(frameImageOpacity(1)).toBe(1);
    expect(frameImageOpacity(0.4)).toBeCloseTo(0.5, 9);
    expect(frameImageOpacity(0)).toBe(0);
    expect(frameImageOpacity(Number.NaN)).toBe(1);
  });
});

describe("zone de texte du cadre image", () => {
  it("reprend les mesures de la capture d'origine", () => {
    // Bord gauche à 268/1920, première ligne centrée à 126/1080 avec un interligne de 77/1080.
    expect(FRAME_TEXT_AREA.left).toBeCloseTo(268 / 1920, 2);
    expect(FRAME_TEXT_AREA.top).toBeCloseTo((126 - 77 / 2) / 1080, 2);
    // Bord droit entre la fin de la ligne la plus longue (1713) et la coupure suivante (~1790).
    const right = 1 - FRAME_TEXT_AREA.right;
    expect(right).toBeGreaterThan(1713 / 1920);
    expect(right).toBeLessThan(1790 / 1920);
  });

  it("laisse presque toute la hauteur de scène au texte (une dizaine de lignes)", () => {
    const h = frameTextAreaHeight(576);
    expect(h).toBeCloseTo(576 * (1 - 2 * 0.081), 6);
    // Interligne mesuré : 77/1080 de la hauteur.
    expect(Math.floor(h / (576 * 77 / 1080))).toBe(11);
  });
});

describe("dimmedUnitCount", () => {
  it("borne le texte atténué au texte affiché", () => {
    expect(dimmedUnitCount(0, 10)).toBe(0);
    expect(dimmedUnitCount(4, 10)).toBe(4);
    expect(dimmedUnitCount(12, 10)).toBe(10);
    expect(dimmedUnitCount(-1, 10)).toBe(0);
  });
});

describe("indicatorOffset (#175)", () => {
  it("colle l'icône au bord droit du dernier caractère et la centre verticalement", () => {
    const char = { top: 50, left: 80, right: 100, height: 40 };
    expect(indicatorOffset(char, { top: 20, left: 10 }, 1, 24)).toEqual({
      left: 90 + INDICATOR_GAP,
      top: 30 + (40 - 24) / 2,
    });
  });

  it("divise les mesures écran par l'échelle de la scène", () => {
    const char = { top: 100, left: 160, right: 210, height: 80 };
    expect(indicatorOffset(char, { top: 40, left: 20 }, 2, 24)).toEqual({
      left: 190 / 2 + INDICATOR_GAP,
      top: 60 / 2 + (80 / 2 - 24) / 2,
    });
  });

  it("retombe sur une échelle de 1 si la mesure est invalide", () => {
    const char = { top: 10, left: 0, right: 20, height: 20 };
    expect(indicatorOffset(char, { top: 0, left: 0 }, 0, 20)).toEqual({
      left: 20 + INDICATOR_GAP,
      top: 10,
    });
    expect(indicatorOffset(char, { top: 0, left: 0 }, Number.NaN, 20).left).toBe(20 + INDICATOR_GAP);
  });
});

describe("CLICK_GLYPHS", () => {
  it("décrit les bandes linebreak_a (24 px) et pagebreak_a (32 px) de 40 vignettes", () => {
    expect(CLICK_GLYPHS.line.width * CLICK_GLYPHS.line.frames).toBe(960);
    expect(CLICK_GLYPHS.page.width * CLICK_GLYPHS.page.frames).toBe(1280);
  });
});
