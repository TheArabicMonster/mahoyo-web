/**
 * Prépare les assets e2e **avant** le démarrage du serveur Vite (issue #243).
 *
 * Appelé par la commande `webServer` de `playwright.config.ts` : Playwright lance le serveur
 * avant les `globalSetup`, or Vite fige la liste des fichiers publics à la création du serveur.
 * Les placeholders doivent donc exister sur disque avant, sinon Vite répond `index.html` pour
 * `/assets/...` (repli SPA) et le player parse du HTML comme un scénario KAG.
 *
 * Deux modes :
 * - **placeholders** (défaut, CI incluse) : génère un jeu synthétique autonome sous
 *   `MAHOYO_E2E_ASSETS/assets/` (ou `<tmp>/mahoyo-e2e-assets/assets/` par défaut) ;
 * - **assets réels** (`MAHOYO_E2E_REAL_ASSETS=1`) : n'écrit rien, vérifie que
 *   `MAHOYO_E2E_ASSETS/assets/{asset-manifest.json,scenario/1-0.ks}` existent (dossier `public`
 *   d'un checkout local par exemple) et le serveur les sert tels quels.
 *
 * Le même module est appelé par `tests/e2e/global-setup.ts` (journalisation + contrôle).
 */
import { copyFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, sep } from "path";
import {
  PLACEHOLDER_ASSET_FILES,
  generatePlaceholderAssets,
  isPlaceholderAssetDir,
  type PlaceholderInstallOptions,
} from "./placeholders.js";
import { backupAssets, readBackupMarker, writeBackupMarker } from "./assets-backup.js";
import { generateImageDimensions } from "../../tools/image-dimensions.js";

/** Fichiers de la coquille PWA (public/) nécessaires au build e2e hors ligne (#96). */
const PWA_SHELL_FILES = ["manifest.json", "icon-192.png", "icon-512.png"] as const;
const REPO_PUBLIC_DIR = join(import.meta.dirname, "../../public");

/**
 * Copie le manifeste PWA et les icônes du dépôt dans le `publicDir` de test :
 * les placeholders générés ne les produisent pas, or le build PWA en a besoin
 * (les vrais assets du jeu, eux, ne sont jamais requis).
 */
export function copyPwaShellFiles(publicDir: string): void {
  for (const file of PWA_SHELL_FILES) {
    const source = join(REPO_PUBLIC_DIR, file);
    const target = join(publicDir, file);
    if (existsSync(source) && !existsSync(target)) copyFileSync(source, target);
  }
}

export type E2eAssetsMode = "placeholders" | "real";

/** Dossier `publicDir` de Vite (servi à la racine) : doit contenir `assets/`. */
export function e2ePublicDir(): string {
  const fromEnv = process.env.MAHOYO_E2E_ASSETS?.trim();
  const dir = fromEnv && fromEnv !== "" ? fromEnv : join(tmpdir(), "mahoyo-e2e-assets");
  // Fixe la variable pour que le serveur Vite (process enfant) et les tests lisent le même dossier.
  process.env.MAHOYO_E2E_ASSETS = dir;
  return dir;
}

/** Prépare les assets du mode courant et renvoie le dossier publicDir. */
export function prepareE2eAssets(options: PlaceholderInstallOptions = {}): { publicDir: string; mode: E2eAssetsMode } {
  const publicDir = e2ePublicDir();
  const real = Boolean(process.env.MAHOYO_E2E_REAL_ASSETS);
  const force = options.force ?? process.env.MAHOYO_E2E_FORCE_PLACEHOLDERS === "1";

  if (real) {
    const assets = join(publicDir, "assets");
    const manifest = join(assets, "asset-manifest.json");
    const scenario = join(assets, "scenario", "1-0.ks");
    if (!existsSync(manifest) || !existsSync(scenario)) {
      throw new Error(
        `MAHOYO_E2E_REAL_ASSETS=1 : ${assets} ne contient pas asset-manifest.json et scenario/1-0.ks.\n` +
          `Pointer MAHOYO_E2E_ASSETS vers le dossier parent des assets (ex. "/chemin/vers/mahoyo-web/public").`,
      );
    }
    return { publicDir, mode: "real" };
  }

  // Isolation P0 (#417) : jamais dans le `public/` du dépôt sans choix explicite.
  const resolvedPublic = resolve(publicDir);
  const repoPublic = resolve(REPO_PUBLIC_DIR);
  if (!force && (resolvedPublic === repoPublic || resolvedPublic.startsWith(`${repoPublic}${sep}`))) {
    throw new Error(
      `[e2e] Isolation des assets (#417) : refus d'écrire des placeholders dans le public/ du dépôt (${publicDir}).\n` +
        "Le dossier par défaut est <tmp>/mahoyo-e2e-assets. Pour servir vos vrais assets : MAHOYO_E2E_REAL_ASSETS=1. " +
        "Pour forcer malgré tout (sauvegarde automatique) : --force ou MAHOYO_E2E_FORCE_PLACEHOLDERS=1.",
    );
  }
  // Idempotence (#417) : `webServer` puis `globalSetup` appellent tous deux cette fonction.
  // Si les placeholders sont déjà en place, on ne refait ni génération ni sauvegarde : le marqueur
  // créé par le premier appel doit rester celui de l'état d'origine pour la restauration finale.
  const alreadyPlaceholder = isPlaceholderAssetDir(publicDir);
  if (!alreadyPlaceholder) {
    // Sauvegarde des fichiers qui vont être écrasés (restaurée par le globalTeardown après les tests).
    const existingMarker = readBackupMarker(publicDir);
    const backup = existingMarker ? null : backupAssets(publicDir, PLACEHOLDER_ASSET_FILES);
    if (backup) writeBackupMarker(publicDir, backup);
    const restoreNow = (): void => {
      backup?.restore();
      backup?.dispose();
      rmSync(join(publicDir, ".e2e-assets-backup.json"), { force: true });
    };
    const restoreOnSignal = (): void => {
      restoreNow();
      process.exit(130);
    };
    process.once("SIGINT", restoreOnSignal);
    process.once("SIGTERM", restoreOnSignal);
    try {
      generatePlaceholderAssets(publicDir, { force });
    } catch (error) {
      restoreNow();
      throw error;
    } finally {
      process.removeListener("SIGINT", restoreOnSignal);
      process.removeListener("SIGTERM", restoreOnSignal);
    }
  }
  copyPwaShellFiles(publicDir);
  // Manifeste des dimensions (#315) : placements sprites en pixels absolus dès la première frame.
  generateImageDimensions(join(publicDir, "assets"));
  return { publicDir, mode: "placeholders" };
}

// Exécution directe : `node --import tsx tests/e2e/prepare-assets.ts` (commande webServer).
const invokedDirectly = /prepare-assets\.(ts|js)$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  const force = process.argv.includes("--force");
  const { publicDir, mode } = prepareE2eAssets({ force });
  console.log(`[e2e] assets ${mode === "real" ? "réels servis" : "placeholders générés (dossier isolé)"} depuis ${publicDir}`);
}
