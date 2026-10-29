/**
 * Tests unitaires du contrôle « aucun asset commité ».
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import {
  ASSET_EXTENSIONS,
  findAssetViolations,
  formatViolations,
  getAssetExtension,
} from "../../../tools/check-no-assets-lib.js";

describe("getAssetExtension", () => {
  it("détecte les extensions d'assets interdites", () => {
    expect(getAssetExtension("foo.tlg")).toBe(".tlg");
    expect(getAssetExtension("foo.XP3")).toBe(".xp3");
    expect(getAssetExtension("bar.ks")).toBe(".ks");
    expect(getAssetExtension("music.ogg")).toBe(".ogg");
    expect(getAssetExtension("font.ttf")).toBe(".ttf");
  });

  it("retourne null pour une extension non concernée", () => {
    expect(getAssetExtension("README.md")).toBeNull();
    expect(getAssetExtension("src/main.ts")).toBeNull();
    expect(getAssetExtension(".gitignore")).toBeNull();
  });
});

describe("ASSET_EXTENSIONS", () => {
  it("contient les extensions listées dans l'issue #92", () => {
    const expected = [
      ".tlg",
      ".tft",
      ".xp3",
      ".sar",
      ".ks",
      ".ogg",
      ".mp3",
      ".wav",
      ".png",
      ".webp",
      ".jpg",
      ".jpeg",
      ".gif",
      ".ttf",
      ".otf",
      ".woff",
      ".woff2",
    ];
    for (const ext of expected) {
      expect(ASSET_EXTENSIONS).toContain(ext);
    }
  });
});

describe("findAssetViolations", () => {
  it("signale un faux asset non allowlisté", () => {
    const files = ["src/main.ts", "fake-asset.tlg", "public/icon.png"];
    const allowlist = new Set<string>(["public/icon.png"]);
    const violations = findAssetViolations(files, allowlist);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({ path: "fake-asset.tlg", extension: ".tlg" });
  });

  it("ignore les fichiers présents dans l'allowlist", () => {
    const files = ["public/icon-192.png", "public/icon-512.png"];
    const allowlist = new Set<string>(files);
    const violations = findAssetViolations(files, allowlist);

    expect(violations).toHaveLength(0);
  });

  it("ignore les extensions non concernées", () => {
    const files = ["README.md", "src/main.ts", "tools/script.ts"];
    const violations = findAssetViolations(files, new Set());

    expect(violations).toHaveLength(0);
  });

  it("traite les extensions de manière insensible à la casse", () => {
    const files = ["ASSET.TLG", "Mixed.PNG"];
    const violations = findAssetViolations(files, new Set());

    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({ path: "ASSET.TLG", extension: ".tlg" });
    expect(violations[1]).toEqual({ path: "Mixed.PNG", extension: ".png" });
  });
});

describe("formatViolations", () => {
  it("liste les fichiers fautifs et l'action à prendre", () => {
    const violations = [
      { path: "fake-asset.tlg", extension: ".tlg" },
      { path: "sound/copyrighted.ogg", extension: ".ogg" },
    ];
    const output = formatViolations(violations);

    expect(output).toContain("Fichiers interdits détectés (2)");
    expect(output).toContain("fake-asset.tlg (.tlg)");
    expect(output).toContain("sound/copyrighted.ogg (.ogg)");
    expect(output).toContain("tools/allowed-assets.txt");
  });

  it("retourne une chaîne vide si aucune violation", () => {
    expect(formatViolations([])).toBe("");
  });
});
