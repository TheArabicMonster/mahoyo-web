/**
 * Planification des tâches du pipeline.
 *
 * À partir de l'inventaire et du contexte (outils disponibles), `planTasks`
 * produit une liste de tâches concrètes (conversion, copie, transcodage).
 *
 * Chaque tâche sait quelle action effectuer et quelle extension de sortie
 * utiliser. Le manifest final est construit à partir des résultats réels,
 * pas des prédictions de webPath.
 */
import { AUDIO_OUTPUT_EXT } from "./convert-audio.js";
import type { AudioFormat } from "./convert-audio.js";
import type { InventoryEntry } from "./inventory.js";

export type TaskAction = "convert-image" | "copy" | "convert-audio" | "transcode-ks";

export type Task = {
  entry: InventoryEntry;
  action: TaskAction;
  /** Chemin de sortie final (absolu). */
  outputPath: string;
  /** Extension de sortie réelle (ex: .webp, .png, .ogg, .wav, .ks). */
  outputExt: string;
  /** Gabarit de commande externe si applicable. */
  commandTemplate?: string;
  /** true si la tâche ne nécessite pas d'outil externe (copie, transcodage, décodeur TLG intégré). */
  internal: boolean;
  /** Conversion WebP (#374) : options d'encodage quand `outputExt === ".webp"` et interne. */
  webp?: { lossless: boolean; quality: number; encoder?: "sharp" | "cwebp" };
  /** Conversion audio interne (#387) : ffmpeg détecté et format de sortie des WAV. */
  audio?: { ffmpegPath: string; format: AudioFormat };
};

export type TaskResult = {
  task: Task;
  status: "ok" | "failed" | "skipped";
  /** Chemin réellement écrit (si ok). */
  actualOutputPath?: string;
  /** Message d'erreur (si failed). */
  error?: string;
};

export type PlanContext = {
  /** Répertoire de sortie absolu. */
  outputDir: string;
  /** Gabarit pour conversion TLG → image. */
  tlgCommand?: string;
  /** Gabarit pour conversion WAV → OGG. */
  audioCommand?: string;
  /** true pour copier les .wav sans encodeur (au lieu d'échouer). */
  copyWavIfNoEncoder: boolean;
  /**
   * Conversion audio interne (#387) : ffmpeg détecté par le pipeline. Priorité au gabarit
   * `audioCommand` explicite s'il est fourni.
   */
  audio?: { ffmpegPath: string; format: AudioFormat } | null;
  /**
   * Encodeur WebP détecté (#374) ; absent/null = repli PNG. `lossyCategories` active la
   * conversion avec perte (qualité ≥ 90, SSIM ≥ 0,99) pour ces catégories seulement.
   */
  webp?: {
    encoder: "sharp" | "cwebp";
    lossyCategories: readonly string[];
    quality: number;
  } | null;
};

/**
 * Construit le plan de tâches à partir de l'inventaire.
 *
 * Table de décision :
 * - .tlg + tlgCommand → convert-image (.webp, outil externe)
 * - .tlg sans tlgCommand → convert-image (.png) par le décodeur intégré (tlg-decode.ts :
 *   TLG0.0 et TLG5 ; un TLG6 échoue avec un message explicite et reste absent du manifest)
 * - .png/.jpg/.jpeg/.bmp → copy (garde l'extension)
 * - .ogg/.mp3 → copy (.ogg)
 * - .wav + audioCommand → convert-audio (.ogg, gabarit externalisé)
 * - .wav + ffmpeg détecté (sans audioCommand) → convert-audio (.ogg Opus, ou .m4a AAC, #387)
 * - .wav sans audioCommand ni ffmpeg → copy (.wav) si copyWavIfNoEncoder, sinon échec
 * - .ks → transcode-ks (.ks)
 */
export function planTasks(entries: InventoryEntry[], ctx: PlanContext): Task[] {
  const tasks: Task[] = [];

  for (const entry of entries) {
    const task = planEntry(entry, ctx);
    if (task) tasks.push(task);
  }

  return tasks;
}

/** Catégorie PERF-08 pour l'option avec perte : `bg`, `ev` (images d'événement), sinon `image`. */
function webpCategory(entry: InventoryEntry): string {
  if (entry.kind === "bg") return "bg";
  if (entry.kind === "image" && /^ev/i.test(entry.key)) return "ev";
  return entry.kind;
}

function webpLosslessFor(entry: InventoryEntry, ctx: PlanContext): boolean {
  return !ctx.webp || !ctx.webp.lossyCategories.includes(webpCategory(entry));
}

function planEntry(entry: InventoryEntry, ctx: PlanContext): Task | null {
  const { kind, ext } = entry;

  // Images (bg, image, rule)
  if (kind === "bg" || kind === "image" || kind === "rule") {
    if (ext === ".tlg") {
      if (ctx.tlgCommand) {
        const outputExt = kind === "rule" ? ".png" : ".webp";
        return makeTask(entry, ctx, "convert-image", outputExt, ctx.tlgCommand, false);
      }
      // Pas de convertisseur externe : décodeur intégré, puis WebP sans perte par défaut (#374),
      // repli PNG si aucun encodeur WebP (ou règle : les rules restent en PNG).
      if (ctx.webp && kind !== "rule") {
        return makeTask(entry, ctx, "convert-image", ".webp", undefined, true, {
          lossless: webpLosslessFor(entry, ctx),
          quality: ctx.webp.quality,
          encoder: ctx.webp.encoder,
        });
      }
      return makeTask(entry, ctx, "convert-image", ".png", undefined, true);
    }
    // PNG/JPG/BMP → WebP sans perte si encodeur dispo, sinon copie telle quelle.
    if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".bmp") {
      if (ctx.webp && kind !== "rule" && ext === ".png") {
        return makeTask(entry, ctx, "convert-image", ".webp", undefined, true, {
          lossless: webpLosslessFor(entry, ctx),
          quality: ctx.webp.quality,
          encoder: ctx.webp.encoder,
        });
      }
      return makeTask(entry, ctx, "copy", ext, undefined, true);
    }
    return null;
  }

  // Audio (bgm, se)
  if (kind === "bgm" || kind === "se") {
    if (ext === ".ogg" || ext === ".mp3") {
      return makeTask(entry, ctx, "copy", ".ogg", undefined, true);
    }
    if (ext === ".wav") {
      if (ctx.audioCommand) {
        return makeTask(entry, ctx, "convert-audio", ".ogg", ctx.audioCommand, false);
      }
      if (ctx.audio) {
        return makeTask(
          entry,
          ctx,
          "convert-audio",
          AUDIO_OUTPUT_EXT[ctx.audio.format],
          undefined,
          false,
          undefined,
          ctx.audio,
        );
      }
      if (ctx.copyWavIfNoEncoder) {
        return makeTask(entry, ctx, "copy", ".wav", undefined, true);
      }
      return makeTask(entry, ctx, "convert-audio", ".ogg", undefined, false);
    }
    return null;
  }

  // Scénarios
  if (kind === "scenario") {
    return makeTask(entry, ctx, "transcode-ks", ".ks", undefined, true);
  }

  return null;
}

function makeTask(
  entry: InventoryEntry,
  ctx: PlanContext,
  action: TaskAction,
  outputExt: string,
  commandTemplate: string | undefined,
  internal: boolean,
  webp?: { lossless: boolean; quality: number; encoder?: "sharp" | "cwebp" },
  audio?: { ffmpegPath: string; format: AudioFormat },
): Task {
  const fileName = `${entry.key}${outputExt}`;
  const outputPath = `${ctx.outputDir}/${entry.kind}/${fileName}`;
  return {
    entry,
    action,
    outputPath,
    outputExt,
    commandTemplate,
    internal,
    ...(webp ? { webp } : {}),
    ...(audio ? { audio } : {}),
  };
}

/**
 * Groupe les résultats par statut pour le résumé.
 */
export function summarizeResults(results: TaskResult[]): {
  ok: number;
  failed: number;
  skipped: number;
  byAction: Record<TaskAction, { ok: number; failed: number; skipped: number }>;
} {
  const summary = {
    ok: 0,
    failed: 0,
    skipped: 0,
    byAction: {} as Record<TaskAction, { ok: number; failed: number; skipped: number }>,
  };

  for (const result of results) {
    const action = result.task.action;
    if (!summary.byAction[action]) {
      summary.byAction[action] = { ok: 0, failed: 0, skipped: 0 };
    }
    summary[result.status]++;
    summary.byAction[action][result.status]++;
  }

  return summary;
}
