/**
 * Orchestrateur du pipeline d'assets.
 *
 * Usage:
 *   npm run pipeline -- --input <dir> --output <dir> [options]
 *
 * Étapes :
 *   1. Résoudre la source (extraire XP3 si extracteur fourni, sinon --input)
 *   2. Inventorier (buildInventory)
 *   3. Planifier (planTasks)
 *   4. Exécuter les tâches (convertir/copier/transcoder)
 *   5. Construire le manifest depuis les résultats (buildManifestFromResults)
 *   6. Vérifier les références (verifyReferences → report)
 *
 * Options:
 *   --input <dir>        Dossier source (.xp3 ou fichiers extraits)
 *   --output <dir>       Dossier de sortie (servu au navigateur)
 *   --work <dir>         Dossier de travail (défaut: .pipeline-work/)
 *   --dry-run            Simuler sans écrire
 *   --xp3-cmd <template> Gabarit extraction XP3 (avec {in} {out})
 *   --tlg-cmd <template> Gabarit conversion TLG (avec {in} {out})
 *   --audio-cmd <template> Gabarit conversion audio (avec {in} {out})
 *   --strict             Code de sortie non nul si références manquantes
 *   --force              Ignorer le cache incrémental
 */
import { mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { buildInventory } from "./inventory.js";
import { planTasks, summarizeResults, type PlanContext } from "./plan.js";
import { executeAll } from "./task-executor.js";
import {
  buildManifestFromResults,
  writeManifest,
  verifyReferences,
} from "./manifest.js";
import { validateCommandTemplate } from "./command-template.js";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

export type PipelineOptions = {
  inputDir: string;
  outputDir: string;
  workDir: string;
  dryRun: boolean;
  xp3Command?: string;
  tlgCommand?: string;
  audioCommand?: string;
  strict: boolean;
  force: boolean;
};

export type PipelineReport = {
  inventoryCount: number;
  taskCount: number;
  results: ReturnType<typeof summarizeResults>;
  manifestPath: string;
  reportPath: string;
  verification?: Awaited<ReturnType<typeof verifyReferences>>;
};

export async function runPipeline(opts: PipelineOptions): Promise<PipelineReport> {
  const { inputDir, outputDir, workDir, dryRun } = opts;

  console.log(`[pipeline] Input : ${inputDir}`);
  console.log(`[pipeline] Output: ${outputDir}`);
  console.log(`[pipeline] Work  : ${workDir}`);
  console.log(`[pipeline] Dry-run: ${dryRun}`);

  // Valider les gabarits de commande si fournis.
  if (opts.tlgCommand) {
    const err = validateCommandTemplate(opts.tlgCommand, true, true);
    if (err) throw new Error(`--tlg-cmd: ${err}`);
  }
  if (opts.audioCommand) {
    const err = validateCommandTemplate(opts.audioCommand, true, true);
    if (err) throw new Error(`--audio-cmd: ${err}`);
  }

  // 1. Résoudre la source.
  let sourceRoot = inputDir;
  if (opts.xp3Command) {
    const extractedDir = join(workDir, "extracted");
    if (!dryRun) await mkdir(extractedDir, { recursive: true });
    // TODO: extraction XP3 via gabarit
    console.warn("[pipeline] Extraction XP3 non implémentée dans cette version");
    sourceRoot = inputDir; // Pour l'instant, on suppose que les fichiers sont déjà extraits
  }

  // 2. Inventorier.
  console.log("[pipeline] Inventaire...");
  const entries = buildInventory(sourceRoot);
  console.log(`[pipeline] ${entries.length} fichiers inventoriés`);

  // 3. Planifier.
  const planCtx: PlanContext = {
    outputDir: resolve(outputDir),
    tlgCommand: opts.tlgCommand,
    audioCommand: opts.audioCommand,
    copyWavIfNoEncoder: true,
  };
  const tasks = planTasks(entries, planCtx);

  // Afficher le résumé du plan.
  const actionCounts: Record<string, number> = {};
  for (const task of tasks) {
    actionCounts[task.action] = (actionCounts[task.action] ?? 0) + 1;
  }
  console.log("[pipeline] Plan:", actionCounts);

  if (dryRun) {
    console.log("[pipeline] Dry-run: aucune écriture.");
    const results = tasks.map((task) => ({
      task,
      status: "ok" as const,
      actualOutputPath: task.outputPath,
    }));
    return {
      inventoryCount: entries.length,
      taskCount: tasks.length,
      results: summarizeResults(results),
      manifestPath: join(outputDir, "asset-manifest.json"),
      reportPath: join(workDir, "report.json"),
    };
  }

  // 4. Exécuter les tâches.
  console.log("[pipeline] Exécution...");
  await mkdir(outputDir, { recursive: true });
  const taskResults = await executeAll(tasks, dryRun, (done, total, current) => {
    if (done % 100 === 0 || done === total) {
      process.stdout.write(`\r[pipeline] ${done}/${total}...`);
    }
  });
  if (tasks.length > 0) process.stdout.write("\n");

  const summary = summarizeResults(taskResults);
  console.log(`[pipeline] Terminé: ${summary.ok} OK, ${summary.failed} échecs, ${summary.skipped} ignorés`);

  // 5. Construire le manifest depuis les résultats.
  const manifest = buildManifestFromResults(taskResults, resolve(outputDir));
  const manifestPath = join(outputDir, "asset-manifest.json");
  writeManifest(manifest, manifestPath);
  console.log(`[pipeline] Manifest écrit: ${manifestPath}`);
  console.log(`[pipeline]   ${Object.keys(manifest.images).length} images, ${Object.keys(manifest.audio).length} audio, ${Object.keys(manifest.scenarios).length} scénarios`);

  // 6. Vérifier les références.
  const scenarioEntries = entries.filter((e) => e.kind === "scenario");
  const verification = verifyReferences(scenarioEntries, manifest);
  const reportPath = join(workDir, "report.json");
  await mkdir(workDir, { recursive: true });
  const { writeFileSync } = await import("fs");
  writeFileSync(reportPath, JSON.stringify(verification, null, 2), "utf-8");
  console.log(`[pipeline] Rapport écrit: ${reportPath}`);
  console.log(`[pipeline]   ${verification.missingStorages.length} storages manquants, ${verification.evalSyntaxErrors.length} erreurs @eval`);

  if (opts.strict && verification.missingStorages.length > 0) {
    throw new Error(`${verification.missingStorages.length} storages manquants (mode --strict)`);
  }

  return {
    inventoryCount: entries.length,
    taskCount: tasks.length,
    results: summary,
    manifestPath,
    reportPath,
    verification,
  };
}

// CLI
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const inputDir = args.input as string | undefined;
  const outputDir = args.output as string | undefined;
  const workDir = (args.work as string) ?? ".pipeline-work";
  const dryRun = args["dry-run"] === true;
  const strict = args.strict === true;
  const force = args.force === true;

  if (!inputDir || !outputDir) {
    console.error("Usage: npm run pipeline -- --input <dir> --output <dir> [options]");
    console.error("  [--work <dir>] [--dry-run] [--strict] [--force]");
    console.error("  [--xp3-cmd <template>] [--tlg-cmd <template>] [--audio-cmd <template>]");
    console.error("  Templates utilisent {in} et {out} comme placeholders.");
    process.exit(1);
  }

  try {
    const report = await runPipeline({
      inputDir,
      outputDir,
      workDir,
      dryRun,
      xp3Command: args["xp3-cmd"] as string | undefined,
      tlgCommand: args["tlg-cmd"] as string | undefined,
      audioCommand: args["audio-cmd"] as string | undefined,
      strict,
      force,
    });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
