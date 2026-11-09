import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FALLBACK_TIMINGS, parseCssDuration, TRANSITION_CLASS, TRANSITION_RUNNING_CLASS } from "@/ui/transitions.js";

/**
 * HUD-14 (#205) : feuille `src/ui/transitions.css`. jsdom ne charge ni ne calcule les feuilles :
 * on contrôle la source, et l'alignement des durées avec `tokens.css` (les tokens de mouvement de
 * `docs/DESIGN.md` §7 et les mesures de `docs/ANALYSE_HUD_ORIGINAL.md` §2.12).
 */
const root = resolve(__dirname, "../../..");
const css = readFileSync(resolve(root, "src/ui/transitions.css"), "utf8");
const tokensCss = readFileSync(resolve(root, "src/ui/tokens.css"), "utf8");

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

/** Valeur déclarée d'une variable CSS dans un bloc (chaîne vide si absente). */
function varValue(source: string, name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(source);
  return match?.[1]?.trim() ?? "";
}

/** Durée déclarée dans `tokens.css`. */
function tokenDuration(name: string): string {
  return varValue(tokensCss, name);
}

/** ms d'une valeur `var(--mh-dur-*, 1200ms)` : on lit le repli littéral. */
function fallbackOf(value: string): number | null {
  const match = /var\(\s*--mh-dur-[a-z-]+\s*,\s*([\d.]+m?s)\s*\)/.exec(value);
  return match ? parseCssDuration(match[1]!) : null;
}

/** Valeur ms d'un token `--mh-dur-*`. */
function tokenMs(name: string): number | null {
  return parseCssDuration(tokenDuration(name));
}

describe("transitions.css : feuille du rideau plein écran (HUD-14)", () => {
  /** Règles seules : les commentaires citent les contraintes (ex. « aucune règle url( »). */
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("ne contient aucun asset ni URL (repli CSS pur, docs/DESIGN.md §9)", () => {
    expect(rules).not.toMatch(/url\(/);
    expect(rules).not.toMatch(/\.(png|jpe?g|webp|svg|ogg|mp3)\b/i);
    expect(rules).not.toMatch(/data:/);
  });

  it("déclare le rideau plein écran au-dessus de l'interface et sous #ui-loading", () => {
    const body = ruleBody(css, `.${TRANSITION_CLASS} {`);
    expect(body).not.toBe("");
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset:\s*0/);
    expect(body).toMatch(/z-index:\s*250/);
    expect(body).toMatch(/background:\s*#000/);
    expect(body).toMatch(/opacity:\s*0/);
    expect(body).toMatch(/pointer-events:\s*none/);
    // #ui-loading est à z-index 300 (ui-manager.css) : l'écran de chargement stylé reste au-dessus.
    expect(body).toMatch(/z-index:\s*250/);
  });

  it("définit les durées par type de transition en lisant les tokens --mh-dur-*", () => {
    const defaults = ruleBody(css, `.${TRANSITION_CLASS} {`);
    expect(fallbackOf(varValue(defaults, "--mh-transition-out"))).toBe(tokenMs("--mh-dur-scene-out"));
    expect(fallbackOf(varValue(defaults, "--mh-transition-in"))).toBe(tokenMs("--mh-dur-scene-in"));
    expect(parseCssDuration(varValue(defaults, "--mh-transition-hold"))).toBe(FALLBACK_TIMINGS["title-to-game"].hold);

    const toTitle = ruleBody(css, '.mh-ui-transition[data-kind="game-to-title"]');
    expect(fallbackOf(varValue(toTitle, "--mh-transition-out"))).toBe(tokenMs("--mh-dur-fade-out"));
    expect(fallbackOf(varValue(toTitle, "--mh-transition-in"))).toBe(tokenMs("--mh-dur-fade-in"));
    expect(parseCssDuration(varValue(toTitle, "--mh-transition-hold"))).toBe(FALLBACK_TIMINGS["game-to-title"].hold);

    const loading = ruleBody(css, '.mh-ui-transition[data-kind="loading-to-scene"]');
    expect(fallbackOf(varValue(loading, "--mh-transition-out"))).toBe(tokenMs("--mh-dur-fade-out"));
    expect(fallbackOf(varValue(loading, "--mh-transition-in"))).toBe(tokenMs("--mh-dur-scene-in"));
    expect(parseCssDuration(varValue(loading, "--mh-transition-hold"))).toBe(FALLBACK_TIMINGS["loading-to-scene"].hold);
  });

  it("reste aligné sur les constantes de repli du module TS (une seule source de vérité)", () => {
    const defaults = ruleBody(css, `.${TRANSITION_CLASS} {`);
    expect(fallbackOf(varValue(defaults, "--mh-transition-out"))).toBe(FALLBACK_TIMINGS["title-to-game"].out);
    expect(fallbackOf(varValue(defaults, "--mh-transition-in"))).toBe(FALLBACK_TIMINGS["title-to-game"].in);
  });

  it("anime les phases out et in en fondu linéaire, sans transition en idle", () => {
    const out = ruleBody(css, '.mh-ui-transition[data-phase="out"]');
    expect(out).toMatch(/opacity:\s*1/);
    expect(out).toMatch(
      /transition:\s*opacity\s+var\(--mh-transition-out\)\s+var\(--mh-ease,\s*linear\)/,
    );
    expect(out).toMatch(/pointer-events:\s*auto/);

    const black = ruleBody(css, '.mh-ui-transition[data-phase="black"]');
    expect(black).toMatch(/opacity:\s*1/);
    expect(black).toMatch(/transition:\s*none/);

    const inPhase = ruleBody(css, '.mh-ui-transition[data-phase="in"]');
    expect(inPhase).toMatch(/opacity:\s*0/);
    expect(inPhase).toMatch(
      /transition:\s*opacity\s+var\(--mh-transition-in\)\s+var\(--mh-ease,\s*linear\)/,
    );

    const idle = ruleBody(css, '.mh-ui-transition[data-phase="idle"]');
    expect(idle).toMatch(/opacity:\s*0/);
    expect(idle).toMatch(/pointer-events:\s*none/);
  });

  it("stylise l'écran de chargement (#ui-loading) au-dessus du rideau, sans texte ni asset", () => {
    expect(css).toMatch(new RegExp(`\\.${TRANSITION_RUNNING_CLASS}\\s*>\\s*#ui-loading`));
    expect(css).toMatch(/background:\s*transparent/);
    // Indicateur CSS pur : apparition retardée (seulement si les assets manquent) + rotation.
    const indicator = ruleBody(css, "#ui-loading::before");
    expect(indicator).not.toBe("");
    expect(indicator).toMatch(/opacity:\s*0/);
    expect(indicator).toMatch(/border-radius:\s*50%/);
    expect(indicator).toMatch(/border-top-color:\s*var\(--mh-cyan-(?:rail|glint)/);
    expect(css).toMatch(/@keyframes\s+mh-ui-transition-loading-spin/);
    expect(css).toMatch(/@keyframes\s+mh-ui-transition-loading-appear/);
    // L'apparition est retardée du fondu au noir : rien ne s'affiche si la scène est déjà prête.
    expect(css).toMatch(/--mh-loading-delay:\s*calc\(/);
    expect(css).not.toMatch(/content:\s*["'][^"']+["']/); // aucun libellé en dur (i18n)
  });

  it("supprime réellement les animations sous prefers-reduced-motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start).toBeGreaterThanOrEqual(0);
    const reduced = css.slice(start);
    expect(reduced).toMatch(/transition:\s*none/);
    expect(reduced).toMatch(/animation:\s*none/);
    expect(reduced).toMatch(/opacity:\s*0/);
  });

  it("ne redéclare pas :root et n'utilise pas !important", () => {
    expect(rules).not.toMatch(/:root/);
    expect(rules).not.toMatch(/!important/);
  });
});
