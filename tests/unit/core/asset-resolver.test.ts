import { describe, it, expect } from "vitest";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { AssetManifest } from "@/core/asset-manifest.js";

describe("AssetResolver — convention (sans manifest)", () => {
  it("resolves background, image and audio URLs", () => {
    const resolver = createAssetResolver();
    expect(resolver.background("black")).toBe("/assets/bg/black.webp");
    expect(resolver.image("青子")).toBe("/assets/image/青子.webp");
    expect(resolver.bgm("m01")).toBe("/assets/bgm/m01.ogg");
    expect(resolver.se("se01")).toBe("/assets/se/se01.ogg");
    expect(resolver.rule("rule01")).toBe("/assets/rule/rule01.png");
    expect(resolver.scenario("1-0.ks")).toBe("/assets/scenario/1-0.ks");
    expect(resolver.scenario("1-0")).toBe("/assets/scenario/1-0.ks");
  });

  it("strips suffixes from storage names", () => {
    const resolver = createAssetResolver();
    expect(resolver.background("black|night")).toBe("/assets/bg/black.webp");
  });

  it("normalizes storage keys (lowercase, no extension)", () => {
    const resolver = createAssetResolver();
    expect(resolver.image("Aoko.tlg|b")).toBe("/assets/image/aoko.webp");
    expect(resolver.background("BG/Night.PNG")).toBe("/assets/bg/night.webp");
  });

  it("accepts a custom base URL", () => {
    const resolver = createAssetResolver({ baseUrl: "/static" });
    expect(resolver.background("black")).toBe("/static/bg/black.webp");
  });
});

describe("AssetResolver — avec manifest", () => {
  const manifest: AssetManifest = {
    version: 1,
    generatedAt: "2026-01-01T00:00:00Z",
    images: {
      "aoko": { url: "image/aoko.webp", source: "fg/aoko.tlg", kind: "image" },
      "bg01": { url: "bg/bg01.webp", source: "bg/bg01.tlg", kind: "bg" },
      "crossfade": { url: "rule/crossfade.png", source: "rule/crossfade.png", kind: "rule" },
    },
    audio: {
      "m19": { url: "bgm/m19.ogg", source: "bgm/m19.ogg", kind: "bgm" },
      "se01132": { url: "se/se01132.ogg", source: "sound/se01132.wav", kind: "se" },
    },
    scenarios: {
      "1-0": { url: "scenario/1-0.ks", source: "data/scenario/1-0.ks", encoding: "utf-16le" },
    },
  };

  it("résout via le manifest", () => {
    const resolver = createAssetResolver({ manifest });
    expect(resolver.image("Aoko")).toBe("/assets/image/aoko.webp");
    expect(resolver.background("bg01")).toBe("/assets/bg/bg01.webp");
    expect(resolver.rule("crossfade")).toBe("/assets/rule/crossfade.png");
  });

  it("résout l'audio via le manifest", () => {
    const resolver = createAssetResolver({ manifest });
    expect(resolver.bgm("m19")).toBe("/assets/bgm/m19.ogg");
    expect(resolver.se("se01132")).toBe("/assets/se/se01132.ogg");
  });

  it("résout les scénarios via le manifest", () => {
    const resolver = createAssetResolver({ manifest });
    expect(resolver.scenario("1-0")).toBe("/assets/scenario/1-0.ks");
  });

  it("normalise la clé avant la recherche manifest", () => {
    const resolver = createAssetResolver({ manifest });
    // "Aoko.tlg|b" → clé "aoko" → trouvé dans le manifest
    expect(resolver.image("Aoko.tlg|b")).toBe("/assets/image/aoko.webp");
  });

  it("retombe sur la convention si absent du manifest", () => {
    const resolver = createAssetResolver({ manifest });
    // "unknown" n'est pas dans le manifest → convention
    expect(resolver.image("unknown")).toBe("/assets/image/unknown.webp");
  });

  it("couleurs solides absentes du manifest : convention de repli", () => {
    const resolver = createAssetResolver({ manifest });
    expect(resolver.background("black")).toBe("/assets/bg/black.webp");
    expect(resolver.background("white")).toBe("/assets/bg/white.webp");
  });

  it("couleurs solides présentes dans le manifest : le fichier généré est utilisé (#134)", () => {
    // Le pipeline génère bg/white.png : ignorer le manifest donnait bg/white.webp, inexistant,
    // et le flash blanc du prologue s'affichait noir.
    const withSolids: AssetManifest = {
      ...manifest,
      images: {
        ...manifest.images,
        white: { url: "bg/white.png", source: "bg/white.png", kind: "bg" },
        red: { url: "bg/red.png", source: "bg/red.png", kind: "bg" },
      },
    };
    const resolver = createAssetResolver({ manifest: withSolids });
    expect(resolver.background("white")).toBe("/assets/bg/white.png");
    expect(resolver.image("red")).toBe("/assets/bg/red.png");
    expect(resolver.background("white|x")).toBe("/assets/bg/white.png");
  });

  it("résout un script traduit via translatedScenario", () => {
    const resolver = createAssetResolver();
    expect(resolver.translatedScenario("1-0.ks", "fr")).toBe("/assets/lang/fr/scenario/1-0.ks");
    expect(resolver.translatedScenario("1-0", "fr")).toBe("/assets/lang/fr/scenario/1-0.ks");
  });

  it("résout l'index d'une langue via languageIndex", () => {
    const resolver = createAssetResolver();
    expect(resolver.languageIndex("fr")).toBe("/assets/lang/fr/index.json");
  });

  it("accepte une baseUrl personnalisée pour les langues", () => {
    const resolver = createAssetResolver({ baseUrl: "/static" });
    expect(resolver.translatedScenario("1-0.ks", "en")).toBe("/static/lang/en/scenario/1-0.ks");
    expect(resolver.languageIndex("en")).toBe("/static/lang/en/index.json");
  });
});
