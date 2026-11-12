/**
 * Conversion audio du pipeline (#387, plan v2 §B1).
 *
 * Les **SE du jeu sont des WAV** (806 fichiers, ~596 Mo) qui dominent les transferts ; ils sont
 * convertis par défaut vers **Opus/Ogg** (`libopus`, 96 kbps stéréo / 64 kbps mono) dès que
 * `ffmpeg` est disponible — les BGM sont déjà en OGG et ne sont **pas** réencodées.
 *
 * Repli Safari : `canPlayType('audio/ogg; codecs=opus')` n'est pas supporté par les anciens
 * Safari ; le pipeline peut alors produire des `.m4a` AAC (`--audio-format aac`). Le manifeste
 * porte toujours l'extension **réelle** produite (`.ogg` ou `.m4a`), et le résolveur d'assets
 * (qui lit le manifeste) est déjà tolérant à l'extension : la stratégie de repli est donc un
 * build dédié, documentée dans `docs/PIPELINE.md`.
 *
 * Les fichiers OGG/MP3 existants sont seulement copiés (pas de réencodage d'un format déjà
 * compressé).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { copyFile, mkdir, rename } from "fs/promises";
import { dirname } from "path";
import { ensureDirAsync, listFiles, outputPathFor, type PipelineContext } from "./pipeline-utils.js";

const execFileAsync = promisify(execFile);

/** Format audio de sortie pour les WAV. */
export type AudioFormat = "opus" | "aac";

/** Extension réelle du fichier produit (le manifeste reflète toujours l'extension réelle). */
export const AUDIO_OUTPUT_EXT: Record<AudioFormat, ".ogg" | ".m4a"> = { opus: ".ogg", aac: ".m4a" };
/** Débit Opus stéréo (96 kbps, plan v2 §B1). */
export const OPUS_BITRATE_STEREO = 96_000;
/** Débit Opus mono (64 kbps, plan v2 §B1). */
export const OPUS_BITRATE_MONO = 64_000;
/** Débit AAC du repli Safari (128 kbps). */
export const AAC_BITRATE = 128_000;
/** Tolérance de durée acceptée entre source et sortie (plan v2 §B1 : ±20 ms). */
export const DURATION_TOLERANCE_MS = 20;
/** Binaire ffmpeg par défaut (résolu via le PATH). */
export const FFMPEG_DEFAULT = "ffmpeg";

export type ConvertAudioFileOptions = {
  ffmpegPath?: string;
  ffprobePath?: string;
  format?: AudioFormat;
};

/** Arguments ffmpeg pour un WAV donné (débit selon mono/stéréo pour Opus). */
export function ffmpegAudioArgs(
  inputPath: string,
  outputPath: string,
  format: AudioFormat,
  channels: number | null,
): string[] {
  if (format === "aac") {
    return ["-y", "-i", inputPath, "-c:a", "aac", "-b:a", `${AAC_BITRATE / 1000}k`, "-f", "ipod", outputPath];
  }
  const bitrate = channels === 1 ? OPUS_BITRATE_MONO : OPUS_BITRATE_STEREO;
  return ["-y", "-i", inputPath, "-c:a", "libopus", "-b:a", `${bitrate / 1000}k`, "-vbr", "on", "-f", "ogg", outputPath];
}

/** Nombre de canaux du premier flux audio (null si ffprobe indisponible). */
export async function probeAudioChannels(
  filePath: string,
  ffprobePath: string = FFMPEG_DEFAULT.replace(/ffmpeg$/, "ffprobe"),
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=channels",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    const channels = Number.parseInt(String(stdout).trim().split("\n")[0] ?? "", 10);
    return Number.isFinite(channels) && channels > 0 ? channels : null;
  } catch {
    return null;
  }
}

/** Durée d'un fichier en millisecondes (null si ffprobe indisponible). */
export async function probeDurationMs(
  filePath: string,
  ffprobePath: string = FFMPEG_DEFAULT.replace(/ffmpeg$/, "ffprobe"),
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    const seconds = Number.parseFloat(String(stdout).trim());
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  } catch {
    return null;
  }
}

export type AudioConversionResult = {
  /** Écart de durée sortie − entrée (ms), null si non mesurable. */
  durationDeltaMs: number | null;
  /** Débit visé (kbps). */
  bitrateKbps: number;
  /** Canaux détectés (null si ffprobe indisponible). */
  channels: number | null;
};

/**
 * Convertit un fichier WAV en Opus/Ogg (ou AAC/.m4a) de façon atomique et vérifie la durée
 * (avertissement au-delà de ±20 ms, sans échouer : le conteneur Ogg arrondit au paquet).
 */
export async function convertAudioFile(
  inputPath: string,
  outputPath: string,
  options: ConvertAudioFileOptions = {},
): Promise<AudioConversionResult> {
  const format = options.format ?? "opus";
  const ffmpegPath = options.ffmpegPath ?? FFMPEG_DEFAULT;
  const ffprobePath = options.ffprobePath ?? ffmpegPath.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
  await mkdir(dirname(outputPath), { recursive: true });

  const channels = await probeAudioChannels(inputPath, ffprobePath);
  const tmpPath = `${outputPath}.tmp`;
  await execFileAsync(ffmpegPath, ffmpegAudioArgs(inputPath, tmpPath, format, channels), {
    maxBuffer: 10 * 1024 * 1024,
  });
  await rename(tmpPath, outputPath);

  const inputMs = await probeDurationMs(inputPath, ffprobePath);
  const outputMs = await probeDurationMs(outputPath, ffprobePath);
  const durationDeltaMs = inputMs !== null && outputMs !== null ? outputMs - inputMs : null;
  if (durationDeltaMs !== null && Math.abs(durationDeltaMs) > DURATION_TOLERANCE_MS) {
    console.warn(
      `[convert-audio] Durée hors tolérance (±${DURATION_TOLERANCE_MS} ms, écart ${durationDeltaMs} ms) : ${inputPath}`,
    );
  }

  const bitrateKbps =
    format === "aac"
      ? AAC_BITRATE / 1000
      : channels === 1
        ? OPUS_BITRATE_MONO / 1000
        : OPUS_BITRATE_STEREO / 1000;
  return { durationDeltaMs, bitrateKbps, channels };
}

export type ConvertAudioOptions = {
  inputDir: string;
  outputDir: string;
  /** Gabarit/path historique : encodeur externe fourni par l'utilisateur (`ffmpeg` path). */
  encoder?: string;
  /** Format des WAV convertis en interne (défaut : opus ; repli Safari : aac). */
  format?: AudioFormat;
  /** Binaire ffmpeg interne (défaut : `ffmpeg` du PATH). */
  ffmpegPath?: string;
  dryRun?: boolean;
};

export async function convertAudio(options: ConvertAudioOptions): Promise<{
  audios: string[];
  converted: number;
  warnings: number;
}> {
  const format = options.format ?? "opus";
  const audios = listFiles(options.inputDir, (p) => {
    const ext = p.toLowerCase();
    return ext.endsWith(".ogg") || ext.endsWith(".mp3") || ext.endsWith(".wav");
  });
  let converted = 0;
  let warnings = 0;

  for (const audio of audios) {
    const isWav = audio.toLowerCase().endsWith(".wav");
    // WAV → extension selon le format choisi ; OGG/MP3 existants restent copiés en .ogg.
    const outExt = isWav ? AUDIO_OUTPUT_EXT[format] : ".ogg";
    const outPath = outputPathFor(options.inputDir, options.outputDir, audio, outExt);
    await ensureDirAsync(dirname(outPath));
    if (options.dryRun) continue;
    try {
      if (options.encoder) {
        // Encodeur externe fourni par l'utilisateur : comportement historique (chemin + args).
        await execFileAsync(options.encoder, [audio, outPath]);
      } else if (isWav) {
        const result = await convertAudioFile(audio, outPath, {
          format,
          ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
        });
        if (result.durationDeltaMs !== null && Math.abs(result.durationDeltaMs) > DURATION_TOLERANCE_MS) {
          warnings++;
        }
      } else {
        await copyFile(audio, outPath);
      }
      converted++;
    } catch (err) {
      console.error(`[convert-audio] Échec de ${audio}:`, err);
    }
  }

  return { audios, converted, warnings };
}

export async function runConvertAudio(context: PipelineContext): Promise<void> {
  const { audios, converted, warnings } = await convertAudio({
    inputDir: context.inputDir,
    outputDir: context.outputDir,
    encoder: context.audioEncoder,
    format: context.audioFormat ?? "opus",
    dryRun: context.dryRun,
  });
  console.log(
    `[convert-audio] ${audios.length} fichier(s), ${converted} converti(s)/copié(s)` +
      (warnings > 0 ? `, ${warnings} avertissement(s) de durée` : ""),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputDir = process.argv[2];
  const outputDir = process.argv[3];
  const encoder = process.argv[4];
  const format = process.argv[5] === "aac" ? "aac" : "opus";
  if (!inputDir || !outputDir) {
    console.error("Usage: convert-audio.ts <inputDir> <outputDir> [encoder] [opus|aac]");
    process.exit(1);
  }
  runConvertAudio({ inputDir, outputDir, dryRun: false, audioEncoder: encoder, audioFormat: format }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
