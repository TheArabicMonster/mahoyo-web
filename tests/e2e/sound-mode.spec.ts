import { test, expect } from "@playwright/test";

/**
 * HUD-16 (#209) : Sound mode, vérifié dans Chromium (mode placeholders, aucun asset du jeu).
 *
 * Le manifeste de l'utilisateur est intercepté : il porte des métadonnées inventées
 * (`title`/`composer`) pour vérifier que la galerie les affiche sans qu'aucun titre du jeu ne soit
 * commité. La lecture réelle est refusée par le navigateur (piste absente) : l'écran doit rester
 * stable (autoplay/erreur de média rattrapés par le lecteur).
 */
const manifest = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00Z",
  images: {},
  audio: {
    bgm01: {
      url: "bgm/01.ogg",
      source: "bgm/01.ogg",
      kind: "bgm",
      title: "Titre utilisateur A",
      composer: "Compositeur A",
    },
    bgm02: { url: "bgm/02.ogg", source: "bgm/02.ogg", kind: "bgm" },
  },
  scenarios: {},
};

test.describe("Sound mode (HUD-16)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await page.route("**/assets/asset-manifest.json", (route) => route.fulfill({ json: manifest }));
  });

  /** Ouvre Extra > Soundmode et attend la galerie. */
  async function openGallery(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/");
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 15000 });
    await page.locator('[data-entry="extra"]').click();
    const entry = page.locator('[data-entry="soundmode"]');
    await expect(entry).not.toHaveAttribute("aria-disabled", "true");
    await entry.click();
    await expect(page.locator("#ui-sound .mh-sound-screen")).toBeVisible();
  }

  test("liste les BGM avec les métadonnées du manifeste utilisateur, sans titre du jeu", async ({ page }) => {
    await openGallery(page);
    const tracks = page.locator("#ui-sound .mh-sound-track");
    await expect(tracks).toHaveCount(2);
    // Métadonnées fournies par l'utilisateur (manifeste intercepté) : affichées telles quelles.
    await expect(tracks.first().locator(".mh-sound-track-title")).toHaveText("Titre utilisateur A");
    await expect(tracks.first().locator(".mh-sound-track-composer")).toHaveText("Compositeur A");
    // Sans métadonnées, libellé neutre du dictionnaire (aucun titre du jeu).
    await expect(tracks.nth(1).locator(".mh-sound-track-composer")).toBeHidden();
    // Commandes et progression présentes.
    await expect(page.locator("#ui-sound .mh-sound-play")).toBeVisible();
    await expect(page.locator("#ui-sound .mh-sound-progress-range")).toBeDisabled();
    await expect(page.locator("#ui-sound .mh-sound-volume-range")).toBeEnabled();
  });

  test("Espace = lecture, suivant change de morceau, Échap ferme et rend le focus", async ({ page }) => {
    await openGallery(page);
    await page.locator("#ui-sound .mh-sound-track").first().focus();
    await page.keyboard.press(" ");
    await expect(page.locator("#ui-sound .mh-sound-play")).toHaveAttribute("aria-pressed", "true");

    await page.locator("#ui-sound .mh-sound-next").click();
    await expect(page.locator("#ui-sound .mh-sound-track").nth(1)).toHaveClass(/is-current/);

    await page.keyboard.press("Escape");
    await expect(page.locator("#ui-sound .mh-sound-screen")).toHaveCount(0);
    await expect(page.locator('[data-entry="soundmode"]')).toBeFocused();
  });
});
