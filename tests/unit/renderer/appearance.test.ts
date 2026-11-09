/**
 * Apparence des calques (#252) : mapping `type=`/`effect=`/blur/brightness/contrast vers CSS.
 *
 * Les valeurs de `type` et la sémantique des effets viennent des sources du moteur installé
 * (non commitées) : `data/scenario/noiseplugin.tjs` (constantes numériques) et
 * `data/override/animationlayer.override.tjs` (application des effets).
 */
import { describe, it, expect } from "vitest";
import {
  LAYER_TYPE_BLEND_MODES,
  UNMAPPED_LAYER_TYPES,
  appearanceBlendMode,
  appearanceFilter,
  boxBlurSigma,
  contrastFactor,
  effectFilter,
  isEnvironmentEffect,
  type Appearance,
  type SvgFilterRegistry,
} from "@/renderer/appearance.js";
import { applyAppearance } from "@/renderer/appearance.js";

/** Registre factice : rend lisible le filtre attendu sans DOM. */
const fakeRegistry: SvgFilterRegistry = {
  monoFilter: (color) => `url(#mono-${color.replace("#", "")})`,
  channelFilter: (channel) => `url(#channel-${channel})`,
  brightnessContrastFilter: (brightness, factor) => `url(#bc-${brightness}-${factor})`,
  blurFilter: (sx, sy) => `url(#blur-${sx}-${sy})`,
};

describe("mapping des modes de fusion (type=)", () => {
  it("mappe les codes du corpus sur les modes CSS correspondants", () => {
    expect(appearanceBlendMode(2)).toBe("normal"); // ltAlpha
    expect(appearanceBlendMode(5)).toBe("multiply"); // ltMultiplicative
    expect(appearanceBlendMode(11)).toBe("screen"); // ltScreen
    expect(appearanceBlendMode(13)).toBe("normal"); // ltPsNormal (le plus fréquent)
    expect(appearanceBlendMode(16)).toBe("multiply"); // ltPsMultiplicative
    expect(appearanceBlendMode(17)).toBe("screen"); // ltPsScreen
    expect(appearanceBlendMode(18)).toBe("overlay"); // ltPsOverlay
    expect(appearanceBlendMode(19)).toBe("hard-light"); // ltPsHardLight
    expect(appearanceBlendMode(22)).toBe("color-dodge"); // ltPsColorDodge5 (approx.)
    expect(appearanceBlendMode(28)).toBe("exclusion"); // ltPsExclusion
  });

  it("ne rend rien pour un type absent, inconnu ou sans équivalent", () => {
    expect(appearanceBlendMode(undefined)).toBe("");
    expect(appearanceBlendMode(99)).toBe("");
    expect(appearanceBlendMode(1)).toBe(""); // ltOpaque
    expect(appearanceBlendMode(4)).toBe(""); // ltSubtractive
  });

  it("tous les types du corpus (1..28 connus) sont couverts par la table", () => {
    // Valeurs réellement présentes dans les 251 scripts : 1-28 sauf 6/7.
    for (const type of [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]) {
      expect(LAYER_TYPE_BLEND_MODES[type]).toBeDefined();
    }
    expect([...UNMAPPED_LAYER_TYPES]).toEqual([1, 4]);
  });
});

describe("filtres d'effet (effect=)", () => {
  it("mappe les effets intrinsèques sur les fonctions CSS/SVG", () => {
    expect(effectFilter("monocro", fakeRegistry)).toBe("grayscale(1)");
    expect(effectFilter("monochrome", fakeRegistry)).toBe("grayscale(1)");
    expect(effectFilter("nega", fakeRegistry)).toBe("invert(1)");
    expect(effectFilter("sepia", fakeRegistry)).toBe("sepia(1)");
    expect(effectFilter("red", fakeRegistry)).toBe("url(#channel-red)");
    expect(effectFilter("green", fakeRegistry)).toBe("url(#channel-green)");
  });

  it("mono<rrggbb> = aplat de couleur conservant l'alpha (filtre SVG)", () => {
    expect(effectFilter("monoffffff", fakeRegistry)).toBe("url(#mono-ffffff)");
    expect(effectFilter("mono09092d", fakeRegistry)).toBe("url(#mono-09092d)");
    expect(effectFilter("mono000000", fakeRegistry)).toBe("url(#mono-000000)");
  });

  it("n'applique pas les effets d'ambiance du jeu (données envcolor.ksc non installées)", () => {
    expect(effectFilter("屋外深夜", fakeRegistry)).toBeNull();
    expect(effectFilter("mh屋内曇り", fakeRegistry)).toBeNull();
    expect(isEnvironmentEffect("屋外深夜")).toBe(true);
    expect(isEnvironmentEffect("mh居間灯り")).toBe(true);
    expect(isEnvironmentEffect("monocro")).toBe(false);
    expect(isEnvironmentEffect("monoff1313")).toBe(false);
    expect(isEnvironmentEffect(undefined)).toBe(false);
  });

  it("aucun effet / effet inconnu : pas de filtre", () => {
    expect(effectFilter(undefined, fakeRegistry)).toBeNull();
    expect(effectFilter("none", fakeRegistry)).toBeNull();
    expect(effectFilter("inconnu", fakeRegistry)).toBeNull();
  });
});

describe("luminosité, contraste et flou", () => {
  it("facteur de contraste : (c + 255) / 255", () => {
    expect(contrastFactor(0)).toBe(1);
    expect(contrastFactor(80)).toBeCloseTo(1.3137, 3);
    expect(contrastFactor(-40)).toBeCloseTo(0.8431, 3);
  });

  it("sigma du double box blur : sqrt(2r(r+1)/3)", () => {
    expect(boxBlurSigma(0)).toBe(0);
    expect(boxBlurSigma(8)).toBeCloseTo(6.9282, 3);
    expect(boxBlurSigma(2)).toBeCloseTo(2, 5);
  });

  it("compose les filtres dans l'ordre du moteur : effet → luminosité/contraste → flou", () => {
    const appearance: Appearance = { effect: "monoff1313", brightness: -20, contrast: 40, blurx: 8, blury: 8 };
    expect(appearanceFilter(appearance, fakeRegistry)).toBe(
      `url(#mono-ff1313) url(#bc--20-${contrastFactor(40)}) blur(${boxBlurSigma(8).toFixed(2)}px)`,
    );
  });

  it("flou anisotrope : filtre SVG (stdDeviation X Y)", () => {
    const appearance: Appearance = { blurx: 8, blury: 2 };
    expect(appearanceFilter(appearance, fakeRegistry)).toBe(
      `url(#blur-${boxBlurSigma(8)}-${boxBlurSigma(2)})`,
    );
  });

  it("apparence vide : aucun filtre", () => {
    expect(appearanceFilter({}, fakeRegistry)).toBe("");
    expect(appearanceFilter({ brightness: 0, contrast: 0, blurx: 0, blury: 0 }, fakeRegistry)).toBe("");
  });
});

describe("applyAppearance", () => {
  const el = () => document.createElement("img");

  it("pose filtre et mode de fusion", () => {
    const img = el();
    applyAppearance(img, { effect: "monocro", type: 16 }, fakeRegistry);
    expect(img.style.filter).toBe("grayscale(1)");
    expect(img.style.mixBlendMode).toBe("multiply");
  });

  it("retire les valeurs quand l'apparence est vide", () => {
    const img = el();
    applyAppearance(img, { effect: "nega", type: 11 }, fakeRegistry);
    expect(img.style.filter).toBe("invert(1)");
    applyAppearance(img, undefined, fakeRegistry);
    expect(img.style.filter).toBe("");
    expect(img.style.mixBlendMode).toBe("");
  });
});
