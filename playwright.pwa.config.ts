/**
 * Configuration Playwright dédiée au test PWA/hors ligne (#96).
 *
 * Contrairement à `playwright.config.ts` (serveur de dev), ce test a besoin d'un
 * **build** réel : le service worker n'est enregistré qu'en production et son
 * pré-cache référence les bundles hachés produits par Vite. Le serveur `preview`
 * sert donc `dist/`, construit ici avec les placeholders (aucun asset du jeu).
 *
 * Chromium uniquement, par choix : l'API Service Worker et `context.setOffline`
 * existent sur Firefox, mais l'installation PWA n'y est pas proposée (surtout sous
 * Linux) et le comportement d'installation n'est pas standardisé ; Chromium est le
 * navigateur de référence pour l'installabilité PWA. Le test vérifie le manifeste,
 * le service worker, les caches et la lecture hors ligne.
 */
import { defineConfig } from "@playwright/test";
import { tmpdir } from "os";
import { join } from "path";

const assetsDir = process.env.MAHOYO_E2E_ASSETS?.trim() || join(tmpdir(), "mahoyo-pwa-assets");
process.env.MAHOYO_E2E_ASSETS = assetsDir;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/pwa.spec.ts",
  // Le parcours installe le SW, recharge en ligne puis hors ligne : marge confortable.
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4174",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    // Placeholders (manifeste + icônes PWA copiés) → build (avec service worker) → preview.
    command:
      "node --import tsx tests/e2e/prepare-assets.ts && npm run build && npm run preview -- --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://localhost:4174",
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      MAHOYO_E2E_ASSETS: assetsDir,
    },
  },
});
