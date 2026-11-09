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

import { isSolidColor, storageKey } from "./storage-key.js";
import type {
  AssetKind,
  AssetManifest,
} from "./asset-manifest.js";
import {
  listImages,
  lookupImage as lookupImg,
  lookupAudio as lookupAud,
  lookupScenario as lookupScn,
} from "./asset-manifest.js";

/** Entrée d'image résolue : clé du manifeste, URL complète (baseUrl comprise), kind et source. */
export type ResolvedImageEntry = {
  key: string;
  url: string;
  kind: AssetKind;
  source: string;
};

export type AssetResolver = {
  /** Résout une image de background. */
  background(storage: string): string;
  /** Résout une image de sprite / layer. */
  image(storage: string): string;
  /** Résout une image de rule pour les transitions. */
  rule(storage: string): string;
  /**
   * Résout une image d'interface (cadre, fond, illustration de titre…) : l'URL complète si la clé
   * figure au manifest, sinon `null`. Sans manifest, aucune convention de dossier n'est tentée :
   * une image d'interface est facultative, son absence est normale (repli CSS) et ne déclenche
   * ni avertissement ni requête (#189).
   */
  uiImage(key: string): string | null;
  /**
   * Toutes les images du manifeste, avec leur URL résolue (galerie CG, HUD-15 / #208).
   * Sans manifeste : liste vide (le repli par convention ne permet pas de lister les fichiers).
   */
  imageEntries(): readonly ResolvedImageEntry[];
  /** Résout un fichier BGM. */
  bgm(storage: string): string;
  /** Résout un fichier SE. */
  se(storage: string): string;
  /** Résout un fichier de script .ks. */
  scenario(storage: string): string;
  /** Résout un fichier de script .ks dans une langue traduite. */
  translatedScenario(storage: string, language: string): string;
  /** URL de l'index d'une langue (`lang/<language>/index.json`). */
  languageIndex(language: string): string;
  /** URL de la table d'enchaînement des scripts (`story-chain.json`). */
  chain(): string;
  /** URL du graphe de scénario du flowchart (`story-graph.json`, généré par `npm run chain`). */
  graph(): string;
  /** URL des timelines d'animation extraites des scripts (`timelines.json`). */
  timelines(): string;
  /**
   * Signale qu'un asset est introuvable (échec de chargement constaté côté
   * navigateur). Un seul avertissement par asset, quel que soit le nombre
   * d'appels (#143).
   */
  reportMissing(kind: MissingAssetKind, storage: string): void;
};

/** Type d'asset pour les avertissements d'assets absents. */
export type MissingAssetKind = "image" | "audio";

export type AssetResolverOptions = {
  /** Chemin de base pour tous les assets (défaut: "/assets"). */
  baseUrl: string;
  /** Manifest optionnel généré par le pipeline. */
  manifest?: AssetManifest;
  /**
   * Appelé une seule fois par asset absent (défaut : `console.warn`). Les
   * ~9 000 voix et quelques images de la version Steam, absentes du manifest,
   * ne doivent pas inonder la console à chaque étape (#143).
   */
  onMissing?: (kind: MissingAssetKind, key: string) => void;
};

export function createAssetResolver(options: Partial<AssetResolverOptions> = {}): AssetResolver {
  const baseUrl = options.baseUrl ?? "/assets";
  const manifest = options.manifest;
  const reported = new Set<string>();
  const onMissing =
    options.onMissing ??
    ((kind: MissingAssetKind, key: string) => {
      console.warn(`Asset introuvable (${kind === "image" ? "image" : "audio"}) : ${key}`);
    });

  function reportMissing(kind: MissingAssetKind, storage: string): void {
    const key = storageKey(storage);
    if (key === "") return;
    if (kind === "image" && isSolidColor(storage)) return;
    const id = `${kind}:${key}`;
    if (reported.has(id)) return;
    reported.add(id);
    onMissing(kind, key);
  }

  /**
   * Résout une clé via le manifest, ou retombe sur la convention de dossiers.
   *
   * Les couleurs unies (`black`, `white`, `red`…) passent aussi par le manifest : le pipeline
   * en génère un fichier (`bg/white.png`). Les ignorer menait à `bg/white.webp`, inexistant :
   * le fond blanc d'un flash s'affichait noir (#134).
   */
  function resolveImage(storage: string, kind: "bg" | "image" | "rule", ext: string): string {
    const key = storageKey(storage);
    // Manifest d'abord.
    const url = lookupImg(manifest, key);
    if (url) return `${baseUrl}/${url}`;
    // Absent du manifest : un seul avertissement, puis repli par convention.
    if (manifest) reportMissing("image", storage);
    return `${baseUrl}/${kind}/${key}.${ext}`;
  }

  function resolveAudio(storage: string, kind: "bgm" | "se", ext: string): string {
    const key = storageKey(storage);
    const url = lookupAud(manifest, key);
    if (url) return `${baseUrl}/${url}`;
    if (manifest) reportMissing("audio", storage);
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
    uiImage(key: string): string | null {
      const url = lookupImg(manifest, storageKey(key));
      return url ? `${baseUrl}/${url}` : null;
    },
    imageEntries(): ResolvedImageEntry[] {
      // Aucune URL sans manifeste : on ne peut pas lister les fichiers par convention.
      return listImages(manifest).map((entry) => ({ ...entry, url: `${baseUrl}/${entry.url}` }));
    },
    scenario(storage: string): string {
      const key = storageKey(storage);
      const url = lookupScn(manifest, key);
      if (url) return `${baseUrl}/${url}`;
      // Sans manifest, on garde le .ks.
      return `${baseUrl}/scenario/${key}.ks`;
    },
    translatedScenario(storage: string, language: string): string {
      const key = storageKey(storage);
      // Sans manifest, on garde le .ks.
      return `${baseUrl}/lang/${language}/scenario/${key}.ks`;
    },
    languageIndex(language: string): string {
      return `${baseUrl}/lang/${language}/index.json`;
    },
    chain(): string {
      return `${baseUrl}/story-chain.json`;
    },
    graph(): string {
      return `${baseUrl}/story-graph.json`;
    },
    timelines(): string {
      return `${baseUrl}/timelines.json`;
    },
    reportMissing,
  };
}
