/**
 * Export / import JSON des sauvegardes (#198, WEB-03) : l'équivalent web des fichiers `.dat` du jeu d'origine.
 *
 * Le fichier contient les enregistrements tels que stockés (vignette, `locked`, `comment`, `sceneTitle`, `choices`)
 * et la progression du flowchart. Il est produit par l'utilisateur à partir de ses propres parties et n'est jamais
 * versionné dans le dépôt.
 *
 * Règles d'import :
 * - un emplacement **verrouillé** n'est jamais écrasé : il est conservé et rapporté (`skippedLocked`) ;
 * - les autres emplacements sont écrasés (`overwritten` les liste, pour qu'une interface puisse prévenir) ;
 * - une entrée invalide est ignorée et comptée (`invalid`), sans interrompre le reste ;
 * - la progression est **fusionnée** (union) avec celle de l'appareil, jamais remplacée.
 *
 * Fonctions sans DOM : le téléchargement et le sélecteur de fichier sont dans `src/ui/save-transfer.ts`.
 */
import type { StoryProgress, SlotId } from "@/ui/types.js";
import { migrateSaveRecord, parseSlotKey, SaveLockedError, slotKey, type SaveRecord, type SaveStore } from "./save-store.js";
import type { SettingsStore } from "./settings-store.js";
import { emptyStoryProgress, mergeStoryProgress, normalizeStoryProgress } from "./story-progress.js";

export const SAVE_EXPORT_FORMAT = "mahoyo-saves";
export const SAVE_EXPORT_VERSION = 1;

/** Accès à la progression du flowchart (sous-ensemble de `SettingsStore`). */
export type ProgressAccess = Pick<SettingsStore, "loadStoryProgress" | "saveStoryProgress">;

export type SaveExport = {
  format: typeof SAVE_EXPORT_FORMAT;
  version: typeof SAVE_EXPORT_VERSION;
  /** Date de l'export (ISO 8601), informative. */
  exportedAt: string;
  saves: { slot: SlotId; record: SaveRecord }[];
  storyProgress: StoryProgress;
};

export type ParseResult =
  | { ok: true; data: SaveExport; /** Entrées écartées parce qu'invalides. */ invalid: number }
  | { ok: false; reason: "unreadable" | "unsupported" };

export type ImportReport = {
  /** Emplacements écrits (nouveaux ou écrasés). */
  imported: SlotId[];
  /** Parmi `imported`, ceux qui contenaient déjà une sauvegarde (non verrouillée). */
  overwritten: SlotId[];
  /** Emplacements verrouillés laissés intacts. */
  skippedLocked: SlotId[];
  /** Emplacements dont l'écriture a échoué (stockage plein, base inaccessible). */
  failed: SlotId[];
  /** Entrées du fichier ignorées car invalides (emplacement ou enregistrement inexploitable). */
  invalid: number;
  /** La progression du flowchart a-t-elle été fusionnée ? */
  progressMerged: boolean;
};

function slotOrder(a: SlotId, b: SlotId): number {
  const rank = (s: SlotId): number => (s === "auto" ? -2 : s === "quick" ? -1 : s);
  return rank(a) - rank(b);
}

/** Construit le contenu d'un export à partir du magasin (et de la progression, si fournie). */
export async function exportSaves(
  store: SaveStore,
  progress?: ProgressAccess,
  now: () => Date = () => new Date(),
): Promise<SaveExport> {
  const entries = await store.list();
  entries.sort((a, b) => slotOrder(a.slot, b.slot));
  let storyProgress = emptyStoryProgress();
  if (progress) {
    try {
      storyProgress = normalizeStoryProgress(await progress.loadStoryProgress());
    } catch {
      /* progression illisible : export des sauvegardes seules */
    }
  }
  return {
    format: SAVE_EXPORT_FORMAT,
    version: SAVE_EXPORT_VERSION,
    exportedAt: now().toISOString(),
    saves: entries.map(({ slot, record }) => ({ slot, record })),
    storyProgress,
  };
}

export function serializeSaveExport(data: SaveExport): string {
  return JSON.stringify(data);
}

const THUMBNAIL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]*$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Valide un enregistrement importé : il doit contenir de quoi être chargé par le player, sinon il est écarté
 * (un enregistrement bancal ferait échouer le chargement plus tard). Les métadonnées passent par
 * `migrateSaveRecord`. La vignette n'est conservée que si c'est une data-URL d'image : un fichier importé ne
 * doit pas pouvoir faire charger une URL externe au navigateur.
 */
function toImportableRecord(raw: unknown): SaveRecord | null {
  if (!isObject(raw)) return null;
  if (typeof raw.scriptFile !== "string" || raw.scriptFile === "") return null;
  if (typeof raw.timestamp !== "number" || !Number.isFinite(raw.timestamp)) return null;
  for (const field of ["runtime", "audio", "position", "stop", "stage"] as const) {
    if (!isObject(raw[field])) return null;
  }
  const record = migrateSaveRecord(raw);
  if (!record) return null;
  const url = record.thumbnailUrl;
  return { ...record, thumbnailUrl: typeof url === "string" && THUMBNAIL_PATTERN.test(url) ? url : null };
}

/** Emplacement tel qu'écrit à l'export : "auto", "quick" ou un entier positif. */
function parseExportedSlot(value: unknown): SlotId | null {
  if (value === "auto" || value === "quick") return value;
  return typeof value === "number" && Number.isInteger(value) ? parseSlotKey(String(value)) : null;
}

/** Lit un fichier d'export. Ne lève jamais. */
export function parseSaveExport(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!isObject(raw) || raw.format !== SAVE_EXPORT_FORMAT || !Array.isArray(raw.saves)) {
    return { ok: false, reason: "unreadable" };
  }
  if (raw.version !== SAVE_EXPORT_VERSION) return { ok: false, reason: "unsupported" };

  const bySlot = new Map<string, { slot: SlotId; record: SaveRecord }>();
  let invalid = 0;
  for (const item of raw.saves as unknown[]) {
    const slot = isObject(item) ? parseExportedSlot(item.slot) : null;
    const record = isObject(item) ? toImportableRecord(item.record) : null;
    if (slot === null || !record) {
      invalid++;
      continue;
    }
    bySlot.set(slotKey(slot), { slot, record }); // doublon : la dernière entrée l'emporte
  }
  const saves = [...bySlot.values()].sort((a, b) => slotOrder(a.slot, b.slot));
  return {
    ok: true,
    invalid,
    data: {
      format: SAVE_EXPORT_FORMAT,
      version: SAVE_EXPORT_VERSION,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      saves,
      storyProgress: normalizeStoryProgress(raw.storyProgress),
    },
  };
}

/** Applique un export au magasin. Ne lève jamais ; le détail est dans le rapport. */
export async function importSaves(
  store: SaveStore,
  data: SaveExport,
  progress?: ProgressAccess,
  invalid = 0,
): Promise<ImportReport> {
  const report: ImportReport = {
    imported: [],
    overwritten: [],
    skippedLocked: [],
    failed: [],
    invalid,
    progressMerged: false,
  };
  for (const { slot, record } of data.saves) {
    try {
      const existing = await store.get(slot);
      if (existing?.locked) {
        report.skippedLocked.push(slot);
        continue;
      }
      await store.put(slot, record);
      report.imported.push(slot);
      if (existing) report.overwritten.push(slot);
    } catch (err) {
      if (err instanceof SaveLockedError) report.skippedLocked.push(slot);
      else {
        console.warn("[save-transfer] écriture impossible pour", slot, err);
        report.failed.push(slot);
      }
    }
  }
  if (progress) {
    try {
      const current = normalizeStoryProgress(await progress.loadStoryProgress());
      await progress.saveStoryProgress(mergeStoryProgress(current, data.storyProgress));
      report.progressMerged = true;
    } catch (err) {
      console.warn("[save-transfer] progression non fusionnée :", err);
    }
  }
  return report;
}

/** Lit un texte d'export puis l'applique. */
export async function importSavesFromText(
  store: SaveStore,
  text: string,
  progress?: ProgressAccess,
): Promise<{ ok: true; report: ImportReport } | { ok: false; reason: "unreadable" | "unsupported" }> {
  const parsed = parseSaveExport(text);
  if (!parsed.ok) return parsed;
  return { ok: true, report: await importSaves(store, parsed.data, progress, parsed.invalid) };
}
