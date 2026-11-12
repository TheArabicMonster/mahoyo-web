import { describe, it, expect, vi } from "vitest";
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

describe("AssetResolver — assets absents du manifest (#143)", () => {
  const manifest: AssetManifest = {
    version: 1,
    generatedAt: "2026-01-01T00:00:00Z",
    images: { aoko: { url: "image/aoko.webp", source: "fg/aoko.tlg", kind: "image" } },
    audio: { m19: { url: "bgm/m19.ogg", source: "bgm/m19.ogg", kind: "bgm" } },
    scenarios: {},
  };

  it("n'avertit qu'une fois par asset absent, même résolu à chaque étape", () => {
    const calls: string[] = [];
    const resolver = createAssetResolver({ manifest, onMissing: (kind, key) => calls.push(`${kind}:${key}`) });
    for (let i = 0; i < 50; i++) {
      resolver.image("inconnu|a");
      resolver.image("inconnu|b");
      resolver.se("voix_inconnue");
      resolver.se("VOIX_INCONNUE");
      resolver.reportMissing("audio", "voix_inconnue");
    }
    expect(calls).toEqual(["image:inconnu", "audio:voix_inconnue"]);
  });

  it("garde l'URL de repli (le fichier peut exister hors manifest)", () => {
    const resolver = createAssetResolver({ manifest, onMissing: () => {} });
    expect(resolver.se("voix_inconnue")).toBe("/assets/se/voix_inconnue.ogg");
  });

  it("n'avertit pas pour un asset présent, une couleur solide ou un nom vide", () => {
    const calls: string[] = [];
    const resolver = createAssetResolver({ manifest, onMissing: (k, n) => calls.push(`${k}:${n}`) });
    resolver.image("aoko");
    resolver.bgm("m19");
    resolver.background("black");
    resolver.image("");
    expect(calls).toEqual([]);
  });

  it("n'avertit pas sans manifest (mode convention)", () => {
    const calls: string[] = [];
    const resolver = createAssetResolver({ onMissing: (k, n) => calls.push(`${k}:${n}`) });
    resolver.image("inconnu");
    expect(calls).toEqual([]);
  });

  it("par défaut, avertit via console.warn une seule fois", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const resolver = createAssetResolver({ manifest });
      resolver.image("inconnu");
      resolver.image("inconnu");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("AssetResolver.uiImage (#189)", () => {
  const m: AssetManifest = {
    version: 1,
    generatedAt: "2026-01-01T00:00:00Z",
    images: { "cadre test": { url: "image/cadre.webp", source: "image/cadre.tlg", kind: "image" } },
    audio: {},
    scenarios: {},
  };

  it("renvoie l URL complète d une clé présente, null sinon, sans avertissement", () => {
    const onMissing = vi.fn();
    const resolver = createAssetResolver({ baseUrl: "/a", manifest: m, onMissing });
    expect(resolver.uiImage("Cadre Test")).toBe("/a/image/cadre.webp");
    expect(resolver.uiImage("absente")).toBeNull();
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("sans manifest : null (aucune convention de dossier)", () => {
    expect(createAssetResolver().uiImage("cadre test")).toBeNull();
  });
});

describe("AssetResolver — énumération des images (galerie CG, HUD-15)", () => {
  it("liste les images du manifeste avec l'URL absolue", () => {
    const manifest: AssetManifest = {
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      images: {
        cg01: { url: "image/cg01.webp", source: "image/cg01.tlg", kind: "image" },
        bg01: { url: "bg/bg01.webp", source: "bg/bg01.tlg", kind: "bg" },
      },
      audio: {},
      scenarios: {},
    };
    const entries = createAssetResolver({ manifest }).imageEntries();
    expect(entries).toEqual([
      { key: "bg01", url: "/assets/bg/bg01.webp", kind: "bg", source: "bg/bg01.tlg" },
      { key: "cg01", url: "/assets/image/cg01.webp", kind: "image", source: "image/cg01.tlg" },
    ]);
  });

  it("sans manifeste : aucune entrée (le repli par convention ne permet pas de lister)", () => {
    expect(createAssetResolver().imageEntries()).toEqual([]);
  });
});

describe("AssetResolver — énumération des sons (galerie sonore, HUD-16)", () => {
  it("liste les sons du manifeste avec l'URL absolue et les métadonnées utilisateur", () => {
    const manifest: AssetManifest = {
      version: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      images: {},
      audio: {
        bgm01: { url: "bgm/a.ogg", source: "bgm/a.ogg", kind: "bgm", title: "Titre utilisateur", composer: "Compositeur" },
        se01: { url: "se/s.ogg", source: "sound/s.wav", kind: "se" },
      },
      scenarios: {},
    };
    expect(createAssetResolver({ manifest }).audioEntries()).toEqual([
      { key: "bgm01", url: "/assets/bgm/a.ogg", kind: "bgm", source: "bgm/a.ogg", title: "Titre utilisateur", composer: "Compositeur" },
      { key: "se01", url: "/assets/se/s.ogg", kind: "se", source: "sound/s.wav" },
    ]);
  });

  it("sans manifeste : aucune entrée", () => {
    expect(createAssetResolver().audioEntries()).toEqual([]);
  });
});

describe("AssetResolver — audio : extension/casse sans ambiguïté (#354)", () => {
  const audioManifest: AssetManifest = {
    version: 1,
    generatedAt: "2026-01-01T00:00:00Z",
    images: {},
    audio: {
      m19: { url: "bgm/m19.ogg", source: "bgm/m19.ogg", kind: "bgm" },
      m39: { url: "bgm/m39.ogg", source: "bgm/m39.ogg", kind: "bgm" },
      m50: { url: "bgm/m50.ogg", source: "bgm/m50.ogg", kind: "bgm" },
    },
    scenarios: {},
  };
  const audio = (manifest: AssetManifest) => {
    const missing: string[] = [];
    return { resolver: createAssetResolver({ manifest, onMissing: (_k, n) => missing.push(n) }), missing };
  };

  it("résout la casse (M19→m19, M39→m39)", () => {
    const { resolver, missing } = audio(audioManifest);
    expect(resolver.bgm("M19")).toBe("/assets/bgm/m19.ogg");
    expect(resolver.bgm("M39")).toBe("/assets/bgm/m39.ogg");
    expect(missing).toEqual([]);
  });

  it("résout l'extension retirée (m50.ogg→m50)", () => {
    const { resolver, missing } = audio(audioManifest);
    expect(resolver.bgm("m50.ogg")).toBe("/assets/bgm/m50.ogg");
    expect(resolver.se("m50.OGG")).toBe("/assets/bgm/m50.ogg");
    expect(missing).toEqual([]);
  });

  it("rapproche aussi une clé de manifeste qui porte l'extension", () => {
    const manifest: AssetManifest = {
      ...audioManifest,
      audio: { "m50.ogg": { url: "bgm/m50.ogg", source: "bgm/m50.ogg", kind: "bgm" } },
    };
    const { resolver } = audio(manifest);
    expect(resolver.bgm("m50")).toBe("/assets/bgm/m50.ogg");
    expect(resolver.bgm("M50.ogg")).toBe("/assets/bgm/m50.ogg");
  });

  it("bgm101.ogg réellement absent : repli convention + un seul avertissement", () => {
    const { resolver, missing } = audio(audioManifest);
    expect(resolver.bgm("bgm101.ogg")).toBe("/assets/bgm/bgm101.ogg");
    resolver.bgm("bgm101.ogg");
    resolver.bgm("bgm101");
    expect(missing).toEqual(["bgm101"]);
  });

  it("collision : la correspondance exacte est prioritaire", () => {
    const manifest: AssetManifest = {
      ...audioManifest,
      audio: {
        M19: { url: "bgm/M19.ogg", source: "bgm/M19.ogg", kind: "bgm" },
        m19: { url: "bgm/m19.ogg", source: "bgm/m19.ogg", kind: "bgm" },
      },
    };
    const { resolver, missing } = audio(manifest);
    expect(resolver.bgm("M19")).toBe("/assets/bgm/M19.ogg");
    expect(resolver.bgm("m19")).toBe("/assets/bgm/m19.ogg");
    expect(resolver.bgm("m19.ogg")).toBe("/assets/bgm/m19.ogg");
    expect(missing).toEqual([]);
  });

  it("ambiguïté sans exact : ne choisit pas au hasard et signale l'absence une fois", () => {
    const manifest: AssetManifest = {
      ...audioManifest,
      audio: {
        "M19.ogg": { url: "bgm/M19.ogg", source: "bgm/M19.ogg", kind: "bgm" },
        "m19.wav": { url: "bgm/m19.ogg", source: "bgm/m19.wav", kind: "bgm" },
      },
    };
    const { resolver, missing } = audio(manifest);
    expect(resolver.bgm("m19.mp3")).toBe("/assets/bgm/m19.ogg");
    expect(missing).toEqual(["m19"]);
    // Une requête exacte reste résolue sans ambiguïté.
    expect(resolver.bgm("M19.ogg")).toBe("/assets/bgm/M19.ogg");
  });
});

describe("AssetResolver — présence et taille audio (#394)", () => {
  const manifest: AssetManifest = {
    version: 1,
    generatedAt: "2026-01-01T00:00:00Z",
    images: {},
    audio: {
      m19: { url: "bgm/m19.ogg", source: "bgm/m19.ogg", kind: "bgm", size: 123456 },
      se01: { url: "se/se01.ogg", source: "se/se01.ogg", kind: "se" },
    },
    scenarios: {},
  };

  it("hasAudio distingue les refs absentes (voix Steam) des présentes", () => {
    const resolver = createAssetResolver({ manifest });
    expect(resolver.hasAudio("M19")).toBe(true);
    expect(resolver.hasAudio("se01")).toBe(true);
    expect(resolver.hasAudio("a10_5a_8_0002")).toBe(false);
    expect(resolver.audioSize("m19")).toBe(123456);
    expect(resolver.audioSize("se01")).toBeNull();
  });

  it("sans manifeste, la présence est inconnue (convention) et la taille null", () => {
    const resolver = createAssetResolver();
    expect(resolver.hasAudio("a10_5a_8_0002")).toBe(true);
    expect(resolver.audioSize("m19")).toBeNull();
  });
});
