/**
 * Garde-fou CI du registre de commandes KAG — **mode zéro strict** (#275, #302).
 *
 * Depuis la clôture v1.0, **aucune commande inconnue n'est tolérée** :
 * 1. le registre des no-ops justifiés (`tools/ignored-commands.ts`) est valide
 *    (raison, effet, issue) ;
 * 2. la baseline (`tools/audit-commands-baseline.json`) est **vide** (métadonnées
 *    seules) — le mécanisme de décroissance a été supprimé ;
 * 3. la section générée de `docs/LECTURE_COMPLETE.md` est à jour ;
 * 4. si les assets sont disponibles (`MAHOYO_ASSETS_DIR` ou `public/assets`), l'audit
 *    du corpus ne doit révéler **aucune** commande inconnue : la moindre inconnue
 *    fait échouer le garde-fou (exit 1). Sans assets, seule la partie statique est
 *    vérifiée (avertissement).
 *
 * Modes : `npm run audit:guard` (statique + doc) et `--strict` (compatibilité ; le
 * zéro strict est désormais le comportement par défaut). Il n'existe plus de
 * `npm run audit:baseline` : la baseline ne doit jamais être modifiée.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { countOccurrences, loadBaseline, type CommandBaseline, type CommandCounts } from "./audit-commands.js";
import { auditScript, aggregateGlobal, listCorpus } from "./audit-lib.js";
import { checkGeneratedBlock } from "./audit-commands-doc.js";
import { IGNORED_COMMANDS_BY_NAME, validateIgnoredCommands } from "./ignored-commands.js";

const REPO_ROOT = join(import.meta.dirname, "..");
const DEFAULT_ASSETS_DIR = join(REPO_ROOT, "public/assets");

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
 * Mode zéro strict : toute commande inconnue mesurée est une erreur. Aucune baseline, aucune
 * tolérance de décroissance — l'inconnue doit être implémentée, approximée (registre #296) ou
 * déclarée no-op justifié (#275).
 */
export function evaluateCorpusAudit(audit: Pick<CorpusCommandAudit, "unknown">): string[] {
  const unknown = Object.keys(audit.unknown).sort();
  const lines: string[] = [];
  for (const name of unknown) {
    lines.push(
      `commande inconnue « @${name} » (${audit.unknown[name]} occurrence(s)) : le mode zéro strict interdit toute inconnue — l'implémenter, l'approximer (registre #296) ou la déclarer no-op justifié (#275).`,
    );
  }
  return lines;
}

/**
 * Mode zéro strict : la baseline versionnée doit être **vide** (métadonnées seules). Le
 * mécanisme de décroissance (et `npm run audit:baseline`) a été supprimé à la clôture v1.0.
 */
export function evaluateBaselineShape(baseline: CommandBaseline): string[] {
  const names = Object.keys(baseline.commands);
  if (names.length === 0) return [];
  return [
    `baseline non vide (${names.length} commande(s) inconnue(s)) : en mode zéro strict la baseline doit rester vide — ne jamais y ajouter d'inconnue (#302).`,
  ];
}

type Finding = { level: "error" | "warning" | "info"; message: string };

/** Garde-fou complet : retourne les constats et le rapport d'audit éventuel. */
export async function runGuard(_options: { strict?: boolean } = {}): Promise<{
  findings: Finding[];
  audit: CorpusCommandAudit | null;
}> {
  const findings: Finding[] = [];

  // 1. Registre des no-ops justifiés (raison, effet, issue).
  for (const problem of validateIgnoredCommands()) {
    findings.push({ level: "error", message: `registre : ${problem}` });
  }

  // 2. Baseline : lecture + mode zéro strict (elle doit rester vide).
  let baseline: CommandBaseline | null = null;
  try {
    baseline = loadBaseline();
  } catch (err) {
    findings.push({ level: "error", message: err instanceof Error ? err.message : String(err) });
  }
  if (baseline) {
    for (const message of evaluateBaselineShape(baseline)) {
      findings.push({ level: "error", message });
    }
    for (const name of Object.keys(baseline.commands)) {
      if (IGNORED_COMMANDS_BY_NAME.has(name)) {
        findings.push({
          level: "error",
          message: `« @${name} » est à la fois dans la baseline et dans le registre : retirer de la baseline.`,
        });
      }
    }
  }

  // 3. Doc générée à jour.
  try {
    const docError = checkGeneratedBlock();
    if (docError) findings.push({ level: "error", message: docError });
  } catch (err) {
    findings.push({ level: "error", message: err instanceof Error ? err.message : String(err) });
  }

  // 4. Audit du corpus si assets disponibles : zéro inconnue tolérée.
  const assetsDir = resolveAssetsDir();
  let audit: CorpusCommandAudit | null = null;
  if (assetsDir) {
    audit = await auditCorpusCommands(assetsDir);
    for (const message of evaluateCorpusAudit(audit)) {
      findings.push({ level: "error", message });
    }
    findings.push({
      level: "info",
      message: `audit corpus (zéro strict) : ${audit.scriptsAudited} scripts, ${Object.keys(audit.implemented).length} implémentée(s), ${Object.keys(audit.ignored).length} ignorée(s) volontairement, ${Object.keys(audit.unknown).length} inconnue(s) (${countOccurrences(audit.unknown)} occurrences).`,
    });
  } else {
    findings.push({
      level: "warning",
      message:
        "aucun asset local (MAHOYO_ASSETS_DIR/public/assets) : garde-fou statique seulement (registre, baseline vide, doc) ; l'audit zéro strict est vérifié en CI avec le corpus de placeholders.",
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
  // `--strict` est conservé pour compatibilité : le zéro strict est le comportement par défaut.
  if (args.some((arg) => arg !== "--strict")) {
    console.error(`[audit:guard] option inconnue : ${args.join(" ")}`);
    process.exit(1);
  }
  runGuard({ strict: args.includes("--strict") })
    .then(({ findings }) => {
      const errors = findings.filter((finding) => finding.level === "error");
      const warnings = findings.filter((finding) => finding.level === "warning");
      console.log(formatFindings(findings));
      console.log("");
      console.log(
        `[audit:guard] ${errors.length === 0 ? "OK" : "ÉCHEC"} — ${errors.length} erreur(s), ${warnings.length} avertissement(s), mode zéro strict${args.includes("--strict") ? " (--strict)" : ""}.`,
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
