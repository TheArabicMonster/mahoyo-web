/**
 * Tests de la vérification statique des références d'assets du pipeline
 * (`verifyReferences`, rapport `report.json` de `npm run pipeline`).
 *
 * La vérification doit résoudre une référence comme le player
 * (`storageKey` + manifest, repli NFKC) : variantes `nom|x`, dossier,
 * extension, casse et espaces ne doivent pas produire de faux manques.
 *
 * @vitest-environment node
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import { verifyReferences } from "../../../tools/manifest.js";
import type { VerificationReport } from "../../../tools/manifest.js";
import type { AssetManifest } from "../../../src/core/asset-manifest.js";
import type { InventoryEntry } from "../../../tools/inventory.js";

const MANIFEST: AssetManifest = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  images: {
    "perso01(全)": { url: "image/perso01.webp", source: "image/perso01.png", kind: "image" },
    // Clés d'anciens manifest : casse, espace final et pleine chasse conservés.
    "bg01 ": { url: "bg/bg01.webp", source: "bg/bg01.png", kind: "bg" },
    FondNeige: { url: "bg/fond-neige.webp", source: "bg/fond-neige.png", kind: "bg" },
    "im07ｌ56風船(紫オブジェ)": { url: "image/im07.webp", source: "image/im07.png", kind: "image" },
  },
  audio: {
    m01: { url: "bgm/m01.ogg", source: "bgm/m01.ogg", kind: "bgm" },
    se01: { url: "se/se01.ogg", source: "se/se01.ogg", kind: "se" },
  },
  scenarios: {},
};

const TMP_DIR = mkdtempSync(join(tmpdir(), "mahoyo-manifest-verify-"));

function scenario(name: string, content: string): InventoryEntry {
  const source = join(TMP_DIR, name);
  writeFileSync(source, content, "utf-8");
  return { source, relPath: `scenario/${name}` } as unknown as InventoryEntry;
}

function verify(files: Record<string, string>): VerificationReport {
  return verifyReferences(
    Object.entries(files).map(([name, content]) => scenario(name, content)),
    MANIFEST,
  );
}

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("verifyReferences — variantes |x", () => {
  it("résout une variante image via son asset de base (pas un manque)", () => {
    // Le parser normalise le storage (storageKey) : le suffixe |x est retiré
    // avant la vérification, exactement comme pour le player.
    const report = verify({ "a.ks": "*start\n@fg storage=perso01(全)|e\n" });

    expect(report.missingStorages).toEqual([]);
    expect(report.referencesChecked).toBe(1);
  });

  it("résout une variante audio via son asset de base", () => {
    const report = verify({ "a.ks": "*start\n@play storage=m01|a\n" });

    expect(report.missingStorages).toEqual([]);
    expect(report.referencesChecked).toBe(1);
  });

  it("signale une variante non résolue sous sa clé de base, sans compter la variante comme manque", () => {
    const report = verify({ "a.ks": "*start\n@fg storage=absent(全)|b\n" });

    expect(report.missingStorages).toEqual([
      { script: "scenario/a.ks", line: 0, storage: "absent(全)", kind: "image" },
    ]);
  });
});

describe("verifyReferences — normalisation comme le resolver", () => {
  it("résout dossier, extension et casse (normalisation du parser)", () => {
    const report = verify({ "a.ks": "*start\n@bg storage=BG/fondneige.tlg\n" });

    expect(report.missingStorages).toEqual([]);
    expect(report.referencesChecked).toBe(1);
  });

  it("résout un espace final resté dans une clé d'ancien manifest (repli)", () => {
    // Clé de l'ancien manifest : « bg01 » suivi d'un espace ; le script le référence sans espace.
    const report = verify({ "a.ks": "*start\n@bg storage=bg01\n" });

    expect(report.missingStorages).toEqual([]);
    expect(report.referencesChecked).toBe(1);
  });

  it("résout les formes Unicode NFKC (pleine chasse)", () => {
    const report = verify({ "a.ks": "*start\n@fg storage=im07l56風船(紫オブジェ)\n" });

    expect(report.missingStorages).toEqual([]);
  });

  it("signale un asset de base absent avec sa clé normalisée", () => {
    const report = verify({
      "a.ks": "*start\n@play storage=bgm101.ogg\n@se storage=se99\n",
    });

    expect(report.missingStorages).toEqual([
      { script: "scenario/a.ks", line: 0, storage: "bgm101", kind: "bgm" },
      { script: "scenario/a.ks", line: 0, storage: "se99", kind: "se" },
    ]);
  });
});

describe("verifyReferences — références hors assets", () => {
  it("compte à part les calques sans image (storage vide)", () => {
    const report = verify({ "a.ks": "*start\n@fg id=pb1\n@fg id=pb2 storage=\n" });

    expect(report.emptyStorageRefs).toBe(2);
    expect(report.missingStorages).toEqual([]);
    expect(report.referencesChecked).toBe(0);
  });

  it("ignore les couleurs unies", () => {
    const report = verify({ "a.ks": "*start\n@bg storage=white\n@fg storage=black\n" });

    expect(report.missingStorages).toEqual([]);
    expect(report.referencesChecked).toBe(0);
  });

  it("compte à part les paramètres de macro non résolubles statiquement", () => {
    const report = verify({ "a.ks": "*start\n@fg storage=%img\n" });

    expect(report.macroStorageRefs).toBe(1);
    expect(report.missingStorages).toEqual([]);
  });
});

describe("Manifest — extension WebP réelle (#374)", () => {
  it("porte l'URL .webp produite par le pipeline et le resolver la sert", async () => {
    const { buildManifestFromResults } = await import("../../../tools/manifest.js");
    const { createAssetResolver } = await import("@/core/asset-resolver.js");
    const manifest = buildManifestFromResults(
      [
        {
          task: {
            entry: {
              source: "/in/bg/night.tlg",
              relPath: "bg/night.tlg",
              kind: "bg",
              ext: ".tlg",
              key: "night",
              webPath: "bg/night.png",
              webExt: ".png",
            },
            action: "convert-image",
            outputPath: "/out/bg/night.webp",
            outputExt: ".webp",
            internal: true,
          },
          status: "ok",
          actualOutputPath: "/out/bg/night.webp",
        },
      ] as never,
      "/out",
    );
    expect(manifest.images.night?.url).toBe("bg/night.webp");
    expect(createAssetResolver({ manifest }).background("night")).toBe("/assets/bg/night.webp");
  });
});
