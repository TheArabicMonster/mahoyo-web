import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Non-régression #150 : la barre d'état (`.mh-ui-status`) ne doit pas couvrir l'écran.
 * `.mh-ui-overlay > div { inset: 0 }` (0,1,1) battait `.mh-ui-status { top; right }` (0,1,0) :
 * le badge ↶ devenait une bande sombre de 29×720 px à gauche. jsdom ne calcule pas la mise
 * en page, on contrôle donc la feuille de style.
 */
const css = readFileSync(resolve(__dirname, "../../../src/ui/ui-manager.css"), "utf8");

function declarations(selector: string): string[] {
  const escaped = selector.replace(/[.>*[\]]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1]!.trim());
}

describe("ui-manager.css : barre d'état", () => {
  it("les emplacements de l'overlay couvrent l'écran par défaut", () => {
    expect(declarations(".mh-ui-overlay > div").join(";")).toContain("inset: 0");
  });

  it("une règle plus spécifique replace la barre d'état dans un coin", () => {
    const rules = declarations(".mh-ui-overlay > .mh-ui-status");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatch(/inset:\s*var\(--mh-space-1\)\s+var\(--mh-space-1\)\s+auto auto/);
  });

  it("les badges ne s'étirent pas sur la hauteur de la barre", () => {
    const rules = declarations(".mh-ui-overlay > .mh-ui-status");
    expect(rules[0]).toMatch(/align-items:\s*flex-start/);
  });

  it("la barre d'état n'impose aucune taille", () => {
    for (const r of declarations(".mh-ui-status")) {
      expect(r).not.toMatch(/\b(width|height|inset)\s*:/);
    }
  });
});
