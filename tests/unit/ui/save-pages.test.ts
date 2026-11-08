import { describe, expect, it } from "vitest";
import {
  clampPage,
  formatSaveDate,
  isSpecialSlot,
  moveCursor,
  NUMBERED_SLOT_COUNT,
  pageOfSlot,
  paginate,
  SAVE_PAGE_COUNT,
  SAVE_POSITION_COUNT,
  SAVE_SLOTS_PER_PAGE,
  saveSlotIds,
} from "@/ui/save-pages.js";
import type { SaveSlot } from "@/ui/types.js";

const filled = (id: SaveSlot["id"]): SaveSlot => ({
  id,
  data: { scriptFile: "a.ks", timestamp: 0, previewText: "", thumbnailUrl: null, stage: {} as never },
});

describe("grille de sauvegarde : constantes", () => {
  it("8 emplacements par page (2 × 4), 15 pages, 120 positions dont 118 numérotées", () => {
    expect(SAVE_SLOTS_PER_PAGE).toBe(8);
    expect(SAVE_PAGE_COUNT).toBe(15);
    expect(SAVE_POSITION_COUNT).toBe(120);
    expect(NUMBERED_SLOT_COUNT).toBe(118);
  });

  it("saveSlotIds : auto et rapide en tête, puis 1 à 118", () => {
    const ids = saveSlotIds();
    expect(ids).toHaveLength(120);
    expect(ids.slice(0, 4)).toEqual(["auto", "quick", 1, 2]);
    expect(ids.at(-1)).toBe(118);
    expect(isSpecialSlot("auto")).toBe(true);
    expect(isSpecialSlot(3)).toBe(false);
  });
});

describe("paginate", () => {
  it("renvoie 15 pages de 8 fiches, la page 1 commençant par les emplacements spéciaux", () => {
    const pages = paginate([]);
    expect(pages).toHaveLength(15);
    for (const page of pages) expect(page).toHaveLength(8);
    expect(pages[0]!.map((s) => s.id)).toEqual(["auto", "quick", 1, 2, 3, 4, 5, 6]);
    expect(pages[1]!.map((s) => s.id)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    expect(pages[14]!.at(-1)!.id).toBe(118);
  });

  it("complète les emplacements absents par des vides et conserve les pleins", () => {
    const pages = paginate([filled(9), filled("quick")]);
    expect(pages[0]![1]!.data).not.toBeNull();
    expect(pages[1]![2]!.data).not.toBeNull();
    expect(pages[0]![0]!.data).toBeNull();
  });

  it("ignore un emplacement hors grille", () => {
    const pages = paginate([filled(500)]);
    expect(pages.flat().some((s) => s.id === 500)).toBe(false);
  });
});

describe("pages", () => {
  it("clampPage ramène dans 1..15", () => {
    expect(clampPage(0)).toBe(1);
    expect(clampPage(99)).toBe(15);
    expect(clampPage(4.7)).toBe(4);
    expect(clampPage(Number.NaN)).toBe(1);
  });

  it("pageOfSlot", () => {
    expect(pageOfSlot("auto")).toBe(1);
    expect(pageOfSlot(6)).toBe(1);
    expect(pageOfSlot(7)).toBe(2);
    expect(pageOfSlot(118)).toBe(15);
    expect(pageOfSlot(119)).toBeNull();
  });
});

describe("moveCursor (grille 2 × 4)", () => {
  it("se déplace d'une colonne ou d'une ligne et reste en place au bord", () => {
    expect(moveCursor(0, "ArrowRight")).toBe(1);
    expect(moveCursor(1, "ArrowRight")).toBe(1);
    expect(moveCursor(1, "ArrowLeft")).toBe(0);
    expect(moveCursor(0, "ArrowLeft")).toBe(0);
    expect(moveCursor(0, "ArrowDown")).toBe(2);
    expect(moveCursor(6, "ArrowDown")).toBe(6);
    expect(moveCursor(7, "ArrowUp")).toBe(5);
    expect(moveCursor(1, "ArrowUp")).toBe(1);
  });
});

describe("formatSaveDate", () => {
  it("AAAA/MM/JJ hh:mm:ss en heure locale", () => {
    expect(formatSaveDate(new Date(2025, 0, 5, 3, 4, 5).getTime())).toBe("2025/01/05 03:04:05");
    expect(formatSaveDate(new Date(2031, 11, 25, 23, 59, 0).getTime())).toBe("2031/12/25 23:59:00");
  });
  it("date invalide : chaîne vide", () => {
    expect(formatSaveDate(Number.NaN)).toBe("");
  });
});
