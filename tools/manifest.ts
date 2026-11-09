/**
 * Génération du manifest d'assets et vérification des références.
 *
 * Le manifest mappe les clés de storage normalisées vers les URLs web.
 * Il est produit à partir de l'inventaire et vérifié contre les scripts .ks
 * pour détecter les storages introuvables.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";
import type { AssetManifest, ManifestEntry, ScenarioEntry } from "../src/core/asset-manifest.js";
import { lookupAudio, lookupImage } from "../src/core/asset-manifest.js";
import { isSolidColor, storageKey } from "../src/core/storage-key.js";
import type { InventoryEntry } from "./inventory.js";
import { lex } from "../src/kag/lexer.js";
import { parse } from "../src/kag/parser.js";
import { decodeKs } from "./ks-encoding.js";
import type { TaskResult } from "./plan.js";

/**
 * Construit le manifest à partir de l'inventaire.
 */
export function buildManifest(entries: InventoryEntry[]): AssetManifest {
  const manifest: AssetManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    images: {},
    audio: {},
    scenarios: {},
  };

  for (const entry of entries) {
    if (entry.kind === "bg" || entry.kind === "image" || entry.kind === "rule") {
      const me: ManifestEntry = {
        url: entry.webPath,
        source: entry.relPath,
        kind: entry.kind,
      };
      manifest.images[entry.key] = me;
    } else if (entry.kind === "bgm" || entry.kind === "se") {
      manifest.audio[entry.key] = {
        url: entry.webPath,
        source: entry.relPath,
        kind: entry.kind,
      };
    } else if (entry.kind === "scenario") {
      // Détecter l'encodage pour le scénario.
      let encoding = "utf-8";
      try {
        const buffer = readFileSync(entry.source);
        const decoded = decodeKs(buffer);
        encoding = decoded.encoding;
      } catch {
        // Si on ne peut pas lire, on garde utf-8 par défaut.
      }
      manifest.scenarios[entry.key] = {
        url: entry.webPath,
        source: entry.relPath,
        encoding,
      };
    }
  }

  return manifest;
}

/**
 * Rapport de vérification : storages introuvables, expressions @eval, etc.
 */
export type VerificationReport = {
  /** Storages référencés dans les scripts mais absents du manifest (clé de base normalisée). */
  missingStorages: { script: string; line: number; storage: string; kind: string }[];
  /** Références storage vides (calques sans image), comptées à part. */
  emptyStorageRefs?: number;
  /** Références ignorées car paramètre de macro (`%…`) non résoluble statiquement. */
  macroStorageRefs?: number;
  /** Expressions @eval trouvées (pour information). */
  evalExpressions: { script: string; expression: string }[];
  /** Expressions @eval dont la syntaxe n'est pas du JS valide (TJS spécifique). */
  evalSyntaxErrors: { script: string; expression: string; error: string }[];
  /** Nombre de scripts analysés. */
  scriptsAnalyzed: number;
  /** Nombre total de références vérifiées. */
  referencesChecked: number;
};

/**
 * Vérifie que toutes les références storage des scripts .ks sont dans le manifest.
 * Lit les scripts depuis l'inventaire (chemins sources).
 */
export function verifyReferences(
  scenarioEntries: InventoryEntry[],
  manifest: AssetManifest,
): VerificationReport {
  const report: VerificationReport = {
    missingStorages: [],
    emptyStorageRefs: 0,
    macroStorageRefs: 0,
    evalExpressions: [],
    evalSyntaxErrors: [],
    scriptsAnalyzed: 0,
    referencesChecked: 0,
  };

  for (const entry of scenarioEntries) {
    try {
      const buffer = readFileSync(entry.source);
      const decoded = decodeKs(buffer);
      const text = decoded.text;
      const tokens = lex(text);
      const parsed = parse(tokens);
      report.scriptsAnalyzed++;

      for (const page of parsed.pages) {
        for (const instr of page.instructions) {
          collectStorageRefs(instr, entry.relPath, manifest, report);
          if (instr.kind === "eval") {
            report.evalExpressions.push({
              script: entry.relPath,
              expression: instr.expression,
            });
            // Vérifier la syntaxe JS (compile sans exécuter).
            try {
              new Function("f", "sf", "tf", `"use strict"; return (${instr.expression});`);
            } catch (err) {
              report.evalSyntaxErrors.push({
                script: entry.relPath,
                expression: instr.expression,
                error: String(err),
              });
            }
          }
        }
      }
    } catch (err) {
      // Erreur de parsing : on ignore ce script pour la vérification.
      console.warn(`[manifest] Failed to verify ${entry.relPath}:`, err);
    }
  }

  return report;
}

/** Collecte les références storage d'une instruction et vérifie le manifest.
 *
 * La résolution est celle du player (`src/core/asset-resolver.ts`) : le parser a
 * déjà normalisé chaque `storage` avec `storageKey` (suffixe de variante `|x`,
 * dossier, extension, casse, espaces retirés) ; le manifest est ensuite cherché
 * par clé exacte puis repliée (NFKC, casse, espaces de bordure), ce qui corrige
 * les clés d'anciens manifest (ex. espace avant l'extension). Les références
 * vides (calques sans image) et les paramètres de macro `%…` sont comptés à
 * part : ils ne sont pas résolubles statiquement (le runtime les résout).
 */
function collectStorageRefs(
  instr: { kind: string; [key: string]: unknown },
  scriptPath: string,
  manifest: AssetManifest,
  report: VerificationReport,
): void {
  const storage = (instr as { storage?: string }).storage;
  if (typeof storage !== "string") return;
  const raw = storage.trim();

  // Calque sans image (storage vide) : pas un fichier à charger.
  if (raw === "") {
    report.emptyStorageRefs = (report.emptyStorageRefs ?? 0) + 1;
    return;
  }
  // Paramètre de macro : la valeur réelle n'est connue qu'au site d'appel.
  if (raw.includes("%")) {
    report.macroStorageRefs = (report.macroStorageRefs ?? 0) + 1;
    return;
  }
  // Couleurs unies : pas un asset du jeu (le pipeline en génère un fichier à part).
  if (isSolidColor(raw)) return;

  const key = storageKey(raw);
  let kind: string;
  let found: boolean;

  switch (instr.kind) {
    case "bg":
    case "fg":
    case "animate":
    case "clfg":
      kind = "image";
      found = lookupImage(manifest, key) !== null;
      break;
    case "play":
    case "fadebgm":
      kind = "bgm";
      found = lookupAudio(manifest, key) !== null;
      break;
    case "se":
    case "fadese":
    case "sestop":
      kind = "se";
      found = lookupAudio(manifest, key) !== null;
      break;
    case "jump":
    case "call":
      // Les références de script sont vérifiées séparément.
      return;
    default:
      return;
  }

  report.referencesChecked++;
  if (found) return;
  report.missingStorages.push({
    script: scriptPath,
    line: 0,
    storage: key,
    kind,
  });
}

// ── Manifest depuis résultats réels ──

/**
 * Construit le manifest à partir des résultats réels des tâches.
 * Contrairement à buildManifest (qui utilise les prédictions webPath),
 * cette fonction utilise les chemins réellement écrits.
 *
 * Priorité en cas de collision sur images : bg > image > rule.
 */
export function buildManifestFromResults(
  results: TaskResult[],
  outputDir: string,
): AssetManifest {
  const manifest: AssetManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    images: {},
    audio: {},
    scenarios: {},
  };

  // Collecter les entrées par kind pour gérer les priorités.
  const imageEntries: { key: string; entry: ManifestEntry; priority: number }[] = [];

  for (const result of results) {
    if (result.status !== "ok") continue;
    if (!result.actualOutputPath) continue;

    const task = result.task;
    const kind = task.entry.kind;
    const key = task.entry.key;

    // Chemin relatif au outputDir.
    const relPath = relativePath(outputDir, result.actualOutputPath);

    if (kind === "bg" || kind === "image" || kind === "rule") {
      const priority = kind === "bg" ? 3 : kind === "image" ? 2 : 1;
      imageEntries.push({
        key,
        entry: { url: relPath, source: task.entry.relPath, kind },
        priority,
      });
    } else if (kind === "bgm" || kind === "se") {
      manifest.audio[key] = { url: relPath, source: task.entry.relPath, kind };
    } else if (kind === "scenario") {
      manifest.scenarios[key] = {
        url: relPath,
        source: task.entry.relPath,
        encoding: "utf-8", // Tous les scénarios sont transcodés en UTF-8
      };
    }
  }

  // Résoudre les collisions images avec priorité bg > image > rule.
  for (const { key, entry, priority } of imageEntries) {
    const existing = manifest.images[key];
    if (!existing) {
      manifest.images[key] = entry;
    } else {
      // Conserver la priorité la plus haute.
      const existingPriority = existing.kind === "bg" ? 3 : existing.kind === "image" ? 2 : 1;
      if (priority > existingPriority) {
        manifest.images[key] = entry;
      }
    }
  }

  return manifest;
}

/**
 * Écrit le manifest en JSON de façon atomique.
 */
export function writeManifest(manifest: AssetManifest, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
  renameSync(tmpPath, outputPath);
}

import { renameSync } from "fs";

/** Calcule le chemin relatif d'un fichier par rapport à un dossier de base. */
function relativePath(baseDir: string, filePath: string): string {
  const base = baseDir.replace(/\/$/, "");
  if (filePath.startsWith(base + "/")) {
    return filePath.slice(base.length + 1);
  }
  return filePath;
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.error("Usage: manifest.ts est appelé par pipeline.ts, pas directement.");
  process.exit(1);
}
