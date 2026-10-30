import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "@/player/settings-store.js";

describe("mergeSettings", () => {
  it("conserve la langue par défaut", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {});
    expect(merged.language).toBe("ja");
  });

  it("accepte fr", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { language: "fr" });
    expect(merged.language).toBe("fr");
  });

  it("accepte en", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { language: "en" });
    expect(merged.language).toBe("en");
  });

  it("retombe sur ja si la langue est inconnue", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { language: "de" as never });
    expect(merged.language).toBe("ja");
  });

  it("retombe sur ja si la langue est invalide dans le store", () => {
    const stored = { ...DEFAULT_SETTINGS, language: "xx" as never };
    const merged = mergeSettings(DEFAULT_SETTINGS, stored);
    expect(merged.language).toBe("ja");
  });
});
