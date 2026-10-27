/**
 * Transcodage des scripts KAG (.ks) vers UTF-8 pour le player web.
 *
 * Rôle : décoder (UTF-16LE, UTF-8, Shift_JIS, chiffré KiriKiri) → UTF-8 sans BOM.
 *
 * Ce module NE réécrit PAS les `storage=` : la normalisation se fait dans le
 * parser via `storageKey` (src/core/storage-key.ts).
 *
 * Ce module NE supprime PAS les commandes (`@eval`, `@iscript`, etc.) : le
 * runtime tolère les commandes inconnues et exécute `@eval`.
 *
 * Le nombre de lignes est préservé pour que les numéros de ligne des warnings
 * et du rapport restent justes.
 */
import { readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { decodeKs } from "./ks-encoding.js";
import { ensureDirAsync, listFiles, outputPathFor, type PipelineContext } from "./pipeline-utils.js";

/**
 * Normalise le texte d'un script KAG :
 * - Supprime un BOM résiduel.
 * - Convertit \r\n et \r en \n.
 * - Supprime les caractères NUL.
 *
 * NE modifie PAS les commandes, les storage=, ni le nombre de lignes.
 */
export function normalizeScriptText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "");
}

/**
 * Transcode un buffer .ks en texte UTF-8 normalisé.
 * Utilise decodeKs pour la détection d'encodage, puis normalizeScriptText.
 */
export function transcodeKagScript(buffer: Buffer): { text: string; encoding: string } {
  const decoded = decodeKs(buffer);
  const text = normalizeScriptText(decoded.text);
  return { text, encoding: decoded.encoding };
}

/**
 * Transcode un fichier .ks et retourne son contenu UTF-8.
 */
export function normalizeKagFile(path: string): { text: string; encoding: string } {
  const buffer = readFileSync(path);
  return transcodeKagScript(buffer);
}

/**
 * Point d'entrée du pipeline : transcode tous les scripts .ks
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
    const { text } = normalizeKagFile(ksPath);
    const outPath = outputPathFor(context.inputDir, context.outputDir, ksPath);

    if (!context.dryRun) {
      await ensureDirAsync(dirname(outPath));
      await writeFile(outPath, text, "utf-8");
    }
    normalized++;
  }

  console.log(`[normalize-ks] ${ksFiles.length} script(s), ${normalized} transcodé(s)`);
}

// CLI simple
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: normalize-ks.ts <input.ks>");
    process.exit(1);
  }
  const { text, encoding } = normalizeKagFile(input);
  console.error(`[normalize-ks] encoding: ${encoding}`);
  console.log(text);
}
