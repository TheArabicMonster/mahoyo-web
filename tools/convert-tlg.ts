/**
 * Conversion des images .tlg (KiriKiri) vers .webp.
 *
 * Wrapper autour d'un convertisseur externe (`tlg2png`, `krkrExtract`, etc.).
 * Si aucun convertisseur n'est fourni, les fichiers sont ignorés.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { ensureDir, listFiles, outputPathFor, type PipelineContext } from "./pipeline-utils.js";

const execFileAsync = promisify(execFile);

export type ConvertTlgOptions = {
  inputDir: string;
  outputDir: string;
  converter?: string;
  dryRun?: boolean;
};

export async function convertTlg(options: ConvertTlgOptions): Promise<{ tlgs: string[]; converted: number }> {
  const tlgs = listFiles(options.inputDir, (p) => p.toLowerCase().endsWith(".tlg"));
  let converted = 0;

  if (!options.converter) {
    console.warn("[convert-tlg] Aucun convertisseur fourni. TLG trouvés :", tlgs.length);
    return { tlgs, converted };
  }

  for (const tlg of tlgs) {
    const outPath = outputPathFor(options.inputDir, options.outputDir, tlg, ".webp");
    ensureDir(outPath);
    if (!options.dryRun) {
      try {
        await execFileAsync(options.converter, [tlg, outPath]);
        converted++;
      } catch (err) {
        console.error(`[convert-tlg] Échec de ${tlg}:`, err);
      }
    }
  }

  return { tlgs, converted };
}

export async function runConvertTlg(context: PipelineContext): Promise<void> {
  const { tlgs, converted } = await convertTlg({
    inputDir: context.inputDir,
    outputDir: context.outputDir,
    converter: context.tlgConverter,
    dryRun: context.dryRun,
  });
  console.log(`[convert-tlg] ${tlgs.length} TLG(s), ${converted} converti(s)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputDir = process.argv[2];
  const outputDir = process.argv[3];
  const converter = process.argv[4];
  if (!inputDir || !outputDir) {
    console.error("Usage: convert-tlg.ts <inputDir> <outputDir> [converterPath]");
    process.exit(1);
  }
  runConvertTlg({ inputDir, outputDir, dryRun: false, tlgConverter: converter }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
