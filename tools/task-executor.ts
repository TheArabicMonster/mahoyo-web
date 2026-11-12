/**
 * Exécuteur de tâches du pipeline.
 *
 * Chaque tâche est exécutée selon son action :
 * - convert-image : appelle l'outil externe (gabarit) pour convertir .tlg → .webp/.png ;
 *   sans gabarit, décode le .tlg avec le décodeur intégré (tlg-decode.ts) vers .png
 * - convert-audio : appelle l'outil externe pour convertir .wav → .ogg
 * - copy : copie le fichier tel quel
 * - transcode-ks : transcode le .ks en UTF-8 via normalize-ks
 *
 * Les fichiers sont d'abord écrits dans un fichier temporaire puis renommés
 * (écriture atomique) pour éviter les fichiers tronqués en cas de crash.
 */
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { runCommand } from "./command-template.js";
import { normalizeScriptText } from "./normalize-ks.js";
import { decodeKs } from "./ks-encoding.js";
import { readFileSync } from "fs";
import { convertAudioFile } from "./convert-audio.js";
import { convertTlgFile } from "./convert-tlg.js";
import { encodePngToWebp, encodeTlgToWebp, measureSsim, type WebpEncoderKind } from "./webp.js";
import { tlgToPng } from "./tlg-decode.js";
import type { Task, TaskResult } from "./plan.js";

/**
 * Exécute une tâche.
 *
 * @param task la tâche à exécuter
 * @param dryRun true pour ne rien écrire
 * @returns le résultat de la tâche
 */
export async function executeTask(task: Task, dryRun: boolean): Promise<TaskResult> {
  if (dryRun) {
    return { task, status: "ok", actualOutputPath: task.outputPath };
  }

  try {
    // Assurer que le dossier parent existe.
    await mkdir(dirname(task.outputPath), { recursive: true });

    switch (task.action) {
      case "copy":
        await copyFile(task.entry.source, task.outputPath);
        break;

      case "convert-image":
      case "convert-audio": {
        // Conversion WebP interne (#374) : TLG décodé en PNG puis encodé, ou PNG→WebP.
        if (!task.commandTemplate && task.action === "convert-image" && task.webp) {
          const encoder: WebpEncoderKind = task.webp.encoder ?? "cwebp";
          const options = { lossless: task.webp.lossless, quality: task.webp.quality };
          if (options.lossless) {
            if (task.entry.ext === ".tlg") {
              await encodeTlgToWebp(task.entry.source, task.outputPath, options, encoder);
            } else {
              await encodePngToWebp(task.entry.source, task.outputPath, options, encoder);
            }
            break;
          }
          // Avec perte : garde-fou SSIM ≥ 0,99 contre le PNG ; sinon re-encodage sans perte.
          const dir = await mkdtemp(join(tmpdir(), "mahoyo-webp-guard-"));
          try {
            const pngPath = join(dir, "source.png");
            if (task.entry.ext === ".tlg") {
              await writeFile(pngPath, tlgToPng(await readFile(task.entry.source)));
            } else {
              await copyFile(task.entry.source, pngPath);
            }
            await encodePngToWebp(pngPath, task.outputPath, options, encoder);
            const ssim = await measureSsim(pngPath, task.outputPath);
            if (ssim === null || ssim < 0.99) {
              console.warn(`[webp] SSIM ${ssim ?? "n/a"} < 0,99 pour ${task.entry.relPath} : repli sans perte`);
              await encodePngToWebp(pngPath, task.outputPath, { ...options, lossless: true }, encoder);
            }
          } finally {
            await rm(dir, { recursive: true, force: true });
          }
          break;
        }
        // TLG sans outil externe : décodeur intégré (TLG0.0 / TLG5), écriture PNG.
        if (!task.commandTemplate && task.action === "convert-image" && task.entry.ext === ".tlg") {
          await convertTlgFile(task.entry.source, task.outputPath);
          break;
        }
        // WAV → Opus/Ogg (ou AAC/.m4a) par ffmpeg détecté, sans gabarit utilisateur (#387).
        if (!task.commandTemplate && task.action === "convert-audio" && task.audio) {
          await convertAudioFile(task.entry.source, task.outputPath, {
            ffmpegPath: task.audio.ffmpegPath,
            format: task.audio.format,
          });
          break;
        }
        if (!task.commandTemplate) {
          return {
            task,
            status: "failed",
            error: `aucun outil externe fourni pour ${task.entry.relPath}`,
          };
        }
        // Écrire dans un fichier temporaire puis renommer.
        const tmpPath = `${task.outputPath}.tmp`;
        await runCommand(task.commandTemplate, task.entry.source, tmpPath);
        await rename(tmpPath, task.outputPath);
        break;
      }

      case "transcode-ks": {
        const buffer = readFileSync(task.entry.source);
        const decoded = decodeKs(buffer);
        const text = normalizeScriptText(decoded.text);
        await writeFile(task.outputPath, text, "utf-8");
        break;
      }
    }

    return { task, status: "ok", actualOutputPath: task.outputPath };
  } catch (err) {
    return {
      task,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Exécute toutes les tâches (séquentiellement pour l'instant).
 *
 * TODO: ajouter un pool de concurrence pour les conversions externes.
 */
export async function executeAll(
  tasks: Task[],
  dryRun: boolean,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  const total = tasks.length;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (onProgress) {
      onProgress(i, total, task.entry.relPath);
    }
    const result = await executeTask(task, dryRun);
    results.push(result);
  }

  if (onProgress) {
    onProgress(total, total, "");
  }

  return results;
}
