import { describe, it, expect } from "vitest";
import { classifyAsset, webExtension, webPathFor } from "../../../tools/inventory.js";

describe("classifyAsset", () => {
  it("classe par dossier bg/ → bg", () => {
    expect(classifyAsset("bg/night.tlg")).toBe("bg");
    expect(classifyAsset("bg/BG01.PNG")).toBe("bg");
  });

  it("classe par dossier fg/ → image", () => {
    expect(classifyAsset("fg/aoko.tlg")).toBe("image");
  });

  it("classe par dossier image/ → image", () => {
    expect(classifyAsset("image/about.png")).toBe("image");
  });

  it("classe par dossier rule/ → rule", () => {
    expect(classifyAsset("rule/crossfade.png")).toBe("rule");
  });

  it("classe par dossier bgm/ → bgm", () => {
    expect(classifyAsset("bgm/m19.ogg")).toBe("bgm");
  });

  it("classe par dossier sound/ → se", () => {
    expect(classifyAsset("sound/se01132.wav")).toBe("se");
  });

  it("classe data/scenario/*.ks → scenario", () => {
    expect(classifyAsset("data/scenario/1-0.ks")).toBe("scenario");
    expect(classifyAsset("scenario/1-0.ks")).toBe("scenario");
  });

  it("classe .ks sans dossier → scenario", () => {
    expect(classifyAsset("1-0.ks")).toBe("scenario");
  });

  it("retombe sur l'extension si pas de dossier", () => {
    expect(classifyAsset("night.tlg")).toBe("image");
    expect(classifyAsset("m01.ogg")).toBe("bgm");
    expect(classifyAsset("se01.wav")).toBe("se");
  });

  it("gère les chemins avec backslash", () => {
    expect(classifyAsset("bg\\night.tlg")).toBe("bg");
    expect(classifyAsset("sound\\se01.wav")).toBe("se");
  });
});

describe("webExtension", () => {
  it("retourne .webp pour les images", () => {
    expect(webExtension("bg")).toBe(".webp");
    expect(webExtension("image")).toBe(".webp");
  });

  it("retourne .png pour les rules", () => {
    expect(webExtension("rule")).toBe(".png");
  });

  it("retourne .ogg pour l'audio", () => {
    expect(webExtension("bgm")).toBe(".ogg");
    expect(webExtension("se")).toBe(".ogg");
  });

  it("retourne .ks pour les scénarios", () => {
    expect(webExtension("scenario")).toBe(".ks");
  });
});

describe("webPathFor", () => {
  it("construit le chemin web correct", () => {
    expect(webPathFor("bg", "night")).toBe("bg/night.webp");
    expect(webPathFor("image", "aoko")).toBe("image/aoko.webp");
    expect(webPathFor("rule", "crossfade")).toBe("rule/crossfade.png");
    expect(webPathFor("bgm", "m19")).toBe("bgm/m19.ogg");
    expect(webPathFor("se", "se01132")).toBe("se/se01132.ogg");
    expect(webPathFor("scenario", "1-0")).toBe("scenario/1-0.ks");
  });

  it("gère les clés avec caractères japonais", () => {
    expect(webPathFor("image", "山城01(近)")).toBe("image/山城01(近).webp");
  });
});
