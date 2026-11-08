/**
 * Sauvegardes dans IndexedDB (#198, WEB-03).
 *
 * 120 emplacements avec vignette en data-URL dépassent le quota de `localStorage` (~5 Mo) ; IndexedDB n'a pas
 * cette limite pratique. Deux object stores, clé = emplacement ("auto", "quick", "3") :
 *   - `saves`      : l'enregistrement, sans vignette (`thumbnailUrl: null`) ;
 *   - `thumbnails` : la vignette (data-URL), séparée pour garder les enregistrements légers.
 * Écriture, suppression et mise à jour sont atomiques (une transaction sur les deux stores) et le verrou est
 * vérifié dans cette même transaction : pas de fenêtre de course entre deux onglets.
 *
 * `createSaveStore` est le point d'entrée : il ouvre IndexedDB, migre les anciennes clés `mahoyo.save.<slot>`
 * du localStorage, et retombe sur localStorage puis sur la mémoire si IndexedDB est indisponible (navigation
 * privée, tests Node). Aucune de ces étapes ne lève d'exception vers l'appelant.
 */
import type { SlotId } from "@/ui/types.js";
import {
  LOCAL_SAVE_PREFIX,
  SaveLockedError,
  applyMetaPatch,
  createLocalSaveStore,
  createMemorySaveStore,
  migrateSaveRecord,
  parseSlotKey,
  resolveLocalStorage,
  slotKey,
  type SaveEntry,
  type SaveMetaPatch,
  type SaveRecord,
  type SaveStore,
} from "./save-store.js";

export const SAVE_DB_NAME = "mahoyo-saves";
const DB_VERSION = 1;
const SAVES = "saves";
const THUMBS = "thumbnails";
/** Au-delà, on considère qu'IndexedDB ne répondra pas (certains navigateurs en navigation privée) et on replie. */
const DEFAULT_OPEN_TIMEOUT_MS = 4000;

// ── Utilitaires IndexedDB ──

function openDatabase(factory: IDBFactory, name: string, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("IndexedDB: ouverture trop longue"));
    }, timeoutMs);
    const finish = (fn: () => void): void => {
      clearTimeout(timer);
      fn();
    };
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, DB_VERSION);
    } catch (err) {
      finish(() => reject(err));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES);
      if (!db.objectStoreNames.contains(THUMBS)) db.createObjectStore(THUMBS);
    };
    req.onsuccess = () => {
      if (settled) {
        req.result.close(); // ouverture tardive après abandon : on rend la connexion
        return;
      }
      finish(() => resolve(req.result));
    };
    req.onerror = () => {
      if (!settled) finish(() => reject(req.error ?? new Error("IndexedDB: ouverture refusée")));
    };
    req.onblocked = () => {
      if (!settled) finish(() => reject(new Error("IndexedDB: ouverture bloquée")));
    };
  });
}

type Stores = { saves: IDBObjectStore; thumbs: IDBObjectStore };

/**
 * Exécute `body` dans une transaction sur les deux stores. `body` pose ses requêtes (en callbacks, la
 * transaction doit rester active) et renvoie une fonction qui produit le résultat une fois la transaction validée.
 * `abort(err)` annule tout et rejette avec `err`. Toute exception de `body` ou d'un callback annule aussi.
 */
function transact<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (stores: Stores, abort: (err: unknown) => void, guard: (fn: () => void) => () => void) => () => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction([SAVES, THUMBS], mode);
    } catch (err) {
      reject(err);
      return;
    }
    let failure: unknown;
    let hasFailure = false;
    let result: () => T = () => undefined as T;
    const abort = (err: unknown): void => {
      if (hasFailure) return;
      hasFailure = true;
      failure = err;
      try {
        tx.abort();
      } catch {
        reject(err); // transaction déjà terminée
      }
    };
    const guard = (fn: () => void) => (): void => {
      try {
        fn();
      } catch (err) {
        abort(err);
      }
    };
    tx.oncomplete = () => {
      try {
        resolve(result());
      } catch (err) {
        reject(err);
      }
    };
    tx.onabort = () => reject(hasFailure ? failure : (tx.error ?? new Error("IndexedDB: transaction annulée")));
    try {
      result = body({ saves: tx.objectStore(SAVES), thumbs: tx.objectStore(THUMBS) }, abort, guard);
    } catch (err) {
      abort(err);
    }
  });
}

/** Sépare la vignette de l'enregistrement. Passe par JSON pour garantir un contenu clonable, comme localStorage. */
function splitRecord(record: SaveRecord): { stored: SaveRecord; thumbnail: string | null } {
  const plain = JSON.parse(JSON.stringify(record)) as SaveRecord;
  const thumbnail = typeof plain.thumbnailUrl === "string" && plain.thumbnailUrl !== "" ? plain.thumbnailUrl : null;
  return { stored: { ...plain, thumbnailUrl: null }, thumbnail };
}

function joinRecord(raw: unknown, thumbnail: unknown): SaveRecord | null {
  const record = migrateSaveRecord(raw);
  if (!record) return null;
  return typeof thumbnail === "string" ? { ...record, thumbnailUrl: thumbnail } : record;
}

function isLocked(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { locked?: unknown }).locked === true;
}

// ── Magasin IndexedDB ──

/** Magasin sur une base déjà ouverte. `get` et `list` ne rejettent pas (lecture impossible = vide). */
export function createIndexedDbSaveStore(db: IDBDatabase): SaveStore {
  db.onversionchange = () => db.close(); // laisse passer une montée de version faite par un autre onglet
  return {
    async list() {
      try {
        return await transact(db, "readonly", ({ saves, thumbs }) => {
          const keys = saves.getAllKeys();
          const values = saves.getAll();
          const thumbKeys = thumbs.getAllKeys();
          const thumbValues = thumbs.getAll();
          return () => {
            const thumbByKey = new Map<string, unknown>();
            thumbKeys.result.forEach((k, i) => thumbByKey.set(String(k), thumbValues.result[i]));
            const entries: SaveEntry[] = [];
            keys.result.forEach((k, i) => {
              const slot = parseSlotKey(String(k));
              const record = slot === null ? null : joinRecord(values.result[i], thumbByKey.get(String(k)));
              if (slot !== null && record) entries.push({ slot, record });
            });
            return entries;
          };
        });
      } catch (err) {
        console.warn("[save-store] lecture IndexedDB impossible :", err);
        return [];
      }
    },

    async get(slot) {
      const key = slotKey(slot);
      try {
        return await transact(db, "readonly", ({ saves, thumbs }) => {
          const rec = saves.get(key);
          const thumb = thumbs.get(key);
          return () => joinRecord(rec.result, thumb.result);
        });
      } catch (err) {
        console.warn("[save-store] lecture IndexedDB impossible :", err);
        return null;
      }
    },

    async put(slot, record) {
      const key = slotKey(slot);
      const { stored, thumbnail } = splitRecord(record);
      await transact(db, "readwrite", ({ saves, thumbs }, abort, guard) => {
        const current = saves.get(key);
        current.onsuccess = guard(() => {
          if (isLocked(current.result)) return abort(new SaveLockedError(slot));
          saves.put(stored, key);
          if (thumbnail !== null) thumbs.put(thumbnail, key);
          else thumbs.delete(key);
        });
        return () => undefined;
      });
    },

    async delete(slot) {
      const key = slotKey(slot);
      await transact(db, "readwrite", ({ saves, thumbs }, abort, guard) => {
        const current = saves.get(key);
        current.onsuccess = guard(() => {
          if (isLocked(current.result)) return abort(new SaveLockedError(slot));
          saves.delete(key);
          thumbs.delete(key);
        });
        return () => undefined;
      });
    },

    async update(slot, patch: SaveMetaPatch) {
      const key = slotKey(slot);
      return transact(db, "readwrite", ({ saves }, _abort, guard) => {
        let found = false;
        const current = saves.get(key);
        current.onsuccess = guard(() => {
          const record = migrateSaveRecord(current.result);
          if (!record) return;
          found = true;
          saves.put(applyMetaPatch(record, patch), key);
        });
        return () => found;
      });
    },
  };
}

// ── Migration depuis localStorage ──

export type MigrationReport = {
  /** Anciennes clés copiées, vérifiées, puis retirées du localStorage. */
  migrated: SlotId[];
  /** Emplacement déjà présent à l'identique dans le nouveau magasin : seule l'ancienne clé est retirée. */
  alreadyPresent: SlotId[];
  /** Anciennes clés laissées en place (le nouveau magasin contient une autre sauvegarde, ou l'écriture n'a pas pu être vérifiée). */
  kept: SlotId[];
  /** Clés illisibles (JSON invalide) : laissées en place, jamais supprimées. */
  unreadable: string[];
};

/** JSON à clés triées : compare deux enregistrements sans dépendre de l'ordre des propriétés. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Forme comparable : vignette vide/absente = null (c'est ainsi qu'elle est stockée). */
function comparable(record: SaveRecord): string {
  const url = record.thumbnailUrl;
  return canonicalJson({ ...record, thumbnailUrl: typeof url === "string" && url !== "" ? url : null });
}

/**
 * Copie les sauvegardes `mahoyo.save.<slot>` de `storage` vers `target`.
 *
 * - Chaque enregistrement passe par `migrateSaveRecord` (donc titre, commentaire, verrou et choix sont complétés).
 * - L'ancienne clé n'est retirée qu'après relecture de `target` et comparaison à l'identique de ce qui a été écrit.
 * - Jamais d'écrasement : si `target` contient déjà une autre sauvegarde pour l'emplacement (il est plus récent),
 *   l'ancienne clé est conservée telle quelle.
 * - Idempotente : relancée après une interruption (onglet fermé, quota), elle reprend sans doublon ni perte.
 * - Ne lève jamais : tout accès au stockage est protégé.
 */
export async function migrateLocalSaves(
  target: SaveStore,
  storage: Storage,
  prefix: string = LOCAL_SAVE_PREFIX,
): Promise<MigrationReport> {
  const report: MigrationReport = { migrated: [], alreadyPresent: [], kept: [], unreadable: [] };
  let keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return report;
  }
  keys = keys.filter((key) => parseSlotKey(key.slice(prefix.length)) !== null);

  for (const key of keys) {
    const slot = parseSlotKey(key.slice(prefix.length))!;
    let record: SaveRecord | null = null;
    try {
      const raw = storage.getItem(key);
      record = raw ? migrateSaveRecord(JSON.parse(raw)) : null;
    } catch {
      record = null;
    }
    if (!record) {
      report.unreadable.push(key);
      continue;
    }
    try {
      const expected = comparable(record);
      const existing = await target.get(slot);
      if (existing) {
        if (comparable(existing) === expected) {
          removeKey(storage, key);
          report.alreadyPresent.push(slot);
        } else {
          report.kept.push(slot);
        }
        continue;
      }
      await target.put(slot, record);
      const written = await target.get(slot);
      if (written && comparable(written) === expected) {
        removeKey(storage, key);
        report.migrated.push(slot);
      } else {
        report.kept.push(slot);
      }
    } catch (err) {
      console.warn(`[save-store] migration de ${key} interrompue :`, err);
      report.kept.push(slot);
    }
  }
  return report;
}

function removeKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* la clé restera ; elle sera retrouvée à l'identique au prochain lancement */
  }
}

// ── Point d'entrée avec repli ──

export type SaveBackend = "indexeddb" | "localstorage" | "memory";

export type CreateSaveStoreOptions = {
  /** Fabrique IndexedDB. `undefined` = celle du navigateur si elle existe ; `null` = indisponible. */
  indexedDB?: IDBFactory | null;
  /** Stockage de repli et source de la migration. `undefined` = `localStorage` s'il est accessible ; `null` = aucun. */
  storage?: Storage | null;
  dbName?: string;
  openTimeoutMs?: number;
};

export interface ResilientSaveStore extends SaveStore {
  /** Stockage effectivement utilisé (attend l'ouverture et la migration). */
  backend(): Promise<SaveBackend>;
  /** Bilan de la migration localStorage → IndexedDB ; null si IndexedDB est indisponible ou si la migration a échoué. */
  migration(): Promise<MigrationReport | null>;
}

function browserIndexedDb(): IDBFactory | null {
  try {
    return typeof indexedDB === "undefined" ? null : indexedDB;
  } catch {
    return null;
  }
}

/**
 * Magasin de production : IndexedDB si possible (avec migration des anciennes clés localStorage), sinon
 * localStorage, sinon mémoire. L'ouverture est paresseuse et partagée ; aucune méthode ne rejette à cause de
 * l'indisponibilité du stockage.
 */
export function createSaveStore(options: CreateSaveStoreOptions = {}): ResilientSaveStore {
  const storage = options.storage === undefined ? resolveLocalStorage() : options.storage;
  const factory = options.indexedDB === undefined ? browserIndexedDb() : options.indexedDB;

  const ready = (async (): Promise<{ store: SaveStore; backend: SaveBackend; report: MigrationReport | null }> => {
    if (factory) {
      try {
        const db = await openDatabase(factory, options.dbName ?? SAVE_DB_NAME, options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
        const store = createIndexedDbSaveStore(db);
        const report = storage ? await migrateLocalSaves(store, storage).catch(() => null) : null;
        return { store, backend: "indexeddb", report };
      } catch (err) {
        console.warn("[save-store] IndexedDB indisponible, repli sur localStorage :", err);
      }
    }
    if (storage) return { store: createLocalSaveStore(storage), backend: "localstorage", report: null };
    console.warn("[save-store] aucun stockage disponible : les sauvegardes ne survivront pas au rechargement.");
    return { store: createMemorySaveStore(), backend: "memory", report: null };
  })();

  return {
    async backend() {
      return (await ready).backend;
    },
    async migration() {
      return (await ready).report;
    },
    async list() {
      return (await ready).store.list();
    },
    async get(slot) {
      return (await ready).store.get(slot);
    },
    async put(slot, record) {
      return (await ready).store.put(slot, record);
    },
    async delete(slot) {
      return (await ready).store.delete(slot);
    },
    async update(slot, patch) {
      return (await ready).store.update(slot, patch);
    },
  };
}
