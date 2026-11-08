import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "@/player/settings-store.js";

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
