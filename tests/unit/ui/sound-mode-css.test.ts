import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HUD-16 (#209) : feuille `src/ui/sound-mode.css`. jsdom ne charge ni ne calcule les feuilles : on
 * contrôle la source (grille responsive, sélection sans couleur seule, contrôles accessibles, repli
 * sans asset, mouvement réduit) et l'absence de toute ressource ou titre du jeu.
 */
const root = resolve(__dirname, "../../..");
const css = readFileSync(resolve(root, "src/ui/sound-mode.css"), "utf8");
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

/** Tous les corps de règles dont le sélecteur apparaît en début de ligne (règles groupées exclues). */
function exactRuleBodies(source: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "gm");
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

/** Corps de la règle dédiée contenant `needle` (ignore les sélecteurs groupés qui la précèdent). */
function ruleWith(source: string, selector: string, needle: RegExp): string {
  return exactRuleBodies(source, selector).find((body) => needle.test(body)) ?? "";
}

/** Corps d'une at-rule (`@container …`, `@media …`), première occurrence. */
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

describe("sound-mode.css : galerie sonore (HUD-16)", () => {
  it("ne contient aucun asset, aucune URL, aucun !important ni :root", () => {
    expect(rules).not.toMatch(/url\(/);
    expect(rules).not.toMatch(/\.(png|jpe?g|webp|svg|ogg|mp3|wav)\b/i);
    expect(rules).not.toMatch(/data:/);
    expect(rules).not.toMatch(/!important/);
    expect(rules).not.toMatch(/:root/);
  });

  it("peint un écran plein cadre opaque au-dessus du titre, dans le slot #ui-sound", () => {
    const screen = ruleBody(css, ".mh-sound-screen {");
    expect(screen).not.toBe("");
    expect(screen).toMatch(/position:\s*absolute/);
    expect(screen).toMatch(/inset:\s*0/);
    expect(screen).toMatch(/pointer-events:\s*auto/);
    expect(screen).toMatch(/background-color:/);
    expect(screen).toMatch(/display:\s*flex/);
    expect(screen).toMatch(/flex-direction:\s*column/);
    // Le dégradé nuit reste peint par `.mh-ui-night` (night.css) : pas de dégradé redéfini ici.
    expect(screen).not.toMatch(/linear-gradient/);
  });

  it("grille responsive 3 → 2 → 1 colonnes en container query", () => {
    const grid = ruleBody(css, ".mh-sound-grid {");
    expect(grid).toMatch(/display:\s*grid/);
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(3,/);
    expect(ruleBody(css, ".mh-sound-scroll {")).toMatch(/container-type:\s*inline-size/);
    expect(atRuleBody(css, "@container (max-width: 1000px)")).toMatch(
      /grid-template-columns:\s*repeat\(2,/,
    );
    expect(atRuleBody(css, "@container (max-width: 640px)")).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it("morceaux : boutons de 58 px au moins avec titre et compositeur", () => {
    const track = ruleBody(css, ".mh-sound-track {");
    expect(track).toMatch(/min-height:\s*58px/);
    expect(track).toMatch(/display:\s*flex/);
    expect(track).toMatch(/linear-gradient/); // sarcelle glossy en CSS pur
    expect(css).toMatch(/\.mh-sound-track-composer\[hidden\]\s*\{\s*display:\s*none/);
  });

  it("sélection et morceau courant sans couleur seule : bord épais + marqueur + contour", () => {
    expect(css).toMatch(/--mh-sound-info:\s*#69c8c9/);
    const current = ruleBody(css, ".mh-sound-track.is-current {");
    expect(current).toMatch(/border-width:\s*3px/);
    expect(ruleBody(css, ".mh-sound-track.is-selected {")).toMatch(/border:\s*3px\s+solid/);
    expect(ruleBody(css, ".mh-sound-track.is-selected {")).toMatch(
      /outline:\s*2px\s+solid\s+var\(--mh-focus/,
    );
    const marker = ruleBody(css, ".mh-sound-track-marker {");
    expect(marker).toMatch(/display:\s*none/);
    expect(marker).toMatch(/position:\s*absolute/);
    expect(css).toMatch(/\.mh-sound-track\.is-playing \.mh-sound-track-marker[\s\S]*?display:\s*inline/);
  });

  it("commandes : boutons 44×44, bascules aria-pressed avec bord épais, focus visible", () => {
    expect(ruleWith(css, ".mh-sound-button", /width:\s*44px/)).toMatch(/height:\s*44px/);
    expect(ruleWith(css, ".mh-sound-toggle", /border-radius:\s*50%/)).toMatch(/width:\s*42px/);
    expect(ruleBody(css, '.mh-sound-toggle[aria-pressed="true"]')).toMatch(/border:\s*2px\s+solid/);
    expect(ruleBody(css, '.mh-sound-toggle[aria-pressed="true"]')).toMatch(/linear-gradient/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--mh-focus/);
  });

  it("barre de progression et volume : range stylés, remplissage cyan, temps tabulaires", () => {
    expect(
      ruleWith(css, 'input[type="range"].mh-sound-progress-range', /accent-color/),
    ).toMatch(/flex:\s*1 1 auto/);
    expect(ruleWith(css, 'input[type="range"].mh-sound-progress-range', /accent-color/)).toMatch(
      /accent-color:\s*var\(--mh-cyan-progress/,
    );
    expect(ruleBody(css, 'input[type="range"].mh-sound-progress-range::-moz-range-progress')).toMatch(
      /background:\s*var\(--mh-cyan-progress/,
    );
    const volumeRange = ruleWith(css, 'input[type="range"].mh-sound-volume-range', /width:\s*140px/);
    expect(volumeRange).toMatch(/accent-color:\s*var\(--mh-cyan-rail/);
    expect(ruleBody(css, ".mh-sound-time {")).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(ruleBody(css, ".mh-sound-volume-label")).toMatch(/font-size:\s*var\(--mh-control-size/);
  });

  it("ligne d'information compositeur / titre en cyan avec filet", () => {
    const info = ruleBody(css, ".mh-sound-info {");
    expect(info).toMatch(/border-top:/);
    expect(info).toMatch(/color:\s*var\(--mh-sound-info/);
    expect(info).toMatch(/min-height:/);
  });

  it("état vide masqué par [hidden] et message neutre", () => {
    expect(ruleBody(css, ".mh-sound-empty[hidden]")).toMatch(/display:\s*none/);
  });

  it("cibles tactiles de 44 px en pointeur grossier", () => {
    const coarse = atRuleBody(css, "@media (pointer: coarse)");
    expect(coarse).toMatch(/min-width:\s*44px/);
    expect(coarse).toMatch(/min-height:\s*44px/);
    expect(coarse).toMatch(/mh-sound-back/);
    expect(coarse).toMatch(/range/);
  });

  it("mouvement réduit : aucune transition ni animation", () => {
    const reduced = atRuleBody(css, "@media (prefers-reduced-motion: reduce)");
    expect(reduced).not.toBe("");
    expect(reduced).toMatch(/transition:\s*none/);
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it("aucun texte du jeu : la feuille ne contient que des glyphes décoratifs", () => {
    const contents = [...rules.matchAll(/content:\s*"([^"]*)"/g)].map((match) => match[1]!);
    for (const content of contents) {
      expect(content.length).toBeLessThanOrEqual(4);
    }
    // Aucune chaîne longue (titre, compositeur) dans la feuille.
    expect(rules).not.toMatch(/content:\s*"[^"]{8,}"/);
  });
});
