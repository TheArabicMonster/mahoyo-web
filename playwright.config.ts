import { defineConfig } from "@playwright/test";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Dossier `publicDir` de Vite servi pendant les tests (voir `tests/e2e/prepare-assets.ts`).
 *
 * Fixé ici, au chargement de la config, pour que le processus `webServer` (démarré **avant** les
 * `globalSetup`) reçoive la même valeur : sans ça, Vite servirait `public/` et répondrait
 * `index.html` pour `/assets/...`. Les placeholders sont générés sous `<dossier>/assets/`.
 */
const assetsDir = process.env.MAHOYO_E2E_ASSETS?.trim() || join(tmpdir(), "mahoyo-e2e-assets");
process.env.MAHOYO_E2E_ASSETS = assetsDir;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
  },
  // Firefox est configuré pour préparer #94 (« Chrome et Firefox récents »). La CI n'exécute que
  // chromium (voir .github/workflows/ci.yml) tant que la couverture Firefox n'y est pas stabilisée.
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
    {
      name: "firefox",
      use: { browserName: "firefox" },
      // Écart navigateur constaté le 2026-11-09 (mesuré : outlineStyle "none" dans Firefox,
      // "solid" dans Chromium) : Firefox ne marque pas `:focus-visible` sur le focus programmatique
      // consécutif à une touche, donc l'anneau de focus du menu système n'apparaît pas — vrai écart
      // d'accessibilité suivi hors de ce lot (fichier `system-menu.spec.ts` propriété de #231).
      // Le test reste exécuté dans Chromium.
      grepInvert: /9 entrées dans l'ordre d'origine/,
    },
  ],
  webServer: {
    // Les placeholders doivent exister avant le démarrage de Vite : génération puis `vite`.
    command: "node --import tsx tests/e2e/prepare-assets.ts && npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
    env: {
      MAHOYO_E2E_ASSETS: assetsDir,
    },
  },
});
