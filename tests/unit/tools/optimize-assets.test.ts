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
  checkAssetsInstallation,
  formatOptimizeReport,
  isGitIgnoredOrOutsideRepo,
  optimizeAssets,
  pixelsIdentical,
  repairManifest,
} from "../../../tools/optimize-assets.js";
import { encodePngToWebp } from "../../../tools/webp.js";
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

describe("réparation de manifeste (#398)", () => {
  /** Manifeste minimal cohérent avec un audio `.wav` et une image `.png` attendus. */
  function makeBrokenManifest(dir: string, expected: { audio?: string; image?: string }): void {
    for (const sub of ["bg", "se"]) mkdirSync(join(dir, sub), { recursive: true });
    const manifest: AssetManifest = {
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      images: expected.image ? { img: { url: expected.image, source: "bg/a.tlg", kind: "bg" } } : {},
      audio: expected.audio ? { snd: { url: expected.audio, source: "se/se01.wav", kind: "se" } } : {},
      scenarios: {},
    };
    writeFileSync(join(dir, "asset-manifest.json"), JSON.stringify(manifest, null, 2));
  }

  it("répare une URL audio .wav → .ogg quand seul le .ogg existe", () => {
    const dir = makeTempDir("mahoyo-repair-audio-");
    makeBrokenManifest(dir, { audio: "se/se01.wav" });
    writeFileSync(join(dir, "se", "se01.ogg"), "dummy-ogg");
    expect(checkAssetsInstallation(dir, readManifest(dir)).ok).toBe(false);
    const { report, remaining } = repairManifest(dir, readManifest(dir));
    expect(report.audio).toBe(1);
    expect(report.images).toBe(0);
    expect(remaining.ok).toBe(true);
  });

  it("répare une URL image .png → .webp quand seul le .webp existe", () => {
    const dir = makeTempDir("mahoyo-repair-image-");
    makeBrokenManifest(dir, { image: "bg/a.png" });
    writeFileSync(join(dir, "bg", "a.webp"), "dummy-webp");
    const { report, remaining } = repairManifest(dir, readManifest(dir));
    expect(report.images).toBe(1);
    expect(report.details[0]).toContain("bg/a.png → bg/a.webp");
    expect(remaining.ok).toBe(true);
  });

  it("repair mixte : audio + image, manifeste réécrit avec assetsVersion + dimensions régénérées", async () => {
    const dir = makeTempDir("mahoyo-repair-mixte-");
    makeBrokenManifest(dir, { audio: "se/se01.wav", image: "bg/a.png" });
    writeFileSync(join(dir, "se", "se01.ogg"), "dummy-ogg");
    writeFileSync(join(dir, "bg", "a.webp"), "dummy-webp");
    const report = await optimizeAssets({ assetsDir: dir, repair: true });
    expect(report.repairs?.audio).toBe(1);
    expect(report.repairs?.images).toBe(1);
    expect(report.check?.ok).toBe(true);
    const manifest = readManifest(dir);
    expect(manifest.audio["snd"].url).toBe("se/se01.ogg");
    expect(manifest.images["img"].url).toBe("bg/a.webp");
    expect(manifest.assetsVersion).toBeDefined();
    expect(existsSync(join(dir, "image-dimensions.json"))).toBe(true);
    expect(formatOptimizeReport(report)).toContain("Réparation");
  });

  it("--check échoue (code 1) si des entrées manquent, code 0 avec --force (CLI)", () => {
    const dir = makeTempDir("mahoyo-check-missing-");
    makeBrokenManifest(dir, { audio: "se/se01.wav", image: "bg/a.png" });
    const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
    const run = (extra: string[]) =>
      spawnSync(tsxBin, ["tools/optimize-assets.ts", "--assets", dir, "--check", ...extra], {
        cwd: process.cwd(),
        encoding: "utf-8",
      });
    const withoutForce = run([]);
    expect(withoutForce.status).toBe(1);
    expect(`${withoutForce.stdout}${withoutForce.stderr}`).toContain("MANQUANT");
    const withForce = run(["--force"]);
    expect(withForce.status).toBe(0);
  });
});

describe("crash-safety (#398)", () => {
  const skipIfNoWebpConversion = HAS_WEBP ? it : it.skip;

  skipIfNoWebpConversion("run interrompu : les originaux restent (suppression différée) et le manifeste reste cohérent", async () => {
    const dir = makeAssetsFixture({ wav: false });
    let conversions = 0;
    await expect(
      optimizeAssets({
        assetsDir: dir,
        noAudio: true,
        onConverted: () => {
          conversions += 1;
          if (conversions === 1) throw new Error("interruption simulée");
        },
      }),
    ).rejects.toThrow("interruption simulée");

    // Aucun original supprimé (suppression reportée après l'écriture finale).
    for (const png of ["bg/a.png", "image/cg01.png", "image/ev01.png", "rule/r.png"]) {
      expect(existsSync(join(dir, png))).toBe(true);
    }
    // Manifeste encore lisible et cohérent : chaque URL a bien son fichier.
    const manifest = readManifest(dir);
    for (const entry of Object.values(manifest.images)) {
      expect(existsSync(join(dir, entry.url))).toBe(true);
    }
  });

  it("écrit le manifeste tous les N conversions (flush atomique) sans casser la cohérence", async () => {
    const dir = makeAssetsFixture({ pngs: false, wav: false });
    writeFileSync(join(dir, "bg", "a.webp"), "dummy");
    const report = await optimizeAssets({ assetsDir: dir, noAudio: true, noWebp: true, manifestFlushEvery: 1 });
    expect(report.check ?? { ok: true }).toBeTruthy();
    // no-op : rien n'a été converti, le manifeste n'a pas été réécrit inutilement.
    expect(readManifest(dir).assetsVersion).toBeUndefined();
  });
});

describe("garde de fidélité pixel (#398)", () => {
  const skipIfNoWebpConversion = HAS_WEBP ? it : it.skip;

  skipIfNoWebpConversion("refuse la conversion sans perte si les pixels diffèrent (PNG conservé)", async () => {
    const dir = makeAssetsFixture({ wav: false });
    const report = await optimizeAssets({
      assetsDir: dir,
      noAudio: true,
      pixelIdentityCheck: async () => false,
    });
    // Conversion refusée : webp supprimé, PNG conservé, URL inchangée, avertissement clair.
    expect(existsSync(join(dir, "bg", "a.webp"))).toBe(false);
    expect(existsSync(join(dir, "bg", "a.png"))).toBe(true);
    const manifest = readManifest(dir);
    expect(manifest.images["bgA"].url).toBe("bg/a.png");
    expect(report.webp.files).toBe(0);
    expect(report.warnings.some((warning) => warning.includes("identité pixel"))).toBe(true);
    expect(formatOptimizeReport(report)).toContain("identité pixel");
  });

  skipIfNoWebpConversion("pixelsIdentical : vrai pour un WebP sans perte, faux pour une autre image", async () => {
    const dir = makeTempDir("mahoyo-fidelity-");
    const png = join(dir, "a.png");
    const same = join(dir, "same.webp");
    const other = join(dir, "other.webp");
    writeFileSync(png, pngSolid(64, 64, 200, 30, 30));
    writeFileSync(join(dir, "b.png"), pngSolid(64, 64, 30, 200, 30));
    await encodePngToWebp(png, same, { lossless: true, quality: 90 }, tooling.encoder!);
    await encodePngToWebp(join(dir, "b.png"), other, { lossless: true, quality: 90 }, tooling.encoder!);
    expect(await pixelsIdentical(png, same)).toBe(true);
    expect(await pixelsIdentical(png, other)).toBe(false);
  });
});
