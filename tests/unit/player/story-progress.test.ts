import { describe, it, expect } from "vitest";
import {
  createLocalSettingsStore,
  createMemorySettingsStore,
  DEFAULT_SETTINGS,
  mergeSettings,
} from "@/player/settings-store.js";
import {
  emptyStoryProgress,
  markFinished,
  markVisited,
  mergeStoryProgress,
  normalizeStoryProgress,
  recordChoice,
  recordEnding,
} from "@/player/story-progress.js";

/** Storage minimal en mémoire, avec options de panne. */
function fakeStorage(init: Record<string, string> = {}, opts: { throwOnGet?: boolean } = {}): Storage {
  const data = new Map(Object.entries(init));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => {
      if (opts.throwOnGet) throw new Error("SecurityError");
      return data.get(k) ?? null;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("fonctions de progression par scène", () => {
  it("part d'une progression vide", () => {
    expect(emptyStoryProgress()).toEqual({ visited: [], finished: [], choices: [], endings: [] });
  });

  it("markVisited ajoute sans doublon et sans muter", () => {
    const p0 = emptyStoryProgress();
    const p1 = markVisited(p0, "s01");
    expect(p1.visited).toEqual(["s01"]);
    expect(p0.visited).toEqual([]);
    expect(markVisited(p1, "s01")).toBe(p1);
  });

  it("markFinished marque aussi le script comme visité", () => {
    const p = markFinished(emptyStoryProgress(), "s01");
    expect(p.finished).toEqual(["s01"]);
    expect(p.visited).toEqual(["s01"]);
  });

  it("recordChoice enregistre l'arête sans doublon", () => {
    const p1 = recordChoice(emptyStoryProgress(), "s01", "s02");
    expect(p1.choices).toEqual([{ from: "s01", to: "s02" }]);
    expect(recordChoice(p1, "s01", "s02")).toBe(p1);
    expect(recordChoice(p1, "s01", "s03").choices).toHaveLength(2);
  });

  it("recordEnding marque la fin et le script visité", () => {
    const p = recordEnding(emptyStoryProgress(), "end_a");
    expect(p.endings).toEqual(["end_a"]);
    expect(p.visited).toEqual(["end_a"]);
  });

  it("ignore les identifiants vides", () => {
    const p = emptyStoryProgress();
    expect(markVisited(p, "")).toBe(p);
    expect(recordChoice(p, "", "s02")).toBe(p);
  });

  it("mergeStoryProgress fait l'union sans doublon", () => {
    const a = recordChoice(markVisited(emptyStoryProgress(), "a"), "a", "b");
    const b = recordChoice(markVisited(emptyStoryProgress(), "b"), "a", "b");
    const m = mergeStoryProgress(a, b);
    expect(m.visited).toEqual(["a", "b"]);
    expect(m.choices).toEqual([{ from: "a", to: "b" }]);
  });
});

describe("normalizeStoryProgress (migration et données douteuses)", () => {
  it.each([[null], [undefined], ["texte"], [42], [[]], [true]])("valeur %j -> progression vide", (raw) => {
    expect(normalizeStoryProgress(raw)).toEqual(emptyStoryProgress());
  });

  it("données anciennes (objet sans les champs) -> champs vides", () => {
    expect(normalizeStoryProgress({ completed: ["ch1"] })).toEqual(emptyStoryProgress());
  });

  it("données partielles -> champs absents vides, présents conservés", () => {
    expect(normalizeStoryProgress({ visited: ["a", "b"] })).toEqual({
      visited: ["a", "b"],
      finished: [],
      choices: [],
      endings: [],
    });
  });

  it("écarte les éléments de mauvais type et les doublons", () => {
    const p = normalizeStoryProgress({
      visited: ["a", 3, null, "a", ""],
      finished: "pas une liste",
      choices: [{ from: "a", to: "b" }, { from: "a" }, null, "x", { from: 1, to: 2 }, { from: "a", to: "b" }],
      endings: [{}, "end"],
    });
    expect(p).toEqual({
      visited: ["a"],
      finished: [],
      choices: [{ from: "a", to: "b" }],
      endings: ["end"],
    });
  });

  it("ne conserve aucun champ inconnu, dont un éventuel libellé de choix", () => {
    const p = normalizeStoryProgress({
      choices: [{ from: "a", to: "b", label: "Texte du libellé", text: "x" }],
      extra: "libellé",
    });
    expect(p.choices).toEqual([{ from: "a", to: "b" }]);
    expect(Object.keys(p).sort()).toEqual(["choices", "endings", "finished", "visited"]);
    expect(Object.keys(p.choices[0]!).sort()).toEqual(["from", "to"]);
  });
});

describe("persistance localStorage de la progression par scène", () => {
  it("lit une progression vide si la clé est absente", async () => {
    const store = createLocalSettingsStore(fakeStorage());
    expect(await store.loadStoryProgress()).toEqual(emptyStoryProgress());
  });

  it("écrit puis relit l'état (aller-retour)", async () => {
    const storage = fakeStorage();
    let p = emptyStoryProgress();
    p = markFinished(markVisited(p, "s01"), "s01");
    p = recordChoice(p, "s01", "s02");
    p = recordEnding(p, "end_a");
    await createLocalSettingsStore(storage).saveStoryProgress(p);
    expect(await createLocalSettingsStore(storage).loadStoryProgress()).toEqual(p);
  });

  it("utilise le préfixe mahoyo.* et ne touche pas aux clés existantes", async () => {
    const storage = fakeStorage();
    const store = createLocalSettingsStore(storage);
    await store.saveProgress({ completed: ["ch1"] });
    await store.saveRead(new Set(["s01:3"]));
    await store.saveStoryProgress(markVisited(emptyStoryProgress(), "s01"));
    expect(storage.getItem("mahoyo.story-progress")).not.toBeNull();
    expect(await store.loadProgress()).toEqual({ completed: ["ch1"] });
    expect([...(await store.loadRead())]).toEqual(["s01:3"]);
  });

  it("le déjà lu et la progression par chapitre existants restent lisibles sans progression par scène", async () => {
    const storage = fakeStorage({
      "mahoyo.read": JSON.stringify(["s01:0", "s01:1"]),
      "mahoyo.progress": JSON.stringify({ completed: ["ch1", "ch2"] }),
    });
    const store = createLocalSettingsStore(storage);
    expect([...(await store.loadRead())]).toEqual(["s01:0", "s01:1"]);
    expect(await store.loadProgress()).toEqual({ completed: ["ch1", "ch2"] });
    expect(await store.loadStoryProgress()).toEqual(emptyStoryProgress());
  });

  it("tolère un JSON corrompu", async () => {
    const store = createLocalSettingsStore(fakeStorage({ "mahoyo.story-progress": "{pas du json" }));
    expect(await store.loadStoryProgress()).toEqual(emptyStoryProgress());
  });

  it("tolère un stockage inaccessible en lecture", async () => {
    const store = createLocalSettingsStore(fakeStorage({}, { throwOnGet: true }));
    expect(await store.loadStoryProgress()).toEqual(emptyStoryProgress());
  });

  it("tolère des données partielles persistées", async () => {
    const store = createLocalSettingsStore(
      fakeStorage({ "mahoyo.story-progress": JSON.stringify({ endings: ["end_a"] }) }),
    );
    expect(await store.loadStoryProgress()).toEqual({ visited: [], finished: [], choices: [], endings: ["end_a"] });
  });

  it("n'écrit aucun libellé de choix dans la valeur persistée", async () => {
    const storage = fakeStorage();
    const store = createLocalSettingsStore(storage);
    const label = "Libellé secret du choix";
    // Un appelant qui passerait un objet enrichi (libellé) ne doit rien persister de plus.
    const polluted = {
      visited: ["s01"],
      finished: [],
      choices: [{ from: "s01", to: "s02", label }],
      endings: [],
      label,
    } as never;
    await store.saveStoryProgress(polluted);
    const raw = storage.getItem("mahoyo.story-progress")!;
    expect(raw).not.toContain(label);
    expect(JSON.parse(raw)).toEqual({
      visited: ["s01"],
      finished: [],
      choices: [{ from: "s01", to: "s02" }],
      endings: [],
    });
  });

  it("le store mémoire se comporte de la même façon (copie défensive)", async () => {
    const store = createMemorySettingsStore();
    expect(await store.loadStoryProgress()).toEqual(emptyStoryProgress());
    const p = recordChoice(markVisited(emptyStoryProgress(), "s01"), "s01", "s02");
    await store.saveStoryProgress(p);
    const loaded = await store.loadStoryProgress();
    expect(loaded).toEqual(p);
    expect(loaded).not.toBe(p);
  });
});

describe("flowchartRevealAll", () => {
  it("vaut false par défaut", () => {
    expect(DEFAULT_SETTINGS.flowchartRevealAll).toBe(false);
    expect(mergeSettings(DEFAULT_SETTINGS, {}).flowchartRevealAll).toBe(false);
  });

  it("survit à mergeSettings (patch et base)", () => {
    const on = mergeSettings(DEFAULT_SETTINGS, { flowchartRevealAll: true });
    expect(on.flowchartRevealAll).toBe(true);
    // Un patch sans le champ (autre réglage modifié) conserve la valeur de la base.
    expect(mergeSettings(on, { skipUnread: true }).flowchartRevealAll).toBe(true);
    expect(mergeSettings(on, { flowchartRevealAll: false }).flowchartRevealAll).toBe(false);
  });

  it("retombe sur false si la valeur est invalide ou absente de la base", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { flowchartRevealAll: "oui" as never }).flowchartRevealAll).toBe(false);
    const oldBase = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete oldBase.flowchartRevealAll;
    expect(mergeSettings(oldBase as never, {}).flowchartRevealAll).toBe(false);
  });

  it("migration : d'anciens réglages sans le champ donnent false et gardent le reste", async () => {
    const legacy = { ...DEFAULT_SETTINGS, language: "en", skipUnread: true } as Partial<typeof DEFAULT_SETTINGS>;
    delete legacy.flowchartRevealAll;
    const store = createLocalSettingsStore(fakeStorage({ "mahoyo.settings": JSON.stringify(legacy) }));
    const loaded = await store.loadSettings();
    expect(loaded.flowchartRevealAll).toBe(false);
    expect(loaded.language).toBe("en");
    expect(loaded.skipUnread).toBe(true);
  });

  it("survit à l'enregistrement et au rechargement", async () => {
    const storage = fakeStorage();
    const store = createLocalSettingsStore(storage);
    await store.saveSettings(mergeSettings(DEFAULT_SETTINGS, { flowchartRevealAll: true }));
    expect((await createLocalSettingsStore(storage).loadSettings()).flowchartRevealAll).toBe(true);
  });

  it("réglages absents ou corrompus : valeurs par défaut", async () => {
    expect((await createLocalSettingsStore(fakeStorage()).loadSettings()).flowchartRevealAll).toBe(false);
    const bad = createLocalSettingsStore(fakeStorage({ "mahoyo.settings": "{oups" }));
    expect((await bad.loadSettings()).flowchartRevealAll).toBe(false);
  });
});
