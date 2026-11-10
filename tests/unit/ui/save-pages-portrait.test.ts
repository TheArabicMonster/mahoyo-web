/** Grille de sauvegarde en portrait (#210) : 1 colonne × 4 lignes par page, 30 pages. */
import { describe, it, expect } from "vitest";
import {
  SAVE_PAGE_COUNT,
  SAVE_SLOTS_PER_PAGE,
  clampPage,
  moveCursor,
  pageCountFor,
  paginate,
} from "@/ui/save-pages.js";

describe("save-pages — portrait (#210)", () => {
  it("les valeurs paysage restent inchangées", () => {
    expect(SAVE_SLOTS_PER_PAGE).toBe(8);
    expect(pageCountFor()).toBe(SAVE_PAGE_COUNT);
    expect(paginate([])).toHaveLength(SAVE_PAGE_COUNT);
  });

  it("4 fiches par page → 30 pages de 4", () => {
    expect(pageCountFor(4)).toBe(30);
    const pages = paginate([], 4);
    expect(pages).toHaveLength(30);
    expect(pages[0]).toHaveLength(4);
    expect(pages[29]).toHaveLength(4);
  });

  it("clampPage borne à 30 en portrait", () => {
    expect(clampPage(0, 4)).toBe(1);
    expect(clampPage(99, 4)).toBe(30);
    expect(clampPage(Number.NaN, 4)).toBe(1);
  });

  it("moveCursor en une colonne : haut/bas avancent d'une fiche, gauche/droite restent", () => {
    expect(moveCursor(0, "ArrowDown", 1)).toBe(1);
    expect(moveCursor(0, "ArrowRight", 1)).toBe(0);
    expect(moveCursor(1, "ArrowUp", 1)).toBe(0);
    expect(moveCursor(3, "ArrowDown", 1)).toBe(3); // dernière ligne de la page
  });
});
