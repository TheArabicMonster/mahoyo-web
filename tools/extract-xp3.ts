/**
 * Extraction des archives .xp3 du jeu original.
 *
 * Cet outil est un wrapper : il attend un extracteur externe compatible
 * (par exemple `xp3extract`, `krkrExtract` ou un script Python) et l'appelle
 * pour chaque archive .xp3 trouvée dans le dossier d'input.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { ensureDir, listFiles, outputPathFor, type PipelineContext } from "./pipeline-utils.js";

const execFileAsync = promisify(execFile);

export type ExtractXp3Options = {
  inputDir: string;
  outputDir: string;
  extractor?: string;
  dryRun?: boolean;
};

/**
 * Extrait toutes les archives .xp3 de `inputDir` vers `outputDir`.
 * Si aucun extracteur n'est fourni, l'outil se contente de lister les archives.
 */
export async function extractXp3(options: ExtractXp3Options): Promise<{ archives: string[]; extracted: number }> {
  const archives = listFiles(options.inputDir, (p) => p.toLowerCase().endsWith(".xp3"));
  let extracted = 0;

  if (!options.extractor) {
    console.warn("[extract-xp3] Aucun extracteur fourni. Archives trouvées :", archives.length);
    return { archives, extracted };
  }

  for (const archive of archives) {
    const outDir = outputPathFor(options.inputDir, options.outputDir, archive).replace(/\.xp3$/i, "");
    ensureDir(outDir);
    if (!options.dryRun) {
      try {
        await execFileAsync(options.extractor, [archive, outDir]);
        extracted++;
      } catch (err) {
        console.error(`[extract-xp3] Échec de l'extraction de ${archive}:`, err);
      }
    }
  }

  return { archives, extracted };
}

export async function runExtractXp3(context: PipelineContext): Promise<void> {
  const { archives, extracted } = await extractXp3({
    inputDir: context.inputDir,
    outputDir: context.outputDir,
    extractor: context.xp3Extractor,
    dryRun: context.dryRun,
  });
  console.log(`[extract-xp3] ${archives.length} archive(s), ${extracted} extraite(s)`);
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputDir = process.argv[2];
  const outputDir = process.argv[3];
  const extractor = process.argv[4];
  if (!inputDir || !outputDir) {
    console.error("Usage: extract-xp3.ts <inputDir> <outputDir> [extractorPath]");
    process.exit(1);
  }
  runExtractXp3({ inputDir, outputDir, dryRun: false, xp3Extractor: extractor }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
