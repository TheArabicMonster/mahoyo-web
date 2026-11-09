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

/**
 * Entrée d'image aplatie (clé du manifeste + kind + source), pour les écrans qui listent les
 * images de l'utilisateur (galerie CG, HUD-15 / #208).
 */
export type ImageEntry = {
  /** Clé normalisée du manifeste (sans extension, en minuscules). */
  key: string;
  /** URL relative au baseUrl du résolveur (ex. `image/cg01.webp`). */
  url: string;
  /** Kind du manifeste (`bg`, `image`, `rule`). */
  kind: AssetKind;
  /** Fichier source d'origine (ex. `image/cg01.tlg`) : sert aux conventions de dossier. */
  source: string;
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
 * Clé « repliée » : forme Unicode compatible (NFKC), sans espace en bordure, en minuscules.
 *
 * Les noms de fichiers du jeu et les références des scripts ne s'accordent pas toujours au
 * caractère près : un `ｌ` pleine chasse d'un côté et `l` de l'autre, ou un espace avant
 * l'extension (`nom .png`) conservé dans une clé de manifest générée avant que `storageKey`
 * ne le retire. Le repli rapproche ces deux cas sans toucher aux clés du manifest.
 */
export function foldKey(key: string): string {
  return key.normalize("NFKC").trim().toLowerCase();
}

/** Index replié (clé repliée -> clé du manifest) par section, construit à la première recherche. */
const foldedIndexes = new WeakMap<object, Map<string, string>>();

function lookupEntry<T extends { url: string }>(
  section: Record<string, T>,
  key: string,
): string | null {
  const direct = section[key];
  if (direct?.url) return direct.url;

  let index = foldedIndexes.get(section);
  if (!index) {
    index = new Map();
    for (const k of Object.keys(section)) {
      const folded = foldKey(k);
      // En cas de collision, la première clé gagne (aucune dans les assets connus).
      if (!index.has(folded)) index.set(folded, k);
    }
    foldedIndexes.set(section, index);
  }
  const match = index.get(foldKey(key));
  return match !== undefined ? (section[match]?.url ?? null) : null;
}

/**
 * Recherche un asset dans le manifest par clé normalisée.
 * Retourne l'URL relative, ou null si non trouvé.
 *
 * Une clé absente est cherchée une seconde fois sous sa forme repliée (voir `foldKey`).
 */
export function lookupImage(
  manifest: AssetManifest | undefined,
  key: string,
): string | null {
  if (!manifest) return null;
  return lookupEntry(manifest.images, key);
}

export function lookupAudio(
  manifest: AssetManifest | undefined,
  key: string,
): string | null {
  if (!manifest) return null;
  return lookupEntry(manifest.audio, key);
}

export function lookupScenario(
  manifest: AssetManifest | undefined,
  key: string,
): string | null {
  if (!manifest) return null;
  const entry = manifest.scenarios[key];
  return entry?.url ?? null;
}

/**
 * Liste les images du manifeste, aplaties en entrées triées par clé.
 *
 * Utilisé par la galerie CG (#208) : les clés et les chemins sources sont des données du
 * manifeste de l'utilisateur, jamais des assets versionnés.
 */
export function listImages(manifest: AssetManifest | undefined): ImageEntry[] {
  if (!manifest) return [];
  return Object.entries(manifest.images)
    .map(([key, entry]) => ({ key, url: entry.url, kind: entry.kind, source: entry.source }))
    .sort((a, b) => a.key.localeCompare(b.key, "ja", { numeric: true }));
}
