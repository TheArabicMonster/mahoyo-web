/**
 * Test e2e PWA (#96) : manifeste, service worker, caches et **lecture hors ligne**
 * après un premier chargement. Tourne sur un build de production (`vite preview`,
 * voir `playwright.pwa.config.ts`) avec les placeholders — aucun asset du jeu.
 */
import { test, expect } from "@playwright/test";

test.describe("PWA installable et hors ligne", () => {
  test("manifeste valide, service worker actif, lecture hors ligne après premier chargement", async ({
    page,
    context,
  }) => {
    // 1. Premier chargement en ligne : l'application démarre.
    await page.goto("/");
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 20_000 });

    // 2. Manifeste installable : champs requis + icônes 192/512.
    const manifest = (await page.evaluate(async () => {
      const response = await fetch("/manifest.json");
      return response.json();
    })) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      theme_color?: string;
      icons?: { src?: string; sizes?: string; type?: string; purpose?: string }[];
    };
    expect(manifest.name).toContain("Mahoyo");
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toBe("#1a1a2e");
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((manifest.icons ?? []).some((icon) => icon.purpose?.includes("maskable"))).toBe(true);

    // 3. Service worker : enregistré, installé et contrôleur de la page.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
        });
      }
      return Boolean(registration.active);
    });

    // 4. Rechargement en ligne : tous les fichiers passent par le SW (pré-cache +
    //    cache runtime des assets), donc le hors ligne doit fonctionner ensuite.
    await page.reload();
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 20_000 });

    const cachesInfo = await page.evaluate(async () => {
      const names = await caches.keys();
      const shell = names.find((name) => name.startsWith("mahoyo-shell-"));
      const runtime = names.find((name) => name.startsWith("mahoyo-runtime-"));
      const count = async (name: string | undefined): Promise<number> =>
        name ? (await (await caches.open(name)).keys()).length : 0;
      return { names, shell: await count(shell), runtime: await count(runtime) };
    });
    expect(cachesInfo.names.some((name) => name.startsWith("mahoyo-shell-"))).toBe(true);
    expect(cachesInfo.shell).toBeGreaterThan(0);
    // Les assets du jeu (placeholders) ont été mis en cache à la demande.
    expect(cachesInfo.runtime).toBeGreaterThan(0);

    // 5. Hors ligne : rechargement de l'application depuis les caches.
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
