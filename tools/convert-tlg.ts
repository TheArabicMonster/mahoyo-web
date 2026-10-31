/**
 * Conversion des images .tlg (KiriKiri).
 *
 * - Avec un convertisseur externe (`tlg2png`, `krkrExtract`, etc.) : sortie .webp,
 *   comme avant (`--tlg-cmd`).
 * - Sans convertisseur : décodeur intégré (`tlg-decode.ts`, TLG0.0 et TLG5), sortie .png.
 *   Un TLG6 ou un fichier chiffré est signalé en échec, sans bloquer les autres.
 */
import { execFile } from "child_process";
import { readFile, rename, writeFile } from "fs/promises";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { ensureDir, listFiles, outputPathFor, type PipelineContext } from "./pipeline-utils.js";
import { tlgToPng } from "./tlg-decode.js";

const execFileAsync = promisify(execFile);

export type ConvertTlgOptions = {
  inputDir: string;
  outputDir: string;
  converter?: string;
  dryRun?: boolean;
};

/** Convertit un .tlg en .png avec le décodeur intégré (écriture atomique). */
export async function convertTlgFile(inputPath: string, outputPath: string): Promise<void> {
  const png = tlgToPng(await readFile(inputPath));
  ensureDir(dirname(outputPath));
  const tmp = `${outputPath}.tmp`;
  await writeFile(tmp, png);
  await rename(tmp, outputPath);
}

export async function convertTlg(
  options: ConvertTlgOptions,
): Promise<{ tlgs: string[]; converted: number; failed: number }> {
  const tlgs = listFiles(options.inputDir, (p) => p.toLowerCase().endsWith(".tlg"));
  let converted = 0;
  let failed = 0;

  for (const tlg of tlgs) {
    const outPath = outputPathFor(options.inputDir, options.outputDir, tlg, options.converter ? ".webp" : ".png");
    if (options.dryRun) continue;
    try {
      if (options.converter) {
        ensureDir(dirname(outPath));
        await execFileAsync(options.converter, [tlg, outPath]);
      } else {
        await convertTlgFile(tlg, outPath);
      }
      converted++;
    } catch (err) {
      failed++;
      console.error(`[convert-tlg] Échec de ${tlg}:`, err instanceof Error ? err.message : err);
    }
  }

  return { tlgs, converted, failed };
}

export async function runConvertTlg(context: PipelineContext): Promise<void> {
  const { tlgs, converted, failed } = await convertTlg({
    inputDir: context.inputDir,
    outputDir: context.outputDir,
    converter: context.tlgConverter,
    dryRun: context.dryRun,
  });
  console.log(`[convert-tlg] ${tlgs.length} TLG(s), ${converted} converti(s), ${failed} échec(s)`);
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
