/**
 * Dictionnaire d'interface FR / JA / EN (#184, WEB-05).
 *
 * - Le français (`locales/fr.ts`) est la langue de référence : ses clés définissent `MessageKey`.
 *   `ja` et `en` sont typés `Record<MessageKey, string>` : une clé manquante ou en trop ne compile pas
 *   (et un test unitaire le vérifie aussi à l'exécution).
 * - `t(key, params?)` lit la langue courante ; une valeur absente retombe sur le français, puis sur la clé.
 * - Les paramètres s'écrivent `{nom}` dans les textes. Le typage les exige : `t("slot.numbered", { n: 3 })`.
 * - Une clé qui se termine par `.deco` est un sous-titre décoratif (par ex. le japonais d'un écran en français) :
 *   à rendre avec `aria-hidden="true"`, jamais comme libellé principal. Voir `decoKeyOf` et `isDecorativeKey`.
 *
 * Module sans dépendance externe ni accès au DOM : il se teste seul.
 *
 * Ajouter une clé : voir `docs/I18N.md`.
 */
import type { GameLanguage } from "@/core/language.js";
import { en } from "./locales/en.js";
import { fr } from "./locales/fr.js";
import { ja } from "./locales/ja.js";

/** Clés valides du dictionnaire (déduites du français). */
export type MessageKey = keyof typeof fr;

/** Noms de paramètres `{nom}` présents dans un texte littéral. */
type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer R}` ? P | ParamNames<R> : never;

export type MessageParams = Readonly<Record<string, string | number>>;

/** Arguments restants de `t` : le paramètre est exigé, et seulement, quand le texte français en contient. */
type ParamsArg<D extends Readonly<Record<string, string>>, K extends keyof D> = [ParamNames<D[K] & string>] extends [
  never,
]
  ? [params?: MessageParams]
  : [params: Readonly<Record<ParamNames<D[K] & string>, string | number>>];

/** Langue de repli, et langue de l'interface tant que rien n'est choisi. */
export const FALLBACK_LANGUAGE: GameLanguage = "fr";

/** Locale BCP 47 pour les formats de date et de nombre. */
export const UI_LOCALES: Readonly<Record<GameLanguage, string>> = { fr: "fr-FR", ja: "ja-JP", en: "en-US" };

/** Noms de langue dans leur propre langue (identiques quelle que soit la langue de l'interface). */
export const LANGUAGE_NAMES: Readonly<Record<GameLanguage, string>> = { ja: "日本語", en: "English", fr: "Français" };

const DECO_SUFFIX = ".deco";

/** Vrai pour une clé de sous-titre décoratif (`xxx.deco`). */
export function isDecorativeKey(key: string): boolean {
  return key.endsWith(DECO_SUFFIX);
}

/** Clé décorative associée à un libellé principal : `decoKeyOf("title.start")` donne `"title.start.deco"`. */
export function decoKeyOf<K extends string>(key: K): `${K}.deco` {
  return `${key}${DECO_SUFFIX}`;
}

function format(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export type I18n<D extends Readonly<Record<string, string>>> = {
  /** Traduit dans une langue donnée, sans toucher à la langue courante. */
  translate<K extends keyof D & string>(language: GameLanguage, key: K, ...args: ParamsArg<D, K>): string;
  /** Traduit dans la langue courante. */
  t<K extends keyof D & string>(key: K, ...args: ParamsArg<D, K>): string;
  /** Vrai si la clé a une valeur dans cette langue (sans repli). */
  has(language: GameLanguage, key: string): boolean;
  setLanguage(language: GameLanguage): void;
  getLanguage(): GameLanguage;
  /** Écoute les changements de langue ; renvoie la fonction de désabonnement. */
  subscribe(listener: (language: GameLanguage) => void): () => void;
};

/**
 * Fabrique un traducteur. `base` fait foi pour les clés et sert de repli ; les autres langues peuvent être
 * partielles à l'exécution (le typage de `ja`/`en` empêche déjà les oublis dans le dépôt).
 */
export function createI18n<D extends Readonly<Record<string, string>>>(
  base: D,
  dictionaries: Readonly<Partial<Record<GameLanguage, Readonly<Partial<Record<keyof D, string>>>>>>,
  initial: GameLanguage = FALLBACK_LANGUAGE,
): I18n<D> {
  let current = initial;
  const listeners = new Set<(language: GameLanguage) => void>();

  const own = (language: GameLanguage, key: string): string | undefined =>
    (dictionaries[language] as Readonly<Record<string, string | undefined>> | undefined)?.[key];

  const translate = (language: GameLanguage, key: string, params?: MessageParams): string =>
    format(own(language, key) ?? (base as Readonly<Record<string, string>>)[key] ?? key, params);

  return {
    translate: (language, key, ...args) => translate(language, key, args[0]),
    t: (key, ...args) => translate(current, key, args[0]),
    has: (language, key) => own(language, key) !== undefined,
    setLanguage(language) {
      if (language === current) return;
      current = language;
      for (const listener of [...listeners]) listener(language);
    },
    getLanguage: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** Dictionnaires par langue (exposés pour les tests de complétude). */
export const DICTIONARIES: Readonly<Record<GameLanguage, Readonly<Record<MessageKey, string>>>> = { fr, ja, en };

const instance = createI18n(fr, { fr, ja, en });

/** Traduit dans la langue courante de l'interface. */
export const t = instance.t;
/** Traduit dans une langue précise, sans changer la langue courante. */
export const translate = instance.translate;
export const setUiLanguage = instance.setLanguage;
export const getUiLanguage = instance.getLanguage;
export const onUiLanguageChange = instance.subscribe;

/** Locale BCP 47 de la langue courante (dates, nombres). */
export function uiLocale(): string {
  return UI_LOCALES[instance.getLanguage()];
}
