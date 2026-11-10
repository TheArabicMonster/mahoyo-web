/**
 * Thème Mahoyo & animations (#99) — garde-fous des tokens et de la cohérence CSS.
 *
 * - les tokens de surfaces/focus/mouvement existent et sont utilisés par les composants communs ;
 * - `prefers-reduced-motion` et l'option joueur `data-reduce-motion` neutralisent les durées ;
 * - aucun marqueur de conflit de merge ni valeur de focus brute dans les feuilles auditées.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dirname, "../../..");
const read = (f: string): string => readFileSync(join(root, f), "utf-8");
const tokens = read("src/ui/tokens.css");
const uiManager = read("src/ui/ui-manager.css");
const title = read("src/ui/title-screen.css");

const REQUIRED = [
  "--mh-scrim",
  "--mh-scrim-soft",
  "--mh-ui-panel-fill",
  "--mh-ui-panel-border",
  "--mh-ui-button-fill",
  "--mh-ui-button-hover",
  "--mh-shadow-panel",
  "--mh-focus-width",
  "--mh-focus-offset",
  "--mh-ease-out",
  "--mh-dur-ui-in",
  "--mh-dur-ui-out",
  "--mh-dur-stagger",
];

describe("tokens du thème (#99)", () => {
  for (const token of REQUIRED) {
    it(`déclare ${token}`, () => {
      expect(tokens).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
    });
  }

  it("la réduction d'animations met les durées d'interface à 0 ms", () => {
    expect(tokens).toMatch(/prefers-reduced-motion: reduce[\s\S]*--mh-dur-ui-in: 0ms;/);
    expect(tokens).toMatch(/prefers-reduced-motion: reduce[\s\S]*--mh-dur-ui-out: 0ms;/);
    expect(tokens).toMatch(/prefers-reduced-motion: reduce[\s\S]*--mh-dur-stagger: 0ms;/);
    expect(tokens).toMatch(/:root\[data-reduce-motion="true"\][\s\S]*--mh-dur-ui-in: 0ms;/);
    expect(tokens).toMatch(/:root\[data-reduce-motion="true"\][\s\S]*--mh-dur-stagger: 0ms;/);
  });
});

describe("composants communs tokenisés (#99)", () => {
  it("ui-manager.css n'utilise plus de couleur ni de durée codée en dur", () => {
    const withoutComments = uiManager.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(withoutComments).not.toMatch(/(animation|transition)-duration:\s*(?!0(?:ms|s)\b)\d/);
    expect(uiManager).toContain("var(--mh-scrim)");
    expect(uiManager).toContain("var(--mh-ui-panel-fill)");
    expect(uiManager).toContain("var(--mh-shadow-panel)");
    expect(uiManager).toContain("var(--mh-focus-width)");
    expect(uiManager).toContain("var(--mh-focus-offset)");
  });

  it("les fondus d'écrans/panneaux utilisent les tokens de mouvement", () => {
    expect(uiManager).toMatch(/@keyframes mh-ui-screen-in/);
    expect(uiManager).toMatch(/@keyframes mh-ui-panel-in/);
    expect(uiManager).toMatch(/animation: mh-ui-screen-in var\(--mh-dur-ui-in\) var\(--mh-ease-out\)/);
    expect(title).toMatch(/@keyframes mh-ui-title-fade-in/);
    expect(title).toMatch(/animation: mh-ui-title-fade-in var\(--mh-dur-ui-in\) var\(--mh-ease-out\)/);
  });

  it("le focus visible n'utilise plus la géométrie brute (2px)", () => {
    for (const file of [
      "archive-view.css", "backlog-screen.css", "cg-mode.css", "config-screen.css",
      "confirm-dialog.css", "flowchart-view.css", "save-load-screen.css", "sound-mode.css",
      "system-menu.css", "title-screen.css", "ui-manager.css",
    ]) {
      expect(read(`src/ui/${file}`), file).not.toMatch(/outline:\s*2px/);
      expect(read(`src/ui/${file}`), file).not.toMatch(/outline-offset:\s*2px;/);
    }
  });

  it("aucune feuille CSS ne contient de marqueur de conflit de merge", () => {
    for (const file of [
      "archive-view.css", "backlog-screen.css", "cg-mode.css", "config-screen.css",
      "confirm-dialog.css", "flowchart-view.css", "save-load-screen.css", "sound-mode.css",
      "system-menu.css", "title-screen.css", "ui-manager.css", "tokens.css",
    ]) {
      expect(read(`src/ui/${file}`), file).not.toMatch(/^(<<<<<<<|=======$|>>>>>>>)/m);
    }
  });
});
