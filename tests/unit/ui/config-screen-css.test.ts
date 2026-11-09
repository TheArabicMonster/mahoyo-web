import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HUD-09 (#200) : feuille de la configuration. jsdom ne calcule pas la mise en page : on contrôle la source
 * (les mesures réelles se prennent au navigateur, voir docs/DESIGN.md §9.10 et tests/e2e/config-screen.spec.ts).
 */
const css = readFileSync(resolve(__dirname, "../../../src/ui/config-screen.css"), "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("config-screen.css", () => {
  it("ne référence aucune image (CSS pur, aucun asset)", () => {
    expect(code).not.toMatch(/url\(/i);
  });

  it("les panneaux ont un bord de 2 px, clair en haut à gauche et sombre en bas à droite", () => {
    const m = code.match(/\.mh-cfg-panel\s*\{([^}]*)\}/);
    expect(m![1]).toMatch(/border: 2px solid/);
    expect(m![1]).toMatch(/border-color: var\(--mh-panel-border-light[^)]*\) var\(--mh-panel-border-dark/);
    expect(m![1]).toMatch(/background: var\(--mh-panel-fill/);
  });

  it("l'état actif des boutons est sarcelle, l'inactif gris (tokens du design system)", () => {
    expect(code).toMatch(/\.mh-cfg-toggle\.active\s*\{[^}]*--mh-teal-on-top[^}]*--mh-teal-on-bottom/);
    expect(code).toMatch(/\.mh-cfg-toggle,[^{]*\{[^}]*--mh-grey-off-top[^}]*--mh-grey-off-bottom/);
  });

  it("la pastille des curseurs est une sphère argent sur une piste noire", () => {
    expect(code).toMatch(/::-webkit-slider-thumb[^}]*border-radius: 50%[^}]*#cbcbcb/);
    expect(code).toMatch(/::-webkit-slider-runnable-track[^}]*background: #080808/);
  });

  it("le focus clavier est visible (contour 2 px --mh-focus, décalage 2 px)", () => {
    expect(code).toMatch(/:focus-visible[^{]*\{[^}]*outline: 2px solid var\(--mh-focus/);
    expect(code).toMatch(/outline-offset: 2px/);
  });

  it("les cibles font 44 px au moins sur écran tactile", () => {
    const m = code.match(/@media \(pointer: coarse\)\s*\{([\s\S]*)\}\s*$/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/\.mh-cfg-tab,[\s\S]*\.mh-cfg-toggle[\s\S]*min-height: 44px/);
    expect(m![1]).toMatch(/\.mh-cfg-spin-btn \{ min-width: 44px/);
  });

  it("l'apparition est coupée sous prefers-reduced-motion", () => {
    expect(code).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation: none/);
  });

  it("les positions du pied suivent les mesures de l'original (%, repère 1280x720)", () => {
    expect(code).toMatch(/\.mh-cfg-col-left \{ left: 3\.906%; width: 35\.78%/); // x 50-508
    expect(code).toMatch(/\.mh-cfg-col-right \{ left: 42\.19%; width: 53\.91%/); // x 540-1230
    expect(code).toMatch(/left: 80\.47%;[\s\S]*?width: 15\.62%/); // « Réglages par défaut » 1030-1230
  });
});
