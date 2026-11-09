import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** WEB-01 (#203) : feuille des commandes tactiles. jsdom ne calcule pas la mise en page : on contrôle la source. */
const css = readFileSync(resolve(__dirname, "../../../src/ui/touch-controls.css"), "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("touch-controls.css", () => {
  it("ne référence aucune image (CSS pur, aucun asset)", () => {
    expect(code).not.toMatch(/url\(/i);
  });

  it("interdit le zoom et le défilement de page, et laisse défiler les écrans longs", () => {
    expect(code).toMatch(/html,\s*body,\s*#app\s*\{[^}]*touch-action: pan-x pan-y/);
    expect(code).toMatch(/html,\s*body,\s*#app\s*\{[^}]*overscroll-behavior: none/);
  });

  it("en jeu, l'overlay prend touch-action: none (le glissement appartient aux gestes)", () => {
    expect(code).toMatch(/\.mh-ui-overlay\[data-screen="game"\]\s*\{[^}]*touch-action: none/);
  });

  it("les cibles sont définies en pixels réels puis divisées par l'échelle du viewport", () => {
    expect(code).toMatch(/--touch-target:\s*calc\(var\(--mh-touch-target-px, 48\) \* 1px \/ var\(--mh-ui-scale, 1\)\)/);
    expect(code).toMatch(/\.mh-touch-menu\s*\{[^}]*width: var\(--touch-target\)[^}]*height: var\(--touch-target\)/);
    expect(code).toMatch(/\.mh-touch \.mh-touch-action\s*\{[^}]*min-width: var\(--touch-target\)[^}]*height: var\(--touch-target\)/);
  });

  it("le focus clavier est visible (contour 2 px --mh-focus, décalage 2 px, en pixels réels)", () => {
    expect(code).toMatch(/:focus-visible\s*\{[^}]*outline: calc\(2px \/ var\(--mh-ui-scale, 1\)\) solid var\(--mh-focus/);
    expect(code).toMatch(/outline-offset: calc\(2px \/ var\(--mh-ui-scale, 1\)\)/);
  });

  it("la bascule active ne dépend pas de la seule couleur (bord épais + trait)", () => {
    expect(code).toMatch(/\.mh-touch-action\.is-active\s*\{[^}]*border-width:[^}]*box-shadow: inset/);
  });

  it("les transitions sont coupées sous prefers-reduced-motion", () => {
    expect(code).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition: none/);
  });
});
