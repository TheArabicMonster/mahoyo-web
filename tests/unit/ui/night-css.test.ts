import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HUD-02 (#188) : fond « nuit bleue » (`src/ui/night.css`). jsdom ne calcule ni les dégradés ni la
 * mise en page : on contrôle la feuille source, et le contraste est calculé à partir des tokens.
 */
const root = resolve(__dirname, "../../..");
const nightCss = readFileSync(resolve(root, "src/ui/night.css"), "utf8");
const tokensCss = readFileSync(resolve(root, "src/ui/tokens.css"), "utf8");

/** Corps (sans accolades) de chaque règle dont le sélecteur est exactement `selector`. */
function bodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.>*[\]():]/g, "\\$&");
  const re = new RegExp(`(?:^|[}\\n,])\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "g");
  return [...css.matchAll(re)].map((m) => m[1]!);
}

function token(name: string): string {
  const m = tokensCss.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`token ${name} introuvable`);
  return m[1]!;
}

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const channel = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
/** Luminance relative WCAG 2.x. */
const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** Rapport de contraste WCAG 2.x (1 à 21). */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** Couleur `fg` d'opacité `alpha` posée sur `bg` (mélange sRGB, comme le navigateur). */
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha))) as Rgb;

/** Opacité (0-1) d'une variable `--x: color-mix(in srgb, var(--mh-y) N%, transparent)` de night.css. */
function ornamentAlpha(name: string): { token: string; alpha: number } {
  const m = nightCss.match(new RegExp(`${name}:\\s*color-mix\\(in srgb,\\s*var\\((--mh-[a-z-]+)\\)\\s*(\\d+)%,\\s*transparent\\)`));
  if (!m) throw new Error(`${name} : color-mix attendu`);
  return { token: m[1]!, alpha: Number(m[2]) / 100 };
}

describe("night.css : structure (DESIGN §2.2)", () => {
  const base = bodies(nightCss, ".mh-ui-night").join("\n");

  it("compose le fond avec les tokens --mh-bg-night-* (dégradé vertical haut -> milieu -> bas)", () => {
    for (const t of ["--mh-bg-night-top", "--mh-bg-night-mid", "--mh-bg-night-mid-right", "--mh-bg-night-bottom"]) {
      expect(base, t).toContain(`var(${t})`);
    }
    expect(base).toMatch(/linear-gradient\(\s*to bottom/);
  });

  it("ne redéclare aucun token du design system", () => {
    const declared = [...nightCss.matchAll(/^\s*(--mh-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!);
    for (const name of declared) {
      expect(tokensCss, name).not.toMatch(new RegExp(`^\\s*${name}\\s*:`, "m"));
      expect(name, "variable locale").toMatch(/^--mh-night-/);
    }
  });

  it("peint feuillage et arabesques dans un seul calque ::before derrière le contenu", () => {
    const before = bodies(nightCss, ".mh-ui-night::before").join("\n");
    expect(before).toMatch(/z-index:\s*-1/);
    expect(before).toMatch(/pointer-events:\s*none/);
    expect(before.match(/var\(--mh-night-arabesque(?:-faint)?\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    // Silhouettes de feuillage : couleur la plus sombre du fond, haut et bas.
    expect(before.match(/var\(--mh-bg-night-top\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    // Autant de tailles/positions/répétitions que de calques.
    const layers = (before.match(/(?:radial|linear|conic)-gradient\(/g) ?? []).length;
    for (const prop of ["background-size", "background-position", "background-repeat"]) {
      const value = before.match(new RegExp(`${prop}:([^;]*);`))?.[1] ?? "";
      expect(value.split(",").length, prop).toBe(layers);
    }
  });

  it("les bandeaux restent dans les proportions mesurées (haut ~13 %, bas ~14 % de la hauteur)", () => {
    // 140 px et 150 px sur 1080 px ; en pourcentage, donc sans dépendance au repère (1920, 1280 ou 1024).
    const before = bodies(nightCss, ".mh-ui-night::before").join("\n");
    const sizes = (before.match(/background-size:([^;]*);/)?.[1] ?? "").split(",").map((s) => s.trim());
    const heights = sizes.map((s) => parseFloat(s.split(/\s+/)[1] ?? "0"));
    const bands = heights.filter((h) => h > 0 && h < 100);
    expect(Math.max(...bands)).toBeGreaterThanOrEqual(13);
    expect(Math.max(...bands)).toBeLessThanOrEqual(15);
  });
});

describe("night.css : surcouche d'image optionnelle (DESIGN §9)", () => {
  it("n'a aucune URL : sans variable d'asset, aucune requête d'image", () => {
    expect(nightCss).not.toMatch(/url\(/);
    expect(nightCss).not.toMatch(/@import/);
  });

  it("peint l'image du manifeste (--mh-asset-night, sinon c_background) au-dessus du rendu CSS, repli `none`", () => {
    const after = bodies(nightCss, ".mh-ui-night::after").join("\n");
    expect(after).toContain("var(--mh-asset-night, var(--mh-asset-c_background, none))");
    expect(after).toMatch(/z-index:\s*-1/);
    expect(nightCss).not.toMatch(/--mh-asset-night\s*:/); // optionnelle : posée par un écran, jamais par night.css
  });

  it("la variante voile n'affiche pas l'image (scène visible dessous)", () => {
    expect(bodies(nightCss, ".mh-ui-night-veil::after").join("\n")).toMatch(/background:\s*none/);
  });
});

describe("night.css : contraste texte/fond >= 7:1", () => {
  const texts = ["--mh-text", "--mh-text-ui", "--mh-text-menu", "--mh-text-menu-hover", "--mh-text-title"];
  const backgrounds = ["--mh-bg-night-top", "--mh-bg-night-mid", "--mh-bg-night-mid-right", "--mh-bg-night-bottom"];
  const bandBase = nightCss.match(/--mh-night-band-base:\s*(#[0-9a-fA-F]{6})/)?.[1] ?? "";

  it("le fond de bandeau est déclaré", () => {
    expect(bandBase).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  for (const text of texts) {
    for (const bg of [...backgrounds, "bandeau"]) {
      it(`${text} sur ${bg}`, () => {
        const bgRgb = toRgb(bg === "bandeau" ? bandBase : token(bg));
        expect(contrast(toRgb(token(text)), bgRgb)).toBeGreaterThanOrEqual(7);
      });
    }
  }

  it("le pire cas d'une arabesque (opacité maximale sur le fond le plus clair) reste >= 7:1", () => {
    const lightest = toRgb(token("--mh-bg-night-mid-right"));
    for (const name of ["--mh-night-arabesque", "--mh-night-arabesque-faint"]) {
      const { token: tok, alpha } = ornamentAlpha(name);
      const line = over(toRgb(token(tok)), alpha, lightest);
      for (const text of texts) {
        expect(contrast(toRgb(token(text)), line), `${text} sur ${name}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("les opacités d'ornements sont des pourcentages entiers <= 40 %", () => {
    for (const name of ["--mh-night-arabesque", "--mh-night-arabesque-faint"]) {
      const { alpha } = ornamentAlpha(name);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(0.4);
    }
  });
});

describe("night.css : voile (DESIGN §6)", () => {
  it("la scène reste devinable : voile #152539 à 80-85 %", () => {
    expect(nightCss).toMatch(/--mh-night-veil:\s*#152539/);
    const alpha = Number(nightCss.match(/--mh-night-veil-alpha:\s*(\d+)%/)?.[1]);
    expect(alpha).toBeGreaterThanOrEqual(80);
    expect(alpha).toBeLessThanOrEqual(85);
  });

  it("un noir de scène sous le voile donne un bleu nuit sombre où le texte reste >= 7:1", () => {
    const veiled = over(toRgb("#152539"), 0.82, [0, 0, 0]);
    expect(contrast(toRgb(token("--mh-text-menu")), veiled)).toBeGreaterThanOrEqual(7);
  });
});
