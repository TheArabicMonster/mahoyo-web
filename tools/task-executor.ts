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
import { copyFile, mkdir, rename, writeFile } from "fs/promises";
import { dirname } from "path";
import { runCommand } from "./command-template.js";
import { normalizeScriptText } from "./normalize-ks.js";
import { decodeKs } from "./ks-encoding.js";
import { readFileSync } from "fs";
import { convertTlgFile } from "./convert-tlg.js";
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
        // TLG sans outil externe : décodeur intégré (TLG0.0 / TLG5), écriture PNG.
        if (!task.commandTemplate && task.action === "convert-image" && task.entry.ext === ".tlg") {
          await convertTlgFile(task.entry.source, task.outputPath);
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
