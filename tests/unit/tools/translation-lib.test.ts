import { describe, it, expect } from "vitest";
import {
  compareScripts,
  installTranslation,
  parseTranslationScript,
  decodeTranslationScript,
  neutralizeEmptyPauses,
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

  it("juge compatible quand les breaks texte diffèrent mais pas le squelette de flux", () => {
    const originalText = "*start|\nTexte A.\n@r\nTexte B.[p]\n";
    const translatedText = "*start|\nTexte A. Texte B.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.level).toBe("compatible");
    expect(report.installable).toBe(true);
  });

  it("juge compatible quand seulement des commandes audio diffèrent", () => {
    const originalText = "*start|\nTexte.[p]\n";
    const translatedText = "*start|\n@se storage=a\nTexte.\n@sestop storage=a\n[p]\n";
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

  it("juge incompatible quand un label visé par un saut est manquant", () => {
    const originalText = "*start|\n@jump target=*next\n*next|\nSuite.[p]\n";
    const translatedText = "*start|\n@jump target=*next\nSuite.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.level).toBe("incompatible");
    expect(report.installable).toBe(false);
    expect(report.reason).toContain("label");
    expect(report.missingLabels).toContain("next");
  });

  it("tolère un label renommé quand aucun saut ne le vise (numérotation des pages différente)", () => {
    const originalText = "*page1|\nTexte.[p]\n*page2|\nSuite.[p]\n";
    const translatedText = "*page0|\nTexte.[p]\n*page1|\nSuite.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.installable).toBe(true);
    expect(report.missingLabels.length).toBeGreaterThan(0);
  });

  it("juge incompatible un label renommé que vise un saut", () => {
    const originalText = "*page1|\n@jump target=*page2\n*page2|\nSuite.[p]\n";
    const translatedText = "*page0|\n@jump target=*page2\n*page1|\nSuite.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.installable).toBe(false);
    expect(report.reason).toContain("visés par un saut");
  });

  it("tolère un label ajouté : il est signalé mais ne casse aucun saut", () => {
    const originalText = "*start|\nTexte.[p]\n";
    const translatedText = "*start|\n*extra\nTexte.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.installable).toBe(true);
    expect(report.extraLabels).toContain("extra");
  });

  it("juge incompatible un label ajouté qui décale les pages de l'original", () => {
    const originalText = "*start|\nTexte.[p]\n*suite|\nAutre.[p]\n";
    const translatedText = "*start|\nTexte.[p]\n*extra|\nIntrus.[p]\n*suite|\nAutre.[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.installable).toBe(false);
  });

  it("juge incompatible quand une instruction de flux est ajoutée", () => {
    const originalText = "*start|\nTexte.[p]\n";
    const translatedText = "*start|\nTexte.\n@jump target=*start[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.level).toBe("incompatible");
    expect(report.installable).toBe(false);
    expect(report.reason).toContain("flux");
  });

  it("juge incompatible quand une commande de flux change de cible", () => {
    const originalText = "*start|\n@jump storage=a.ks[p]\n";
    const translatedText = "*start|\n@jump storage=b.ks[p]\n";
    const report = compareScripts(makeOriginal(originalText), makeTranslated(translatedText), "t.ks");
    expect(report.level).toBe("incompatible");
    expect(report.installable).toBe(false);
    expect(report.reason).toContain("flux");
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

  describe("neutralizeEmptyPauses (#141)", () => {
    it("retire les [l] vides quand le texte traduit tient sur la première ligne", () => {
      const original =
        "*start|\nAlpha.[l]\n@r\nBeta.[l]\n@r\nGamma.[l]\nFin.[p]\n";
      const translated =
        "*start|\nAlpha beta gamma.[l]\n@r\n[l]\n@r\n[l]\nFin.[p]\n";
      const { text, removed } = neutralizeEmptyPauses(original, translated);
      expect(removed).toBe(2);
      expect(text).toBe("*start|\nAlpha beta gamma.[l]\n@r\n\n@r\n\nFin.[p]\n");
    });

    it("ne touche pas aux pauses vides qui existent aussi dans l'original", () => {
      const original = "*start|\nAlpha.[l]\n@se storage=x\n[l]\nBeta.[p]\n";
      const translated = "*start|\nAlpha prime.[l]\n@se storage=x\n[l]\nBeta prime.[p]\n";
      const { text, removed } = neutralizeEmptyPauses(original, translated);
      expect(removed).toBe(0);
      expect(text).toBe(translated);
    });

    it("retire un [l] vide en trop au milieu de lignes toutes lisibles", () => {
      const original = "*start|\nUn.[l]\nDeux.[l]\nTrois.[p]\n";
      const translated = "*start|\nUn bis.[l]\n@se storage=x\n[l]\nDeux bis.[l]\nTrois bis.[p]\n";
      const { text, removed } = neutralizeEmptyPauses(original, translated);
      expect(removed).toBe(1);
      expect(text).toBe("*start|\nUn bis.[l]\n@se storage=x\n\nDeux bis.[l]\nTrois bis.[p]\n");
    });

    it("ne retire que le [l] vide d'une ligne qui contient aussi du texte et d'autres tags", () => {
      const original = "*start|\nUn.[l]\nDeux.[l]\nTrois.[p]\n";
      const translated = "*start|\nUn bis.[l][r]\n[l]Deux bis.[l]\nTrois bis.[p]\n";
      const { text, removed } = neutralizeEmptyPauses(original, translated);
      expect(removed).toBe(1);
      expect(text).toBe("*start|\nUn bis.[l][r]\nDeux bis.[l]\nTrois bis.[p]\n");
    });

    it("gère la commande @l et conserve les fins de ligne CRLF", () => {
      const original = "*start|\r\nUn.[l]\r\nDeux.[l]\r\nFin.[p]\r\n";
      const translated = "*start|\r\nUn deux.[l]\r\n@l\r\nFin bis.[p]\r\n";
      const { text, removed } = neutralizeEmptyPauses(original, translated);
      expect(removed).toBe(1);
      expect(text).toBe("*start|\r\nUn deux.[l]\r\n\r\nFin bis.[p]\r\n");
    });

    it("ne touche jamais au texte traduit ni aux autres pages", () => {
      const original = "*start|\nUn.[l]\nDeux.[p]\nTrois.[l]\nQuatre.[p]\n";
      const translated = "*start|\nUn deux « é ».[l]\n[l]\n[p]\nTrois quatre.[l]\n[l]\n[p]\n";
      const { text, removed } = neutralizeEmptyPauses(original, translated);
      expect(removed).toBe(2);
      expect(text.replace(/\n+/g, "\n")).toBe(
        "*start|\nUn deux « é ».[l]\n[p]\nTrois quatre.[l]\n[p]\n".replace(/\n+/g, "\n"),
      );
    });

    it("reste prudent face à un bloc @if qui peut émettre du texte", () => {
      const original = "*start|\nUn.[l]\nDeux.[p]\n";
      const translated =
        "*start|\nUn deux.[l]\n@if exp=\"f.x==1\"\nSuite.\n@endif\n[l]\n[p]\n";
      const { text, removed } = neutralizeEmptyPauses(original, translated);
      expect(removed).toBe(0);
      expect(text).toBe(translated);
    });

    it("ne modifie rien si le nombre de pages diffère", () => {
      const original = "*start|\nUn.[l]\nDeux.[p]\nTrois.[p]\n";
      const translated = "*start|\nUn deux.[l]\n[l]\n[p]\n";
      const { text, removed } = neutralizeEmptyPauses(original, translated);
      expect(removed).toBe(0);
      expect(text).toBe(translated);
    });

    it("est appliqué à l'installation, sans changer le niveau de compatibilité", () => {
      const originalTexts = new Map<string, string>([
        ["a.ks", "*start|\nUn.[l]\nDeux.[p]\n"],
        ["b.ks", "*start|\nUn.[p]\n"],
      ]);
      const translatedTexts = new Map<string, string>([
        ["a.ks", "*start|\nUn deux.[l]\n[l]\n[p]\n"],
        ["b.ks", "*start|\nUn bis.[p]\n"],
      ]);
      const { index, installed, neutralized } = installTranslation(originalTexts, translatedTexts, {
        language: "fr",
        label: "Français",
        credits: "Moon-Trad",
      });
      expect(index.scripts).toEqual(["a.ks", "b.ks"]);
      expect(installed.get("a.ks")).toBe("*start|\nUn deux.[l]\n\n[p]\n");
      expect(installed.get("b.ks")).toBe("*start|\nUn bis.[p]\n");
      expect(neutralized.get("a.ks")).toBe(1);
      expect(neutralized.has("b.ks")).toBe(false);
    });
  });
});
