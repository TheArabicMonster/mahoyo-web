/**
 * Normalise les scripts KAG extraits pour le player web.
 *
 * - Lecture en Shift_JIS par défaut.
 * - Supprime les commandes / tags purement internes au moteur console.
 * - Normalise les noms d'assets pour qu'ils correspondent au AssetResolver.
 */
import { readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { ensureDirAsync, listFiles, outputPathFor, type PipelineContext } from "./pipeline-utils.js";

/**
 * Détecte et retourne l'encodage probable d'un buffer.
 * Par simplicité, on considère que les scripts KAG originaux sont en Shift_JIS.
 */
export function detectEncoding(_buffer: Buffer): "shift_jis" | "utf-8" {
  return "shift_jis";
}

/** Décode un buffer selon l'encodage détecté. */
export function decodeBuffer(buffer: Buffer, encoding: string): string {
  if (encoding === "utf-8") return buffer.toString("utf-8");
  // Utilise TextDecoder natif pour Shift_JIS.
  const decoder = new TextDecoder("shift_jis", { fatal: false });
  return decoder.decode(buffer);
}

/**
 * Normalise le texte d'un script KAG.
 * - Supprime le BOM.
 * - Normalise les fins de ligne.
 */
export function normalizeScriptText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/**
 * Nettoie les commandes non supportées / internes au PC 2012.
 * Renvie le script inchangé si toutes les commandes sont supportées.
 */
export function stripUnsupportedCommands(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Commandes liées au système de sauvegarde / debug : à ignurer pour le web.
    if (trimmed.startsWith("@eval") || trimmed.startsWith("@iscript") || trimmed.startsWith("@endscript")) {
      // On garde une ligne vide pour ne pas décaler les numéros de ligne.
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Transforme un nom de storage pour le AssetResolver. */
export function normalizeStorage(storage: string): string {
  return storage
    .replace(/\.(tlg|png|jpg|jpeg|bmp|gif)$/i, "")
    .replace(/\.(ogg|mp3|wav)$/i, "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\//g, "_");
}

/**
 * Réécrit les arguments de certains tags KAG pour pointer vers les assets normalisés.
 * Pour l'instant : storage des images et audio.
 */
export function normalizeAssets(text: string): string {
  return text
    .replace(/@bg\s+([^\n]*)/g, (match) => match)
    .replace(/storage=([^\s\]]+)/g, (_m, storage: string) => {
      return `storage=${normalizeStorage(storage)}`;
    });
}

/**
 * Normalise un script KAG complet (texte).
 */
export function normalizeKagScript(text: string): string {
  return normalizeAssets(stripUnsupportedCommands(normalizeScriptText(text)));
}

/**
 * Normalise un fichier script et retourne son contenu UTF-8.
 */
export function normalizeKagFile(path: string): string {
  const buffer = readFileSync(path);
  const encoding = detectEncoding(buffer);
  const text = decodeBuffer(buffer, encoding);
  return normalizeKagScript(text);
}

/**
 * Point d'entrée du pipeline : normalise tous les scripts .ks
 * de `context.inputDir` et écrit le résultat dans `context.outputDir`.
 */
export async function runNormalizeKs(context: PipelineContext): Promise<void> {
  const ksFiles = listFiles(context.inputDir, (p) => p.toLowerCase().endsWith(".ks"));

  if (ksFiles.length === 0) {
    console.warn("[normalize-ks] Aucun script .ks trouvé dans", context.inputDir);
    return;
  }

  let normalized = 0;
  for (const ksPath of ksFiles) {
    const normalizedText = normalizeKagFile(ksPath);
    const outPath = outputPathFor(context.inputDir, context.outputDir, ksPath);

    if (!context.dryRun) {
      await ensureDirAsync(dirname(outPath));
      await writeFile(outPath, normalizedText, "utf-8");
    }
    normalized++;
  }

  console.log(`[normalize-ks] ${ksFiles.length} script(s), ${normalized} normalisé(s)`);
}

// CLI simple
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: normalize-ks.ts <input.ks>");
    process.exit(1);
  }
  console.log(normalizeKagFile(input));
}
