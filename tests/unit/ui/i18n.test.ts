import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WINDOW_SIZE_OPTIONS } from "@/core/display.js";
import type { GameLanguage } from "@/core/language.js";
import { SHORTCUT_DEFINITIONS } from "@/core/shortcuts.js";
import {
  createI18n,
  decoKeyOf,
  DICTIONARIES,
  getUiLanguage,
  isDecorativeKey,
  LANGUAGE_NAMES,
  onUiLanguageChange,
  setUiLanguage,
  t,
  translate,
  UI_LOCALES,
  uiLocale,
} from "@/ui/i18n.js";

const LANGUAGES: readonly GameLanguage[] = ["fr", "ja", "en"];
const keysOf = (lang: GameLanguage) => Object.keys(DICTIONARIES[lang]).sort();
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("dictionnaire : complétude", () => {
  it("expose exactement les langues du jeu", () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...LANGUAGES].sort());
  });

  for (const lang of ["ja", "en"] as const) {
    it(`${lang} a exactement les mêmes clés que fr (aucune clé manquante ni en trop)`, () => {
      const reference = new Set(keysOf("fr"));
      const own = new Set(keysOf(lang));
      expect([...reference].filter((k) => !own.has(k))).toEqual([]);
      expect([...own].filter((k) => !reference.has(k))).toEqual([]);
    });

    it(`${lang} garde les mêmes paramètres {nom} que fr pour chaque clé`, () => {
      for (const key of keysOf("fr")) {
        const fr = DICTIONARIES.fr[key as keyof typeof DICTIONARIES.fr];
        const other = DICTIONARIES[lang][key as keyof typeof DICTIONARIES.fr];
        expect(placeholders(other), `${lang}:${key}`).toEqual(placeholders(fr));
      }
    });
  }

  it("aucune valeur vide ou blanche", () => {
    for (const lang of LANGUAGES) {
      for (const [key, value] of Object.entries(DICTIONARIES[lang])) {
        expect(value.trim(), `${lang}:${key}`).not.toBe("");
      }
    }
  });

  it("chaque clé décorative (.deco) existe dans toutes les langues", () => {
    const deco = keysOf("fr").filter(isDecorativeKey);
    for (const lang of LANGUAGES) {
      for (const key of deco) expect(keysOf(lang)).toContain(key);
    }
  });

  it("couvre chaque raccourci de core/shortcuts et reste aligné sur son libellé français", () => {
    for (const def of SHORTCUT_DEFINITIONS) {
      const key = `shortcut.${def.id}` as keyof typeof DICTIONARIES.fr;
      expect(DICTIONARIES.fr[key], key).toBe(def.label);
      for (const lang of LANGUAGES) expect(keysOf(lang)).toContain(key);
    }
  });

  it("le libellé français de la taille « fit » correspond à core/display", () => {
    const fit = WINDOW_SIZE_OPTIONS.find((o) => o.value === "fit");
    expect(DICTIONARIES.fr["config.screen.windowSizeFit"]).toBe(fit?.label);
  });

  it("les entrées d'origine du titre restent en anglais en français (valeur par défaut FR)", () => {
    expect([
      DICTIONARIES.fr["title.entry.start"],
      DICTIONARIES.fr["title.entry.load"],
      DICTIONARIES.fr["title.entry.config"],
      DICTIONARIES.fr["title.entry.extra"],
    ]).toEqual(["Start", "Load", "Config", "Extra"]);
  });

  it("les entrées du sous-menu Extra restent aussi en anglais en français (Archive, Cgmode, Soundmode, Back)", () => {
    expect([
      DICTIONARIES.fr["title.entry.archive"],
      DICTIONARIES.fr["title.entry.cgmode"],
      DICTIONARIES.fr["title.entry.soundmode"],
      DICTIONARIES.fr["title.entry.back"],
    ]).toEqual(["Archive", "Cgmode", "Soundmode", "Back"]);
  });

  it("chaque langue a une locale et un nom propre", () => {
    for (const lang of LANGUAGES) {
      expect(UI_LOCALES[lang]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(LANGUAGE_NAMES[lang].length).toBeGreaterThan(0);
    }
  });
});

describe("t / translate (instance par défaut)", () => {
  it("traduit dans la langue courante et suit setUiLanguage", () => {
    setUiLanguage("fr");
    expect(t("common.yes")).toBe("Oui");
    setUiLanguage("en");
    expect(t("common.yes")).toBe("Yes");
    setUiLanguage("ja");
    expect(t("common.yes")).toBe("はい");
    expect(getUiLanguage()).toBe("ja");
    setUiLanguage("fr");
  });

  it("translate vise une langue précise sans changer la langue courante", () => {
    setUiLanguage("fr");
    expect(translate("en", "common.no")).toBe("No");
    expect(getUiLanguage()).toBe("fr");
  });

  it("remplace les paramètres {nom}", () => {
    expect(translate("fr", "slot.numbered", { n: 3 })).toBe("Slot 3");
    expect(translate("en", "toast.scriptNotFound", { file: "1-0.ks" })).toBe("Script not found: 1-0.ks");
  });

  it("le typage refuse une clé inconnue ou un paramètre manquant (vérifié par tsc)", () => {
    // @ts-expect-error clé inexistante
    expect(translate("fr", "n.existe.pas")).toBe("n.existe.pas");
    // @ts-expect-error paramètre {n} obligatoire
    expect(translate("fr", "slot.numbered")).toBe("Slot {n}");
    // @ts-expect-error mauvais nom de paramètre
    expect(translate("fr", "slot.numbered", { x: 1 })).toBe("Slot {n}");
  });

  it("uiLocale suit la langue", () => {
    setUiLanguage("ja");
    expect(uiLocale()).toBe("ja-JP");
    setUiLanguage("fr");
    expect(uiLocale()).toBe("fr-FR");
  });

  it("prévient les abonnés seulement quand la langue change", () => {
    setUiLanguage("fr");
    const listener = vi.fn();
    const off = onUiLanguageChange(listener);
    setUiLanguage("fr");
    expect(listener).not.toHaveBeenCalled();
    setUiLanguage("en");
    expect(listener).toHaveBeenCalledWith("en");
    off();
    setUiLanguage("fr");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("createI18n : repli et clés décoratives", () => {
  const base = { "a.title": "Titre", "a.only": "Seulement FR", "a.hello": "Bonjour {name}", "a.title.deco": "デコ" } as const;
  const i18n = createI18n(base, { en: { "a.title": "Title" }, ja: { "a.title": "題" } });

  it("démarre en français par défaut", () => {
    expect(i18n.getLanguage()).toBe("fr");
    expect(i18n.t("a.title")).toBe("Titre");
  });

  it("une clé absente d'une langue retombe sur le français", () => {
    i18n.setLanguage("en");
    expect(i18n.t("a.title")).toBe("Title");
    expect(i18n.t("a.only")).toBe("Seulement FR");
    expect(i18n.t("a.hello", { name: "Aoko" })).toBe("Bonjour Aoko");
    expect(i18n.has("en", "a.only")).toBe(false);
    expect(i18n.has("en", "a.title")).toBe(true);
  });

  it("une clé inconnue renvoie la clé elle-même (jamais d'exception)", () => {
    expect(i18n.translate("ja", "absente" as never)).toBe("absente");
  });

  it("laisse intact un paramètre non fourni", () => {
    expect(i18n.translate("fr", "a.hello", {} as never)).toBe("Bonjour {name}");
  });

  it("sépare le libellé principal de son sous-titre décoratif", () => {
    expect(decoKeyOf("a.title")).toBe("a.title.deco");
    expect(isDecorativeKey(decoKeyOf("a.title"))).toBe(true);
    expect(isDecorativeKey("a.title")).toBe(false);
    expect(i18n.translate("fr", decoKeyOf("a.title"))).toBe("デコ");
  });
});

describe("garde-fou : aucun libellé en dur dans ui-manager.ts", () => {
  const source = readFileSync(resolve(__dirname, "../../../src/ui/ui-manager.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? "");

  it("aucune chaîne ne contient de lettre accentuée ou de caractère japonais", () => {
    const offenders = literals.filter((s) => /[À-ÿŒœ぀-ヿ一-鿿]/.test(s));
    expect(offenders).toEqual([]);
  });

  it("les anciens libellés français n'apparaissent plus comme littéraux", () => {
    const labels = [
      "Nouvelle partie", "Continuer", "Charger", "Réglages", "Sauvegarder", "Reprendre", "Historique",
      "Retour", "Oui", "Non", "Supprimer", "Pause", "Config", "Langue", "Volume", "Muet", "Police",
    ];
    expect(literals.filter((s) => labels.includes(s))).toEqual([]);
  });
});
