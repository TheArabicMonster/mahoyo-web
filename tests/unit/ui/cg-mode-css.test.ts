import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HUD-15 (#208) : feuille `src/ui/cg-mode.css`. jsdom ne charge ni ne calcule les feuilles : on
 * contrôle la source (grille responsive 2–4 colonnes, sélection sans couleur seule, visionneuse,
 * repli sans asset, mouvement réduit), et l'absence de toute image versionnée.
 */
const root = resolve(__dirname, "../../..");
const css = readFileSync(resolve(root, "src/ui/cg-mode.css"), "utf8");
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Corps d'un bloc `sélecteur { … }` (première occurrence du sélecteur). */
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(selector);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return "";
}

/** Corps d'un bloc @container / @media (première occurrence de l'at-rule). */
function atRuleBody(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return "";
}

describe("cg-mode.css : galerie CG (HUD-15)", () => {
  it("ne contient aucun asset, aucune URL, aucun !important ni :root", () => {
    expect(rules).not.toMatch(/url\(/);
    expect(rules).not.toMatch(/\.(png|jpe?g|webp|svg|ogg|mp3)\b/i);
    expect(rules).not.toMatch(/data:/);
    expect(rules).not.toMatch(/!important/);
    expect(rules).not.toMatch(/:root/);
  });

  it("peint un écran plein cadre opaque au-dessus du titre, dans le slot #ui-cg", () => {
    const screen = ruleBody(css, ".mh-cg-screen {");
    expect(screen).not.toBe("");
    expect(screen).toMatch(/position:\s*absolute/);
    expect(screen).toMatch(/inset:\s*0/);
    expect(screen).toMatch(/pointer-events:\s*auto/);
    expect(screen).toMatch(/background-color:/);
    // Le dégradé nuit vient de night.css : la feuille ne doit pas le redéfinir.
    expect(screen).not.toMatch(/linear-gradient/);
  });

  it("grille responsive 4 → 3 → 2 colonnes en container query", () => {
    const grid = ruleBody(css, ".mh-cg-grid {");
    expect(grid).toMatch(/display:\s*grid/);
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(4,/);
    expect(ruleBody(css, ".mh-cg-scroll {")).toMatch(/container-type:\s*inline-size/);
    const three = atRuleBody(css, "@container (max-width: 1000px)");
    expect(three).toMatch(/grid-template-columns:\s*repeat\(3,/);
    const two = atRuleBody(css, "@container (max-width: 760px)");
    expect(two).toMatch(/grid-template-columns:\s*repeat\(2,/);
    // Tuile au ratio 20:11 (200×110 px @720).
    expect(ruleBody(css, ".mh-cg-tile {")).toMatch(/aspect-ratio:\s*20\s*\/\s*11/);
  });

  it("sélection sans couleur seule : bord épais + marqueur non chromatique", () => {
    expect(css).toMatch(/--mh-cg-select:\s*#c0f790/);
    const selected = ruleBody(css, ".mh-cg-tile.is-selected {");
    expect(selected).toMatch(/border:\s*3px\s+solid\s+var\(--mh-cg-select\)/);
    const marker = ruleBody(css, ".mh-cg-tile.is-selected::after");
    expect(marker).toMatch(/content:\s*"[^"]+"/); // marqueur (losange) en plus de la couleur
    expect(marker).toMatch(/position:\s*absolute/);
    // Focus clavier visible (contour 2 px) en plus du bord de sélection.
    expect(ruleBody(css, ".mh-cg-tile:focus-visible")).toMatch(
      /outline:\s*var\(--mh-focus-width, 2px\)\s+solid\s+var\(--mh-focus/,
    );
  });

  it("CG verrouillée : repli hachuré, libellé lisible, pas d'image", () => {
    const locked = ruleBody(css, ".mh-cg-tile.is-locked,");
    expect(locked).not.toBe("");
    expect(locked).toMatch(/repeating-linear-gradient/);
    expect(locked).toMatch(/cursor:\s*default/);
    const label = ruleBody(css, ".mh-cg-tile-locked {");
    expect(label).toMatch(/font-size:\s*var\(--mh-control-size/);
    expect(label).toMatch(/text-align:\s*center/);
    // L'image n'est peinte que pour une tuile déverrouillée (classe is-unlocked), jamais en dur.
    expect(rules).toMatch(/\.mh-cg-thumb\s*\{/);
    expect(rules).toMatch(/object-fit:\s*cover/);
  });

  it("visionneuse plein écran : zoom transformé, barre de commandes, état masqué", () => {
    const viewer = ruleBody(css, ".mh-cg-viewer {");
    expect(viewer).toMatch(/position:\s*absolute/);
    expect(viewer).toMatch(/inset:\s*0/);
    expect(ruleBody(css, ".mh-cg-viewer[hidden]")).toMatch(/display:\s*none/);
    const image = ruleBody(css, ".mh-cg-viewer-image {");
    expect(image).toMatch(/transform:\s*scale\(var\(--mh-cg-zoom,\s*1\)\)/);
    expect(image).toMatch(/transform-origin:\s*center/);
    expect(image).toMatch(/transition:\s*transform\s+var\(--mh-dur-fast/);
    expect(image).toMatch(/object-fit:\s*contain/);
    expect(ruleBody(css, ".mh-cg-viewer-bar {")).toMatch(/display:\s*flex/);
    expect(rules).toMatch(/\.mh-cg-viewer-button:disabled/);
  });

  it("cibles tactiles de 44 px en pointeur grossier", () => {
    const coarse = atRuleBody(css, "@media (pointer: coarse)");
    expect(coarse).toMatch(/min-height:\s*44px/);
    expect(coarse).toMatch(/\.mh-cg-viewer-button/);
  });

  it("supprime réellement les transitions sous prefers-reduced-motion", () => {
    const reduced = atRuleBody(css, "@media (prefers-reduced-motion: reduce)");
    expect(reduced).not.toBe("");
    expect(reduced).toMatch(/transition:\s*none/);
    expect(reduced).toMatch(/\.mh-cg-viewer-image/);
  });

  it("libellés jamais en dur : les textes viennent du dictionnaire i18n", () => {
    // La feuille ne doit contenir que les marqueurs décoratifs (losange, croix du verrou).
    const contents = [...rules.matchAll(/content:\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(contents.length).toBeGreaterThan(0);
    for (const content of contents) {
      expect(content).toMatch(/^[◆×‹›‹›]+$/);
    }
  });
});
