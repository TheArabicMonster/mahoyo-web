/**
 * Types du manifest d'assets.
 *
 * Le manifest est généré par le pipeline (`tools/manifest.ts`) et chargé par
 * le player au démarrage. Il mappe les clés de storage normalisées (voir
 * `storage-key.ts`) vers les URLs réelles des fichiers convertis.
 */

export type AssetKind = "bg" | "image" | "rule" | "bgm" | "se" | "scenario";

/** Entrée d'un asset visuel ou audio dans le manifest. */
export type ManifestEntry = {
  /** URL relative au baseUrl du resolver (ex: "bg/山城01(近).webp"). */
  url: string;
  /** Fichier source d'origine (ex: "bg/山城01(近).tlg"). */
  source: string;
  /** Kind original pour débogage. */
  kind: AssetKind;
};

/** Entrée d'un scénario dans le manifest. */
export type ScenarioEntry = {
  url: string;
  source: string;
  /** Encodage d'origine détecté. */
  encoding: string;
};

/** Manifest complet, sérialisable en JSON. */
export type AssetManifest = {
  version: 1;
  /** Horodatage de génération (ISO 8601). */
  generatedAt: string;
  /** Images : backgrounds, sprites, rules, UI. */
  images: Record<string, ManifestEntry>;
  /** Audio : BGM et SE. */
  audio: Record<string, ManifestEntry>;
  /** Scripts KAG normalisés. */
  scenarios: Record<string, ScenarioEntry>;
};

/**
 * Recherche un asset dans le manifest par clé normalisée.
 * Retourne l'URL relative, ou null si non trouvé.
 */
export function lookupImage(
  manifest: AssetManifest | undefined,
  key: string,
): string | null {
  if (!manifest) return null;
  const entry = manifest.images[key];
  return entry?.url ?? null;
}

export function lookupAudio(
  manifest: AssetManifest | undefined,
  key: string,
): string | null {
  if (!manifest) return null;
  const entry = manifest.audio[key];
  return entry?.url ?? null;
}

export function lookupScenario(
  manifest: AssetManifest | undefined,
  key: string,
): string | null {
  if (!manifest) return null;
  const entry = manifest.scenarios[key];
  return entry?.url ?? null;
}
