/**
 * Persistance des sauvegardes.
 *
 * Un enregistrement contient les données affichées par l'UI (`SaveSlot.data`)
 * et ce dont le player a besoin pour reprendre : état du runtime, audio, arrêt.
 */
import type { AudioSnapshot, Position, StopReason } from "@/kag/events.js";
import type { RuntimeSaveData } from "@/kag/runtime.js";
import type { SaveSlot, SlotId } from "@/ui/types.js";

export type SaveRecord = NonNullable<SaveSlot["data"]> & {
  runtime: RuntimeSaveData;
  audio: AudioSnapshot;
  /** Position du point d'arrêt (clé de texte lu). */
  position: Position;
  /** Point d'arrêt où la sauvegarde a été prise (click ou choice). */
  stop: StopReason;
  /** Scripts d'interlude encore à jouer (absent des sauvegardes antérieures). */
  chainQueue?: string[];
};

export interface SaveStore {
  get(slot: SlotId): Promise<SaveRecord | null>;
  put(slot: SlotId, record: SaveRecord): Promise<void>;
  delete(slot: SlotId): Promise<void>;
}

export function createLocalSaveStore(storage: Storage = localStorage, prefix = "mahoyo.save."): SaveStore {
  return {
    async get(slot) {
      try {
        const raw = storage.getItem(prefix + String(slot));
        return raw ? (JSON.parse(raw) as SaveRecord) : null;
      } catch {
        return null;
      }
    },
    async put(slot, record) {
      storage.setItem(prefix + String(slot), JSON.stringify(record));
    },
    async delete(slot) {
      storage.removeItem(prefix + String(slot));
    },
  };
}

export function createMemorySaveStore(): SaveStore & { records: Map<string, SaveRecord> } {
  const records = new Map<string, SaveRecord>();
  return {
    records,
    async get(slot) {
      const r = records.get(String(slot));
      return r ? structuredClone(r) : null;
    },
    async put(slot, record) {
      records.set(String(slot), structuredClone(record));
    },
    async delete(slot) {
      records.delete(String(slot));
    },
  };
}
