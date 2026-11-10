/**
 * Génération du service worker PWA après le build Vite (issue #96).
 *
 * `vite build` produit les bundles hachés et `dist/.vite/manifest.json` ; ce script
 * lit ce manifeste pour connaître les fichiers exacts de la coquille, calcule une
 * version (hash) puis écrit `dist/sw.js` à partir de `src/pwa/sw-source.ts`.
 *
 * Les assets du jeu (`/assets/**` copiés depuis `public/assets`) ne sont **jamais**
 * précachés : ils sont mis en cache à la demande par le service worker (cache
 * runtime borné). La coquille ne contient que index.html, les bundles JS/CSS du
 * build, le manifeste PWA et les icônes.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { renderServiceWorker } from "../src/pwa/sw-source.js";

const REPO_ROOT = join(import.meta.dirname, "..");

/** Fichiers publics toujours précachés (coquille PWA). */
export const STATIC_PRECACHE = ["/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"] as const;

type ViteManifestEntry = {
  file?: string;
  css?: string[];
  assets?: string[];
  isEntry?: boolean;
};

/** Lit `dist/.vite/manifest.json` (objet, pas tableau : `build.manifest` Vite 5). */
export function readViteManifest(distDir: string): Record<string, ViteManifestEntry> {
  const path = join(distDir, ".vite", "manifest.json");
  if (!existsSync(path)) {
    throw new Error(
      `Manifeste de build introuvable (${path}) : activer build.manifest dans vite.config.ts et lancer vite build avant ce script.`,
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Manifeste de build illisible (${path}) : objet attendu.`);
  }
  return parsed as Record<string, ViteManifestEntry>;
}

/**
 * Liste déterministe des URLs de la coquille à précacher : statiques + bundles du
 * build (entrées, CSS, assets importés), sans sourcemaps ni assets du jeu.
 */
export function collectPwaPrecache(distDir: string): string[] {
  const manifest = readViteManifest(distDir);
  const urls = new Set<string>(STATIC_PRECACHE);

  for (const entry of Object.values(manifest)) {
    const candidates = [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])];
    for (const candidate of candidates) {
      if (!candidate || candidate.endsWith(".map")) continue;
      urls.add(`/${candidate.replace(/^\/+/, "")}`);
    }
  }

  const sorted = [...urls].sort();
  const missing = sorted.filter((url) => !existsSync(join(distDir, url.replace(/^\//, ""))));
  if (missing.length > 0) {
    throw new Error(
      `Fichiers de coquille manquants dans ${distDir} : ${missing.join(", ")}. Vérifier publicDir (manifeste/icônes) et le build.`,
    );
  }
  return sorted;
}

/** Version déterministe de la coquille (hash court du contenu précaché). */
export function computeServiceWorkerVersion(precache: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...precache].sort())).digest("hex").slice(0, 12);
}

/** Lit l'état du build et retourne le code source du service worker. */
export function buildServiceWorkerSource(distDir: string): string {
  const precache = collectPwaPrecache(distDir);
  const version = computeServiceWorkerVersion(precache);
  return renderServiceWorker({ precache, version });
}

/** Écrit `dist/sw.js` ; retourne la version et la liste précachée. */
export function writePwaServiceWorker(distDir: string): {
  version: string;
  precache: string[];
  serviceWorkerPath: string;
} {
  const precache = collectPwaPrecache(distDir);
  const version = computeServiceWorkerVersion(precache);
  const serviceWorkerPath = join(distDir, "sw.js");
  writeFileSync(serviceWorkerPath, renderServiceWorker({ precache, version }), "utf-8");
  return { version, precache, serviceWorkerPath };
}

function main(): void {
  const distDir = join(REPO_ROOT, "dist");
  if (!existsSync(distDir)) {
    throw new Error(`Dossier de build introuvable (${distDir}) : lancer vite build d'abord.`);
  }
  const { version, precache, serviceWorkerPath } = writePwaServiceWorker(distDir);
  console.log(
    `[pwa] service worker écrit (${serviceWorkerPath}) — version ${version}, ${precache.length} fichiers précachés.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error("[pwa]", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
