/**
 * Rapport d'exécution du pipeline et garde-fous de sortie (issue #95).
 *
 * Le pipeline écrit ses assets dans un dossier de sortie (`public/assets` par
 * défaut recommandé) et ses fichiers temporaires dans un dossier de travail
 * (`.pipeline-work/` par défaut) : **aucun des deux ne doit être commité**.
 * Ce module fournit :
 * - la collecte des tâches en échec et le rapport `pipeline-report.json` ;
 * - le résumé final (console) et le code de sortie à utiliser ;
 * - la vérification « dossier ignoré par git » pour les sorties.
 */
import { spawnSync } from "child_process";
import { isAbsolute, relative, resolve } from "path";
import type { TaskResult } from "./plan.js";

/** Tâche non exécutée (fichier non converti/copié/transcodé). */
export type RunFailure = {
  /** Chemin source relatif au dossier d'entrée. */
  source: string;
  /** Action prévue (convert-image, copy, convert-audio, transcode-ks). */
  action: string;
  /** Chemin de sortie prévu. */
  output: string;
  /** Message d'erreur. */
  error: string;
};

/** Contenu de `pipeline-report.json`. */
export type PipelineRunReport = {
  timestamp: string;
  inputDir: string;
  outputDir: string;
  workDir: string;
  dryRun: boolean;
  plan: Record<string, number>;
  totals: { tasks: number; ok: number; failed: number; skipped: number };
  failures: RunFailure[];
  verification?: {
    missingStorages: number;
    emptyStorageRefs: number;
    macroStorageRefs: number;
    evalSyntaxErrors: number;
  };
};

/** Extrait la liste des échecs d'exécution, dans l'ordre des tâches. */
export function collectFailures(results: readonly TaskResult[]): RunFailure[] {
  return results
    .filter((r) => r.status === "failed")
    .map((r) => ({
      source: r.task.entry.relPath,
      action: r.task.action,
      output: r.task.outputPath,
      error: r.error ?? "erreur inconnue",
    }));
}

/** Construit le rapport d'exécution à écrire dans le dossier de travail. */
export function buildRunReport(options: {
  inputDir: string;
  outputDir: string;
  workDir: string;
  dryRun: boolean;
  plan: Record<string, number>;
  totals: PipelineRunReport["totals"];
  failures: RunFailure[];
  verification?: PipelineRunReport["verification"];
}): PipelineRunReport {
  return {
    timestamp: new Date().toISOString(),
    inputDir: options.inputDir,
    outputDir: options.outputDir,
    workDir: options.workDir,
    dryRun: options.dryRun,
    plan: options.plan,
    totals: options.totals,
    failures: options.failures,
    ...(options.verification === undefined ? {} : { verification: options.verification }),
  };
}

/** Code de sortie : 1 si des fichiers n'ont pas été produits, ou en `--strict` si des storages manquent. */
export function exitCodeFor(report: PipelineRunReport, strict: boolean): 0 | 1 {
  if (report.totals.failed > 0) return 1;
  if (strict && (report.verification?.missingStorages ?? 0) > 0) return 1;
  return 0;
}

/**
 * Résumé final multi-lignes : les échecs sont listés (premiers 20) avec le chemin
 * du rapport complet. Aucun chemin d'asset n'est inventé ; seuls les chemins
 * sources relatifs fournis par l'inventaire apparaissent.
 */
export function formatRunSummary(report: PipelineRunReport, reportPath: string): string {
  const lines: string[] = [];
  lines.push("=== Résumé du pipeline ===");
  lines.push(`Entrée : ${report.inputDir}`);
  lines.push(`Sortie : ${report.outputDir}`);
  lines.push(`Travail : ${report.workDir}${report.dryRun ? " (dry-run)" : ""}`);
  lines.push(
    `Tâches : ${report.totals.tasks} (${report.totals.ok} OK, ${report.totals.failed} échec(s), ${report.totals.skipped} ignorée(s))`,
  );
  if (report.verification) {
    lines.push(
      `Références : ${report.verification.missingStorages} storage(s) manquant(s), ${report.verification.evalSyntaxErrors} erreur(s) @eval`,
    );
  }
  lines.push(`Rapport : ${reportPath}`);

  if (report.dryRun) {
    lines.push("");
    lines.push("Dry-run : aucune écriture ; relancer sans --dry-run pour produire les fichiers.");
    return lines.join("\n");
  }

  if (report.failures.length > 0) {
    lines.push("");
    lines.push(`Fichiers non convertis (${report.failures.length}) :`);
    for (const [index, failure] of report.failures.entries()) {
      if (index >= 20) {
        lines.push(`  … ${report.failures.length - 20} autre(s), voir le rapport JSON`);
        break;
      }
      lines.push(`  ❌ ${failure.source} (${failure.action}) : ${failure.error}`);
    }
    lines.push("");
    lines.push("Relancer avec --force après correction, ou consulter le rapport pour le détail.");
  } else {
    lines.push("");
    lines.push("Tous les fichiers planifiés ont été produits.");
  }

  return lines.join("\n");
}

/** Statut d'un chemin vis-à-vis de git (pour empêcher de commiter des assets). */
export type GitIgnoreStatus = "ignored" | "not-ignored" | "outside-repo" | "unknown";

/**
 * Vérifie si `target` est ignoré par git, en le comparant au dépôt courant.
 * `unknown` si git est indisponible ou si le dossier courant n'est pas un dépôt.
 */
export function gitIgnoreStatus(target: string, cwd: string = process.cwd()): GitIgnoreStatus {
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf-8" });
  if (root.status !== 0 || !root.stdout.trim()) return "unknown";
  const repoRoot = resolve(root.stdout.trim());
  const abs = resolve(cwd, target);
  const rel = relative(repoRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return "outside-repo";
  const res = spawnSync("git", ["-C", repoRoot, "check-ignore", "-q", "--", abs]);
  if (res.status === 0) return "ignored";
  // `git check-ignore` peut sortir en erreur (128) si git est indisponible.
  if (res.status === 1) return "not-ignored";
  return "unknown";
}

/** Message d'erreur pour un dossier de sortie non ignoré par git, ou null si OK. */
export function unignoredOutputError(kind: "sortie" | "travail", dir: string): string | null {
  const status = gitIgnoreStatus(dir);
  if (status !== "not-ignored") return null;
  const suggestion =
    kind === "sortie"
      ? "Utilisez ./public/assets (ignoré par git) ou ajoutez votre dossier à .gitignore."
      : "Utilisez .pipeline-work/ (ignoré par git), un dossier hors du dépôt (/tmp/…), ou ajoutez-le à .gitignore.";
  return `Le dossier de ${kind} « ${dir} » est dans le dépôt mais n'est pas ignoré par git : les assets du jeu ne doivent jamais être commités. ${suggestion}`;
}
