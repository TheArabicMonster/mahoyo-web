import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WEB-06 (#211) : preuves statiques d'accessibilité des écrans système.
 *
 * jsdom ne calcule ni la mise en page ni les media queries : on contrôle la source (focus, mouvement
 * réduit, rôles) et on calcule les contrastes WCAG depuis `tokens.css`. Les mesures réelles
 * (outline calculé, focus piégé, axe-core) sont vérifiées par `tests/e2e/system-a11y.spec.ts`.
 */

const root = resolve(__dirname, "../../..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

const tokens = read("src/ui/tokens.css");
const uiManager = read("src/ui/ui-manager.css");
const screenCss = {
  "menu système": "src/ui/system-menu.css",
  "confirmation": "src/ui/confirm-dialog.css",
  "sauvegarde/chargement": "src/ui/save-load-screen.css",
  "historique": "src/ui/backlog-screen.css",
  "configuration": "src/ui/config-screen.css",
  "Extra/Archive": "src/ui/archive-view.css",
} as const;

/** Couleur `--mh-*` lue dans `tokens.css` (valeur hexadécimale du bloc `:root`). */
function token(name: string): string {
  const match = tokens.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!match) throw new Error(`token introuvable : --${name}`);
  return match[1]!;
}

/** Contraste WCAG 2.x entre deux couleurs hexadécimales (sRGB → luminance relative). */
function luminance(hex: string): number {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized.slice(0, 6);
  const channels = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}

describe("focus visible global (DESIGN §10)", () => {
  const code = stripComments(uiManager);

  it("pose un filet de sécurité de spécificité nulle pour tous les contrôles", () => {
    expect(code).toMatch(/:where\([^)]*button[^)]*\):focus-visible/);
    expect(code).toMatch(/outline:\s*2px solid var\(--mh-focus/);
    expect(code).toMatch(/outline-offset:\s*2px/);
  });

  it("dessine l'anneau de repli des focus programmatiques (#257)", () => {
    expect(code).toMatch(/\[data-focus-ring="true"\]:focus/);
    expect(code).toMatch(/outline:\s*2px solid var\(--mh-focus/);
    const title = stripComments(read("src/ui/title-screen.css"));
    // Écran titre sur fond clair : la couleur sombre documentée est conservée sur le repli.
    expect(title).toMatch(/\[data-focus-ring="true"\]:focus[^{]*\{[^}]*outline-color:\s*var\(--mh-ink-hover/);
  });

  it("le module de modalité d'entrée est branché au démarrage et documenté", () => {
    expect(read("src/main.ts")).toMatch(/installFocusRingFallback\(\)/);
    expect(read("src/ui/focus-modality.ts")).toMatch(/data-focus-ring/);
  });

  it("n'utilise pas `outline: none` comme style de focus", () => {
    expect(stripComments(uiManager)).not.toMatch(/outline:\s*none/);
  });

  it.each(Object.entries(screenCss))("l'écran %s a une règle de focus visible cyan 2 px", (_label, rel) => {
    const css = stripComments(read(rel));
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline:\s*2px solid var\(--mh-focus/);
  });

  it("l'écran titre garde son contour sombre sur fond clair (exception documentée DESIGN §9.3)", () => {
    const css = stripComments(read("src/ui/title-screen.css"));
    expect(css).toMatch(/\.mh-ui-title-entry:focus[^{]*\{[^}]*outline:\s*2px solid var\(--mh-ink-hover/);
  });

  it("les zones défilantes focalisables sous Firefox ont un focus visible (config, Archive)", () => {
    // Firefox met les conteneurs défilants dans l'ordre de tabulation : sans règle, le focus y serait
    // invisible (échec CI Firefox de #326). On verrouille la règle pour les deux écrans concernés.
    const config = stripComments(read("src/ui/config-screen.css"));
    expect(config).toMatch(/\.mh-cfg-col:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--mh-focus/);
    const archive = stripComments(read("src/ui/archive-view.css"));
    expect(archive).toMatch(/\.mh-ui-title-chapters:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--mh-focus/);
  });

  it("sauvegarde/chargement : décalage de focus de 2 px partout, comme le 2 px du DESIGN", () => {
    const css = stripComments(read("src/ui/save-load-screen.css"));
    const offsets = [...css.matchAll(/outline-offset:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThan(0);
    expect(offsets.every((offset) => offset === 2)).toBe(true);
  });
});

describe("prefers-reduced-motion (DESIGN §10)", () => {
  it("la scène coupe toutes ses animations et transitions sous mouvement réduit", () => {
    const stage = read("src/renderer/stage-renderer.ts");
    const reduced = stage.slice(stage.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.mh-stage-indicator[\s\S]*?animation:\s*none/);
    expect(reduced).toMatch(/\.mh-stage-haze[\s\S]*?animation:\s*none/);
    expect(reduced).toMatch(/\.mh-stage-wait-on[\s\S]*?animation:\s*none/);
    expect(reduced).toMatch(/\.mh-stage-textbox[\s\S]*?transition:\s*none/);
    expect(reduced).toMatch(/\.mh-stage-wait[\s\S]*?transition:\s*none/);
    // Les glyphes image ont une spécificité plus forte : ils sont repris explicitement.
    expect(reduced).toMatch(/\.mh-glyph-line-ok\[data-style="line"\]/);
    expect(reduced).toMatch(/\.mh-glyph-page-ok\[data-style="page"\]/);
  });

  it("chaque écran animé neutralise son mouvement (bloc réduit ou durée `--mh-dur-*` tokenisée à 0)", () => {
    for (const [label, rel] of Object.entries(screenCss)) {
      const css = stripComments(read(rel));
      if (!/animation|transition/.test(css)) continue;
      const reducedByBlock = /@media \(prefers-reduced-motion: reduce\)/.test(css);
      const reducedByToken = /(?:animation|transition)[^;]*var\(--mh-dur-[a-z-]+/.test(css);
      expect(reducedByBlock || reducedByToken, `${label} : mouvement non neutralisé sous prefers-reduced-motion`).toBe(true);
    }
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*--mh-dur-menu:\s*0ms/);
  });
});

describe("contrastes conformes (DESIGN §10)", () => {
  it.each([
    ["texte d'interface sur panneau", "mh-text-ui", "mh-panel-fill", 4.5],
    ["texte de menu sur nuit", "mh-text-menu", "mh-bg-night-mid", 7],
    ["libellé de panneau", "mh-panel-label", "mh-panel-fill", 7],
    ["titre sur nuit", "mh-text-title", "mh-bg-night-top", 7],
    ["texte de choix sur panneau", "mh-text-menu", "mh-panel-fill", 7],
  ] as const)("%s (%s / %s) ≥ %s:1", (_label, fg, bg, min) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });

  it("le contour de focus est visible sur les fonds sombres (≥ 3:1, WCAG 1.4.11)", () => {
    for (const surface of ["mh-bg-night-top", "mh-panel-fill", "mh-bg-night-mid"]) {
      expect(contrast(token("mh-focus"), token(surface)), `focus sur ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});
