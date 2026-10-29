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
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, extname } from "path";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime, createRuntimeState } from "@/kag/runtime.js";
import type { AssetManifest } from "@/core/asset-manifest.js";
import type { RenderEvent } from "@/kag/events.js";

// ── Configuration ──

const SCENARIO_DIR = join(import.meta.dirname, "../public/assets/scenario");
const MANIFEST_PATH = join(import.meta.dirname, "../public/assets/asset-manifest.json");
const REPORTS_DIR = join(import.meta.dirname, "../reports");

/** Maximum de steps par script pour éviter les boucles infinies. */
const DEFAULT_MAX_STEPS = 10_000;

/**
 * Seuil pour la détection de scripts chiffrés/binaires.
 * Si plus de ce ratio de bytes dans les 512 premiers octets sont des
 * caractères de contrôle (< 0x20, hors \t\n\r), des katakana demi-chasse
 * (U+FF61–FF9F, rares dans Mahoyo) ou le caractère de remplacement U+FFFD,
 * le script est considéré chiffré.
 */
const ENCRYPTED_BYTE_THRESHOLD = 0.10;

/**
 * Scripts système à ignorer : menus, config, plugins, etc.
 * Ces scripts ne terminent pas normalement (boucles infinies, @s, @rclick)
 * et dépendent de commandes non gérées par le moteur.
 */
const SKIP_SCRIPTS = new Set([
  "about.ks",
  "archive.ks",
  "autopathplugin.ks",
  "backlog.ks",
  "basicchoice.ks",
  "basicdecide.ks",
  "button-47.ks",
  "call.ks",
  "cgmode.ks",
  "config_system.ks",
  "fallnote.ks",
  "first.ks",
  "fontchange.ks",
  "gamemenu.ks",
  "loaderror.ks",
  "read.ks",
  "saveerror.ks",
  "startup.ks",
  "teatime.ks",
  "title.ks",
  "tracerplugin.ks",
]);

/**
 * Signatures magiques de fichiers binaires qui peuvent porter l'extension .ks
 * dans l'archive KiriKiri XP3. Le décodeur les lit comme du texte mais ce
 * sont en réalité des images ou des fichiers audio.
 *
 * Après décodage Shift-JIS→UTF-8, certaines signatures sont déformées :
 * - PNG : 0x89→U+81FC (臼), puis "NG" intact → on cherche "臼NG"
 * - RIFF : peut rester intact ou être déformé → on cherche "RIFF"
 *
 * Les patterns sont ancrés en début de chaîne (un BOM optionnel est toléré).
 */
const BINARY_PATTERNS: RegExp[] = [
  /^\uFEFF?\u0089PNG/,   // PNG (décodage UTF-8 direct)
  /^\uFEFF?臼NG/,        // PNG (0x89 décodé en U+81FC par Shift-JIS)
  /^\uFEFF?RIFF/,        // RIFF container (WAV, etc.)
];

/**
 * Détecte un script chiffré/binaire en examinant les premiers octets.
 *
 * Les scripts KAG normaux commencent par du texte ASCII/Japonais (commentaires
 * `;`, labels `*`, commandes `@`). Les scripts chiffrés contiennent des bytes
 * de contrôle ou du binaire brut.
 */
export function isEncrypted(text: string): boolean {
  // 1. Vérifier les signatures magiques de fichiers binaires
  const head = text.slice(0, 32);
  for (const pat of BINARY_PATTERNS) {
    if (pat.test(head)) return true;
  }

  // 2. Examiner les 512 premiers caractères pour les bytes de contrôle
  const sample = text.slice(0, 512);
  if (sample.length === 0) return false;

  let badBytes = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // Caractères de contrôle (hors tab, LF, CR) = signal de chiffrage
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      badBytes++;
    }
    // Katakana demi-chasse (U+FF61–FF9F) : très rares dans Mahoyo,
    // typiques d'un décodage Shift-JIS de binaire audio.
    if (code >= 0xff61 && code <= 0xff9f) {
      badBytes++;
    }
    // Caractère de remplacement U+FFFD : signal fiable de binaire lu en UTF-8
    if (code === 0xfffd) {
      badBytes++;
    }
  }

  return badBytes / sample.length > ENCRYPTED_BYTE_THRESHOLD;
}

// ── Types du rapport ──

export interface ScriptAuditResult {
  /** Nom du fichier .ks (relatif à scenario/). */
  file: string;
  /** Nombre de steps exécutés. */
  steps: number;
  /** Commandes inconnues rencontrées. */
  unknownCommands: Record<string, number>;
  /** Warnings collectés (groupés). */
  warnings: Record<string, number>;
  /** Assets référencés mais absents du manifest. */
  missingAssets: string[];
  /** Erreurs fatales (runtime crash). */
  errors: string[];
  /** Compteur rawCount du runtime. */
  rawCount: number;
  /** Temps d'exécution en ms. */
  durationMs: number;
  /** true si le script a atteint maxSteps sans terminer. */
  hitMaxSteps: boolean;
}

export interface AuditReport {
  /** Date de l'audit (ISO). */
  timestamp: string;
  /** Nombre total de scripts dans le répertoire. */
  totalScriptsFound: number;
  /** Nombre de scripts système ignorés. */
  skippedSystem: number;
  /** Nombre de scripts chiffrés ignorés. */
  skippedEncrypted: number;
  /** Nombre de scripts audités. */
  totalScripts: number;
  /** Nombre de scripts avec au moins une erreur fatale. */
  scriptsWithErrors: number;
  /** Nombre de scripts ayant atteint maxSteps. */
  scriptsWithMaxSteps: number;
  /** Durée totale en ms. */
  totalDurationMs: number;
  /** Résultats par script. */
  scripts: ScriptAuditResult[];
  /** Synthèse : commandes inconnues triées par fréquence (tout corpus). */
  unknownCommandsGlobal: Record<string, number>;
  /** Synthèse : warnings triés par fréquence (tout corpus). */
  warningsGlobal: Record<string, number>;
  /** Synthèse : assets manquants triés par fréquence. */
  missingAssetsGlobal: Record<string, number>;
}

// ── Logique d'audit d'un script ──

/**
 * Exécute un script .ks en mode headless et collecte les diagnostics.
 * Les pauses (click/wait/waitFor) sont franchies automatiquement.
 * Les références inter-scripts via loadScript sont suivies.
 */
export async function auditScript(
  ksPath: string,
  fileName: string,
  manifest: AssetManifest | null,
  scriptTexts: Map<string, string>,
  maxSteps: number = DEFAULT_MAX_STEPS,
): Promise<ScriptAuditResult> {
  const text = scriptTexts.get(fileName) ?? readFileSync(ksPath, "utf-8");
  const script = parse(lex(text));

  const runtime = new Runtime(script, fileName);

  const warnings: string[] = [];
  runtime.onWarning = (msg: string) => warnings.push(msg);

  // ScriptLoader qui lit les scripts référencés depuis le cache texte.
  runtime.scriptLoader = async (storage: string) => {
    try {
      const content = scriptTexts.get(storage);
      if (content === undefined) return null;
      return parse(lex(content));
    } catch {
      return null;
    }
  };

  const missingAssets = new Set<string>();
  const errors: string[] = [];
  let steps = 0;
  let hitMaxSteps = false;

  const start = performance.now();

  while (steps < maxSteps) {
    try {
      const step = runtime.step();
      steps++;

      // Collecter les assets référencés
      if (manifest) {
        collectAssets(step.events, manifest, missingAssets);
      }

      if (step.stop.kind === "end") break;

      // Gérer les changements de script
      if (step.stop.kind === "loadScript") {
        const loaded = await runtime.loadScript(
          step.stop.file,
          step.stop.label,
          step.stop.pushCallStack ?? true,
        );
        if (!loaded) break;
      }

      // click / wait / waitFor → on avance automatiquement
      // (le prochain appel à step() reprend l'exécution)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      break;
    }
  }

  if (steps >= maxSteps) {
    hitMaxSteps = true;
  }

  const durationMs = Math.round(performance.now() - start);

  // Grouper les commandes inconnues
  const unknownCommands: Record<string, number> = {};
  for (const w of warnings) {
    const match = w.match(/commande non gérée: @(\S+)/);
    if (match) {
      unknownCommands[match[1]] = (unknownCommands[match[1]] ?? 0) + 1;
    }
  }

  // Grouper les autres warnings (hors commandes inconnues)
  const otherWarnings: Record<string, number> = {};
  for (const w of warnings) {
    if (!w.includes("commande non gérée")) {
      // Ne pas simplifier les warnings de chargement de script :
      // le nom du fichier est l'information utile.
      const key = w.includes("failed to load script")
        ? w
        : w.replace(/:\s*\S+$/, "");
      otherWarnings[key] = (otherWarnings[key] ?? 0) + 1;
    }
  }

  return {
    file: fileName,
    steps,
    unknownCommands,
    warnings: otherWarnings,
    missingAssets: Array.from(missingAssets).sort(),
    errors,
    rawCount: runtime.rawCount,
    durationMs,
    hitMaxSteps,
  };
}

// ── Collecte d'assets (identique au test d'intégration) ──

function collectAssets(
  events: readonly RenderEvent[],
  manifest: AssetManifest,
  missing: Set<string>,
): void {
  for (const ev of events) {
    if (ev.kind === "scene") {
      if (ev.scene.bg) checkImage(ev.scene.bg, manifest, missing);
      for (const sprite of ev.scene.sprites) {
        checkImage(sprite.storage, manifest, missing);
      }
    } else if (ev.kind === "audio") {
      const e = ev.event;
      if (e.kind === "play" && e.storage) {
        checkAudio(e.storage, manifest, missing);
      }
    }
  }
}

function checkImage(storage: string, manifest: AssetManifest, missing: Set<string>): void {
  if (!manifest.images[storage]) {
    missing.add(`image:${storage}`);
  }
}

function checkAudio(storage: string, manifest: AssetManifest, missing: Set<string>): void {
  if (!manifest.audio[storage]) {
    missing.add(`audio:${storage}`);
  }
}

// ── Agrégation ──

function aggregateGlobal(results: ScriptAuditResult[]): {
  unknownCommandsGlobal: Record<string, number>;
  warningsGlobal: Record<string, number>;
  missingAssetsGlobal: Record<string, number>;
} {
  const unknownCommandsGlobal: Record<string, number> = {};
  const warningsGlobal: Record<string, number> = {};
  const missingAssetsGlobal: Record<string, number> = {};

  for (const r of results) {
    for (const [cmd, count] of Object.entries(r.unknownCommands)) {
      unknownCommandsGlobal[cmd] = (unknownCommandsGlobal[cmd] ?? 0) + count;
    }
    for (const [w, count] of Object.entries(r.warnings)) {
      warningsGlobal[w] = (warningsGlobal[w] ?? 0) + count;
    }
    for (const a of r.missingAssets) {
      missingAssetsGlobal[a] = (missingAssetsGlobal[a] ?? 0) + 1;
    }
  }

  return { unknownCommandsGlobal, warningsGlobal, missingAssetsGlobal };
}

// ── Formatage du rapport Markdown ──

/** Échappe les `|` pour les cellules de tableaux Markdown. */
function escapeMdPipe(s: string): string {
  return s.replace(/\|/g, "\\|");
}

export function formatMarkdownReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push("# Audit headless du corpus KAG");
  lines.push("");
  lines.push(`- **Date** : ${report.timestamp}`);
  lines.push(`- **Scripts trouvés** : ${report.totalScriptsFound}`);
  lines.push(`- **Scripts système ignorés** : ${report.skippedSystem}`);
  lines.push(`- **Scripts chiffrés ignorés** : ${report.skippedEncrypted}`);
  lines.push(`- **Scripts audités** : ${report.totalScripts}`);
  lines.push(`- **Scripts en erreur** : ${report.scriptsWithErrors}`);
  lines.push(`- **Scripts maxSteps atteint** : ${report.scriptsWithMaxSteps}`);
  lines.push(`- **Durée totale** : ${(report.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push("");

  // Commandes inconnues
  lines.push("## Commandes inconnues (triées par fréquence)");
  lines.push("");
  const sortedCmds = Object.entries(report.unknownCommandsGlobal).sort((a, b) => b[1] - a[1]);
  if (sortedCmds.length === 0) {
    lines.push("_Aucune commande inconnue._");
  } else {
    lines.push("| Commande | Occurrences |");
    lines.push("|---|---|");
    for (const [cmd, count] of sortedCmds) {
      lines.push(`| @${escapeMdPipe(cmd)} | ${count} |`);
    }
  }
  lines.push("");

  // Warnings
  lines.push("## Warnings (triés par fréquence)");
  lines.push("");
  const sortedWarnings = Object.entries(report.warningsGlobal).sort((a, b) => b[1] - a[1]);
  if (sortedWarnings.length === 0) {
    lines.push("_Aucun warning._");
  } else {
    lines.push("| Warning | Occurrences |");
    lines.push("|---|---|");
    for (const [w, count] of sortedWarnings) {
      lines.push(`| ${escapeMdPipe(w)} | ${count} |`);
    }
  }
  lines.push("");

  // Assets manquants
  lines.push("## Assets manquants dans le manifest");
  lines.push("");
  const sortedAssets = Object.entries(report.missingAssetsGlobal).sort((a, b) => b[1] - a[1]);
  if (sortedAssets.length === 0) {
    lines.push("_Aucun asset manquant._");
  } else {
    lines.push("| Asset | Scripts |");
    lines.push("|---|---|");
    for (const [a, count] of sortedAssets) {
      lines.push(`| ${escapeMdPipe(a)} | ${count} |`);
    }
  }
  lines.push("");

  // Scripts en erreur
  const errorScripts = report.scripts.filter((s) => s.errors.length > 0);
  if (errorScripts.length > 0) {
    lines.push("## Scripts en erreur fatale");
    lines.push("");
    for (const s of errorScripts) {
      lines.push(`### ${s.file}`);
      for (const e of s.errors) {
        lines.push(`- \`${e}\``);
      }
      lines.push("");
    }
  }

  // Scripts ayant atteint maxSteps
  const maxStepScripts = report.scripts.filter((s) => s.hitMaxSteps);
  if (maxStepScripts.length > 0) {
    lines.push("## Scripts ayant atteint maxSteps (boucle probable)");
    lines.push("");
    for (const s of maxStepScripts) {
      lines.push(`- ${s.file} (${s.steps} steps, ${s.rawCount} raw)`);
    }
    lines.push("");
  }

  // Détail par script (résumé)
  lines.push("## Détail par script");
  lines.push("");
  lines.push("| Fichier | Steps | rawCount | Inconnues | Warnings | Assets manquants | Durée |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const s of report.scripts) {
    const unknownCount = Object.values(s.unknownCommands).reduce((a, b) => a + b, 0);
    const warnCount = Object.values(s.warnings).reduce((a, b) => a + b, 0);
    const marker = s.errors.length > 0 ? " ❌" : s.hitMaxSteps ? " ⚠️" : "";
    lines.push(
      `| ${s.file}${marker} | ${s.steps} | ${s.rawCount} | ${unknownCount} | ${warnCount} | ${s.missingAssets.length} | ${s.durationMs}ms |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

// ── CLI ──

async function main(): Promise<void> {
  if (!existsSync(SCENARIO_DIR)) {
    console.error(`Répertoire scenario introuvable : ${SCENARIO_DIR}`);
    console.error("Lancez d'abord le pipeline pour générer les assets.");
    process.exit(1);
  }

  // Charger le manifest (optionnel)
  let manifest: AssetManifest | null = null;
  if (existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    console.log(`Manifest chargé : ${MANIFEST_PATH}`);
  } else {
    console.log("Manifest absent — vérification d'assets désactivée.");
  }

  // Lister les .ks
  const allKsFiles = readdirSync(SCENARIO_DIR)
    .filter((f) => extname(f) === ".ks")
    .sort();

  // Séparer les scripts système (ignorés) des scripts narratifs (audités)
  const storyScripts = allKsFiles.filter((f) => !SKIP_SCRIPTS.has(f));
  const systemScripts = allKsFiles.filter((f) => SKIP_SCRIPTS.has(f));

  // Pré-charger le contenu de tous les scripts pour le scriptLoader
  const scriptTexts = new Map<string, string>();
  for (const f of allKsFiles) {
    try {
      scriptTexts.set(f, readFileSync(join(SCENARIO_DIR, f), "utf-8"));
    } catch {
      // Ignorer les scripts illisibles
    }
  }

  // Détecter les scripts chiffrés/binaires
  const encryptedScripts: string[] = [];
  const auditableScripts: string[] = [];
  for (const f of storyScripts) {
    const content = scriptTexts.get(f);
    if (content && isEncrypted(content)) {
      encryptedScripts.push(f);
      // Retirer du cache pour empêcher le chargement via @call/@jump
      scriptTexts.delete(f);
    } else {
      auditableScripts.push(f);
    }
  }

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
