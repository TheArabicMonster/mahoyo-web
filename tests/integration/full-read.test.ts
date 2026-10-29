/**
 * Test d'intégration e2e : lecture complète du corpus KAG avec vrais assets locaux.
 *
 * Ce test parcourt tous les scripts narratifs de scenario/ (hors système et
 * chiffrés) du début à la fin, via le vrai moteur KAG en mode headless.
 *
 * Il nécessite la variable d'environnement MAHOYO_ASSETS_DIR ou un dossier
 * public/assets généré. Sans cela, le test est ignoré.
 *
 * Il produit un rapport dans reports/ (JSON + Markdown) et affiche seulement
 * un résumé chiffré. Aucun texte original du jeu n'est imprimé.
 *
 * @vitest-environment node
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import {
  auditScript,
  aggregateGlobal,
  formatMarkdownReport,
  listCorpus,
} from "../../tools/audit-lib.js";
import type { AuditReport, ScriptAuditResult } from "../../tools/audit-lib.js";
import { hasAssets, assetsDir, manifestPath, scenarioDir } from "./skip-if-no-assets.js";

/** Nombre de scripts narratifs lus sur le corpus de référence (voir docs/LECTURE_COMPLETE.md). */
const EXPECTED_MIN_NARRATIVE_SCRIPTS = 221;

// Le rapport est écrit dans reports/ (ignoré par git).
const REPORTS_DIR = join(import.meta.dirname, "../../reports");

/**
 * Renvoie un résumé chiffré du rapport, sans aucun texte original.
 */
function buildSummary(report: AuditReport): string {
  const lines: string[] = [];
  lines.push("=== Lecture complète du corpus KAG ===");
  lines.push(`Scripts trouvés : ${report.totalScriptsFound}`);
  lines.push(`Scripts système ignorés : ${report.skippedSystem}`);
  lines.push(`Scripts chiffrés ignorés : ${report.skippedEncrypted}`);
  lines.push(`Scripts narratifs audités : ${report.totalScripts}`);
  lines.push(`Scripts en erreur fatale : ${report.scriptsWithErrors}`);
  lines.push(`Scripts ayant atteint maxSteps : ${report.scriptsWithMaxSteps}`);
  lines.push(`Durée totale : ${(report.totalDurationMs / 1000).toFixed(1)}s`);

  const cmdCount = Object.values(report.unknownCommandsGlobal).reduce((a, b) => a + b, 0);
  lines.push(`Commandes inconnues : ${cmdCount}`);
  const assetCount = Object.values(report.missingAssetsGlobal).reduce((a, b) => a + b, 0);
  lines.push(`Assets de base manquants : ${assetCount}`);
  lines.push(`Références à variante résolues : ${report.resolvedVariantRefsGlobal ?? 0}`);
  lines.push(`Références d'asset de nom vide : ${report.emptyAssetRefsGlobal ?? 0}`);

  const topCommands = Object.entries(report.unknownCommandsGlobal)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topCommands.length > 0) {
    lines.push("Top commandes inconnues :");
    for (const [cmd, count] of topCommands) {
      lines.push(`  @${cmd} : ${count}`);
    }
  }

  const errorScripts = report.scripts.filter((s) => s.errors.length > 0);
  if (errorScripts.length > 0) {
    lines.push("Scripts en erreur fatale :");
    for (const s of errorScripts) {
      lines.push(`  ${s.file}`);
    }
  }

  const maxStepScripts = report.scripts.filter((s) => s.hitMaxSteps);
  if (maxStepScripts.length > 0) {
    lines.push("Scripts ayant atteint maxSteps :");
    for (const s of maxStepScripts) {
      lines.push(`  ${s.file}`);
    }
  }

  return lines.join("\n");
}

describe.skipIf(!hasAssets)("Lecture complète du corpus KAG", () => {
  it("traverse tous les scripts narratifs sans erreur bloquante", async () => {
    // Sécurité : sans assets, le describe est skipped, mais on garde une
    // assertion défensive au cas où.
    expect(assetsDir).toBeTruthy();
    expect(scenarioDir).toBeTruthy();
    expect(existsSync(scenarioDir)).toBe(true);

    let manifest: import("@/core/asset-manifest.js").AssetManifest | null = null;
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    }

    const listing = listCorpus(scenarioDir);
    const { allKsFiles, systemScripts, encryptedScripts, auditableScripts, scriptTexts } = listing;

    const results: ScriptAuditResult[] = [];
    for (const f of auditableScripts) {
      const result = await auditScript(join(scenarioDir, f), f, manifest, scriptTexts);
      results.push(result);
    }

    const {
      unknownCommandsGlobal,
      warningsGlobal,
      missingAssetsGlobal,
      resolvedVariantRefsGlobal,
      emptyAssetRefsGlobal,
    } = aggregateGlobal(results);
    const totalDurationMs = results.reduce((acc, r) => acc + r.durationMs, 0);
    const scriptsWithErrors = results.filter((r) => r.errors.length > 0).length;
    const scriptsWithMaxSteps = results.filter((r) => r.hitMaxSteps).length;

    const report: AuditReport = {
      timestamp: new Date().toISOString(),
      totalScriptsFound: allKsFiles.length,
      skippedSystem: systemScripts.length,
      skippedEncrypted: encryptedScripts.length,
      totalScripts: auditableScripts.length,
      scriptsWithErrors,
      scriptsWithMaxSteps,
      totalDurationMs,
      scripts: results,
      unknownCommandsGlobal,
      warningsGlobal,
      missingAssetsGlobal,
      resolvedVariantRefsGlobal,
      emptyAssetRefsGlobal,
    };

    // Écrire le rapport (ignoré par git).
    mkdirSync(REPORTS_DIR, { recursive: true });
    writeFileSync(join(REPORTS_DIR, "full-read.json"), JSON.stringify(report, null, 2), "utf-8");
    writeFileSync(join(REPORTS_DIR, "full-read.md"), formatMarkdownReport(report), "utf-8");

    // Afficher seulement le résumé chiffré, jamais le texte original.
    const summary = buildSummary(report);
    // eslint-disable-next-line no-console
    console.log(`\n${summary}\n`);

    // Garde-fou contre une classification qui écarterait des scripts à tort
    // (système/chiffrés) : 251 trouvés - 17 système - 13 binaires = 221.
    expect(auditableScripts.length).toBeGreaterThanOrEqual(EXPECTED_MIN_NARRATIVE_SCRIPTS);

    // Aucune erreur bloquante et aucune boucle sans progression.
    expect(scriptsWithErrors).toBe(0);
    expect(scriptsWithMaxSteps).toBe(0);
  });
});
