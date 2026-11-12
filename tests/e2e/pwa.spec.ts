/**
 * Test e2e PWA (#96) + cache d'assets versionné (#372) : manifeste, service worker, cache
 * `mahoyo-assets-<assetsVersion>`, purge à l'activation, 2e passage en cache chaud et lecture
 * hors ligne. Tourne sur un build de production (`vite preview`, voir `playwright.pwa.config.ts`)
 * avec les placeholders — aucun asset du jeu.
 */
import { test, expect } from "@playwright/test";

test.describe("PWA installable et hors ligne", () => {
  test("manifeste valide, SW actif, cache d'assets versionné, 2e passage chaud et lecture hors ligne", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 20_000 });

    // 1. Manifeste installable : champs requis + icônes 192/512.
    const manifest = (await page.evaluate(async () => {
      const response = await fetch("/manifest.json");
      return response.json();
    })) as {
      name?: string;
      start_url?: string;
      display?: string;
      theme_color?: string;
      icons?: { sizes?: string; purpose?: string }[];
    };
    expect(manifest.name).toContain("Mahoyo");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#1a1a2e");
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((manifest.icons ?? []).some((icon) => icon.purpose?.includes("maskable"))).toBe(true);

    // 2. Service worker : enregistré, installé et contrôleur de la page.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
        });
      }
      return Boolean(registration.active);
    });

    // 3. Version d'assets écrite par le pipeline (placeholders : `placeholders-v1`).
    const assetsVersion = await page.evaluate(async () => {
      const response = await fetch("/assets/asset-manifest.json");
      const manifest = (await response.json()) as { assetsVersion?: string };
      return manifest.assetsVersion;
    });
    expect(assetsVersion).toBe("placeholders-v1");

    // 4. Rechargement en ligne : les requêtes passent par le SW (pré-cache + cache d'assets).
    await page.reload();
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 20_000 });

    const cachesInfo = await page.evaluate(async () => {
      const names = await caches.keys();
      const assetsCaches = names.filter((name) => name.startsWith("mahoyo-assets-"));
      const shell = names.find((name) => name.startsWith("mahoyo-shell-"));
      const count = async (name: string | undefined): Promise<number> =>
        name ? (await (await caches.open(name)).keys()).length : 0;
      return { names, assetsCaches, shellEntries: await count(shell), assetsEntries: await count(assetsCaches[0]) };
    });
    // Un seul cache d'assets, nommé avec la version du manifeste (#372).
    expect(cachesInfo.assetsCaches).toEqual([`mahoyo-assets-${assetsVersion}`]);
    expect(cachesInfo.names.some((name) => name.startsWith("mahoyo-shell-"))).toBe(true);
    expect(cachesInfo.shellEntries).toBeGreaterThan(0);
    expect(cachesInfo.assetsEntries).toBeGreaterThan(0);
    // L'ancien cache runtime non versionné a disparu.
    expect(cachesInfo.names.some((name) => name.startsWith("mahoyo-runtime-"))).toBe(false);

    // 5. 2e passage : ≥ 95 % des assets chargés sont présents dans le cache versionné
    //    (cache-first → ces requêtes seront servies sans réseau).
    const hitRatio = await page.evaluate(async (version) => {
      const resourcePaths = performance
        .getEntriesByType("resource")
        .map((entry) => new URL(entry.name).pathname)
        .filter((path) => path.startsWith("/assets/"));
      const uniquePaths = [...new Set(resourcePaths)];
      const assetsCache = await caches.open(`mahoyo-assets-${version}`);
      const shellName = (await caches.keys()).find((name) => name.startsWith("mahoyo-shell-"));
      const shellCache = shellName ? await caches.open(shellName) : null;
      let hits = 0;
      const missing: string[] = [];
      for (const path of uniquePaths) {
        // Les bundles JS/CSS de l'app sont dans le pré-cache de coquille, les assets du jeu dans
        // le cache versionné : un hit dans l'un ou l'autre est un passage en cache chaud.
        const match = (await assetsCache.match(path)) ?? (shellCache ? await shellCache.match(path) : undefined);
        if (match) hits++;
        else missing.push(path);
      }
      return { total: uniquePaths.length, hits, ratio: uniquePaths.length > 0 ? hits / uniquePaths.length : 1, missing };
    }, assetsVersion);
    expect(hitRatio.total).toBeGreaterThan(0);
    expect(hitRatio.ratio).toBeGreaterThanOrEqual(0.95);

    // 6. Purge à l'activation : un ancien cache d'assets factice est supprimé quand le SW
    //    s'active (pas pendant les fetches). On enregistre le même SW avec une URL de script
    //    distincte pour forcer une installation/activation ; l'app applique SKIP_WAITING puis
    //    recharge une fois (mise à jour contrôlée de `register.ts`).
    await page.evaluate(async () => {
      const cache = await caches.open("mahoyo-assets-ancienne-version");
      await cache.put("/assets/ancien.webp", new Response("vieux"));
      await navigator.serviceWorker.register("/sw.js?e2e-purge=1");
    });
    const deadline = Date.now() + 20_000;
    let purged = false;
    while (Date.now() < deadline) {
      try {
        purged = await page.evaluate(async () => !(await caches.keys()).includes("mahoyo-assets-ancienne-version"));
      } catch {
        // La page se recharge (mise à jour contrôlée) : on réessaie à la prochaine itération.
      }
      if (purged) break;
      await page.waitForTimeout(250);
    }
    await page.waitForLoadState("load");
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 20_000 });
    expect(purged).toBe(true);
    const cachesAfterPurge = await page.evaluate(async () => caches.keys());
    expect(cachesAfterPurge.filter((name) => name.startsWith("mahoyo-assets-"))).toEqual([
      `mahoyo-assets-${assetsVersion}`,
    ]);

    // 7. Pas de vidage en boucle : le cache ne rétrécit pas d'un passage à l'autre.
    const before = await page.evaluate(async (version) => (await (await caches.open(`mahoyo-assets-${version}`)).keys()).length, assetsVersion);
    await page.reload();
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 20_000 });
    const after = await page.evaluate(async (version) => (await (await caches.open(`mahoyo-assets-${version}`)).keys()).length, assetsVersion);
    expect(after).toBeGreaterThanOrEqual(before);

    // 8. Hors ligne : rechargement de l'application depuis les caches.
    await context.setOffline(true);
    await page.reload();
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 30_000 });
    await expect(page.locator("#app")).not.toBeEmpty();
  });

  test("le service worker est bien versionné (cache de coquille par build)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const names = await page.evaluate(async () => caches.keys());
    const shell = names.filter((name) => name.startsWith("mahoyo-shell-"));
    expect(shell).toHaveLength(1);
    expect(shell[0]).toMatch(/^mahoyo-shell-[0-9a-f]{12}$/);
  });
});
