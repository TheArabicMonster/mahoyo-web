import { describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createSaveStore } from "@/player/save-store-idb.js";
import { createMemorySaveStore, type SaveRecord, type SaveStore } from "@/player/save-store.js";
import {
  exportSaves,
  importSaves,
  importSavesFromText,
  parseSaveExport,
  serializeSaveExport,
  type ProgressAccess,
} from "@/player/save-transfer.js";
import { emptyStoryProgress } from "@/player/story-progress.js";
import type { SlotId, StoryProgress } from "@/ui/types.js";

function record(overrides: Partial<SaveRecord> = {}): SaveRecord {
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
    sceneTitle: "Scène",
    comment: "",
    locked: false,
    choices: [],
    ...overrides,
  } as unknown as SaveRecord;
}

function progressStore(initial: StoryProgress = emptyStoryProgress()): ProgressAccess & { current: StoryProgress } {
  const box = { current: initial };
  return {
    get current() {
      return box.current;
    },
    set current(v) {
      box.current = v;
    },
    loadStoryProgress: async () => box.current,
    saveStoryProgress: async (p) => {
      box.current = structuredClone(p) as StoryProgress;
    },
  };
}

const sortedList = async (store: SaveStore) =>
  (await store.list()).sort((a, b) => String(a.slot).localeCompare(String(b.slot), "en", { numeric: true }));

describe("export / import JSON", () => {
  it("aller-retour à l'identique : 120 emplacements, verrou, commentaire, choix, vignette et progression", async () => {
    const source = createSaveStore({ indexedDB: new IDBFactory(), storage: null });
    for (let n = 1; n <= 120; n++) {
      await source.put(
        n,
        record({
          comment: n % 7 === 0 ? `note ${n}` : "",
          locked: n % 10 === 0,
          choices: n % 3 === 0 ? [{ from: `a-${n}`, to: `b-${n}` }] : [],
          thumbnailUrl: `data:image/webp;base64,${"A".repeat(2000)}`,
          previewText: `scène ${n}`,
        }),
      );
    }
    await source.put("auto", record({ sceneTitle: "Auto" }));
    await source.put("quick", record({ sceneTitle: "Rapide", locked: true }));
    const progress = progressStore({
      visited: ["1-0", "1-1"],
      finished: ["1-0"],
      choices: [{ from: "1-1", to: "1-2" }],
      endings: [],
    });

    const text = serializeSaveExport(await exportSaves(source, progress));

    const target = createSaveStore({ indexedDB: new IDBFactory(), storage: null });
    const targetProgress = progressStore();
    const result = await importSavesFromText(target, text, targetProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.imported).toHaveLength(122);
    expect(result.report.skippedLocked).toEqual([]);
    expect(result.report.invalid).toBe(0);
    expect(result.report.progressMerged).toBe(true);
    expect(await sortedList(target)).toEqual(await sortedList(source));
    expect(targetProgress.current).toEqual(progress.current);

    // Un second export de la cible est identique (hors date) : l'aller-retour est stable.
    const again = await exportSaves(target, targetProgress);
    const original = await exportSaves(source, progress);
    expect({ ...again, exportedAt: "" }).toEqual({ ...original, exportedAt: "" });
  });

  it("l'export est trié (auto, rapide, puis numéros) et porte format et version", async () => {
    const store = createMemorySaveStore();
    await store.put(10, record());
    await store.put(2, record());
    await store.put("quick", record());
    await store.put("auto", record());
    const data = await exportSaves(store, undefined, () => new Date("2026-01-02T03:04:05Z"));
    expect(data).toMatchObject({ format: "mahoyo-saves", version: 1, exportedAt: "2026-01-02T03:04:05.000Z" });
    expect(data.saves.map((s) => s.slot)).toEqual(["auto", "quick", 2, 10]);
    expect(data.storyProgress).toEqual(emptyStoryProgress());
  });

  it("n'écrase pas un emplacement verrouillé et le rapporte ; écrase les autres", async () => {
    const source = createMemorySaveStore();
    await source.put(1, record({ previewText: "importé 1" }));
    await source.put(2, record({ previewText: "importé 2" }));
    await source.put(3, record({ previewText: "importé 3" }));
    const text = serializeSaveExport(await exportSaves(source));

    const target = createSaveStore({ indexedDB: new IDBFactory(), storage: null });
    await target.put(1, record({ previewText: "local verrouillé", locked: true, comment: "précieux" }));
    await target.put(2, record({ previewText: "local libre" }));

    const result = await importSavesFromText(target, text);
    expect(result.ok && result.report).toMatchObject({
      imported: [2, 3],
      overwritten: [2],
      skippedLocked: [1],
      failed: [],
    });
    expect(await target.get(1)).toMatchObject({ previewText: "local verrouillé", comment: "précieux", locked: true });
    expect((await target.get(2))?.previewText).toBe("importé 2");
    expect((await target.get(3))?.previewText).toBe("importé 3");
  });

  it("un emplacement importé verrouillé reste verrouillé", async () => {
    const source = createMemorySaveStore();
    await source.put(1, record({ locked: true, comment: "c" }));
    const target = createMemorySaveStore();
    await importSavesFromText(target, serializeSaveExport(await exportSaves(source)));
    expect(await target.get(1)).toMatchObject({ locked: true, comment: "c" });
  });

  it("fusionne la progression avec celle de l'appareil au lieu de la remplacer", async () => {
    const source = progressStore({ visited: ["a", "b"], finished: ["a"], choices: [{ from: "a", to: "b" }], endings: ["z"] });
    const text = serializeSaveExport(await exportSaves(createMemorySaveStore(), source));
    const local = progressStore({ visited: ["c"], finished: [], choices: [{ from: "c", to: "d" }], endings: [] });
    await importSavesFromText(createMemorySaveStore(), text, local);
    expect(local.current).toEqual({
      visited: ["c", "a", "b"],
      finished: ["a"],
      choices: [
        { from: "c", to: "d" },
        { from: "a", to: "b" },
      ],
      endings: ["z"],
    });
  });

  it("ignore les entrées invalides sans interrompre l'import et les compte", async () => {
    const good = record({ previewText: "bon" });
    const file = JSON.stringify({
      format: "mahoyo-saves",
      version: 1,
      saves: [
        { slot: 1, record: good },
        { slot: 0, record: good },
        { slot: -2, record: good },
        { slot: 1.5, record: good },
        { slot: "4", record: good },
        { slot: "autre", record: good },
        { slot: 2, record: { scriptFile: "x.ks" } },
        { slot: 3, record: "texte" },
        { slot: 5 },
        "n'importe quoi",
        null,
      ],
    });
    const target = createMemorySaveStore();
    const result = await importSavesFromText(target, file);
    expect(result.ok && result.report.imported).toEqual([1]);
    expect(result.ok && result.report.invalid).toBe(10);
    expect((await target.list()).map((e) => e.slot)).toEqual([1]);
  });

  it("une vignette qui n'est pas une data-URL d'image est retirée (aucune URL externe importée)", async () => {
    const file = JSON.stringify({
      format: "mahoyo-saves",
      version: 1,
      saves: [
        { slot: 1, record: record({ thumbnailUrl: "https://exemple.invalid/pixel.png" }) },
        { slot: 2, record: record({ thumbnailUrl: "javascript:alert(1)" }) },
        { slot: 3, record: record({ thumbnailUrl: "data:text/html;base64,AAAA" }) },
        { slot: 4, record: record({ thumbnailUrl: "data:image/webp;base64,AAAA" }) },
      ],
    });
    const target = createMemorySaveStore();
    await importSavesFromText(target, file);
    expect((await target.get(1))?.thumbnailUrl).toBeNull();
    expect((await target.get(2))?.thumbnailUrl).toBeNull();
    expect((await target.get(3))?.thumbnailUrl).toBeNull();
    expect((await target.get(4))?.thumbnailUrl).toBe("data:image/webp;base64,AAAA");
  });

  it("complète les métadonnées d'un export fait à la main (migration à l'import)", async () => {
    const legacy = record() as unknown as Record<string, unknown>;
    delete legacy.sceneTitle;
    delete legacy.comment;
    delete legacy.locked;
    delete legacy.choices;
    const target = createMemorySaveStore();
    await importSavesFromText(target, JSON.stringify({ format: "mahoyo-saves", version: 1, saves: [{ slot: 1, record: legacy }] }));
    expect(await target.get(1)).toMatchObject({ sceneTitle: "1-1.ks", comment: "", locked: false, choices: [] });
  });

  it("rejette un fichier illisible ou d'une autre version, sans exception", () => {
    expect(parseSaveExport("{pas du json")).toEqual({ ok: false, reason: "unreadable" });
    expect(parseSaveExport("[]")).toEqual({ ok: false, reason: "unreadable" });
    expect(parseSaveExport('{"format":"autre","version":1,"saves":[]}')).toEqual({ ok: false, reason: "unreadable" });
    expect(parseSaveExport('{"format":"mahoyo-saves","version":2,"saves":[]}')).toEqual({ ok: false, reason: "unsupported" });
  });

  it("un fichier sans sauvegarde importe zéro emplacement", async () => {
    const result = await importSavesFromText(createMemorySaveStore(), '{"format":"mahoyo-saves","version":1,"saves":[]}');
    expect(result.ok && result.report.imported).toEqual([]);
  });

  it("signale les emplacements dont l'écriture échoue et poursuit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const source = createMemorySaveStore();
    for (const n of [1, 2, 3]) await source.put(n, record({ previewText: `s${n}` }));
    const text = serializeSaveExport(await exportSaves(source));
    const memory = createMemorySaveStore();
    const full: SaveStore = {
      ...memory,
      put: async (slot, rec) => {
        if (slot === 2) throw new DOMException("quota", "QuotaExceededError");
        return memory.put(slot, rec);
      },
    };
    const result = await importSavesFromText(full, text);
    expect(result.ok && result.report).toMatchObject({ imported: [1, 3], failed: [2] });
  });

  it("une progression inaccessible n'empêche pas l'import des sauvegardes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken: ProgressAccess = {
      loadStoryProgress: async () => {
        throw new Error("stockage inaccessible");
      },
      saveStoryProgress: async () => {
        throw new Error("stockage inaccessible");
      },
    };
    const target = createMemorySaveStore();
    const text = serializeSaveExport({
      ...(await exportSaves(createMemorySaveStore())),
      saves: [{ slot: 1 as SlotId, record: record() }],
    });
    const result = await importSavesFromText(target, text, broken);
    expect(result.ok && result.report).toMatchObject({ imported: [1], progressMerged: false });
    expect(await target.get(1)).not.toBeNull();
  });
});
