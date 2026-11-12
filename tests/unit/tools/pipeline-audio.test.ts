/**
 * Test d'intégration du pipeline audio (#387) : WAV → Opus/Ogg (ou AAC/.m4a) via ffmpeg
 * détecté, manifeste mis à jour avec l'extension réelle et une `assetsVersion` recalculée.
 *
 * @vitest-environment node
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { runPipeline } from "../../../tools/pipeline.js";
import { computeAssetsVersion } from "../../../tools/manifest.js";
import type { AssetManifest } from "../../../src/core/asset-manifest.js";

const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const skipIfNoFfmpeg = HAS_FFMPEG ? it : it.skip;

const TEST_DIR = join(tmpdir(), "mahoyo-pipeline-audio");

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

/** Fixture : un WAV stéréo de 0,3 s comme SE + un script minimal. */
function setupFixture(): { inputDir: string; outputDir: string; workDir: string } {
  rmSync(TEST_DIR, { recursive: true, force: true });
  const inputDir = join(TEST_DIR, "input");
  const outputDir = join(TEST_DIR, "output");
  const workDir = join(TEST_DIR, "work");
  mkdirSync(join(inputDir, "sound"), { recursive: true });
  mkdirSync(join(inputDir, "data", "scenario"), { recursive: true });
  spawnSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-ac", "2", join(inputDir, "sound", "se01.wav")],
    { stdio: "ignore" },
  );
  spawnSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=0.3", "-ac", "2", join(inputDir, "sound", "se13010.wav")],
    { stdio: "ignore" },
  );
  const script = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("@bg storage=black\n@play storage=se01\nTexte.[l]\n@pg\n", "utf-16le"),
  ]);
  writeFileSync(join(inputDir, "data", "scenario", "1-0.ks"), script);
  return { inputDir, outputDir, workDir };
}

function readManifest(outputDir: string): AssetManifest {
  return JSON.parse(readFileSync(join(outputDir, "asset-manifest.json"), "utf-8")) as AssetManifest;
}

describe("Pipeline audio WAV → Opus (#387)", () => {
  skipIfNoFfmpeg("convertit les SE en .ogg Opus, manifeste = extension réelle + assetsVersion", async () => {
    const { inputDir, outputDir, workDir } = setupFixture();

    const report = await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: false,
      strict: false,
      force: true,
      noWebp: true,
    });

    expect(report.exitCode).toBe(0);
    const manifest = readManifest(outputDir);
    expect(manifest.audio["se01"].url).toBe("se/se01.ogg");
    expect(manifest.audio["se13010"].url).toBe("se/se13010.ogg");
    const output = join(outputDir, "se", "se01.ogg");
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeGreaterThan(0);
    // Le WAV source n'est pas copié tel quel.
    expect(existsSync(join(outputDir, "se", "se01.wav"))).toBe(false);
    // `assetsVersion` recalculée sur le manifeste converti (#372).
    expect(manifest.assetsVersion).toBeDefined();
    expect(manifest.assetsVersion).toBe(computeAssetsVersion(manifest));
  });

  skipIfNoFfmpeg("produit des .m4a AAC avec --audio-format aac (repli Safari)", async () => {
    const { inputDir, outputDir, workDir } = setupFixture();

    await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: false,
      strict: false,
      force: true,
      noWebp: true,
      audioFormat: "aac",
    });

    const manifest = readManifest(outputDir);
    expect(manifest.audio["se01"].url).toBe("se/se01.m4a");
    expect(existsSync(join(outputDir, "se", "se01.m4a"))).toBe(true);
  });

  skipIfNoFfmpeg("noAudio copie les WAV tels quels (comportement de repli préservé)", async () => {
    const { inputDir, outputDir, workDir } = setupFixture();

    await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: false,
      strict: false,
      force: true,
      noWebp: true,
      noAudio: true,
    });

    const manifest = readManifest(outputDir);
    expect(manifest.audio["se01"].url).toBe("se/se01.wav");
    expect(existsSync(join(outputDir, "se", "se01.wav"))).toBe(true);
  });
});
