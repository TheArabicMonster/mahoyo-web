import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HUD-07 (#195) : jsdom ne calcule pas la mise en page. On contrôle la feuille `title-screen.css`
 * (mesures de ANALYSE_HUD_ORIGINAL.md §2.1 converties en pourcentages, repli sans asset, contraste).
 * Les positions réelles sont vérifiées au navigateur par `tests/e2e/title-screen.spec.ts`.
 */
const root = resolve(__dirname, "../../..");
const css = readFileSync(resolve(root, "src/ui/title-screen.css"), "utf8");
const tokens = readFileSync(resolve(root, "src/ui/tokens.css"), "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

function block(selector: string): string {
  const escaped = selector.replace(/[.>*[\]"=():]/g, "\\$&");
  const all = code.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"));
  return [...all].map((m) => m[1]!).join("\n");
}

function hexOf(source: string, name: string): string {
  const m = source.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`${name} introuvable`);
  return m[1]!;
}

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const pct = (value: string, prop: string): number => {
  const m = value.match(new RegExp(`${prop}:\\s*([\\d.]+)%`));
  if (!m) throw new Error(`${prop} en % attendu`);
  return Number(m[1]);
};

describe("title-screen.css : géométrie (ANALYSE_HUD_ORIGINAL §2.1, 1280x720)", () => {
  it("le logo occupe x 334-941, y 123-295 (en % du cadre)", () => {
    const logo = block(".mh-ui-title-logo");
    expect(pct(logo, "left")).toBeCloseTo((334 / 1280) * 100, 1);
    expect(pct(logo, "width")).toBeCloseTo(((941 - 334) / 1280) * 100, 1);
    expect(pct(logo, "top")).toBeCloseTo((123 / 720) * 100, 1);
    expect(pct(logo, "height")).toBeCloseTo(((295 - 123) / 720) * 100, 1);
  });

  it("le pas du menu vaut 49 px @720 (6,806 % de la hauteur) et le premier centre est à y = 415", () => {
    const screen = block(".mh-ui-title-screen");
    expect(screen).toMatch(/--mh-title-menu-pitch:\s*6\.806cqh/);
    expect(6.806 * 7.2).toBeCloseTo(49, 0);
    const menu = block(".mh-ui-title-menu");
    expect(menu).toMatch(/top:\s*calc\(57\.639%\s*-\s*var\(--mh-title-menu-pitch\)\s*\/\s*2\)/);
    expect(0.57639 * 720).toBeCloseTo(415, 0);
    expect(block(".mh-ui-title-entry")).toContain("height: var(--mh-title-menu-pitch)");
  });

  it("le menu est centré horizontalement", () => {
    const menu = block(".mh-ui-title-menu");
    expect(menu).toMatch(/left:\s*0/);
    expect(menu).toMatch(/right:\s*0/);
    expect(menu).toMatch(/align-items:\s*center/);
  });

  it("entrées en serif espacé (0,25 em), corps du token, repos --mh-ink, survol --mh-ink-hover, aucun fond", () => {
    const entry = block(".mh-ui-title-entry");
    expect(entry).toMatch(/letter-spacing:\s*0\.25em/);
    expect(entry).toContain("font-size: var(--mh-title-menu-size)");
    expect(entry).toContain("font-family: var(--mh-font-text)");
    expect(entry).toContain("color: var(--mh-ink)");
    expect(entry).toMatch(/background:\s*none/);
    expect(entry).toMatch(/font-weight:\s*400/);
    expect(entry).toMatch(/min-height:\s*44px/);
    const hover = block(".mh-ui-title-entry:hover,\n.mh-ui-title-entry:focus-visible");
    expect(hover).toContain("color: var(--mh-ink-hover)");
    expect(hover).not.toMatch(/background|font-weight/);
  });

  it("focus visible : contour de 2 px", () => {
    expect(block(".mh-ui-title-entry:focus-visible")).toMatch(/outline:\s*2px solid var\(--mh-ink-hover\)/);
  });

  it("la mention de droits est centrée en bas, >= 10 px réels", () => {
    const legal = block(".mh-ui-title-legal");
    expect(legal).toMatch(/text-align:\s*center/);
    expect(legal).toMatch(/bottom:/);
    const size = block(".mh-ui-title-screen").match(/--mh-title-legal-size:\s*([\d.]+)rem/);
    expect(Number(size?.[1]) * 16).toBeGreaterThanOrEqual(10);
  });
});

describe("title-screen.css : repli sans asset", () => {
  it("n'embarque aucune URL : l'illustration et le logo passent par --mh-asset-*, absents = none", () => {
    expect(code).not.toMatch(/url\(/);
    expect(block(".mh-ui-title-screen")).toContain("var(--mh-asset-title_background, none)");
    expect(block(".mh-ui-title-logo-image")).toContain("var(--mh-asset-title_titlelogo, none)");
    expect(code).not.toMatch(/--mh-asset-[\w-]+\s*:/); // jamais posées ici : c'est le rôle de `createUiAssets().apply`
  });

  it("repli crème : dégradé du ciel adouci vers --mh-paper puis vers #f2f3ea (DESIGN §2.1)", () => {
    const screen = block(".mh-ui-title-screen");
    expect(screen).toContain("var(--mh-paper)");
    expect(screen).toMatch(/linear-gradient\(\s*to bottom/);
    expect(hexOf(css, "--mh-title-haze-end")).toBe("#f2f3ea");
    expect(hexOf(tokens, "--mh-paper")).toBe("#eee8de");
  });

  it("le titre de repli et les entrées restent >= 4,5:1 sur le point le plus sombre du fond", () => {
    const ink = toRgb(hexOf(tokens, "--mh-ink"));
    const hover = toRgb(hexOf(tokens, "--mh-ink-hover"));
    for (const stop of ["--mh-title-sky", "--mh-title-haze"]) {
      expect(contrast(ink, toRgb(hexOf(css, stop))), `encre sur ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
    // Le menu (donc le survol bleu) se trouve sous 54 % de la hauteur : brume, papier, pas le ciel.
    expect(contrast(hover, toRgb(hexOf(css, "--mh-title-haze")))).toBeGreaterThanOrEqual(4.5);
    const paper = toRgb(hexOf(tokens, "--mh-paper"));
    expect(contrast(ink, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hover, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(toRgb(hexOf(css, "--mh-title-legal")), paper)).toBeGreaterThanOrEqual(4.5);
  });

  it("le texte du logo n'est pas supprimé quand l'image existe (il reste lisible par les lecteurs d'écran)", () => {
    const hidden = block(".mh-ui-title-logo-image .mh-ui-title-logo-text");
    expect(hidden).not.toMatch(/display:\s*none/);
    expect(hidden).toMatch(/clip-path/);
  });

  it("le mouvement suit les tokens (donc prefers-reduced-motion)", () => {
    expect(block(".mh-ui-title-entry")).toContain("var(--mh-dur-fast)");
  });
});
