/**
 * Tests de `tools/optimize-assets.ts` (#393) : audio Opus, WebP, manifeste/assetsVersion,
 * rapport de poids, `--keep-originals` et refus d'un dossier non-assets.
 *
 * Les tests de conversion réelle sont skippés si `ffmpeg`/un encodeur WebP manque.
 *
 * @vitest-environment node
 */
import { execFileSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertOptimizableAssetsDir,
  categoryOf,
  formatOptimizeReport,
  isGitIgnoredOrOutsideRepo,
  optimizeAssets,
} from "../../../tools/optimize-assets.js";
import { detectWebpTooling } from "../../../tools/webp.js";
import { pngSolid } from "../../e2e/placeholders.js";
import type { AssetManifest } from "../../../src/core/asset-manifest.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const tooling = await detectWebpTooling();
const HAS_WEBP = tooling.encoder !== null;

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** WAV stéréo de 0,3 s généré par ffmpeg (null si ffmpeg absent). */
function makeWav(dir: string): string | null {
  if (!HAS_FFMPEG) return null;
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "se01.wav");
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-ac", "2", path],
    { stdio: "ignore" },
  );
  return result.status === 0 ? path : null;
}

type FixtureOptions = { wav?: boolean; pngs?: boolean };

/** Installation d'assets synthétique : manifeste + fichiers (aucun asset du jeu). */
function makeAssetsFixture(options: FixtureOptions = {}): string {
  const dir = makeTempDir("mahoyo-optimize-");
  for (const sub of ["bg", "image", "rule", "se"]) mkdirSync(join(dir, sub), { recursive: true });
  const images: AssetManifest["images"] = {};
  const audio: AssetManifest["audio"] = {};
  if (options.pngs !== false) {
    writeFileSync(join(dir, "bg", "a.png"), pngSolid(64, 64, 200, 30, 30));
    writeFileSync(join(dir, "image", "cg01.png"), pngSolid(64, 64, 30, 200, 30));
    writeFileSync(join(dir, "image", "ev01.png"), pngSolid(64, 64, 30, 30, 200));
    writeFileSync(join(dir, "rule", "r.png"), pngSolid(64, 64, 10, 10, 10));
    images.bgA = { url: "bg/a.png", source: "bg/a.tlg", kind: "bg" };
    images.cg01 = { url: "image/cg01.png", source: "image/cg01.tlg", kind: "image" };
    images.ev01 = { url: "image/ev01.png", source: "image/ev01.tlg", kind: "image" };
    images.ruleR = { url: "rule/r.png", source: "rule/r.tlg", kind: "rule" };
  }
  if (options.wav !== false) {
    const wav = makeWav(join(dir, "se"));
    if (wav) audio.se01 = { url: "se/se01.wav", source: "se/se01.wav", kind: "se" };
  }
  const manifest: AssetManifest = { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", images, audio, scenarios: {} };
  writeFileSync(join(dir, "asset-manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

function readManifest(dir: string): AssetManifest {
  return JSON.parse(readFileSync(join(dir, "asset-manifest.json"), "utf-8")) as AssetManifest;
}

describe("helpers", () => {
  it("classe les URLs par catégorie", () => {
    expect(categoryOf("bg/a.png")).toBe("bg");
    expect(categoryOf("image/cg01.webp")).toBe("image");
    expect(categoryOf("rule/r.png")).toBe("rule");
    expect(categoryOf("se/se01.ogg")).toBe("se");
    expect(categoryOf("asset-manifest.json")).toBe("json");
    expect(categoryOf("autre/x.bin")).toBe("autres");
  });

  it("refuse un dossier sans manifeste, accepte avec force", () => {
    const dir = makeTempDir("mahoyo-optimize-empty-");
    expect(() => assertOptimizableAssetsDir(dir, false)).toThrow(/Pas un dossier d'assets installé/);
    expect(() => assertOptimizableAssetsDir(dir, true)).not.toThrow();
  });

  it("refuse un dossier d'un dépôt git non ignoré (jamais committer d'assets)", () => {
    const repo = makeTempDir("mahoyo-optimize-git-");
    execFileSync("git", ["init", "-q"], { cwd: repo });
    mkdirSync(join(repo, "assets"));
    writeFileSync(join(repo, "assets", "other.txt"), "x");
    writeFileSync(join(repo, "assets", "asset-manifest.json"), JSON.stringify({ version: 1, generatedAt: "x", images: {}, audio: {}, scenarios: {} }));
    expect(isGitIgnoredOrOutsideRepo(join(repo, "assets"))).toBe(false);
    expect(() => assertOptimizableAssetsDir(join(repo, "assets"), false)).toThrow(/n'est pas ignoré par git/);
    writeFileSync(join(repo, ".gitignore"), "assets/\n");
    expect(isGitIgnoredOrOutsideRepo(join(repo, "assets"))).toBe(true);
    expect(() => assertOptimizableAssetsDir(join(repo, "assets"), false)).not.toThrow();
  });
});

describe("optimizeAssets — audio (Opus)", () => {
  const skipIfNoFfmpeg = HAS_FFMPEG ? it : it.skip;

  skipIfNoFfmpeg("convertit se/*.wav en Opus/Ogg, met à jour le manifeste et supprime l'original", async () => {
    const dir = makeAssetsFixture({ pngs: false });
    const report = await optimizeAssets({ assetsDir: dir, noWebp: true });

    expect(existsSync(join(dir, "se", "se01.ogg"))).toBe(true);
    expect(existsSync(join(dir, "se", "se01.wav"))).toBe(false);
    const manifest = readManifest(dir);
    expect(manifest.audio["se01"].url).toBe("se/se01.ogg");
    expect(manifest.assetsVersion).toBeDefined();
    expect(report.audio.files).toBe(1);
    expect(report.audio.beforeBytes).toBeGreaterThan(report.audio.afterBytes);
    expect(report.audio.afterBytes).toBeGreaterThan(0);
    expect(report.categories.se?.beforeBytes).toBe(report.audio.beforeBytes);
    expect(formatOptimizeReport(report)).toContain("WAV → Opus/Ogg");
  });

  skipIfNoFfmpeg("--keep-originals conserve les WAV", async () => {
    const dir = makeAssetsFixture({ pngs: false });
    const report = await optimizeAssets({ assetsDir: dir, noWebp: true, keepOriginals: true });

    expect(existsSync(join(dir, "se", "se01.ogg"))).toBe(true);
    expect(existsSync(join(dir, "se", "se01.wav"))).toBe(true);
    expect(report.audio.kept).toBe(1);
  });
});

describe("optimizeAssets — WebP", () => {
  const skipIfNoWebp = HAS_WEBP ? it : it.skip;

  skipIfNoWebp("convertit bg/ et image/ en WebP sans perte, laisse rule/ en PNG, met à jour le manifeste", async () => {
    const dir = makeAssetsFixture({ wav: false });
    const beforeManifest = readManifest(dir);
    const report = await optimizeAssets({ assetsDir: dir, noAudio: true });

    expect(existsSync(join(dir, "bg", "a.webp"))).toBe(true);
    expect(existsSync(join(dir, "image", "cg01.webp"))).toBe(true);
    expect(existsSync(join(dir, "image", "ev01.webp"))).toBe(true);
    // rule/ non converti par défaut.
    expect(existsSync(join(dir, "rule", "r.png"))).toBe(true);
    expect(existsSync(join(dir, "rule", "r.webp"))).toBe(false);
    expect(existsSync(join(dir, "bg", "a.png"))).toBe(false);
    const manifest = readManifest(dir);
    expect(manifest.images["bgA"].url).toBe("bg/a.webp");
    expect(manifest.images["cg01"].url).toBe("image/cg01.webp");
    expect(manifest.images["ruleR"].url).toBe("rule/r.png");
    expect(manifest.assetsVersion).toBeDefined();
    expect(beforeManifest.assetsVersion).toBeUndefined();
    // Dimensions régénérées à partir des WebP (readImageSize gère WebP).
    const dimensions = JSON.parse(readFileSync(join(dir, "image-dimensions.json"), "utf-8")) as {
      dimensions: Record<string, { width: number; height: number }>;
    };
    expect(dimensions.dimensions["bgA"]).toEqual({ width: 64, height: 64 });
    expect(dimensions.dimensions["cg01"]).toEqual({ width: 64, height: 64 });
    expect(report.webp.files).toBe(3);
    expect(report.webp.lossless).toBe(3);
    expect(report.webp.lossy).toBe(0);
    expect(report.categories.bg?.files).toBe(1);
    expect(report.categories.image?.files).toBe(2);
    expect(report.categories.rule?.files).toBe(0);
  });

  skipIfNoWebp("--webp-lossy convertit bg/ avec perte (SSIM garde-fou) et image/ev* aussi", async () => {
    const dir = makeAssetsFixture({ wav: false });
    const report = await optimizeAssets({ assetsDir: dir, noAudio: true, webpLossy: true });

    expect(report.webp.lossy).toBeGreaterThanOrEqual(1);
    // Une image/ non `ev` reste sans perte.
    const manifest = readManifest(dir);
    expect(manifest.images["cg01"].url).toBe("image/cg01.webp");
  });

  skipIfNoWebp("--keep-originals conserve les PNG", async () => {
    const dir = makeAssetsFixture({ wav: false });
    const report = await optimizeAssets({ assetsDir: dir, noAudio: true, keepOriginals: true });

    expect(existsSync(join(dir, "bg", "a.png"))).toBe(true);
    expect(existsSync(join(dir, "bg", "a.webp"))).toBe(true);
    expect(report.webp.kept).toBe(3);
  });

  skipIfNoWebp("noWebp / noAudio ne modifient rien", async () => {
    const dir = makeAssetsFixture();
    const before = readFileSync(join(dir, "asset-manifest.json"), "utf-8");
    await optimizeAssets({ assetsDir: dir, noWebp: true, noAudio: true });
    expect(readFileSync(join(dir, "asset-manifest.json"), "utf-8")).toBe(before);
  });
});
