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
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { generatePlaceholderAssets } from "./placeholders.js";

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
export function prepareE2eAssets(): { publicDir: string; mode: E2eAssetsMode } {
  const publicDir = e2ePublicDir();
  const real = Boolean(process.env.MAHOYO_E2E_REAL_ASSETS);

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

  generatePlaceholderAssets(publicDir);
  return { publicDir, mode: "placeholders" };
}

// Exécution directe : `node --import tsx tests/e2e/prepare-assets.ts` (commande webServer).
const invokedDirectly = /prepare-assets\.(ts|js)$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  const { publicDir, mode } = prepareE2eAssets();
  console.log(`[e2e] assets ${mode === "real" ? "réels servis" : "placeholders générés"} depuis ${publicDir}`);
}
