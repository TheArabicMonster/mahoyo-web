/**
 * Tests de la `assetsVersion` écrite par le pipeline (#372, plan Opus §3.E).
 *
 * @vitest-environment node
 */
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { AssetManifest } from "../../../src/core/asset-manifest.js";
import { computeAssetsVersion, withAssetsVersion, writeManifest } from "../../../tools/manifest.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function manifest(overrides: Partial<AssetManifest> = {}): AssetManifest {
  return {
    version: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    images: { black: { url: "bg/black.webp", source: "bg/black.tlg", kind: "bg" } },
    audio: {},
    scenarios: {},
    ...overrides,
  };
}

describe("computeAssetsVersion", () => {
  it("est déterministe et au format hash 16 hex", () => {
    const version = computeAssetsVersion(manifest());
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(computeAssetsVersion(manifest())).toBe(version);
  });

  it("ignore generatedAt (relancer le pipeline sans changer les assets garde la version)", () => {
    const a = computeAssetsVersion(manifest({ generatedAt: "2026-01-01T00:00:00.000Z" }));
    const b = computeAssetsVersion(manifest({ generatedAt: "2027-06-01T12:34:56.000Z" }));
    expect(a).toBe(b);
  });

  it("change quand le contenu change", () => {
    const a = computeAssetsVersion(manifest());
    const b = computeAssetsVersion(
      manifest({ images: { black: { url: "bg/black.webp", source: "bg/black.tlg", kind: "bg" }, white: { url: "bg/white.webp", source: "bg/white.tlg", kind: "bg" } } }),
    );
    expect(a).not.toBe(b);
  });

  it("ignore assetsVersion déjà positionnée (le hash ne se hache pas lui-même)", () => {
    const a = computeAssetsVersion(manifest());
    expect(computeAssetsVersion({ ...manifest(), assetsVersion: "deadbeef" })).toBe(a);
  });
});

describe("withAssetsVersion / writeManifest", () => {
  it("ajoute assetsVersion sans muter le manifeste d'entrée", () => {
    const input = manifest();
    const output = withAssetsVersion(input);
    expect(output.assetsVersion).toBe(computeAssetsVersion(input));
    expect(input.assetsVersion).toBeUndefined();
  });

  it("writeManifest écrit la version dans le fichier (pipeline → SW versionné)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mahoyo-manifest-version-"));
    tempDirs.push(dir);
    const path = join(dir, "asset-manifest.json");
    writeManifest(manifest(), path);
    const written = JSON.parse(readFileSync(path, "utf-8")) as AssetManifest;
    expect(written.assetsVersion).toBe(computeAssetsVersion(manifest()));
    expect(written.images.black.url).toBe("bg/black.webp");
  });
});
