/**
 * Garde-fou CI du registre de commandes KAG (#275).
 *
 * Vérifie :
 * 1. la validité du registre (`tools/ignored-commands.ts`) — aucune commande à
 *    effet visible/audible/de déroulement sans justification explicite et accord ;
 * 2. l'intégrité de la baseline versionnée (`tools/audit-commands-baseline.json`) ;
 * 3. la fraîcheur de la section générée de `docs/LECTURE_COMPLETE.md` ;
 * 4. que la baseline **ne peut que baisser** par rapport à `origin/main` (option
 *    `--ref`, désactivable) ;
 * 5. si les assets sont disponibles (`MAHOYO_ASSETS_DIR` ou `public/assets`), que
 *    l'audit du corpus ne révèle aucune inconnue hors baseline (`--strict` exige
 *    en plus que chaque inconnue de la baseline soit encore mesurée, donc que
 *    toute résolution ait été répercutée).
 *
 * Modes :
 *   npm run audit:guard                    garde-fou (CI : partie statique + doc)
 *   npm run audit:guard -- --strict        exige en plus que la baseline soit à jour
 *   npm run audit:baseline                 recalcule la baseline + la doc (assets requis)
 *
 * Sans assets (cas de la CI sur placeholders), le garde-fou statique (registre,
 * baseline, doc, décroissance) reste actif et l'absence d'audit est signalée.
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  BASELINE_PATH,
  compareWithBaseline,
  countOccurrences,
  loadBaseline,
  normalizeCommandCounts,
  parseBaseline,
  serializeBaseline,
  type CommandBaseline,
  type CommandCounts,
} from "./audit-commands.js";
import { auditScript, aggregateGlobal, listCorpus } from "./audit-lib.js";
import { checkGeneratedBlock, writeGeneratedBlock } from "./audit-commands-doc.js";
import { IGNORED_COMMANDS_BY_NAME, validateIgnoredCommands } from "./ignored-commands.js";

const REPO_ROOT = join(import.meta.dirname, "..");
const DEFAULT_ASSETS_DIR = join(REPO_ROOT, "public/assets");
/** Référence git utilisée pour vérifier que la baseline ne peut que baisser. */
export const DEFAULT_BASELINE_REF = "origin/main";

/** Résultat partagé d'un audit de corpus (sous-ensemble utile au garde-fou). */
export interface CorpusCommandAudit {
  assetsDir: string;
  scriptsAudited: number;
  unknown: CommandCounts;
  ignored: CommandCounts;
  implemented: CommandCounts;
}

/** Résout le dossier d'assets à auditer, ou null si aucun n'est disponible. */
function resolveAssetsDir(): string | null {
  const env = process.env.MAHOYO_ASSETS_DIR?.trim();
  if (env && existsSync(join(env, "asset-manifest.json"))) return env;
  if (existsSync(join(DEFAULT_ASSETS_DIR, "asset-manifest.json"))) return DEFAULT_ASSETS_DIR;
  return null;
}

/** Audite un corpus et retourne les compteurs classés (implémentée/ignorée/inconnue). */
export async function auditCorpusCommands(assetsDir: string): Promise<CorpusCommandAudit> {
  const manifest = JSON.parse(readFileSync(join(assetsDir, "asset-manifest.json"), "utf-8"));
  const listing = listCorpus(join(assetsDir, "scenario"));
  const results = [];
  for (const file of listing.auditableScripts) {
    results.push(
      await auditScript(join(assetsDir, "scenario", file), file, manifest, listing.scriptTexts),
    );
  }
  const aggregate = aggregateGlobal(results);
  return {
    assetsDir,
    scriptsAudited: listing.auditableScripts.length,
    unknown: aggregate.unknownCommandsGlobal,
    ignored: aggregate.ignoredCommandsGlobal,
    implemented: aggregate.implementedCommandsGlobal,
  };
}

/**
 * Problèmes de l'audit d'un corpus vis-à-vis de la baseline.
 * En mode strict, une inconnue de la baseline devenue silencieuse doit être
 * retirée (mise à jour explicite dans la PR).
 */
export function evaluateCorpusAudit(
  audit: Pick<CorpusCommandAudit, "unknown">,
  baseline: CommandCounts,
  options: { strict: boolean },
): string[] {
  const comparison = compareWithBaseline(audit.unknown, baseline);
  const problems: string[] = [];
  for (const name of comparison.newCommands) {
    problems.push(
      `nouvelle commande inconnue « @${name} » (absente de la baseline) : à trier (#276) ou à implémenter.`,
    );
  }
  for (const entry of comparison.increased) {
    problems.push(
      `« @${entry.name} » : ${entry.measured} occurrence(s) contre ${entry.baseline} en baseline — le nombre d'inconnues ne peut que baisser.`,
    );
  }
  if (options.strict) {
    for (const name of comparison.resolved) {
      problems.push(
        `« @${name} » n'est plus inconnue (implémentée ou déclarée no-op) : retirer de la baseline (npm run audit:baseline).`,
      );
    }
  }
  return problems;
}

/** Vérifie que la baseline ne croît pas par rapport à une plus ancienne (ex. origin/main). */
export function evaluateBaselineGrowth(
  baseline: CommandCounts,
  reference: CommandCounts,
): string[] {
  const comparison = compareWithBaseline(baseline, reference);
  const problems: string[] = [];
  for (const name of comparison.newCommands) {
    problems.push(`la baseline ajoute « @${name} » : une inconnue ne peut qu'être retirée, pas ajoutée.`);
  }
  for (const entry of comparison.increased) {
    problems.push(
      `la baseline augmente « @${entry.name} » (${entry.baseline} → ${entry.measured}) : le nombre d'inconnues ne peut que baisser.`,
    );
  }
  return problems;
}

/** Lit la baseline d'une référence git (ex. origin/main), ou null si indisponible. */
function loadBaselineFromRef(ref: string): CommandBaseline | null {
  const res = spawnSync("git", ["-C", REPO_ROOT, "show", `${ref}:tools/audit-commands-baseline.json`], {
    encoding: "utf-8",
  });
  if (res.status !== 0) return null;
  try {
    return parseBaseline(JSON.parse(res.stdout));
  } catch {
    return null;
  }
}

/** Construit la baseline à partir d'un audit de corpus. */
export function buildBaseline(audit: CorpusCommandAudit, today = new Date().toISOString().slice(0, 10)): CommandBaseline {
  return {
    generatedAt: today,
    source: `npm run audit sur ${audit.scriptsAudited} scripts narratifs (assets locaux, non commités)`,
    note: "Inconnues constatées sur le corpus de référence, en attente de triage (#276). Ne peut que décroître ; mise à jour explicite dans la PR (npm run audit:baseline).",
    triageIssue: "#276",
    commands: normalizeCommandCounts(audit.unknown),
  };
}

type Finding = { level: "error" | "warning" | "info"; message: string };

/** Garde-fou complet : retourne les constats et le rapport d'audit éventuel. */
export async function runGuard(options: {
  strict: boolean;
  ref?: string;
  updateBaseline: boolean;
  allowBaselineIncrease: boolean;
}): Promise<{ findings: Finding[]; audit: CorpusCommandAudit | null }> {
  const findings: Finding[] = [];

  // 1. Registre.
  for (const problem of validateIgnoredCommands()) {
    findings.push({ level: "error", message: `registre : ${problem}` });
  }

  // 2. Baseline versionnée.
  let baseline: CommandBaseline | null = null;
  try {
    baseline = loadBaseline();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Premier lancement (`--update-baseline`) : la baseline est créée, pas une erreur.
    findings.push({ level: options.updateBaseline ? "warning" : "error", message });
  }
  if (baseline) {
    for (const name of Object.keys(baseline.commands)) {
      if (IGNORED_COMMANDS_BY_NAME.has(name)) {
        findings.push({
          level: "error",
          message: `« @${name} » est à la fois dans la baseline et dans le registre : retirer de la baseline.`,
        });
      }
    }
  }

  // 3. Doc générée.
  try {
    const docError = checkGeneratedBlock();
    if (docError) findings.push({ level: "error", message: docError });
  } catch (err) {
    findings.push({ level: "error", message: err instanceof Error ? err.message : String(err) });
  }

  // 4. Baseline vs référence git (ne peut que baisser).
  if (baseline && options.ref !== "none") {
    const ref = options.ref ?? DEFAULT_BASELINE_REF;
    const reference = loadBaselineFromRef(ref);
    if (!reference) {
      findings.push({
        level: "warning",
        message: `comparaison avec ${ref} indisponible (première introduction de la baseline ou réf non fetchée).`,
      });
    } else {
      const growth = evaluateBaselineGrowth(baseline.commands, reference.commands);
      for (const message of growth) {
        findings.push({
          level: options.allowBaselineIncrease ? "warning" : "error",
          message,
        });
      }
    }
  }

  // 5. Audit du corpus si assets disponibles (ou mise à jour de la baseline).
  const assetsDir = resolveAssetsDir();
  let audit: CorpusCommandAudit | null = null;
  if (assetsDir) {
    audit = await auditCorpusCommands(assetsDir);
    if (options.updateBaseline) {
      const next = buildBaseline(audit);
      writeFileSync(BASELINE_PATH, serializeBaseline(next), "utf-8");
      findings.push({
        level: "info",
        message: `baseline mise à jour : ${Object.keys(next.commands).length} commande(s) inconnue(s), ${countOccurrences(next.commands)} occurrence(s).`,
      });
      writeGeneratedBlock();
      findings.push({ level: "info", message: "section générée de docs/LECTURE_COMPLETE.md mise à jour." });
      baseline = next;
    }
    if (baseline) {
      const corpusProblems = evaluateCorpusAudit(audit, baseline.commands, { strict: options.strict });
      for (const message of corpusProblems) findings.push({ level: "error", message });
      findings.push({
        level: "info",
        message: `audit corpus : ${audit.scriptsAudited} scripts, ${Object.keys(audit.implemented).length} implémentée(s), ${Object.keys(audit.ignored).length} ignorée(s) volontairement, ${Object.keys(audit.unknown).length} inconnue(s) (${countOccurrences(audit.unknown)} occurrences).`,
      });
    }
  } else {
    findings.push({
      level: "warning",
      message:
        "aucun asset local (MAHOYO_ASSETS_DIR/public/assets) : garde-fou statique seulement (registre, baseline, doc, décroissance).",
    });
  }

  return { findings, audit };
}

/** Résumé console + code de sortie. */
export function formatFindings(findings: readonly Finding[]): string {
  const icon = { error: "❌", warning: "⚠️", info: "ℹ️" } as const;
  return findings.map((finding) => `${icon[finding.level]} ${finding.message}`).join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const updateBaseline = args.includes("--update-baseline");
  const allowBaselineIncrease = args.includes("--allow-baseline-increase");
  const noRef = args.includes("--no-ref");
  const refIndex = args.indexOf("--ref");
  const ref = noRef ? "none" : refIndex !== -1 ? args[refIndex + 1] : undefined;

  runGuard({ strict, ref, updateBaseline, allowBaselineIncrease })
    .then(({ findings }) => {
      const errors = findings.filter((finding) => finding.level === "error");
      const warnings = findings.filter((finding) => finding.level === "warning");
      console.log(formatFindings(findings));
      console.log("");
      console.log(
        `[audit:guard] ${errors.length === 0 ? "OK" : "ÉCHEC"} — ${errors.length} erreur(s), ${warnings.length} avertissement(s)${strict ? ", mode strict" : ""}.`,
      );
      process.exit(errors.length === 0 ? 0 : 1);
    })
    .catch((err) => {
      console.error("[audit:guard] erreur inattendue :", err);
      process.exit(1);
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
