/**
 * Génération du manifest d'assets et vérification des références.
 *
 * Le manifest mappe les clés de storage normalisées vers les URLs web.
 * Il est produit à partir de l'inventaire et vérifié contre les scripts .ks
 * pour détecter les storages introuvables.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import type { AssetManifest, ManifestEntry, ScenarioEntry } from "../src/core/asset-manifest.js";
import type { InventoryEntry } from "./inventory.js";
import { lex } from "../src/kag/lexer.js";
import { parse } from "../src/kag/parser.js";

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
      manifest.scenarios[entry.key] = {
        url: entry.webPath,
        source: entry.relPath,
        encoding: "utf-8",
      };
    }
  }

  return manifest;
}

/**
 * Rapport de vérification : storages introuvables, expressions @eval, etc.
 */
export type VerificationReport = {
  /** Storages référencés dans les scripts mais absents du manifest. */
  missingStorages: { script: string; line: number; storage: string; kind: string }[];
  /** Expressions @eval trouvées (pour information). */
  evalExpressions: { script: string; expression: string }[];
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
    evalExpressions: [],
    scriptsAnalyzed: 0,
    referencesChecked: 0,
  };

  for (const entry of scenarioEntries) {
    try {
      const buffer = readFileSync(entry.source);
      const text = decodeScript(buffer);
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

/** Décode un buffer .ks (UTF-16LE ou UTF-8). */
function decodeScript(buffer: Buffer): string {
  // BOM UTF-16LE
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    const decoder = new TextDecoder("utf-16le", { fatal: false });
    return decoder.decode(buffer);
  }
  // BOM UTF-8
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString("utf-8", 3);
  }
  // UTF-8 par défaut
  return buffer.toString("utf-8");
}

/** Collecte les références storage d'une instruction et vérifie le manifest. */
function collectStorageRefs(
  instr: { kind: string; [key: string]: unknown },
  scriptPath: string,
  manifest: AssetManifest,
  report: VerificationReport,
): void {
  const storage = (instr as { storage?: string }).storage;
  if (!storage) return;

  // Couleurs solides : pas un fichier.
  const SOLID = new Set(["black", "white", "red", "blue", "green", "yellow", "gray", "grey", "none"]);
  if (SOLID.has(storage)) return;

  let kind: string;
  let found: boolean;

  switch (instr.kind) {
    case "bg":
    case "fg":
    case "animate":
    case "clfg":
      kind = "image";
      found = !!manifest.images[storage];
      break;
    case "play":
    case "fadebgm":
      kind = "bgm";
      found = !!manifest.audio[storage];
      break;
    case "se":
    case "fadese":
    case "sestop":
      kind = "se";
      found = !!manifest.audio[storage];
      break;
    case "jump":
    case "call":
      // Les références de script sont vérifiées séparément.
      return;
    default:
      return;
  }

  report.referencesChecked++;
  if (!found) {
    report.missingStorages.push({
      script: scriptPath,
      line: 0,
      storage,
      kind,
    });
  }
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.error("Usage: manifest.ts est appelé par pipeline.ts, pas directement.");
  process.exit(1);
}
