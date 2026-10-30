/**
 * Résolution des URLs d'assets à partir des références logiques KAG.
 *
 * Les scripts KAG utilisent des noms d'assets sans extension et avec une casse
 * variable. Cette couche normalise les clés (via `storageKey`) et résout
 * l'URL finale.
 *
 * Deux modes :
 * - **Sans manifest** : convention de dossiers (`/assets/bg/<key>.webp`, etc.).
 *   Utilisé par la démo et les scripts non traités par le pipeline.
 * - **Avec manifest** : le manifest généré par le pipeline mappe les clés
 *   vers les URLs réelles. Permet de gérer les extensions variables
 *   (`.webp`, `.png`, `.ogg`, `.wav`) et les assets dans des dossiers
 *   non standard.
 */

import { storageKey, isSolidColor } from "./storage-key.js";
import type {
  AssetManifest,
  lookupImage,
  lookupAudio,
  lookupScenario,
} from "./asset-manifest.js";
import {
  lookupImage as lookupImg,
  lookupAudio as lookupAud,
  lookupScenario as lookupScn,
} from "./asset-manifest.js";

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
  /** URL de la table d'enchaînement des scripts (`story-chain.json`). */
  chain(): string;
};

export type AssetResolverOptions = {
  /** Chemin de base pour tous les assets (défaut: "/assets"). */
  baseUrl: string;
  /** Manifest optionnel généré par le pipeline. */
  manifest?: AssetManifest;
};

export function createAssetResolver(options: Partial<AssetResolverOptions> = {}): AssetResolver {
  const baseUrl = options.baseUrl ?? "/assets";
  const manifest = options.manifest;

  /**
   * Résout une clé via le manifest, ou retombe sur la convention de dossiers.
   * Les couleurs solides (black, white, red) retournent la convention car
   * elles n'ont pas de fichier.
   */
  function resolveImage(storage: string, kind: "bg" | "image" | "rule", ext: string): string {
    const key = storageKey(storage);
    // Couleurs solides : pas de fichier, convention seulement.
    if (isSolidColor(storage)) {
      return `${baseUrl}/${kind}/${key}.${ext}`;
    }
    // Manifest d'abord.
    const url = lookupImg(manifest, key);
    if (url) return `${baseUrl}/${url}`;
    // Convention de repli.
    return `${baseUrl}/${kind}/${key}.${ext}`;
  }

  function resolveAudio(storage: string, kind: "bgm" | "se", ext: string): string {
    const key = storageKey(storage);
    const url = lookupAud(manifest, key);
    if (url) return `${baseUrl}/${url}`;
    return `${baseUrl}/${kind}/${key}.${ext}`;
  }

  return {
    background(storage: string): string {
      return resolveImage(storage, "bg", "webp");
    },
    image(storage: string): string {
      return resolveImage(storage, "image", "webp");
    },
    rule(storage: string): string {
      return resolveImage(storage, "rule", "png");
    },
    bgm(storage: string): string {
      return resolveAudio(storage, "bgm", "ogg");
    },
    se(storage: string): string {
      return resolveAudio(storage, "se", "ogg");
    },
    scenario(storage: string): string {
      const key = storageKey(storage);
      const url = lookupScn(manifest, key);
      if (url) return `${baseUrl}/${url}`;
      // Sans manifest, on garde le .ks.
      return `${baseUrl}/scenario/${key}.ks`;
    },
    chain(): string {
      return `${baseUrl}/story-chain.json`;
    },
  };
}
