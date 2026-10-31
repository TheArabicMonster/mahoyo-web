/**
 * Recherche dans le manifest avec repli sur la clé « repliée » (#153).
 * Les noms ci-dessous sont inventés.
 */
import { describe, it, expect } from "vitest";
import { foldKey, lookupAudio, lookupImage, type AssetManifest } from "@/core/asset-manifest.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import { storageKey } from "@/core/storage-key.js";

const entry = (url: string) => ({ url, source: url, kind: "image" as const });

const manifest: AssetManifest = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00Z",
  images: {
    // Fichier dont le nom contient une lettre pleine chasse, référencé en ASCII par un script.
    "im99ｌ série test": entry("image/a.png"),
    "im98lettre ascii": entry("image/b.png"),
    // Clé générée avant que storageKey ne retire l'espace avant l'extension.
    "bg99décor test-(nuit) ": { url: "bg/c.png", source: "bg/c.png", kind: "bg" },
    "normale": entry("image/d.png"),
  },
  audio: {
    "voix test ": { url: "bgm/e.ogg", source: "bgm/e.ogg", kind: "bgm" },
  },
  scenarios: {},
};

describe("foldKey", () => {
  it("replie la pleine chasse, les espaces de bordure et la casse", () => {
    expect(foldKey("ＩＭ１ｌ  ")).toBe("im1l");
    expect(foldKey("a（b）")).toBe("a(b)");
  });
});

describe("lookupImage / lookupAudio — repli sur la clé repliée", () => {
  it("trouve la clé exacte sans passer par le repli", () => {
    expect(lookupImage(manifest, "normale")).toBe("image/d.png");
  });

  it("référence ASCII, fichier pleine chasse", () => {
    expect(lookupImage(manifest, storageKey("im99l série test"))).toBe("image/a.png");
  });

  it("référence pleine chasse, fichier ASCII", () => {
    expect(lookupImage(manifest, storageKey("im98ｌettre ascii"))).toBe("image/b.png");
  });

  it("clé de manifest avec espace final, référence sans espace", () => {
    expect(lookupImage(manifest, storageKey("bg99décor test-(nuit)"))).toBe("bg/c.png");
  });

  it("s'applique aussi à l'audio", () => {
    expect(lookupAudio(manifest, "voix test")).toBe("bgm/e.ogg");
  });

  it("une vraie absence reste une absence", () => {
    expect(lookupImage(manifest, "im99-inconnue")).toBeNull();
    expect(lookupImage(manifest, "constructor")).toBeNull();
    expect(lookupAudio(manifest, "")).toBeNull();
    expect(lookupImage(undefined, "normale")).toBeNull();
  });
});

describe("AssetResolver — noms qui diffèrent du fichier", () => {
  it("résout l'image au lieu de la signaler absente", () => {
    const missing: string[] = [];
    const resolver = createAssetResolver({ manifest, onMissing: (_k, n) => missing.push(n) });
    expect(resolver.image("im98ｌettre ascii")).toBe("/assets/image/b.png");
    expect(resolver.background("bg99décor test-(nuit)")).toBe("/assets/bg/c.png");
    expect(resolver.bgm("voix test")).toBe("/assets/bgm/e.ogg");
    expect(missing).toEqual([]);
  });

  it("signale toujours une image réellement absente", () => {
    const missing: string[] = [];
    const resolver = createAssetResolver({ manifest, onMissing: (_k, n) => missing.push(n) });
    resolver.image("im99-inconnue");
    expect(missing).toEqual(["im99-inconnue"]);
  });
});
