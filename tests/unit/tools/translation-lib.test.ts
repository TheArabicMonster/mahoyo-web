import { describe, it, expect } from "vitest";
import {
  compareScripts,
  installTranslation,
  parseTranslationScript,
  decodeTranslationScript,
} from "../../../tools/translation-lib.js";

function makeOriginal(text: string) {
  return parseTranslationScript(text);
}

function makeTranslated(text: string) {
  return parseTranslationScript(text);
}

describe("translation-lib", () => {
  it("juge strict quand les scripts sont identiques", () => {
    const text = "*start|\nPremier texte.[l][r]\n@bg storage=room time=500\nSecond texte.[p]\n";
    const original = makeOriginal(text);
    const translated = makeTranslated(text);
    const report = compareScripts(original, translated, "t.ks");
    expect(report.level).toBe("strict");
    expect(report.installable).toBe(true);
    expect(report.reason).toBeNull();
  });

  it("juge compatible quand les breaks texte diffèrent mais pas le squelette", () => {
    const originalText = "*start|\nTexte A.\n@r\nTexte B.[p]\n";
    const translatedText = "*start|\nTexte A. Texte B.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.level).toBe("compatible");
    expect(report.installable).toBe(true);
  });

  it("juge incompatible quand le nombre de pages diffère", () => {
    const originalText = "*start|\nTexte.[p]\nSuite.[p]\n";
    const translatedText = "*start|\nTexte.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.level).toBe("incompatible");
    expect(report.installable).toBe(false);
    expect(report.reason).toContain("pages");
  });

  it("juge incompatible quand les labels diffèrent", () => {
    const originalText = "*start|\nTexte.[p]\n*next|\nSuite.[p]\n";
    const translatedText = "*start|\nTexte.[p]\n*different|\nSuite.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.level).toBe("incompatible");
    expect(report.installable).toBe(false);
    expect(report.reason).toContain("label");
  });

  it("juge incompatible quand une commande est ajoutée", () => {
    const originalText = "*start|\nTexte.[p]\n";
    const translatedText = "*start|\nTexte.\n@bg storage=room time=500\n[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.level).toBe("incompatible");
    expect(report.installable).toBe(false);
  });

  it("juge incompatible quand une commande de flux change de cible", () => {
    const originalText = "*start|\n@jump target=*a[p]\n*a|\nTexte.[p]\n";
    const translatedText = "*start|\n@jump target=*b[p]\n*b|\nTexte.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.level).toBe("incompatible");
    expect(report.installable).toBe(false);
  });

  it("installe uniquement les scripts compatibles", () => {
    const originalTexts = new Map<string, string>([
      ["compatible.ks", "*start|\nTexte A.[p]\n"],
      ["incompatible.ks", "*start|\nTexte.[p]\n*next|\nSuite.[p]\n"],
    ]);
    const translatedTexts = new Map<string, string>([
      ["compatible.ks", "*start|\nTexte B.[p]\n"],
      ["incompatible.ks", "*start|\nTexte.[p]\n"],
    ]);
    const { index, installed } = installTranslation(originalTexts, translatedTexts, {
      language: "fr",
      label: "Français",
      credits: "Moon-Trad",
    });
    expect(index.scripts).toEqual(["compatible.ks"]);
    expect(index.strict).toEqual(["compatible.ks"]);
    expect(index.skipped).toHaveLength(1);
    expect(index.skipped[0]!.file).toBe("incompatible.ks");
    expect(installed.has("compatible.ks")).toBe(true);
    expect(installed.has("incompatible.ks")).toBe(false);
  });

  it("normalise UTF-8 BOM et CRLF", () => {
    const bomCrlf = "\uFEFF*start|\nTexte.\r\n[p]\r\n";
    const script = parseTranslationScript(bomCrlf);
    expect(script.pages).toHaveLength(1);
    expect(script.pages[0]!.instructions.some((i) => i.kind === "text")).toBe(true);
  });

  it("tolère l'encodage UTF-16LE", () => {
    const text = "*start|\nTexte.[p]\n";
    const buffer = Buffer.from("\uFEFF" + text, "utf16le");
    const decoded = decodeTranslationScript(buffer);
    expect(decoded.text).toBe(text);
  });

  it("produit un index avec la version et les crédits", () => {
    const originalTexts = new Map<string, string>([["a.ks", "*start|\nA.[p]\n"]]);
    const translatedTexts = new Map<string, string>([["a.ks", "*start|\nB.[p]\n"]]);
    const { index } = installTranslation(originalTexts, translatedTexts, {
      language: "fr",
      label: "Français",
      credits: "Moon-Trad",
    });
    expect(index.version).toBe(1);
    expect(index.language).toBe("fr");
    expect(index.label).toBe("Français");
    expect(index.credits).toBe("Moon-Trad");
    expect(index.scripts).toContain("a.ks");
  });
});
