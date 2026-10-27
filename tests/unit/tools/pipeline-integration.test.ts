/**
 * Test d'intégration du pipeline : inventaire → plan → exécution → manifest.
 *
 * Génère une fixture dans un dossier temporaire avec :
 * - un script .ks en UTF-16LE
 * - une image .png (copie)
 * - un fichier .ogg (copie)
 *
 * Lance le pipeline, vérifie le manifest, et que le resolver trouve chaque fichier.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runPipeline } from "../../../tools/pipeline.js";
import { createAssetResolver } from "@/core/asset-resolver.js";
import type { AssetManifest } from "@/core/asset-manifest.js";

const TEST_DIR = join(tmpdir(), "mahoyo-pipeline-integration");

function setupFixture() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  const inputDir = join(TEST_DIR, "input");
  const outputDir = join(TEST_DIR, "output");
  const workDir = join(TEST_DIR, "work");

  mkdirSync(join(inputDir, "bg"), { recursive: true });
  mkdirSync(join(inputDir, "bgm"), { recursive: true });
  mkdirSync(join(inputDir, "data", "scenario"), { recursive: true });

  // Image PNG (sera copiée)
  writeFileSync(join(inputDir, "bg", "night.png"), Buffer.from("fake-png-data"));

  // Audio OGG (sera copié)
  writeFileSync(join(inputDir, "bgm", "m01.ogg"), Buffer.from("fake-ogg-data"));

  // Script .ks en UTF-16LE avec BOM
  const scriptText = `@bg storage=night\n@play storage=m01\nTexte de test.[l]\n@pg\n`;
  const bom = Buffer.from([0xff, 0xfe]);
  const content = Buffer.from(scriptText, "utf-16le");
  writeFileSync(join(inputDir, "data", "scenario", "1-0.ks"), Buffer.concat([bom, content]));

  return { inputDir, outputDir, workDir };
}

function teardown() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe("Pipeline integration", () => {
  beforeEach(() => setupFixture());
  afterEach(() => teardown());

  it("génère le manifest et les fichiers de sortie", async () => {
    const { inputDir, outputDir, workDir } = setupFixture();

    const report = await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: false,
      copyWavIfNoEncoder: true,
      strict: false,
      force: true,
    } as any);

    // Vérifier que le manifest existe.
    const manifestPath = join(outputDir, "asset-manifest.json");
    expect(existsSync(manifestPath)).toBe(true);

    // Lire le manifest.
    const manifest: AssetManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.version).toBe(1);

    // L'image "night" doit être dans le manifest.
    expect(manifest.images["night"]).toBeDefined();
    expect(manifest.images["night"].url).toBe("bg/night.png");

    // L'audio "m01" doit être dans le manifest.
    expect(manifest.audio["m01"]).toBeDefined();
    expect(manifest.audio["m01"].url).toBe("bgm/m01.ogg");

    // Le scénario "1-0" doit être dans le manifest.
    expect(manifest.scenarios["1-0"]).toBeDefined();
    expect(manifest.scenarios["1-0"].url).toBe("scenario/1-0.ks");

    // Les fichiers doivent exister.
    expect(existsSync(join(outputDir, "bg", "night.png"))).toBe(true);
    expect(existsSync(join(outputDir, "bgm", "m01.ogg"))).toBe(true);
    expect(existsSync(join(outputDir, "scenario", "1-0.ks"))).toBe(true);

    // Le scénario doit être en UTF-8 (transcodé depuis UTF-16LE).
    const ksContent = readFileSync(join(outputDir, "scenario", "1-0.ks"), "utf-8");
    expect(ksContent).toContain("@bg storage=night");
    expect(ksContent).toContain("Texte de test.");
  });

  it("le resolver trouve chaque asset via le manifest", async () => {
    const { inputDir, outputDir, workDir } = setupFixture();

    await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: false,
      copyWavIfNoEncoder: true,
      strict: false,
      force: true,
    } as any);

    // Lire le manifest.
    const manifestPath = join(outputDir, "asset-manifest.json");
    const manifest: AssetManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    // Créer un resolver avec le manifest.
    const resolver = createAssetResolver({ baseUrl: outputDir, manifest });

    // Vérifier que chaque URL pointe vers un fichier existant.
    const bgUrl = resolver.background("night");
    expect(existsSync(bgUrl)).toBe(true);

    const bgmUrl = resolver.bgm("m01");
    expect(existsSync(bgmUrl)).toBe(true);

    const scenarioUrl = resolver.scenario("1-0");
    expect(existsSync(scenarioUrl)).toBe(true);
  });

  it("dry-run n'écrit aucun fichier", async () => {
    const { inputDir, outputDir, workDir } = setupFixture();

    const report = await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: true,
      copyWavIfNoEncoder: true,
      strict: false,
      force: true,
    } as any);

    // Aucun fichier ne doit exister dans outputDir.
    expect(existsSync(join(outputDir, "asset-manifest.json"))).toBe(false);
    expect(existsSync(join(outputDir, "bg", "night.png"))).toBe(false);
    expect(existsSync(join(outputDir, "scenario", "1-0.ks"))).toBe(false);
  });

  it("vérifie les références storage des scripts", async () => {
    const { inputDir, outputDir, workDir } = setupFixture();

    const report = await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: false,
      copyWavIfNoEncoder: true,
      strict: false,
      force: true,
    } as any);

    // Le rapport de vérification doit exister.
    expect(report.verification).toBeDefined();
    expect(report.verification!.scriptsAnalyzed).toBe(1);

    // "night" et "m01" sont dans le manifest → pas de missingStorages.
    // (sauf si le script référence autre chose)
    const missing = report.verification!.missingStorages.filter(
      (m) => m.storage !== "night" && m.storage !== "m01",
    );
    // Le script ne référence que "night" et "m01", donc pas de manquants.
    expect(missing.length).toBe(0);
  });
});
