import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  SAVE_DB_NAME,
  createIndexedDbSaveStore,
  createSaveStore,
  migrateLocalSaves,
} from "@/player/save-store-idb.js";
import {
  SaveLockedError,
  createLocalSaveStore,
  createMemorySaveStore,
  resolveLocalStorage,
  type SaveRecord,
  type SaveStore,
} from "@/player/save-store.js";

/** Storage en mémoire avec quota optionnel (en caractères), comme les ~5 Mo de localStorage. */
function createFakeStorage(quotaChars = Infinity): Storage & { failRemove: boolean } {
  const data = new Map<string, string>();
  const size = (): number => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const storage = {
    failRemove: false,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => {
      if (storage.failRemove) throw new Error("removeItem refusé");
      data.delete(k);
    },
    setItem: (k: string, v: string) => {
      const previous = data.get(k);
      const next = size() - (previous === undefined ? 0 : k.length + previous.length) + k.length + String(v).length;
      if (next > quotaChars) throw new DOMException("quota dépassé", "QuotaExceededError");
      data.set(k, String(v));
    },
  };
  return storage;
}

function legacyRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scriptFile: "1-1.ks",
    timestamp: 1_700_000_000_000,
    previewText: "texte de démonstration",
    thumbnailUrl: null,
    stage: { background: "bg_demo", sprites: [] },
    position: { scriptName: "1-1.ks", page: 2, instruction: 5 },
    runtime: { scriptName: "1-1.ks", pc: 7, variables: { f: { flag: 1 } } },
    audio: { loops: [{ channel: "bgm", storage: "theme", volume: 0.7 }] },
    stop: { kind: "click", style: "page" },
    chainQueue: ["2-0.ks"],
    ...overrides,
  };
}

function record(overrides: Partial<SaveRecord> = {}): SaveRecord {
  return { ...(legacyRecord() as unknown as SaveRecord), sceneTitle: "Scène", comment: "", locked: false, choices: [], ...overrides };
}

/** Fausse vignette lourde (~`kb` Ko) en data-URL, hors de tout asset du jeu. */
function fakeThumbnail(kb: number, seed: number): string {
  return `data:image/webp;base64,${String(seed % 10).repeat(kb * 1024)}`;
}

describe("magasin IndexedDB", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });
  afterEach(() => vi.restoreAllMocks());

  it("persiste entre deux connexions à la même base", async () => {
    const first = createSaveStore({ indexedDB: factory, storage: null });
    await first.put(2, record({ comment: "gardé", thumbnailUrl: "data:image/png;base64,QQ==" }));
    const second = createSaveStore({ indexedDB: factory, storage: null });
    expect(await second.backend()).toBe("indexeddb");
    expect(await second.get(2)).toMatchObject({ comment: "gardé", thumbnailUrl: "data:image/png;base64,QQ==" });
  });

  it("sépare la vignette de l'enregistrement", async () => {
    const store = createSaveStore({ indexedDB: factory, storage: null });
    await store.put(1, record({ thumbnailUrl: "data:image/png;base64,QQ==" }));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(SAVE_DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const read = (storeName: string): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const req = db.transaction(storeName).objectStore(storeName).get("1");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    expect(await read("saves")).toMatchObject({ thumbnailUrl: null, scriptFile: "1-1.ks" });
    expect(await read("thumbnails")).toBe("data:image/png;base64,QQ==");
    db.close();
  });

  it("supprimer un emplacement supprime aussi sa vignette", async () => {
    const store = createSaveStore({ indexedDB: factory, storage: null });
    await store.put(1, record({ thumbnailUrl: "data:image/png;base64,QQ==" }));
    await store.delete(1);
    await store.put(1, record({ thumbnailUrl: null }));
    expect((await store.get(1))?.thumbnailUrl).toBeNull();
  });

  it("écrire sans vignette retire l'ancienne vignette", async () => {
    const store = createSaveStore({ indexedDB: factory, storage: null });
    await store.put(1, record({ thumbnailUrl: "data:image/png;base64,QQ==" }));
    await store.put(1, record({ thumbnailUrl: null }));
    expect((await store.get(1))?.thumbnailUrl).toBeNull();
  });

  it("update conserve la vignette", async () => {
    const store = createSaveStore({ indexedDB: factory, storage: null });
    await store.put(1, record({ thumbnailUrl: "data:image/png;base64,QQ==" }));
    await store.update(1, { comment: "x", locked: true });
    expect(await store.get(1)).toMatchObject({ thumbnailUrl: "data:image/png;base64,QQ==", comment: "x", locked: true });
  });

  it("deux écritures concurrentes sur un emplacement verrouillé sont refusées", async () => {
    const store = createSaveStore({ indexedDB: factory, storage: null });
    await store.put(1, record({ previewText: "ancien", locked: true }));
    const results = await Promise.allSettled([
      store.put(1, record({ previewText: "a" })),
      store.put(1, record({ previewText: "b" })),
      store.delete(1),
    ]);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(SaveLockedError);
    }
    expect((await store.get(1))?.previewText).toBe("ancien");
  });

  it("un enregistrement corrompu dans la base est ignoré sans exception", async () => {
    const store = createSaveStore({ indexedDB: factory, storage: null });
    await store.put(1, record());
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = factory.open(SAVE_DB_NAME);
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("saves", "readwrite");
      tx.objectStore("saves").put("pas un enregistrement", "2");
      tx.oncomplete = () => resolve();
    });
    db.close();
    expect(await store.get(2)).toBeNull();
    expect((await store.list()).map((e) => e.slot)).toEqual([1]);
  });

  describe("quota", () => {
    it("120 emplacements avec vignettes (≈ 12 Mo) s'écrivent sans erreur, là où localStorage échoue", async () => {
      const thumbs = Array.from({ length: 120 }, (_, i) => fakeThumbnail(100, i));

      // Référence : le même contenu dépasse un localStorage de 5 Mo.
      const small = createLocalSaveStore(createFakeStorage(5 * 1024 * 1024));
      let quotaError: unknown = null;
      try {
        for (let i = 0; i < 120; i++) await small.put(i + 1, record({ thumbnailUrl: thumbs[i]! }));
      } catch (err) {
        quotaError = err;
      }
      expect((quotaError as DOMException | null)?.name).toBe("QuotaExceededError");

      const store = createSaveStore({ indexedDB: factory, storage: null });
      for (let i = 0; i < 120; i++) await store.put(i + 1, record({ thumbnailUrl: thumbs[i]!, comment: `n${i + 1}` }));
      expect((await store.list()).length).toBe(120);
      for (const n of [1, 60, 120]) {
        expect(await store.get(n)).toMatchObject({ thumbnailUrl: thumbs[n - 1], comment: `n${n}` });
      }
    });

    it("un dépassement de quota IndexedDB rejette l'écriture et laisse l'ancien contenu intact", async () => {
      const store = createSaveStore({ indexedDB: factory, storage: null });
      await store.put(1, record({ previewText: "ancien", thumbnailUrl: "data:image/png;base64,QQ==" }));

      const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
        throw new DOMException("quota dépassé", "QuotaExceededError");
      });
      await expect(store.put(1, record({ previewText: "nouveau", thumbnailUrl: "data:image/png;base64,Wg==" }))).rejects.toMatchObject({
        name: "QuotaExceededError",
      });
      spy.mockRestore();

      expect(await store.get(1)).toMatchObject({ previewText: "ancien", thumbnailUrl: "data:image/png;base64,QQ==" });
      await store.put(1, record({ previewText: "après" })); // le magasin reste utilisable
      expect((await store.get(1))?.previewText).toBe("après");
    });

    it("un dépassement de quota du localStorage de repli rejette l'écriture sans corrompre le reste", async () => {
      const storage = createFakeStorage(2000);
      const store = createSaveStore({ indexedDB: null, storage });
      await store.put(1, record({ previewText: "petit" }));
      await expect(store.put(2, record({ thumbnailUrl: fakeThumbnail(10, 1) }))).rejects.toMatchObject({ name: "QuotaExceededError" });
      expect((await store.get(1))?.previewText).toBe("petit");
      expect(await store.get(2)).toBeNull();
    });
  });
});

describe("repli quand IndexedDB est indisponible", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retombe sur localStorage et relit les anciennes clés", async () => {
    const storage = createFakeStorage();
    storage.setItem("mahoyo.save.4", JSON.stringify(legacyRecord()));
    const store = createSaveStore({ indexedDB: null, storage });
    expect(await store.backend()).toBe("localstorage");
    expect(await store.migration()).toBeNull();
    expect(await store.get(4)).toMatchObject({ scriptFile: "1-1.ks", sceneTitle: "1-1.ks", comment: "", locked: false });
    await store.put(5, record());
    expect(storage.getItem("mahoyo.save.5")).not.toBeNull();
    expect(storage.getItem("mahoyo.save.4")).not.toBeNull(); // rien n'est déplacé en repli
  });

  it("retombe sur la mémoire quand aucun stockage n'existe, sans exception", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createSaveStore({ indexedDB: null, storage: null });
    expect(await store.backend()).toBe("memory");
    await store.put(1, record({ comment: "éphémère" }));
    expect((await store.get(1))?.comment).toBe("éphémère");
    expect(await store.list()).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it("retombe sur localStorage si l'ouverture lève, échoue ou ne répond jamais", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = createFakeStorage();
    const throwing = { open: () => { throw new DOMException("refusé", "SecurityError"); } } as unknown as IDBFactory;
    const failing = {
      open: () => {
        const req = {} as IDBOpenDBRequest;
        setTimeout(() => (req.onerror as (() => void) | null)?.(), 0);
        return req;
      },
    } as unknown as IDBFactory;
    const silent = { open: () => ({}) as IDBOpenDBRequest } as unknown as IDBFactory;
    for (const indexedDB of [throwing, failing, silent]) {
      const store = createSaveStore({ indexedDB, storage, openTimeoutMs: 30 });
      expect(await store.backend()).toBe("localstorage");
      await store.put(1, record({ comment: "ok" }));
      expect((await store.get(1))?.comment).toBe("ok");
    }
  });

  it("n'utilise pas de localStorage quand son accès lève (navigation privée stricte)", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("accès refusé", "SecurityError");
      },
    });
    try {
      expect(resolveLocalStorage()).toBeNull();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("list et get d'un localStorage qui lève renvoient du vide", async () => {
    const broken = {
      length: 1,
      key: () => {
        throw new Error("boom");
      },
      getItem: () => {
        throw new Error("boom");
      },
    } as unknown as Storage;
    const store = createLocalSaveStore(broken);
    expect(await store.list()).toEqual([]);
    expect(await store.get(1)).toBeNull();
  });
});

describe("migration localStorage → IndexedDB", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });
  afterEach(() => vi.restoreAllMocks());

  function seedLegacy(storage: Storage): Record<string, Record<string, unknown>> {
    const seeded = {
      "mahoyo.save.1": legacyRecord({ previewText: "un", thumbnailUrl: "data:image/webp;base64,AAAA" }),
      "mahoyo.save.12": legacyRecord({ previewText: "douze", comment: "déjà annoté", locked: true, choices: [{ from: "a", to: "b" }] }),
      "mahoyo.save.auto": legacyRecord({ scriptFile: "auto.ks" }),
      "mahoyo.save.quick": legacyRecord({ scriptFile: "quick.ks" }),
    };
    for (const [k, v] of Object.entries(seeded)) storage.setItem(k, JSON.stringify(v));
    storage.setItem("mahoyo.settings", '{"language":"fr"}'); // hors périmètre : doit rester
    return seeded;
  }

  it("retrouve les anciennes sauvegardes (titre, commentaire, verrou, choix, vignette) puis vide l'ancien stockage", async () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    const store = createSaveStore({ indexedDB: factory, storage });

    expect(await store.backend()).toBe("indexeddb");
    expect(await store.get(1)).toMatchObject({ previewText: "un", thumbnailUrl: "data:image/webp;base64,AAAA", sceneTitle: "1-1.ks", comment: "", locked: false, choices: [] });
    expect(await store.get(12)).toMatchObject({ comment: "déjà annoté", locked: true, choices: [{ from: "a", to: "b" }] });
    expect((await store.get("auto"))?.sceneTitle).toBe("auto.ks");
    expect((await store.get("quick"))?.scriptFile).toBe("quick.ks");

    const report = await store.migration();
    expect(report?.migrated).toHaveLength(4);
    expect(report?.kept).toEqual([]);
    expect([...Array(storage.length).keys()].map((i) => storage.key(i))).toEqual(["mahoyo.settings"]);
  });

  it("est idempotente : relancée, elle ne change rien et ne perd rien", async () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    const first = createSaveStore({ indexedDB: factory, storage });
    const before = (await first.list()).sort((a, b) => String(a.slot).localeCompare(String(b.slot)));

    const second = createSaveStore({ indexedDB: factory, storage });
    expect((await second.migration())?.migrated).toEqual([]);
    expect((await second.list()).sort((a, b) => String(a.slot).localeCompare(String(b.slot)))).toEqual(before);

    const direct = await migrateLocalSaves(createIndexedDbSaveStoreFor(factory), storage);
    expect(direct).toEqual({ migrated: [], alreadyPresent: [], kept: [], unreadable: [] });
  });

  it("reprend après une interruption (clés non retirées) sans doublon ni perte", async () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    storage.failRemove = true; // la copie réussit, le retrait échoue
    const first = createSaveStore({ indexedDB: factory, storage });
    expect((await first.migration())?.migrated).toHaveLength(4);
    expect(storage.length).toBe(5); // rien n'a été retiré

    storage.failRemove = false;
    const second = createSaveStore({ indexedDB: factory, storage });
    const report = await second.migration();
    expect(report?.alreadyPresent).toHaveLength(4);
    expect(report?.migrated).toEqual([]);
    expect(storage.length).toBe(1);
    expect((await second.list()).length).toBe(4);
  });

  it("ne supprime pas l'ancienne clé si l'écriture ne peut pas être vérifiée", async () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    // Cible qui accepte l'écriture mais ne la retient pas.
    const lossy: SaveStore = { ...createMemorySaveStore(), put: async () => {}, get: async () => null };
    const report = await migrateLocalSaves(lossy, storage);
    expect(report.migrated).toEqual([]);
    expect(report.kept).toHaveLength(4);
    expect(storage.length).toBe(5);
  });

  it("ne supprime pas l'ancienne clé quand l'écriture échoue (quota) et continue avec les suivantes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = createFakeStorage();
    seedLegacy(storage);
    const memory = createMemorySaveStore();
    const failFirst: SaveStore = {
      ...memory,
      put: async (slot, rec) => {
        if (slot === 1) throw new DOMException("quota", "QuotaExceededError");
        return memory.put(slot, rec);
      },
    };
    const report = await migrateLocalSaves(failFirst, storage);
    expect(report.kept).toEqual([1]);
    expect(report.migrated).toHaveLength(3);
    expect(storage.getItem("mahoyo.save.1")).not.toBeNull();
    expect(storage.getItem("mahoyo.save.12")).toBeNull();
  });

  it("n'écrase jamais une sauvegarde déjà présente dans IndexedDB et garde l'ancienne clé", async () => {
    const storage = createFakeStorage();
    storage.setItem("mahoyo.save.1", JSON.stringify(legacyRecord({ previewText: "ancien" })));
    const target = createIndexedDbSaveStoreFor(factory);
    await target.put(1, record({ previewText: "plus récent" }));
    const report = await migrateLocalSaves(target, storage);
    expect(report.kept).toEqual([1]);
    expect((await target.get(1))?.previewText).toBe("plus récent");
    expect(storage.getItem("mahoyo.save.1")).not.toBeNull();
  });

  it("laisse en place une clé illisible ou hors emplacement, sans exception", async () => {
    const storage = createFakeStorage();
    storage.setItem("mahoyo.save.3", "{pas du json");
    storage.setItem("mahoyo.save.abc", JSON.stringify(legacyRecord()));
    storage.setItem("mahoyo.save.4", JSON.stringify(legacyRecord()));
    const target = createMemorySaveStore();
    const report = await migrateLocalSaves(target, storage);
    expect(report.unreadable).toEqual(["mahoyo.save.3"]);
    expect(report.migrated).toEqual([4]);
    expect(storage.getItem("mahoyo.save.3")).toBe("{pas du json");
    expect(storage.getItem("mahoyo.save.abc")).not.toBeNull();
  });

  it("n'échoue pas si le localStorage lève pendant le parcours", async () => {
    const broken = {
      get length(): number {
        throw new Error("boom");
      },
    } as unknown as Storage;
    await expect(migrateLocalSaves(createMemorySaveStore(), broken)).resolves.toEqual({
      migrated: [],
      alreadyPresent: [],
      kept: [],
      unreadable: [],
    });
  });
});

/** Ouvre le magasin IndexedDB sur une fabrique, sans migration ni repli. */
function createIndexedDbSaveStoreFor(factory: IDBFactory): SaveStore {
  let ready: Promise<SaveStore> | null = null;
  const open = (): Promise<SaveStore> =>
    (ready ??= new Promise((resolve, reject) => {
      const req = factory.open(SAVE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("saves");
        req.result.createObjectStore("thumbnails");
      };
      req.onsuccess = () => resolve(createIndexedDbSaveStore(req.result));
      req.onerror = () => reject(req.error);
    }));
  return {
    list: async () => (await open()).list(),
    get: async (s) => (await open()).get(s),
    put: async (s, r) => (await open()).put(s, r),
    delete: async (s) => (await open()).delete(s),
    update: async (s, p) => (await open()).update(s, p),
  };
}
