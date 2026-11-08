import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HUD-01 (#181) : les tokens `--mh-*` de `docs/DESIGN.md` §11 existent dans `src/ui/tokens.css`.
 * jsdom ne charge pas les feuilles de style : on contrôle le fichier source.
 */
const root = resolve(__dirname, "../../..");
const tokensCss = readFileSync(resolve(root, "src/ui/tokens.css"), "utf8");
const design = readFileSync(resolve(root, "docs/DESIGN.md"), "utf8");

/** Bloc ```css de la section 11 de DESIGN.md. */
function designBlock(): string {
  const section = design.split(/^## 11\. /m)[1]?.split(/^## 12\. /m)[0] ?? "";
  const m = section.match(/```css\n([\s\S]*?)```/);
  return m?.[1] ?? "";
}

function declaredNames(css: string): string[] {
  return [...css.matchAll(/^\s*(--mh-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!);
}

/** Corps du premier bloc `@media (prefers-reduced-motion: reduce)`. */
function reducedMotionBody(css: string): string {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return "";
}

describe("tokens.css : variables du design system", () => {
  // Premier bloc :root uniquement : le bloc reduced-motion redéclare les durées.
  const names = declaredNames(tokensCss.split("@media")[0]!);

  it("déclare toutes les variables du bloc de DESIGN.md §11", () => {
    const expected = declaredNames(designBlock());
    expect(expected.length).toBeGreaterThan(50);
    const missing = [...new Set(expected)].filter((n) => !names.includes(n));
    expect(missing).toEqual([]);
  });

  it("ne déclare aucune variable en double ni hors préfixe --mh-", () => {
    expect(new Set(names).size).toBe(names.length);
    expect(declaredNames(tokensCss).length).toBe((tokensCss.match(/^\s*--[a-z]/gm) ?? []).length);
  });

  it("couvre les familles fonds, texte, panneaux, accents, typo, mouvement et espacement", () => {
    for (const n of [
      "--mh-bg-night-top",
      "--mh-text-menu",
      "--mh-panel-fill",
      "--mh-focus",
      "--mh-font-text",
      "--mh-text-size",
      "--mh-dur-fast",
      "--mh-ease",
      "--mh-space-1",
      "--mh-margin-screen",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("ne contient que des déclarations de variables (aucune règle visuelle, aucun asset)", () => {
    expect(tokensCss).not.toMatch(/url\(/);
    const withoutComments = tokensCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...withoutComments.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim());
    expect(selectors).toEqual([":root", "@media (prefers-reduced-motion: reduce)", ":root"]);
  });

  it("met toutes les durées --mh-dur-* à 0ms sous prefers-reduced-motion", () => {
    const durations = names.filter((n) => n.startsWith("--mh-dur-"));
    expect(durations.length).toBe(6);
    const body = reducedMotionBody(tokensCss);
    for (const d of durations) {
      expect(body).toMatch(new RegExp(`${d}\\s*:\\s*0ms\\s*;`));
    }
  });

  it("garde la frappe du texte hors des durées neutralisées (aucun token de frappe)", () => {
    expect(names.some((n) => /type|typing/.test(n))).toBe(false);
  });
});

describe("main.ts : branchement de la feuille", () => {
  it("importe tokens.css avant les écrans (ui-manager.css est chargé via ui-manager.ts)", () => {
    const main = readFileSync(resolve(root, "src/main.ts"), "utf8");
    const tokensAt = main.indexOf('import "./ui/tokens.css"');
    const uiAt = main.indexOf('from "./ui/ui-manager.js"');
    expect(tokensAt).toBeGreaterThanOrEqual(0);
    expect(tokensAt).toBeLessThan(uiAt);
  });
});
