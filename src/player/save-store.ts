/**
 * Persistance des sauvegardes.
 *
 * Un enregistrement contient les données affichées par l'UI (`SaveSlot.data`)
 * et ce dont le player a besoin pour reprendre : état du runtime, audio, arrêt.
 *
 * Les enregistrements sont migrés à la lecture (`migrateSaveRecord`) : les
 * sauvegardes écrites avant l'ajout du titre de scène, du commentaire et du
 * verrou, ou de l'historique de choix, restent chargeables, sans réécriture du stockage.
 */
import type { AudioSnapshot, Position, StopReason } from "@/kag/events.js";
import type { RuntimeSaveData } from "@/kag/runtime.js";
import type { SaveSlot, SlotId, TakenChoice } from "@/ui/types.js";
import { normalizeStoryProgress } from "./story-progress.js";

export type SaveRecord = NonNullable<SaveSlot["data"]> & {
  runtime: RuntimeSaveData;
  audio: AudioSnapshot;
  /** Position du point d'arrêt (clé de texte lu). */
  position: Position;
  /** Point d'arrêt où la sauvegarde a été prise (click ou choice). */
  stop: StopReason;
  /** Scripts d'interlude encore à jouer (absent des sauvegardes antérieures). */
  chainQueue?: string[];
  /**
   * Titre de scène affiché sur la fiche de l'emplacement. Dérivé des données
   * locales de l'utilisateur (libellé du script), jamais codé en dur.
   * Les anciennes sauvegardes reçoivent le nom du fichier de script.
   */
  sceneTitle: string;
  /** Commentaire libre de l'utilisateur ("" = aucun). */
  comment: string;
  /** Emplacement verrouillé : écrasement et suppression refusés. */
  locked: boolean;
  /**
   * Arêtes de choix prises depuis le début de la partie en cours (scripts uniquement, jamais le
   * libellé), pour reprendre le chemin à l'identique. Absent des sauvegardes antérieures : la
   * migration le ramène à `[]`. C'est un état de la partie, distinct de la progression globale.
   */
  choices?: readonly TakenChoice[];
};

/** Métadonnées modifiables sans réécrire la sauvegarde (y compris sur un emplacement verrouillé). */
export type SaveMetaPatch = Partial<Pick<SaveRecord, "comment" | "locked">>;

/** Levée quand on tente d'écraser ou de supprimer un emplacement verrouillé. */
export class SaveLockedError extends Error {
  constructor(readonly slot: SlotId) {
    super(`Emplacement verrouillé : ${String(slot)}`);
    this.name = "SaveLockedError";
  }
}

export interface SaveStore {
  get(slot: SlotId): Promise<SaveRecord | null>;
  /** Écrase l'emplacement ; rejette avec `SaveLockedError` s'il est verrouillé. */
  put(slot: SlotId, record: SaveRecord): Promise<void>;
  /** Supprime l'emplacement ; rejette avec `SaveLockedError` s'il est verrouillé. */
  delete(slot: SlotId): Promise<void>;
  /** Met à jour commentaire et/ou verrou. Renvoie false si l'emplacement est vide. */
  update(slot: SlotId, patch: SaveMetaPatch): Promise<boolean>;
}

/** Titre de scène d'un script : libellé du sommaire local, sinon nom du fichier. */
export function deriveSceneTitle(scriptFile: string, scripts: readonly { file: string; label: string }[]): string {
  const label = scripts.find((s) => s.file === scriptFile)?.label;
  return label && label.trim() !== "" ? label : scriptFile;
}

/**
 * Normalise un enregistrement lu du stockage (ancien ou courant).
 * Tous les champs existants sont conservés ; les champs absents ou invalides
 * reçoivent une valeur par défaut. Renvoie null si ce n'est pas un objet.
 */
export function migrateSaveRecord(raw: unknown): SaveRecord | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const scriptFile = typeof r.scriptFile === "string" ? r.scriptFile : "";
  return {
    ...r,
    sceneTitle: typeof r.sceneTitle === "string" && r.sceneTitle !== "" ? r.sceneTitle : scriptFile,
    comment: typeof r.comment === "string" ? r.comment : "",
    locked: r.locked === true,
    // Réduit à des paires de scripts : aucun autre champ (libellé, texte) n'est conservé.
    choices: normalizeStoryProgress({ choices: r.choices }).choices,
  } as SaveRecord;
}

export function createLocalSaveStore(storage: Storage = localStorage, prefix = "mahoyo.save."): SaveStore {
  const read = (slot: SlotId): SaveRecord | null => {
    try {
      const raw = storage.getItem(prefix + String(slot));
      return raw ? migrateSaveRecord(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };
  const write = (slot: SlotId, record: SaveRecord): void => storage.setItem(prefix + String(slot), JSON.stringify(record));
  return {
    async get(slot) {
      return read(slot);
    },
    async put(slot, record) {
      if (read(slot)?.locked) throw new SaveLockedError(slot);
      write(slot, record);
    },
    async delete(slot) {
      if (read(slot)?.locked) throw new SaveLockedError(slot);
      storage.removeItem(prefix + String(slot));
    },
    async update(slot, patch) {
      const current = read(slot);
      if (!current) return false;
      write(slot, applyMetaPatch(current, patch));
      return true;
    },
  };
}

export function createMemorySaveStore(): SaveStore & { records: Map<string, SaveRecord> } {
  const records = new Map<string, SaveRecord>();
  return {
    records,
    async get(slot) {
      const r = records.get(String(slot));
      return r ? migrateSaveRecord(structuredClone(r)) : null;
    },
    async put(slot, record) {
      if (records.get(String(slot))?.locked) throw new SaveLockedError(slot);
      records.set(String(slot), structuredClone(record));
    },
    async delete(slot) {
      if (records.get(String(slot))?.locked) throw new SaveLockedError(slot);
      records.delete(String(slot));
    },
    async update(slot, patch) {
      const current = records.get(String(slot));
      if (!current) return false;
      records.set(String(slot), structuredClone(applyMetaPatch(current, patch)));
      return true;
    },
  };
}

function applyMetaPatch(record: SaveRecord, patch: SaveMetaPatch): SaveRecord {
  return {
    ...record,
    ...(typeof patch.comment === "string" ? { comment: patch.comment } : {}),
    ...(typeof patch.locked === "boolean" ? { locked: patch.locked } : {}),
  };
}
