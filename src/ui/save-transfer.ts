/**
 * Export / import des sauvegardes côté navigateur (#198, WEB-03) : téléchargement du fichier JSON,
 * sélecteur de fichier et messages. La logique est dans `src/player/save-transfer.ts` ; l'habillage final
 * (boutons dans l'écran de sauvegarde) relève de HUD-10 (#196), qui appellera ces fonctions.
 */
import {
  exportSaves,
  importSavesFromText,
  serializeSaveExport,
  type ImportReport,
  type ProgressAccess,
} from "@/player/save-transfer.js";
import type { SaveStore } from "@/player/save-store.js";
import { t } from "./i18n.js";

/** Nom du fichier téléchargé : `mahoyo-saves-AAAA-MM-JJ.json`. */
export function exportFileName(now: Date = new Date()): string {
  return `mahoyo-saves-${now.toISOString().slice(0, 10)}.json`;
}

/** Déclenche le téléchargement d'un texte JSON. */
function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Exporte toutes les sauvegardes et la progression dans un fichier téléchargé. Renvoie le message à afficher. */
export async function downloadSaveExport(store: SaveStore, progress?: ProgressAccess): Promise<string> {
  const data = await exportSaves(store, progress);
  downloadText(serializeSaveExport(data), exportFileName());
  return t("saveTransfer.exported", { n: data.saves.length });
}

/** Ouvre le sélecteur de fichier système ; null si l'utilisateur annule. */
export function pickSaveFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/** Message récapitulatif d'un import (une phrase par information utile). */
export function describeImportReport(report: ImportReport): string {
  const lines: string[] = [];
  if (report.imported.length > 0) lines.push(t("saveTransfer.imported", { n: report.imported.length }));
  else if (report.skippedLocked.length === 0 && report.failed.length === 0 && report.invalid === 0) {
    lines.push(t("saveTransfer.nothing"));
  }
  if (report.skippedLocked.length > 0) lines.push(t("saveTransfer.skippedLocked", { n: report.skippedLocked.length }));
  if (report.invalid > 0) lines.push(t("saveTransfer.invalid", { n: report.invalid }));
  if (report.failed.length > 0) lines.push(t("saveTransfer.failed", { n: report.failed.length }));
  return lines.join(" ");
}

/** Importe le contenu d'un fichier choisi par l'utilisateur. Renvoie le message à afficher. */
export async function importSaveFile(
  file: File,
  store: SaveStore,
  progress?: ProgressAccess,
): Promise<{ message: string; report: ImportReport | null }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { message: t("saveTransfer.unreadable"), report: null };
  }
  const result = await importSavesFromText(store, text, progress);
  if (!result.ok) {
    return { message: t(result.reason === "unsupported" ? "saveTransfer.unsupported" : "saveTransfer.unreadable"), report: null };
  }
  return { message: describeImportReport(result.report), report: result.report };
}
