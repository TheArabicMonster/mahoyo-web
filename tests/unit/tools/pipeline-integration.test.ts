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

    await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: false,
      strict: false,
      force: true,
      noWebp: true,
    });

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
      strict: false,
      force: true,
      noWebp: true,
    });

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

    await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: true,
      strict: false,
      force: true,
      noWebp: true,
    });

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
      strict: false,
      force: true,
      noWebp: true,
    });

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

describe("Pipeline integration — E1 (extraction, erreurs, sorties)", () => {
  it("extrait les .xp3 avec --xp3-cmd puis produit les assets et le manifest", async () => {
    const base = join(TEST_DIR, "e1");
    const inputDir = join(base, "input");
    const outputDir = join(base, "output");
    const workDir = join(base, "work");
    mkdirSync(inputDir, { recursive: true });
    writeFileSync(join(inputDir, "data.xp3"), "faux-xp3");

    // Faux extracteur : écrit une arborescence d'assets depuis {out}.
    const extractor = join(base, "extracteur.cjs");
    writeFileSync(
      extractor,
      [
        'const fs = require("fs"), path = require("path");',
        "const [, , , out] = process.argv;",
        'fs.mkdirSync(path.join(out, "bg"), { recursive: true });',
        'fs.mkdirSync(path.join(out, "bgm"), { recursive: true });',
        'fs.mkdirSync(path.join(out, "data", "scenario"), { recursive: true });',
        'fs.writeFileSync(path.join(out, "bg", "night.png"), "png");',
        'fs.writeFileSync(path.join(out, "bgm", "m01.ogg"), "ogg");',
        'fs.writeFileSync(path.join(out, "data", "scenario", "1-0.ks"), "@bg storage=night\\n");',
      ].join("\n"),
      "utf-8",
    );

    const report = await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: false,
      strict: false,
      force: true,
      noWebp: true,
      xp3Command: `"${process.execPath}" "${extractor}" {in} {out}`,
    });

    expect(report.inventoryCount).toBe(3);
    expect(existsSync(join(workDir, "extracted", "data", "bg", "night.png"))).toBe(true);
    expect(existsSync(join(workDir, "extracted", "data", "data", "scenario", "1-0.ks"))).toBe(true);

    const manifest: AssetManifest = JSON.parse(
      readFileSync(join(outputDir, "asset-manifest.json"), "utf-8"),
    );
    expect(manifest.images["night"]).toBeDefined();
    expect(manifest.audio["m01"]).toBeDefined();
    expect(manifest.scenarios["1-0"]).toBeDefined();
  });

  it("liste les fichiers non convertis et expose un code de sortie non nul", async () => {
    const { inputDir, outputDir, workDir } = setupFixture();
    // .tlg invalide : le décodeur intégré doit échouer proprement.
    writeFileSync(join(inputDir, "bg", "broken.tlg"), Buffer.from("pas un TLG"));

    const report = await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun: false,
      strict: false,
      force: true,
      noWebp: true,
    });

    expect(report.results.failed).toBe(1);
    expect(report.failedTasks).toHaveLength(1);
    expect(report.failedTasks[0]?.source).toContain("broken.tlg");
    expect(report.exitCode).toBe(1);

    const runReport = JSON.parse(readFileSync(report.runReportPath, "utf-8"));
    expect(runReport.totals.failed).toBe(1);
    expect(runReport.failures[0].source).toContain("broken.tlg");
  });

  it("refuse un dossier de sortie du dépôt non ignoré par git", async () => {
    const { inputDir, workDir } = setupFixture();
    const unsafeOutput = join(process.cwd(), "mh95-sortie-non-ignore");
    try {
      await expect(
        runPipeline({
          inputDir,
          outputDir: unsafeOutput,
          workDir,
          dryRun: false,
          strict: false,
          force: true,
      noWebp: true,
        }),
      ).rejects.toThrow(/ignoré par git/);
      expect(existsSync(unsafeOutput)).toBe(false);
    } finally {
      rmSync(unsafeOutput, { recursive: true, force: true });
    }
  });
});
