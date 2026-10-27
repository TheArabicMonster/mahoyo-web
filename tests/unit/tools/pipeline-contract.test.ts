/**
 * Test de contrat bout-en-bout : inventaire → manifest → resolver.
 *
 * Simule un dossier d'assets extrait, construit l'inventaire et le manifest,
 * puis vérifie que le resolver trouve chaque entrée.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { buildInventory } from "../../../tools/inventory.js";
import { buildManifest } from "../../../tools/manifest.js";
import { createAssetResolver } from "@/core/asset-resolver.js";

const TMP = join(process.cwd(), "tmp-contract-test");

function setupFixture() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, "bg"), { recursive: true });
  mkdirSync(join(TMP, "fg"), { recursive: true });
  mkdirSync(join(TMP, "rule"), { recursive: true });
  mkdirSync(join(TMP, "bgm"), { recursive: true });
  mkdirSync(join(TMP, "sound"), { recursive: true });
  mkdirSync(join(TMP, "data", "scenario"), { recursive: true });

  // Créer des fichiers factices avec des noms réalistes.
  writeFileSync(join(TMP, "bg", "bg01night.tlg"), "fake");
  writeFileSync(join(TMP, "bg", "bg02school.tlg"), "fake");
  writeFileSync(join(TMP, "fg", "Aoko01(全).tlg"), "fake");
  writeFileSync(join(TMP, "fg", "山城01(近).tlg"), "fake");
  writeFileSync(join(TMP, "rule", "crossfade.png"), "fake");
  writeFileSync(join(TMP, "bgm", "m19.ogg"), "fake");
  writeFileSync(join(TMP, "sound", "se01132.wav"), "fake");
  writeFileSync(join(TMP, "data", "scenario", "1-0.ks"), "fake");
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

describe("Pipeline contract: inventory → manifest → resolver", () => {
  it("inventorie et classe correctement", () => {
    setupFixture();
    try {
      const entries = buildInventory(TMP);
      const kinds = entries.map((e) => e.kind).sort();
      expect(kinds).toContain("bg");
      expect(kinds).toContain("image");
      expect(kinds).toContain("rule");
      expect(kinds).toContain("bgm");
      expect(kinds).toContain("se");
      expect(kinds).toContain("scenario");
    } finally {
      teardown();
    }
  });

  it("génère un manifest utilisable par le resolver", () => {
    setupFixture();
    try {
      const entries = buildInventory(TMP);
      const manifest = buildManifest(entries);
      const resolver = createAssetResolver({ manifest });

      // Backgrounds
      expect(resolver.background("bg01night")).toBe("/assets/bg/bg01night.webp");
      expect(resolver.background("bg02school")).toBe("/assets/bg/bg02school.webp");

      // Sprites (fg → image)
      expect(resolver.image("aoko01(全)")).toBe("/assets/image/aoko01(全).webp");
      expect(resolver.image("山城01(近)")).toBe("/assets/image/山城01(近).webp");

      // Rules
      expect(resolver.rule("crossfade")).toBe("/assets/rule/crossfade.png");

      // Audio
      expect(resolver.bgm("m19")).toBe("/assets/bgm/m19.ogg");
      expect(resolver.se("se01132")).toBe("/assets/se/se01132.ogg");

      // Scenario
      expect(resolver.scenario("1-0")).toBe("/assets/scenario/1-0.ks");
    } finally {
      teardown();
    }
  });

  it("normalise les clés avec |suffix et casse mixte", () => {
    setupFixture();
    try {
      const entries = buildInventory(TMP);
      const manifest = buildManifest(entries);
      const resolver = createAssetResolver({ manifest });

      // "Aoko01(全).tlg|b" → clé "aoko01(全)" → résolu via manifest
      expect(resolver.image("Aoko01(全).tlg|b")).toBe("/assets/image/aoko01(全).webp");

      // "BG01night.TLG" → clé "bg01night" → résolu
      expect(resolver.background("BG01night.TLG")).toBe("/assets/bg/bg01night.webp");
    } finally {
      teardown();
    }
  });

  it("couleurs solides ne cherchent pas dans le manifest", () => {
    setupFixture();
    try {
      const entries = buildInventory(TMP);
      const manifest = buildManifest(entries);
      const resolver = createAssetResolver({ manifest });

      expect(resolver.background("black")).toBe("/assets/bg/black.webp");
      expect(resolver.background("white")).toBe("/assets/bg/white.webp");
      // "black" ne devrait pas être dans le manifest
      expect(manifest.images["black"]).toBeUndefined();
    } finally {
      teardown();
    }
  });

  it("retombe sur la convention pour les assets absents du manifest", () => {
    setupFixture();
    try {
      const entries = buildInventory(TMP);
      const manifest = buildManifest(entries);
      const resolver = createAssetResolver({ manifest });

      // "unknown" n'est pas dans le manifest → convention
      expect(resolver.image("unknown")).toBe("/assets/image/unknown.webp");
      expect(manifest.images["unknown"]).toBeUndefined();
    } finally {
      teardown();
    }
  });
});
