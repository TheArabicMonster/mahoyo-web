/**
 * Garde-fous CSS du portrait (#210, WEB-02) : les écrans système reflowent via
 * `@media (orientation: portrait)` et les cibles tactiles font au moins 44 px.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dirname, "../../..");
const read = (file: string): string => readFileSync(join(root, file), "utf-8");

describe("CSS portrait (#210)", () => {
  const screens = [
    "src/ui/title-screen.css",
    "src/ui/system-menu.css",
    "src/ui/save-load-screen.css",
    "src/ui/config-screen.css",
    "src/ui/backlog-screen.css",
    "src/ui/confirm-dialog.css",
    "src/ui/ui-manager.css",
    "src/ui/touch-controls.css",
  ];

  for (const file of screens) {
    it(`${file} contient un bloc @media (orientation: portrait)`, () => {
      expect(read(file)).toContain("@media (orientation: portrait)");
    });
  }

  it("cibles tactiles ≥ 44 px déclarées en portrait (menu système, save/load, titre)", () => {
    expect(read("src/ui/system-menu.css")).toMatch(/@media \(orientation: portrait\)[\s\S]*min-height: 44px/);
    expect(read("src/ui/save-load-screen.css")).toMatch(/@media \(orientation: portrait\)[\s\S]*min-height: 44px/);
    expect(read("src/ui/title-screen.css")).toMatch(/@media \(orientation: portrait\)[\s\S]*min-height: 44px/);
  });

  it("index.html déclare viewport-fit=cover (encoches en portrait)", () => {
    expect(read("index.html")).toContain("viewport-fit=cover");
  });

  it("la zone de texte portrait est rendue par le renderer (dock dédié, pas de superposition)", () => {
    const css = read("src/renderer/stage-renderer.ts");
    expect(css).toContain('className = "mh-portrait-dock"');
    expect(css).toContain('[data-layout="portrait"] .mh-stage-textbox');
  });
});
