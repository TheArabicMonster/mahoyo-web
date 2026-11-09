import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FLOW-07 (#206) : accessibilité de l'écran Flowchart.
 *
 * jsdom ne calcule ni la mise en page ni les couleurs : on contrôle la source CSS. Les ratios de
 * contraste sont recalculés ici à partir des tokens de `tokens.css` (formule WCAG 2.x), pour que le
 * test échoue si une valeur de token repasse sous 4,5:1.
 */
const css = readFileSync(resolve(__dirname, "../../../src/ui/flowchart-view.css"), "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokensCss = readFileSync(resolve(__dirname, "../../../src/ui/tokens.css"), "utf8");

// ---------------------------------------------------------------------------
// Petit lecteur de règles CSS (suffisant pour une feuille sans imbrication hors @media/@keyframes)
// ---------------------------------------------------------------------------

type CssRule = { selector: string; body: string };

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

function parseRules(source: string): CssRule[] {
  const rules: CssRule[] = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open === -1) break;
    const selector = normalize(source.slice(index, open));
    let depth = 1;
    let cursor = open + 1;
    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      cursor += 1;
    }
    rules.push({ selector, body: source.slice(open + 1, cursor - 1) });
    index = cursor;
  }
  return rules;
}

const rules = parseRules(code);

const selectorsOf = (rule: CssRule): string[] =>
  rule.selector
    .split(",")
    .map((selector) => normalize(selector))
    .filter(Boolean);

const ruleFor = (selector: string, source: readonly CssRule[] = rules): CssRule | undefined =>
  source.find((rule) => selectorsOf(rule).includes(selector));

const mediaFor = (query: string): CssRule | undefined =>
  rules.find((rule) => rule.selector === `@media (${query})`);

// ---------------------------------------------------------------------------
// Contraste WCAG 2.x (sRGB -> luminance relative)
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? [...clean].map((char) => char + char).join("") : clean;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
  return [channels[0]!, channels[1]!, channels[2]!];
}

/** Canal sRGB (0-255) -> canal linéaire (WCAG 2.x, § relative luminance). */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([red, green, blue]: Rgb): number {
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

const tokens = new Map<string, string>();
for (const match of tokensCss.matchAll(/(--mh-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\s*;/g)) {
  tokens.set(match[1]!, match[2]!);
}

function tokenHex(name: string): string {
  const value = tokens.get(name);
  expect(value, `token ${name} absent de tokens.css`).toBeDefined();
  return value!;
}

function tokenRatio(foreground: string, background: string): number {
  return contrastRatio(parseHex(tokenHex(foreground)), parseHex(tokenHex(background)));
}

// ---------------------------------------------------------------------------

describe("flowchart-view.css — accessibilité (#206)", () => {
  it("ne référence aucune image (CSS pur, aucun asset)", () => {
    expect(code).not.toMatch(/url\(/i);
  });

  it("les utilitaires lecteur d'écran sont masqués visuellement mais restent dans l'arbre d'accessibilité", () => {
    const sr = ruleFor(".mh-flow-sr");
    expect(sr).toBeDefined();
    // `display: none` et `visibility: hidden` retireraient le statut et la liste de l'arbre.
    expect(sr!.body).not.toMatch(/display\s*:\s*none/);
    expect(sr!.body).not.toMatch(/visibility\s*:\s*hidden/);
    expect(sr!.body).toMatch(/position\s*:\s*absolute/);
    expect(sr!.body).toMatch(/width\s*:\s*1px/);
    expect(sr!.body).toMatch(/height\s*:\s*1px/);
    expect(sr!.body).toMatch(/overflow\s*:\s*hidden/);
    expect(sr!.body).toMatch(/clip-path\s*:\s*inset\(50%\)/);
    expect(sr!.body).toMatch(/white-space\s*:\s*nowrap/);
  });

  it("le statut `.mh-flow-live` et la liste `.mh-flow-a11y` partagent le masquage, sans masquer leurs boutons", () => {
    const sr = ruleFor(".mh-flow-sr");
    expect(selectorsOf(sr!).includes(".mh-flow-live")).toBe(true);
    expect(selectorsOf(sr!).includes(".mh-flow-a11y")).toBe(true);
    // Aucune règle ne sort la liste ni ses boutons de l'arbre d'accessibilité.
    for (const rule of rules) {
      if (!/\.mh-flow-a11y(?:-node)?\b/.test(rule.selector)) continue;
      expect(rule.body).not.toMatch(/display\s*:\s*none/);
      expect(rule.body).not.toMatch(/visibility\s*:\s*hidden/);
    }
  });

  it("le focus clavier des nœuds est visible : contour 3 px --mh-focus, décalage 3 px", () => {
    const focus = ruleFor(".mh-flow-node:focus-visible");
    expect(focus).toBeDefined();
    expect(focus!.body).toMatch(/outline\s*:\s*3px solid var\(--mh-focus\)/);
    expect(focus!.body).toMatch(/outline-offset\s*:\s*3px/);
    expect(focus!.body).toMatch(/z-index\s*:\s*3/);
  });

  it("le focus garde une deuxième marque non colorée (anneau extérieur pointillé)", () => {
    const ring = ruleFor(".mh-flow-node:focus-visible::after");
    expect(ring).toBeDefined();
    expect(ring!.body).toMatch(/border\s*:\s*2px dashed var\(--mh-text-title\)/);
    expect(ring!.body).toMatch(/pointer-events\s*:\s*none/);
  });

  it("le contour est posé sur le nœud, pas sur `.mh-flow-shape` rogné par son clip-path", () => {
    // Une seule règle `outline` de focus, et elle ne cible pas l'enfant clippé.
    const outlineRules = rules.filter((rule) => /:focus-visible\b/.test(rule.selector) && /outline\s*:/.test(rule.body));
    expect(outlineRules.map((rule) => rule.selector)).toContain(".mh-flow-node:focus-visible");
    for (const rule of outlineRules) {
      expect(rule.selector).not.toMatch(/\.mh-flow-node:focus-visible\s+\.mh-flow-shape/);
    }
  });

  it("le mode portrait passe la grille sur une colonne et un chapitre à la fois au défilement", () => {
    const portrait = mediaFor("orientation: portrait");
    expect(portrait).toBeDefined();
    expect(portrait!.body).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/);
    expect(portrait!.body).toMatch(/\.mh-flow-scroll\s*\{[^}]*scroll-snap-type\s*:\s*y proximity/);
    expect(portrait!.body).toMatch(/\.mh-flow-group\s*\{[^}]*scroll-snap-align\s*:\s*start/);

    const portraitRules = parseRules(portrait!.body);
    const group = ruleFor(".mh-flow-group", portraitRules);
    expect(group!.body).toMatch(/scroll-snap-align\s*:\s*start/);
    expect(group!.body).toMatch(/scroll-margin-top\s*:\s*8px/);
    const aside = ruleFor(".mh-flow-aside", portraitRules);
    expect(aside!.body).toMatch(/display\s*:\s*none/);
  });

  it("le mode portrait place chaque région sur sa ligne et borne le volet de détails", () => {
    const portrait = mediaFor("orientation: portrait");
    const portraitRules = parseRules(portrait!.body);
    for (const selector of [".mh-flow-head", ".mh-flow-map", ".mh-flow-foot"]) {
      const rule = ruleFor(selector, portraitRules);
      expect(rule, `${selector} absent du mode portrait`).toBeDefined();
      expect(rule!.body).toMatch(/grid-column\s*:\s*1/);
      expect(rule!.body).toMatch(/grid-row\s*:\s*\d/);
    }
    const detail = ruleFor(".mh-flow-detail", portraitRules);
    expect(detail!.body).toMatch(/width\s*:\s*min\(280px,\s*calc\(100% - 24px\)\)/);
    const tools = ruleFor(".mh-flow-tools", portraitRules);
    expect(tools!.body).toMatch(/right\s*:\s*10px/);
    expect(tools!.body).toMatch(/bottom\s*:\s*10px/);
  });

  it("les états ne sont jamais portés par la seule couleur (forme, pointillé, glyphe)", () => {
    // Silhouette et révélé non visité : pointillé et fond de panneau.
    const dashed = ruleFor('.mh-flow-node[data-state="hidden"] .mh-flow-shape');
    expect(dashed).toBeDefined();
    expect(dashed!.body).toMatch(/border\s*:\s*2px dashed/);
    expect(dashed!.body).toMatch(/background\s*:\s*transparent/);

    const unvisitedId = ruleFor('.mh-flow-node[data-state="unvisited"] .mh-flow-id');
    expect(unvisitedId!.body).toMatch(/color\s*:\s*var\(--mh-text-menu\)/);

    // Terminé : la pastille change de fond (glyphe ✓ posé par le TS).
    const finishedGlyph = ruleFor('.mh-flow-node[data-state="finished"] .mh-flow-glyph');
    expect(finishedGlyph!.body).toMatch(/background\s*:\s*var\(--mh-teal-on-bottom\)/);

    // Courant : halo + bord épais, en plus du repère « ◀ Ici ».
    const current = ruleFor('.mh-flow-node[data-state="current"]');
    expect(current!.body).toMatch(/filter\s*:\s*drop-shadow/);
    const currentShape = ruleFor('.mh-flow-node[data-state="current"] .mh-flow-shape');
    expect(currentShape!.body).toMatch(/--mh-flow-shape-border\s*:\s*var\(--mh-cyan-glint\)/);

    // Formes distinctes : losange (choix), hexagone (interlude), double bord (fin).
    expect(code).toMatch(
      /\.mh-flow-node\[data-kind="choice"\] \.mh-flow-shape\s*\{[^}]*clip-path\s*:\s*polygon\(50% 0,/,
    );
    expect(code).toMatch(
      /\.mh-flow-node\[data-kind="interlude"\] \.mh-flow-shape\s*\{[^}]*clip-path\s*:\s*polygon\(14% 0,/,
    );
    expect(code).toMatch(
      /\.mh-flow-node\[data-kind="end"\] \.mh-flow-shape\s*\{[^}]*border\s*:\s*2px solid var\(--mh-dialog-border\)/,
    );
  });
});

describe("contrastes WCAG des libellés du flowchart", () => {
  const pairs = [
    { foreground: "--mh-text-ui", background: "--mh-teal-on-top", expected: 4.81, usage: "libellé de nœud / « Relire »" },
    { foreground: "--mh-text-menu", background: "--mh-panel-fill", expected: 9.36, usage: "légende, compteurs" },
    { foreground: "--mh-panel-label", background: "--mh-panel-fill", expected: 10.95, usage: "libellés de panneau" },
    { foreground: "--mh-text-title", background: "--mh-bg-night-top", expected: 16.96, usage: "titre de l'écran" },
  ] as const;

  for (const { foreground, background, expected, usage } of pairs) {
    it(`${foreground} sur ${background} (${usage}) ≥ 4,5:1 — calculé ≈ ${expected}:1`, () => {
      const ratio = tokenRatio(foreground, background);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeCloseTo(expected, 1);
    });
  }
});
