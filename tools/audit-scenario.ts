/**
 * Audit headless du corpus KAG complet.
 *
 * Parcourt tous les scripts .ks du répertoire scenario/ via le moteur KAG,
 * en mode auto-advance (franchit les pauses, clics et attentes
 * automatiquement). Produit un rapport JSON et Markdown dans reports/.
 *
 * Les scripts système (menus, config, plugins) et les scripts chiffrés
 * sont ignorés automatiquement.
 *
 * Usage : npm run audit
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import {
  auditScript,
  formatMarkdownReport,
  listCorpus,
  aggregateGlobal,
} from "./audit-lib.js";
import type { AuditReport, ScriptAuditResult } from "./audit-lib.js";

// ── Configuration ──

const REPORTS_DIR = join(import.meta.dirname, "../reports");

/**
 * Résout le répertoire d'assets à utiliser.
 * Priorité : variable d'environnement MAHOYO_ASSETS_DIR, puis public/assets.
 */
function resolveAssetsDir(): string {
  const envDir = process.env.MAHOYO_ASSETS_DIR;
  if (envDir && existsSync(join(envDir, "scenario"))) {
    return envDir;
  }
  return join(import.meta.dirname, "../public/assets");
}

const ASSETS_DIR = resolveAssetsDir();
const SCENARIO_DIR = join(ASSETS_DIR, "scenario");
const MANIFEST_PATH = join(ASSETS_DIR, "asset-manifest.json");

// ── CLI ──

async function main(): Promise<void> {
  if (!existsSync(SCENARIO_DIR)) {
    console.error(`Répertoire scenario introuvable : ${SCENARIO_DIR}`);
    if (process.env.MAHOYO_ASSETS_DIR) {
      console.error(`MAHOYO_ASSETS_DIR=${process.env.MAHOYO_ASSETS_DIR}`);
    }
    console.error("Lancez d'abord le pipeline pour générer les assets.");
    process.exit(1);
  }

  // Charger le manifest (optionnel)
  let manifest = null;
  if (existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    console.log(`Manifest chargé : ${MANIFEST_PATH}`);
  } else {
    console.log("Manifest absent — vérification d'assets désactivée.");
  }

  // Lister et filtrer le corpus
  const { allKsFiles, systemScripts, encryptedScripts, auditableScripts, scriptTexts } =
    listCorpus(SCENARIO_DIR);

  console.log(`Scripts trouvés : ${allKsFiles.length}`);
  console.log(`Scripts système ignorés : ${systemScripts.length}`);
  console.log(`Scripts chiffrés ignorés : ${encryptedScripts.length} (${encryptedScripts.join(", ")})`);
  console.log(`Scripts à auditer : ${auditableScripts.length}`);

  // Auditer chaque script auditable
  const results: ScriptAuditResult[] = [];
  for (const f of auditableScripts) {
    process.stdout.write(`  ${f} ...`);
    try {
      const result = await auditScript(join(SCENARIO_DIR, f), f, manifest, scriptTexts);
      results.push(result);
      const marker = result.errors.length > 0 ? " ❌" : result.hitMaxSteps ? " ⚠️" : "";
      console.log(` ${result.steps} steps, ${result.rawCount} raw${marker} (${result.durationMs}ms)`);
    } catch (err) {
      results.push({
        file: f,
        steps: 0,
        unknownCommands: {},
        warnings: {},
        missingAssets: [],
        errors: [err instanceof Error ? err.message : String(err)],
        rawCount: 0,
        durationMs: 0,
        hitMaxSteps: false,
      });
      console.log(" ❌ crash");
    }
  }

  // Agréger
  const { unknownCommandsGlobal, warningsGlobal, missingAssetsGlobal } = aggregateGlobal(results);

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
  };

  // Écrire les rapports
  mkdirSync(REPORTS_DIR, { recursive: true });

  const jsonPath = join(REPORTS_DIR, "scenario-audit.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nRapport JSON : ${jsonPath}`);

  const mdPath = join(REPORTS_DIR, "scenario-audit.md");
  writeFileSync(mdPath, formatMarkdownReport(report), "utf-8");
  console.log(`Rapport Markdown : ${mdPath}`);

  // Résumé terminal
  console.log("\n=== Résumé ===");
  console.log(`Scripts audités : ${report.totalScripts} | Erreurs : ${scriptsWithErrors} | MaxSteps : ${scriptsWithMaxSteps} | Durée : ${(totalDurationMs / 1000).toFixed(1)}s`);

  const sortedCmds = Object.entries(unknownCommandsGlobal).sort((a, b) => b[1] - a[1]);
  if (sortedCmds.length > 0) {
    console.log("\nCommandes inconnues (top 15) :");
    for (const [cmd, count] of sortedCmds.slice(0, 15)) {
      console.log(`  @${cmd} : ${count}`);
    }
  }

  if (scriptsWithErrors > 0) {
    process.exit(1);
  }
}

export { auditScript, formatMarkdownReport, isEncrypted, aggregateGlobal, listCorpus } from "./audit-lib.js";
export type { ScriptAuditResult, AuditReport, CorpusListing } from "./audit-lib.js";

// Permet l'import sans exécuter main (pour les tests)
if (process.argv[1]) {
  const { fileURLToPath } = await import("url");
  if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
