/**
 * Résolution des URLs d'assets à partir des références logiques KAG.
 *
 * Les scripts KAG utilisent des noms d'assets sans extension et avec une casse
 * variable. Cette couche essaie plusieurs extensions et normalise les chemins.
 *
 * L'implémentation est injectable dans `StageRenderer` et `AudioPlayer` pour
 * qu'ils ne dépendent pas d'une convention de dossiers particulière.
 */

export type AssetResolver = {
  /** Résout une image de background. */
  background(storage: string): string;
  /** Résout une image de sprite / layer. */
  image(storage: string): string;
  /** Résout une image de rule pour les transitions. */
  rule(storage: string): string;
  /** Résout un fichier BGM. */
  bgm(storage: string): string;
  /** Résout un fichier SE. */
  se(storage: string): string;
  /** Résout un fichier de script .ks. */
  scenario(storage: string): string;
};

export type AssetResolverOptions = {
  /** Chemin de base pour tous les assets (défaut: "/assets"). */
  baseUrl: string;
};

function normalizeStorage(storage: string): string {
  // Supprime les suffixes éventuels ajoutés par le pipeline (ex: "_night|effect").
  return storage.split("|")[0]?.trim() ?? storage;
}

export function createAssetResolver(options: Partial<AssetResolverOptions> = {}): AssetResolver {
  const baseUrl = options.baseUrl ?? "/assets";

  return {
    background(storage: string): string {
      return `${baseUrl}/bg/${normalizeStorage(storage)}.webp`;
    },
    image(storage: string): string {
      return `${baseUrl}/image/${normalizeStorage(storage)}.webp`;
    },
    rule(storage: string): string {
      return `${baseUrl}/rule/${normalizeStorage(storage)}.png`;
    },
    bgm(storage: string): string {
      return `${baseUrl}/bgm/${normalizeStorage(storage)}.ogg`;
    },
    se(storage: string): string {
      return `${baseUrl}/se/${normalizeStorage(storage)}.ogg`;
    },
    scenario(storage: string): string {
      const normalized = normalizeStorage(storage);
      return `${baseUrl}/scenario/${normalized.endsWith(".ks") ? normalized : `${normalized}.ks`}`;
    },
  };
}
