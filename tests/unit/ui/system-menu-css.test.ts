import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HUD-06 (#194) : feuille du menu système. jsdom ne calcule pas la mise en page : on contrôle la
 * feuille source (la mesure réelle se fait au navigateur, voir docs/DESIGN.md §9.2).
 */
const css = readFileSync(resolve(__dirname, "../../../src/ui/system-menu.css"), "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("system-menu.css", () => {
  it("ne référence aucune image (CSS pur, aucun asset)", () => {
    expect(code).not.toMatch(/url\(/i);
  });

  it("l'apparition dure --mh-dur-menu et est coupée sous prefers-reduced-motion", () => {
    expect(code).toMatch(/animation:[^;]*var\(--mh-dur-menu/);
    expect(code).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation: none/);
  });

  it("le focus clavier est visible (contour 2 px --mh-focus, décalage 2 px)", () => {
    expect(code).toMatch(/:focus-visible[^{]*\{[^}]*outline: var\(--mh-focus-width, 2px\) solid var\(--mh-focus/);
    expect(code).toMatch(/outline-offset: var\(--mh-focus-offset, 2px\)/);
  });

  it("les entrées n'ont ni fond ni cadre (texte seul)", () => {
    const m = code.match(/\.mh-sysmenu-entry,\s*\.mh-sysmenu-back\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/border: 0/);
    expect(m![1]).toMatch(/background: none/);
  });

  it("le survol éclaircit et ajoute une lueur", () => {
    expect(code).toMatch(/:hover[^{]*\{[^}]*color:[^}]*text-shadow:/);
  });

  it("la colonne et l'en-tête sont positionnés en pourcentages du repère 1280x720", () => {
    expect(code).toMatch(/left: 85\.3125%/); // x = 1092 @720
    expect(code).toMatch(/left: 84\.92%/); // x = 1087 @720
    expect(code).toMatch(/bottom: 3\.82%/); // « Back » : encre de y = 666 à 687 @720
  });
});
