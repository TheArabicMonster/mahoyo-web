import { describe, it, expect } from "vitest";
import { parseLanguageIndex, hasTranslation, isGameLanguage } from "@/core/language.js";

const validIndex = {
  version: 1,
  language: "fr",
  label: "Français",
  credits: "Moon-Trad",
  scripts: ["1-0.ks", "5a-10.ks"],
  strict: ["1-0.ks"],
  skipped: [{ file: "bad.ks", reason: "incompatible" }],
};

describe("language", () => {
  it("parseLanguageIndex accepte un index valide", () => {
    const parsed = parseLanguageIndex(validIndex);
    expect(parsed).not.toBeNull();
    expect(parsed?.language).toBe("fr");
    expect(parsed?.scripts).toEqual(["1-0.ks", "5a-10.ks"]);
  });

  it("parseLanguageIndex refuse une version incorrecte", () => {
    expect(parseLanguageIndex({ ...validIndex, version: 2 })).toBeNull();
  });

  it("parseLanguageIndex refuse un champ language invalide", () => {
    expect(parseLanguageIndex({ ...validIndex, language: 123 })).toBeNull();
  });

  it("parseLanguageIndex refuse un scripts non tableau", () => {
    expect(parseLanguageIndex({ ...validIndex, scripts: "oops" })).toBeNull();
  });

  it("hasTranslation retourne true si le fichier est dans l'index", () => {
    expect(hasTranslation(parseLanguageIndex(validIndex), "1-0.ks")).toBe(true);
    expect(hasTranslation(parseLanguageIndex(validIndex), "5A-10.KS")).toBe(true);
    expect(hasTranslation(parseLanguageIndex(validIndex), "missing.ks")).toBe(false);
  });

  it("hasTranslation retourne false si l'index est null", () => {
    expect(hasTranslation(null, "1-0.ks")).toBe(false);
  });

  it("isGameLanguage valide les codes de langue", () => {
    expect(isGameLanguage("ja")).toBe(true);
    expect(isGameLanguage("en")).toBe(true);
    expect(isGameLanguage("fr")).toBe(true);
    expect(isGameLanguage("de")).toBe(false);
    expect(isGameLanguage(42)).toBe(false);
  });
});
