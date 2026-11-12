/** Pipeline WebP sans perte par défaut (#374) : extension réelle du manifest. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runPipeline } from "../../../tools/pipeline.js";
import { detectWebpTooling, type WebpTooling } from "../../../tools/webp.js";
import { encodePng } from "../../../tools/tlg-decode.js";
import type { AssetManifest } from "@/core/asset-manifest.js";

const DIR = join(tmpdir(), "mahoyo-pipeline-webp");
let tooling: WebpTooling;

beforeAll(async () => {
  tooling = await detectWebpTooling();
  rmSync(DIR, { recursive: true, force: true });
});

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function fixture(name: string): { inputDir: string; outputDir: string; workDir: string } {
  const root = join(DIR, name);
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  const workDir = join(root, "work");
  mkdirSync(join(inputDir, "bg"), { recursive: true });
  mkdirSync(join(inputDir, "data", "scenario"), { recursive: true });
  writeFileSync(join(inputDir, "bg", "night.png"), encodePng(2, 2, new Uint8Array(2 * 2 * 4).fill(128)));
  writeFileSync(join(inputDir, "data", "scenario", "1-0.ks"), "@bg storage=night\nTexte.[l]\n@pg\n", "utf-8");
  return { inputDir, outputDir, workDir };
}

function manifestOf(outputDir: string): AssetManifest {
  return JSON.parse(readFileSync(join(outputDir, "asset-manifest.json"), "utf-8"));
}

describe("pipeline WebP (#374)", () => {
  it("convertit en WebP sans perte quand un encodeur est disponible", async () => {
    if (!tooling.encoder) return; // repli PNG testé séparément
    const { inputDir, outputDir, workDir } = fixture("lossless");
    await runPipeline({ inputDir, outputDir, workDir, dryRun: false, strict: false, force: true });
    const manifest = manifestOf(outputDir);
    expect(manifest.images.night?.url).toBe("bg/night.webp");
    expect(existsSync(join(outputDir, "bg", "night.webp"))).toBe(true);
    expect(existsSync(join(outputDir, "bg", "night.png"))).toBe(false);
  });

  it("conserve le PNG avec --no-webp (repli)", async () => {
    const { inputDir, outputDir, workDir } = fixture("fallback");
    await runPipeline({ inputDir, outputDir, workDir, dryRun: false, strict: false, force: true, noWebp: true });
    const manifest = manifestOf(outputDir);
    expect(manifest.images.night?.url).toBe("bg/night.png");
    expect(existsSync(join(outputDir, "bg", "night.png"))).toBe(true);
  });
});
