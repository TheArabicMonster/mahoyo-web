import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createSaveStore } from "@/player/save-store-idb.js";
import {
  createLocalSaveStore,
  createMemorySaveStore,
  deriveSceneTitle,
  migrateSaveRecord,
  SaveLockedError,
  type SaveRecord,
  type SaveStore,
} from "@/player/save-store.js";

/** Storage en mémoire (le localStorage de jsdom n'est pas disponible sous cette configuration). */
function createFakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}
const memStorage = createFakeStorage();

/** Enregistrement tel qu'écrit avant HUD-11 : aucun des trois nouveaux champs. */
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

describe("deriveSceneTitle", () => {
  const scripts = [
    { file: "a.ks", label: "Premier script" },
    { file: "b.ks", label: "  " },
  ];
  it("utilise le libellé du sommaire local", () => {
    expect(deriveSceneTitle("a.ks", scripts)).toBe("Premier script");
  });
  it("retombe sur le nom du fichier si le script est inconnu ou sans libellé", () => {
    expect(deriveSceneTitle("zzz.ks", scripts)).toBe("zzz.ks");
    expect(deriveSceneTitle("b.ks", scripts)).toBe("b.ks");
  });
});

describe("migrateSaveRecord", () => {
  it("migre un enregistrement ancien sans perdre aucun champ existant", () => {
    const old = legacyRecord();
    const migrated = migrateSaveRecord(structuredClone(old));
    expect(migrated).toMatchObject(old);
    expect(migrated).toMatchObject({ sceneTitle: "1-1.ks", comment: "", locked: false });
  });

  it("conserve les nouveaux champs déjà présents", () => {
    const migrated = migrateSaveRecord(legacyRecord({ sceneTitle: "Titre", comment: "note", locked: true }));
    expect(migrated).toMatchObject({ sceneTitle: "Titre", comment: "note", locked: true });
  });

  it("remplace les valeurs de type invalide par les défauts", () => {
    const migrated = migrateSaveRecord(legacyRecord({ sceneTitle: 3, comment: null, locked: "oui" }));
    expect(migrated).toMatchObject({ sceneTitle: "1-1.ks", comment: "", locked: false });
  });

  it("ajoute un historique de choix vide aux anciennes sauvegardes", () => {
    expect(migrateSaveRecord(legacyRecord())).toMatchObject({ choices: [] });
  });

  it("conserve l'historique de choix et ne garde que des identifiants de scripts", () => {
    const migrated = migrateSaveRecord(
      legacyRecord({
        choices: [
          { from: "a-3", to: "c-1", label: "texte du jeu", extra: 1 },
          { from: "a-3", to: "c-1" },
          { from: "", to: "x" },
          { from: 3, to: "x" },
          "n'importe quoi",
        ],
      }),
    );
    expect(migrated?.choices).toEqual([{ from: "a-3", to: "c-1" }]);
    expect(JSON.stringify(migrated)).not.toContain("texte du jeu");
  });

  it("remplace un historique de choix invalide par une liste vide", () => {
    expect(migrateSaveRecord(legacyRecord({ choices: "oui" }))?.choices).toEqual([]);
    expect(migrateSaveRecord(legacyRecord({ choices: null }))?.choices).toEqual([]);
  });

  it("est idempotente", () => {
    const once = migrateSaveRecord(legacyRecord());
    expect(migrateSaveRecord(structuredClone(once))).toEqual(once);
  });

  it("rejette ce qui n'est pas un objet", () => {
    expect(migrateSaveRecord(null)).toBeNull();
    expect(migrateSaveRecord("x")).toBeNull();
    expect(migrateSaveRecord([])).toBeNull();
  });
});

describe.each([
  ["localStorage", () => createLocalSaveStore(memStorage)],
  ["mémoire", () => createMemorySaveStore()],
  ["IndexedDB", () => createSaveStore({ indexedDB: new IDBFactory(), storage: null })],
  ["repli localStorage", () => createSaveStore({ indexedDB: null, storage: memStorage })],
] as [string, () => SaveStore][])("SaveStore (%s)", (_name, make) => {
  let store: SaveStore;
  beforeEach(() => {
    memStorage.clear();
    store = make();
  });

  it("écrit puis relit les nouveaux champs", async () => {
    await store.put(1, record({ sceneTitle: "Titre", comment: "à revoir", locked: false }));
    expect(await store.get(1)).toMatchObject({ sceneTitle: "Titre", comment: "à revoir", locked: false });
  });

  it("renvoie null pour un emplacement vide", async () => {
    expect(await store.get(9)).toBeNull();
  });

  it("list renvoie les emplacements occupés avec leur enregistrement", async () => {
    expect(await store.list()).toEqual([]);
    await store.put(3, record({ comment: "trois" }));
    await store.put("auto", record({ comment: "auto" }));
    await store.put("quick", record({ locked: true }));
    const entries = (await store.list()).sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
    expect(entries.map((e) => e.slot)).toEqual([3, "auto", "quick"]);
    expect(entries.find((e) => e.slot === 3)?.record).toEqual(record({ comment: "trois" }));
    expect(entries.find((e) => e.slot === "quick")?.record.locked).toBe(true);
  });

  it("conserve la vignette, le commentaire, le verrou et les choix à l'aller-retour", async () => {
    const full = record({
      thumbnailUrl: "data:image/webp;base64,AAAA",
      comment: "note",
      locked: true,
      choices: [{ from: "a-1", to: "b-1" }],
    });
    await store.put(7, full);
    expect(await store.get(7)).toEqual(full);
  });

  it("update modifie commentaire et verrou sans toucher au reste", async () => {
    const original = record();
    await store.put(2, original);
    expect(await store.update(2, { comment: "ma note", locked: true })).toBe(true);
    expect(await store.get(2)).toEqual({ ...original, comment: "ma note", locked: true });
  });

  it("update renvoie false sur un emplacement vide", async () => {
    expect(await store.update(3, { locked: true })).toBe(false);
    expect(await store.get(3)).toBeNull();
  });

  it("refuse d'écraser un emplacement verrouillé et conserve l'ancien contenu", async () => {
    await store.put(1, record({ previewText: "ancien" }));
    await store.update(1, { locked: true });
    await expect(store.put(1, record({ previewText: "nouveau" }))).rejects.toBeInstanceOf(SaveLockedError);
    expect((await store.get(1))?.previewText).toBe("ancien");
  });

  it("refuse de supprimer un emplacement verrouillé", async () => {
    await store.put(1, record());
    await store.update(1, { locked: true });
    await expect(store.delete(1)).rejects.toBeInstanceOf(SaveLockedError);
    expect(await store.get(1)).not.toBeNull();
  });

  it("autorise l'écrasement et la suppression après déverrouillage", async () => {
    await store.put(1, record({ previewText: "ancien" }));
    await store.update(1, { locked: true });
    await store.update(1, { locked: false });
    await store.put(1, record({ previewText: "nouveau" }));
    expect((await store.get(1))?.previewText).toBe("nouveau");
    await store.delete(1);
    expect(await store.get(1)).toBeNull();
  });

  it("autorise de modifier le commentaire d'un emplacement verrouillé", async () => {
    await store.put(1, record());
    await store.update(1, { locked: true });
    await store.update(1, { comment: "toujours modifiable" });
    expect(await store.get(1)).toMatchObject({ comment: "toujours modifiable", locked: true });
  });
});

describe("createLocalSaveStore : sauvegardes existantes", () => {
  beforeEach(() => memStorage.clear());

  it("charge une ancienne sauvegarde stockée sous mahoyo.save.<slot> sans erreur", async () => {
    const old = legacyRecord();
    memStorage.setItem("mahoyo.save.4", JSON.stringify(old));
    memStorage.setItem("mahoyo.save.auto", JSON.stringify(legacyRecord({ scriptFile: "auto.ks" })));
    const store = createLocalSaveStore(memStorage);

    const loaded = await store.get(4);
    expect(loaded).toMatchObject(old);
    expect(loaded).toMatchObject({ sceneTitle: "1-1.ks", comment: "", locked: false });
    expect((await store.get("auto"))?.sceneTitle).toBe("auto.ks");
  });

  it("une ancienne sauvegarde reste écrasable et supprimable (non verrouillée)", async () => {
    memStorage.setItem("mahoyo.save.4", JSON.stringify(legacyRecord()));
    const store = createLocalSaveStore(memStorage);
    await store.put(4, record({ previewText: "neuf" }));
    expect((await store.get(4))?.previewText).toBe("neuf");
    await store.delete(4);
    expect(memStorage.getItem("mahoyo.save.4")).toBeNull();
  });

  it("ne réécrit pas le stockage à la simple lecture", async () => {
    const raw = JSON.stringify(legacyRecord());
    memStorage.setItem("mahoyo.save.4", raw);
    await createLocalSaveStore(memStorage).get(4);
    expect(memStorage.getItem("mahoyo.save.4")).toBe(raw);
  });

  it("traite un JSON corrompu comme un emplacement vide", async () => {
    memStorage.setItem("mahoyo.save.5", "{pas du json");
    expect(await createLocalSaveStore(memStorage).get(5)).toBeNull();
  });

  it("respecte un verrou écrit dans le stockage", async () => {
    memStorage.setItem("mahoyo.save.6", JSON.stringify(legacyRecord({ locked: true })));
    const store = createLocalSaveStore(memStorage);
    await expect(store.put(6, record())).rejects.toBeInstanceOf(SaveLockedError);
    await expect(store.delete(6)).rejects.toBeInstanceOf(SaveLockedError);
  });
});
