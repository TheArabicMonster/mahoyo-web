/**
 * Conversion/copie des fichiers audio du jeu vers OGG web-compatibles.
 *
 * Les fichiers OGG du jeu sont généralement déjà compatibles navigateur.
 * Cet outil les copie simplement vers l'output, éventuellement en re-encodant
 * si un encoder externe (ffmpeg) est fourni.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { copyFile } from "fs/promises";
import { dirname } from "path";
import { ensureDirAsync, listFiles, outputPathFor, type PipelineContext } from "./pipeline-utils.js";

const execFileAsync = promisify(execFile);

export type ConvertAudioOptions = {
  inputDir: string;
  outputDir: string;
  /** ffmpeg ou autre, ex: `ffmpeg -i {input} -c:a libvorbis -q:a 4 {output}` */
  encoder?: string;
  dryRun?: boolean;
};

export async function convertAudio(options: ConvertAudioOptions): Promise<{ audios: string[]; converted: number }> {
  const audios = listFiles(options.inputDir, (p) => {
    const ext = p.toLowerCase();
    return ext.endsWith(".ogg") || ext.endsWith(".mp3") || ext.endsWith(".wav");
  });
  let converted = 0;

  for (const audio of audios) {
    const outPath = outputPathFor(options.inputDir, options.outputDir, audio, ".ogg");
    await ensureDirAsync(dirname(outPath));
    if (!options.dryRun) {
      try {
        if (options.encoder) {
          await execFileAsync(options.encoder, [audio, outPath]);
        } else {
          await copyFile(audio, outPath);
        }
        converted++;
      } catch (err) {
        console.error(`[convert-audio] Échec de ${audio}:`, err);
      }
    }
  }

  return { audios, converted };
}

export async function runConvertAudio(context: PipelineContext): Promise<void> {
  const { audios, converted } = await convertAudio({
    inputDir: context.inputDir,
    outputDir: context.outputDir,
    encoder: context.audioEncoder,
    dryRun: context.dryRun,
  });
  console.log(`[convert-audio] ${audios.length} fichier(s), ${converted} copié(s)/converti(s)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputDir = process.argv[2];
  const outputDir = process.argv[3];
  const encoder = process.argv[4];
  if (!inputDir || !outputDir) {
    console.error("Usage: convert-audio.ts <inputDir> <outputDir> [encoder]");
    process.exit(1);
  }
  runConvertAudio({ inputDir, outputDir, dryRun: false, encoder }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
