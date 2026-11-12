/**
 * Orchestrateur du pipeline d'assets.
 *
 * Usage:
 *   npm run pipeline -- --input <dir> --output <dir> [options]
 *
 * Étapes :
 *   1. Résoudre la source (extraire XP3 si --xp3-cmd fourni, sinon --input)
 *   2. Inventorier (buildInventory)
 *   3. Planifier (planTasks)
 *   4. Exécuter les tâches (convertir/copier/transcoder)
 *   5. Construire le manifest depuis les résultats (buildManifestFromResults)
 *   6. Vérifier les références (verifyReferences → report.json)
 *   7. Écrire le rapport d'exécution (pipeline-report.json) et le résumé final
 *
 * Code de sortie : 0 si tout est produit ; 1 si des fichiers n'ont pas été
 * convertis/copiés (liste dans le résumé et `pipeline-report.json`), ou en
 * `--strict` s'il reste des storages manquants.
 *
 * Les dossiers de sortie et de travail doivent être ignorés par git (garde-fou :
 * le pipeline refuse un dossier du dépôt non ignoré, pour ne jamais commiter
 * d'asset du jeu).
 *
 * Options:
 *   --input <dir>        Dossier source (.xp3 ou fichiers extraits)
 *   --output <dir>       Dossier de sortie (servi au navigateur)
 *   --work <dir>         Dossier de travail (défaut: .pipeline-work/)
 *   --dry-run            Simuler sans écrire
 *   --xp3-cmd <template> Gabarit extraction XP3 (avec {in} {out})
 *   --tlg-cmd <template> Gabarit conversion TLG (avec {in} {out}) ; .webp attendu
 *   --audio-cmd <template> Gabarit conversion audio (avec {in} {out})
 *   --strict             Code de sortie non nul si références manquantes
 *   --force              Ignorer le cache incrémental
 *   --help               Afficher l'aide et quitter
 *   --no-translation     Ne pas installer la traduction française (par défaut, installée
 *                        après la conversion ; un échec réseau n'est qu'un avertissement)
 */
import { mkdir, stat } from "fs/promises";
import { generateImageDimensions } from "./image-dimensions.js";
import { existsSync } from "fs";
import { execFile, spawnSync } from "child_process";
import { promisify } from "util";
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
import { AUDIO_OUTPUT_EXT, type AudioFormat } from "./convert-audio.js";
import { listFiles } from "./pipeline-utils.js";
import { extractXp3WithCommand } from "./extract-xp3.js";
import {
  buildRunReport,
  collectFailures,
  exitCodeFor,
  formatRunSummary,
  unignoredOutputError,
  type PipelineRunReport,
  type RunFailure,
} from "./pipeline-report.js";
import { installEngineDataFiles, type EngineDataInstallReport } from "./data-files.js";
import { detectWebpTooling } from "./webp.js";

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

const execFileAsync = promisify(execFile);

/** `ffmpeg` est-il disponible sur le PATH ? (détection du mode audio par défaut, #387) */
async function detectFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], { maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

/** Formate un nombre d'octets en Mo lisibles. */
function formatMo(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export type PipelineOptions = {
  inputDir: string;
  outputDir: string;
  workDir: string;
  dryRun: boolean;
  xp3Command?: string;
  tlgCommand?: string;
  audioCommand?: string;
  /** Format audio des WAV convertis par ffmpeg sans `--audio-cmd` (#387) : `opus` (défaut) ou `aac`. */
  audioFormat?: AudioFormat;
  /** Désactive la conversion audio interne (WAV copiés tels quels si `copyWavIfNoEncoder`). */
  noAudio?: boolean;
  strict: boolean;
  force: boolean;
  /** Désactive la conversion WebP (repli PNG, #374). */
  noWebp?: boolean;
  /** Catégories autorisées à la conversion avec perte (`bg`, `ev`) ; vide = sans perte. */
  webpLossy?: string;
  /** Qualité WebP avec perte (≥ 90, défaut 90). */
  webpQuality?: number;
};

export type PipelineReport = {
  inventoryCount: number;
  taskCount: number;
  results: ReturnType<typeof summarizeResults>;
  manifestPath: string;
  reportPath: string;
  /** Chemin du rapport d'exécution (`pipeline-report.json`). */
  runReportPath: string;
  /** Fichiers planifiés mais non produits (échecs). */
  failedTasks: RunFailure[];
  /** Code de sortie recommandé (0 ou 1 ; 1 aussi en --strict si storages manquants). */
  exitCode: 0 | 1;
  verification?: Awaited<ReturnType<typeof verifyReferences>>;
  /** Fichiers de données du moteur installés (ex. `data/others/envcolor.ksc`, #260). */
  dataFiles?: EngineDataInstallReport;
};

export async function runPipeline(opts: PipelineOptions): Promise<PipelineReport> {
  const { inputDir, outputDir, workDir, dryRun } = opts;

  console.log(`[pipeline] Input : ${inputDir}`);
  console.log(`[pipeline] Output: ${outputDir}`);
  console.log(`[pipeline] Work  : ${workDir}`);
  console.log(`[pipeline] Dry-run: ${dryRun}`);

  // Valider les gabarits de commande si fournis.
  if (opts.xp3Command) {
    const err = validateCommandTemplate(opts.xp3Command, true, true);
    if (err) throw new Error(`--xp3-cmd: ${err}`);
  }
  if (opts.tlgCommand) {
    const err = validateCommandTemplate(opts.tlgCommand, true, true);
    if (err) throw new Error(`--tlg-cmd: ${err}`);
  }
  if (opts.audioCommand) {
    const err = validateCommandTemplate(opts.audioCommand, true, true);
    if (err) throw new Error(`--audio-cmd: ${err}`);
  }

  // Garde-fous : les sorties ne doivent jamais pouvoir être commitées.
  for (const [kind, dir] of [
    ["sortie", outputDir],
    ["travail", workDir],
  ] as const) {
    const err = unignoredOutputError(kind, dir);
    if (!err) continue;
    if (dryRun) console.warn(`[pipeline] Attention : ${err}`);
    else throw new Error(err);
  }

  // 1. Résoudre la source : extraction XP3 si un gabarit est fourni.
  let sourceRoot = inputDir;
  if (opts.xp3Command) {
    const extractedDir = join(workDir, "extracted");
    const archives = listFiles(inputDir, (p) => p.toLowerCase().endsWith(".xp3"));

    if (dryRun) {
      const alreadyExtracted = archives.length > 0 && existsSync(extractedDir);
      console.log(
        `[pipeline] Dry-run : ${archives.length} archive(s) .xp3 seraient extraites vers ${extractedDir}`,
      );
      if (archives.length > 0 && !alreadyExtracted) {
        console.log("[pipeline] Dry-run : extraction non exécutée, aucun fichier à inventorier pour l'instant.");
        const emptyTotals = { tasks: 0, ok: 0, failed: 0, skipped: 0 };
        const runReport = buildRunReport({
          inputDir,
          outputDir,
          workDir,
          dryRun,
          plan: {},
          totals: emptyTotals,
          failures: [],
        });
        console.log("");
        console.log(formatRunSummary(runReport, join(workDir, "pipeline-report.json")));
        return {
          inventoryCount: 0,
          taskCount: 0,
          results: summarizeResults([]),
          manifestPath: join(outputDir, "asset-manifest.json"),
          reportPath: join(workDir, "report.json"),
          runReportPath: join(workDir, "pipeline-report.json"),
          failedTasks: [],
          exitCode: 0,
        };
      }
      sourceRoot = existsSync(extractedDir) ? extractedDir : sourceRoot;
    } else {
      if (archives.length === 0) {
        throw new Error(`Aucune archive .xp3 trouvée dans ${inputDir} (option --xp3-cmd).`);
      }
      await mkdir(extractedDir, { recursive: true });
      console.log(`[pipeline] Extraction XP3 (${archives.length} archive(s))...`);
      const extraction = await extractXp3WithCommand({
        inputDir,
        command: opts.xp3Command,
        outputDir: extractedDir,
      });
      console.log(
        `[pipeline] ${extraction.archives.length} archive(s), ${extraction.extracted} extraite(s), ${extraction.failures.length} échec(s)`,
      );
      if (extraction.failures.length > 0) {
        const detail = extraction.failures
          .map((f) => `  - ${f.archive} : ${f.error}`)
          .join("\n");
        throw new Error(`Extraction XP3 incomplète (${extraction.failures.length} échec(s)) :\n${detail}`);
      }
      sourceRoot = extractedDir;
    }
  }

  // 2. Inventorier.
  console.log("[pipeline] Inventaire...");
  const entries = buildInventory(sourceRoot);
  console.log(`[pipeline] ${entries.length} fichiers inventoriés`);
  if (entries.length === 0) {
    const archives = listFiles(sourceRoot, (p) => p.toLowerCase().endsWith(".xp3"));
    if (archives.length > 0) {
      throw new Error(
        `${archives.length} archive(s) .xp3 trouvée(s) mais aucun fichier extrait : relancez avec --xp3-cmd "<commande> {in} {out}" (ou extrayez les archives puis passez le dossier extrait à --input).`,
      );
    }
    throw new Error(`Aucun fichier asset trouvé dans ${sourceRoot}. Vérifiez --input (racine des fichiers extraits) et --xp3-cmd.`);
  }

  // 3. Planifier. WebP sans perte par défaut (#374) ; avec perte seulement sur option et si le
  // garde-fou SSIM (ffmpeg) est disponible, catégories bg/ev uniquement.
  const tooling = await detectWebpTooling();
  const lossyCategories = (opts.webpLossy ?? "")
    .split(",")
    .map((category) => category.trim().toLowerCase())
    .filter((category) => category === "bg" || category === "ev");
  const lossy = lossyCategories.length > 0 && tooling.ssim;
  if (lossyCategories.length > 0 && !tooling.ssim) {
    console.warn("[pipeline] WebP avec perte demandé sans ffmpeg (SSIM) : conversion sans perte conservée.");
  }
  if (!opts.noWebp) {
    if (tooling.encoder) {
      console.log(`[pipeline] WebP ${lossy ? "avec perte contrôlée" : "sans perte"} (${tooling.encoder})`);
    } else {
      console.warn("[pipeline] Aucun encodeur WebP (sharp/cwebp) : repli PNG.");
    }
  }
  // Audio (#387) : WAV → Opus/Ogg par défaut si ffmpeg est disponible et qu'aucun gabarit
  // `--audio-cmd` n'est fourni ; repli AAC/.m4a pour Safari via `--audio-format aac`.
  const audioFormat: AudioFormat = opts.audioFormat ?? "opus";
  const ffmpegAvailable = !opts.noAudio && !opts.audioCommand && (await detectFfmpeg());
  if (!opts.audioCommand && !opts.noAudio) {
    if (ffmpegAvailable) {
      console.log(
        audioFormat === "aac"
          ? "[pipeline] Audio : WAV → AAC .m4a 128 kbps via ffmpeg (repli Safari ; Manifeste = .m4a)"
          : "[pipeline] Audio : WAV → Opus/Ogg 96 kbps (64 kbps mono) via ffmpeg — BGM OGG non réencodées",
      );
    } else {
      console.warn(
        "[pipeline] ffmpeg introuvable : les WAV sont copiés tels quels (installer ffmpeg pour −90 % de poids SE).",
      );
    }
  }
  const planCtx: PlanContext = {
    outputDir: resolve(outputDir),
    tlgCommand: opts.tlgCommand,
    audioCommand: opts.audioCommand,
    copyWavIfNoEncoder: true,
    audio: !opts.audioCommand && ffmpegAvailable ? { ffmpegPath: "ffmpeg", format: audioFormat } : null,
    webp:
      !opts.noWebp && tooling.encoder
        ? {
            encoder: tooling.encoder,
            lossyCategories: lossy ? lossyCategories : [],
            quality: Math.max(90, opts.webpQuality ?? 90),
          }
        : null,
  };
  const tasks = planTasks(entries, planCtx);

  // Afficher le résumé du plan.
  const actionCounts: Record<string, number> = {};
  for (const task of tasks) {
    actionCounts[task.action] = (actionCounts[task.action] ?? 0) + 1;
  }
  console.log("[pipeline] Plan:", actionCounts);

  // Fichiers de données du moteur (`envcolor.ksc`…) : copiés tels quels, hors manifeste.
  const dataFiles = await installEngineDataFiles(sourceRoot, outputDir, { dryRun });
  if (dataFiles.installed.length > 0) {
    console.log(`[pipeline] Données du moteur : ${dataFiles.installed.join(", ")}`);
  }
  for (const missing of dataFiles.missing) {
    console.warn(`[pipeline] Donnée du moteur absente de l'entrée (ignorée) : ${missing}`);
  }

  if (dryRun) {
    console.log("[pipeline] Dry-run: aucune écriture.");
    const results = tasks.map((task) => ({
      task,
      status: "ok" as const,
      actualOutputPath: task.outputPath,
    }));
    const dryRunTotals = { tasks: tasks.length, ok: tasks.length, failed: 0, skipped: 0 };
    const dryRunReport = buildRunReport({
      inputDir,
      outputDir,
      workDir,
      dryRun,
      plan: actionCounts,
      totals: dryRunTotals,
      failures: [],
    });
    console.log("");
    console.log(formatRunSummary(dryRunReport, join(workDir, "pipeline-report.json")));
    return {
      inventoryCount: entries.length,
      taskCount: tasks.length,
      results: summarizeResults(results),
      manifestPath: join(outputDir, "asset-manifest.json"),
      reportPath: join(workDir, "report.json"),
      runReportPath: join(workDir, "pipeline-report.json"),
      failedTasks: [],
      exitCode: 0,
      dataFiles,
    };
  }

  // 4. Exécuter les tâches.
  console.log("[pipeline] Exécution...");
  await mkdir(outputDir, { recursive: true });
  const taskResults = await executeAll(tasks, dryRun, (done, total) => {
    if (done % 100 === 0 || done === total) {
      process.stdout.write(`\r[pipeline] ${done}/${total}...`);
    }
  });
  if (tasks.length > 0) process.stdout.write("\n");

  const summary = summarizeResults(taskResults);
  console.log(`[pipeline] Terminé: ${summary.ok} OK, ${summary.failed} échecs, ${summary.skipped} ignorés`);

  // Rapport de poids audio (#387) : entrée WAV → sortie Opus/AAC (SE convertis par ffmpeg).
  const audioConversions: { input: number; output: number }[] = [];
  for (const result of taskResults) {
    if (result.status !== "ok" || result.task.action !== "convert-audio" || !result.actualOutputPath) continue;
    try {
      const [input, output] = await Promise.all([stat(result.task.entry.source), stat(result.actualOutputPath)]);
      audioConversions.push({ input: input.size, output: output.size });
    } catch {
      // Fichier de sortie manquant : déjà signalé dans le résumé des échecs.
    }
  }
  if (audioConversions.length > 0) {
    const inputBytes = audioConversions.reduce((sum, item) => sum + item.input, 0);
    const outputBytes = audioConversions.reduce((sum, item) => sum + item.output, 0);
    const saved = inputBytes > 0 ? Math.round((1 - outputBytes / inputBytes) * 100) : 0;
    console.log(
      `[pipeline] Audio : ${formatMo(inputBytes)} → ${formatMo(outputBytes)} (−${saved} %, ${audioConversions.length} fichier(s), ${AUDIO_OUTPUT_EXT[audioFormat]})`,
    );
  }

  // 5. Construire le manifest depuis les résultats.
  const manifest = buildManifestFromResults(taskResults, resolve(outputDir));
  const manifestPath = join(outputDir, "asset-manifest.json");
  writeManifest(manifest, manifestPath);
  console.log(`[pipeline] Manifest écrit: ${manifestPath}`);
  // Dimensions des images (#315) : placements sprites en pixels absolus dès la première frame.
  generateImageDimensions(outputDir);
  console.log("[pipeline] Manifeste des dimensions d'images écrit: image-dimensions.json");
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

  // 7. Rapport d'exécution complet (échecs inclus) + résumé final.
  const failures = collectFailures(taskResults);
  const runReport: PipelineRunReport = buildRunReport({
    inputDir,
    outputDir,
    workDir,
    dryRun,
    plan: actionCounts,
    totals: {
      tasks: tasks.length,
      ok: summary.ok,
      failed: summary.failed,
      skipped: summary.skipped,
    },
    failures,
    verification: {
      missingStorages: verification.missingStorages.length,
      emptyStorageRefs: verification.emptyStorageRefs ?? 0,
      macroStorageRefs: verification.macroStorageRefs ?? 0,
      evalSyntaxErrors: verification.evalSyntaxErrors.length,
    },
  });
  const runReportPath = join(workDir, "pipeline-report.json");
  writeFileSync(runReportPath, JSON.stringify(runReport, null, 2), "utf-8");

  const exitCode = exitCodeFor(runReport, opts.strict);
  console.log("");
  console.log(formatRunSummary(runReport, runReportPath));
  if (exitCode !== 0 && opts.strict && summary.failed === 0) {
    console.log(
      `[pipeline] --strict : ${verification.missingStorages.length} storage(s) manquant(s) — voir ${reportPath}`,
    );
  }

  return {
    inventoryCount: entries.length,
    taskCount: tasks.length,
    results: summary,
    manifestPath,
    reportPath,
    runReportPath,
    failedTasks: failures,
    exitCode,
    verification,
    dataFiles,
  };
}

/** Installe la traduction française (téléchargée en local, jamais versionnée) ; non bloquant. */
function installFrenchTranslation(workDir: string, outputDir: string): void {
  console.log("[pipeline] Installation de la traduction française (--no-translation pour l'ignorer)...");
  const res = spawnSync(
    "npx",
    ["tsx", "tools/translation.ts", "fr", join(workDir, "translation-fr"), outputDir, "--fetch"],
    { stdio: "inherit" },
  );
  if (res.status !== 0) {
    console.warn("[pipeline] Traduction non installée (réseau ?). Relancer : npm run translation -- fr <dossier> <assets> --fetch");
  }
}

/** Aide du CLI (`npm run pipeline -- --help`). */
function printUsage(): void {
  console.log(`Usage: npm run pipeline -- --input <dir> --output <dir> [options]

Parcours complet (.xp3 → assets web + manifest) :
  npm run pipeline -- \\
    --input ./jeu-raw \\
    --output ./public/assets \\
    --work .pipeline-work \\
    --xp3-cmd "<extracteur> {in} {out}" \\
    --tlg-cmd "<convertisseur TLG→WebP> {in} {out}" \\
    --audio-cmd "ffmpeg -y -i {in} -c:a libvorbis {out}"

Options :
  --input <dir>          Dossier source (archives .xp3 ou fichiers déjà extraits)
  --output <dir>         Dossier de sortie web (défaut recommandé : ./public/assets, ignoré par git)
  --work <dir>           Dossier de travail (défaut : .pipeline-work/, ignoré par git)
  --xp3-cmd <template>   Gabarit d'extraction des .xp3 ({in} = archive, {out} = dossier)
  --tlg-cmd <template>   Gabarit de conversion .tlg → .webp ({in}/{out}) ; décodeur intégré sinon (.png)
  --audio-cmd <template> Gabarit de conversion audio ({in}/{out}) ; prioritaire sur la conversion interne
  --audio-format <opus|aac> Format des WAV sans --audio-cmd (défaut opus ; aac = repli Safari .m4a)
  --no-audio             Désactive la conversion audio interne (WAV copiés tels quels)
  --no-webp              Désactive la conversion WebP (repli PNG)
  --webp-lossy <cats>    Conversion avec perte pour les catégories listées (bg,ev), qualité ≥90,
                         garde-fou SSIM ≥0,99 (ffmpeg requis) ; désactivé par défaut
  --webp-quality <n>     Qualité avec perte (≥90, défaut 90)
  --dry-run              Simule sans écrire (plan, coûts, archives à extraire)
  --strict               Code de sortie non nul s'il reste des storages manquants
  --force                Ignore le cache incrémental
  --no-translation       N'installe pas la traduction française
  --help, -h             Affiche cette aide

Code de sortie : 0 si tout est produit, 1 si des fichiers n'ont pas été convertis
(liste et rapport dans <work>/pipeline-report.json) ou en --strict.

Prérequis externes : un extracteur .xp3 (obligatoire si --input contient des .xp3),
un convertisseur TLG→WebP (sinon décodeur intégré + WebP sans perte si cwebp/sharp,
repli .png), ffmpeg pour le garde-fou SSIM et, s'il est présent, pour la conversion
audio WAV → Opus/Ogg (ou AAC/.m4a avec --audio-format aac, repli Safari).
Voir docs/PIPELINE.md.`);
}

// CLI
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const inputDir = args.input as string | undefined;
  const outputDir = args.output as string | undefined;
  const workDir = (args.work as string) ?? ".pipeline-work";
  const dryRun = args["dry-run"] === true;
  const strict = args.strict === true;
  const force = args.force === true;

  if (!inputDir || !outputDir) {
    printUsage();
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
      audioFormat:
        args["audio-format"] === undefined
          ? undefined
          : (() => {
              const value = String(args["audio-format"]);
              if (value !== "opus" && value !== "aac") {
                throw new Error(`--audio-format: valeur « ${value} » invalide (attendu : opus ou aac).`);
              }
              return value;
            })(),
      noAudio: args["no-audio"] === true,
      strict,
      force,
      noWebp: args["no-webp"] === true,
      webpLossy: args["webp-lossy"] as string | undefined,
      webpQuality: args["webp-quality"] !== undefined ? Number.parseInt(String(args["webp-quality"]), 10) : undefined,
    });
    if (!dryRun && args["no-translation"] !== true) installFrenchTranslation(workDir, outputDir);
    if (report.exitCode !== 0) {
      console.error(
        `[pipeline] ${report.results.failed} fichier(s) non produit(s) — voir ${report.runReportPath}`,
      );
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
