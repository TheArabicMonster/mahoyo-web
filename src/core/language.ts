/**
 * Index d'une langue de traduction installée localement dans les assets.
 *
 * Le fichier est généré par `tools/translation.ts` et chargé par le player
 * au démarrage pour savoir quels scripts sont disponibles dans chaque langue.
 */

export type LanguageIndex = {
  version: 1;
  language: string;
  label: string;
  credits: string;
  /** Scripts retenus (noms de fichiers .ks). */
  scripts: string[];
  /** Scripts strictement identiques au squelette complet de l'original. */
  strict: string[];
  /** Scripts ignorés avec la raison. */
  skipped: { file: string; reason: string }[];
  /** Ressources supplémentaires référencées par la traduction et absentes du manifest. */
  extraAssets: Record<string, string[]>;
};

const ALLOWED_LANGUAGES = ["ja", "en", "fr"] as const;

export type GameLanguage = (typeof ALLOWED_LANGUAGES)[number];

/** Vérifie que la valeur est un code de langue connu. */
export function isGameLanguage(value: unknown): value is GameLanguage {
  return typeof value === "string" && (ALLOWED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Valide un index de langue désérialisé.
 * Retourne l'index si la forme est correcte, sinon null.
 */
export function parseLanguageIndex(data: unknown): LanguageIndex | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1) return null;
  if (typeof d.language !== "string" || d.language.length === 0) return null;
  if (!Array.isArray(d.scripts) || !d.scripts.every((s) => typeof s === "string")) return null;
  if (!Array.isArray(d.strict) || !d.strict.every((s) => typeof s === "string")) return null;
  if (
    !Array.isArray(d.skipped) ||
    !d.skipped.every((s) => typeof s === "object" && s !== null && typeof (s as { file?: string }).file === "string")
  ) {
    return null;
  }
  const rawExtraAssets = (d as { extraAssets?: unknown }).extraAssets;
  const extraAssets: Record<string, string[]> = {};
  if (typeof rawExtraAssets === "object" && rawExtraAssets !== null) {
    for (const [file, assets] of Object.entries(rawExtraAssets)) {
      if (Array.isArray(assets) && assets.every((a) => typeof a === "string")) {
        extraAssets[file] = assets as string[];
      }
    }
  }

  return {
    version: 1,
    language: d.language,
    label: typeof d.label === "string" ? d.label : d.language,
    credits: typeof d.credits === "string" ? d.credits : "",
    scripts: d.scripts as string[],
    strict: d.strict as string[],
    skipped: d.skipped as { file: string; reason: string }[],
    extraAssets,
  };
}

/** Vérifie si un fichier est présent dans l'index de langue (insensible à la casse). */
export function hasTranslation(index: LanguageIndex | null, file: string): boolean {
  if (!index) return false;
  const lower = file.toLowerCase();
  return index.scripts.some((s) => s.toLowerCase() === lower);
}
