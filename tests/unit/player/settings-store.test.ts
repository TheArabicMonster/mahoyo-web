import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  createLocalSettingsStore,
  createMemorySettingsStore,
  mergeSettings,
  normalizeSeenCg,
} from "@/player/settings-store.js";

describe("mergeSettings", () => {
  it("conserve la langue par défaut", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {});
    expect(merged.language).toBe("fr");
  });

  it("accepte fr", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { language: "fr" });
    expect(merged.language).toBe("fr");
  });

  it("accepte en", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { language: "en" });
    expect(merged.language).toBe("en");
  });

  it("garde la langue de base si la langue est inconnue", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { language: "de" as never });
    expect(merged.language).toBe("fr");
  });

  it("garde la langue par défaut si la langue est invalide dans le store", () => {
    const stored = { ...DEFAULT_SETTINGS, language: "xx" as never };
    const merged = mergeSettings(DEFAULT_SETTINGS, stored);
    expect(merged.language).toBe("fr");
  });

  it("migre les anciens réglages textSpeed/autoDelay (#177)", () => {
    const legacy = {
      display: { textSpeed: 40, autoDelay: 500, fontScale: 1, textboxOpacity: 0.8 },
      audio: { master: 1, bgm: 0.8, se: 0.8, voice: 1, muted: false },
      skipUnread: false,
      language: "fr",
    } as never;
    const merged = mergeSettings(DEFAULT_SETTINGS, legacy);
    expect(merged.display.textSpeedUnread).toBe(40);
    expect(merged.display.textSpeedRead).toBe(30);
    expect(merged.display.autoPageDelay).toBe(500);
    expect(merged.display.autoLineDelay).toBe(500);
    expect(merged.audio.system).toBe(DEFAULT_SETTINGS.audio.system);
    expect(merged.audio.bgmMuted).toBe(false);
    expect(merged.display.fullscreenMode).toBe("fit");
  });

  it("fusionne les raccourcis action par action", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      shortcuts: { saveMenu: ["x"] } as never,
    });
    expect(merged.shortcuts.saveMenu).toEqual(["x"]);
    expect(merged.shortcuts.loadMenu).toEqual(DEFAULT_SETTINGS.shortcuts.loadMenu);
  });
});

/** Storage minimal en mémoire (même rôle que localStorage dans les tests). */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  } as Storage;
}

describe("progression CG vue (HUD-15, #208)", () => {
  it("persiste et relit l'ensemble des clés de CG vues", async () => {
    const storage = fakeStorage();
    const store = createLocalSettingsStore(storage, "test.");
    await store.saveSeenCg(new Set(["cg01", "bg_a"]));
    expect(JSON.parse(storage.getItem("test.cg")!)).toEqual(["cg01", "bg_a"]);
    expect(await createLocalSettingsStore(storage, "test.").loadSeenCg()).toEqual(new Set(["cg01", "bg_a"]));
  });

  it("ignore une donnée corrompue, non-tableau ou non textuelle", async () => {
    const storage = fakeStorage();
    const store = createLocalSettingsStore(storage, "test.");
    storage.setItem("test.cg", "{oops");
    expect(await store.loadSeenCg()).toEqual(new Set());
    storage.setItem("test.cg", JSON.stringify({ cg01: true }));
    expect(await store.loadSeenCg()).toEqual(new Set());
    storage.setItem("test.cg", JSON.stringify([1, null, "", "  ", "cg01", "cg01"]));
    expect(await store.loadSeenCg()).toEqual(new Set(["cg01"]));
  });

  it("normalise une valeur inconnue sans lever", () => {
    expect(normalizeSeenCg(undefined)).toEqual(new Set());
    expect(normalizeSeenCg("cg01")).toEqual(new Set());
    expect(normalizeSeenCg(["a", 3, "b"])).toEqual(new Set(["a", "b"]));
  });

  it("store en mémoire : copie défensive (l'ensemble rendu n'est pas modifiable de l'extérieur)", async () => {
    const store = createMemorySettingsStore();
    await store.saveSeenCg(new Set(["cg01"]));
    const loaded = await store.loadSeenCg();
    loaded.add("cg02");
    expect(await store.loadSeenCg()).toEqual(new Set(["cg01"]));
  });
});
