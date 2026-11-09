import { test, expect } from "@playwright/test";
import { png1x1 } from "./placeholders.js";

/**
 * HUD-15 (#208) : galerie CG, vérifiée dans Chromium (mode placeholders, aucun asset du jeu).
 *
 * Le manifeste d'assets de l'utilisateur est intercepté et remplacé par un manifeste de test
 * (clés inventées) ; les images demandées reçoivent un PNG 1×1 généré à la volée. On vérifie le
 * déverrouillage par la progression persistée (`mahoyo.cg`), la visionneuse (zoom, suivant) et
 * l'accessibilité de base (Échap, focus rendu au sous-menu Extra).
 */
const manifest = {
  version: 1,
  generatedAt: "2026-01-01T00:00:00Z",
  images: {
    cg01: { url: "image/cg01.webp", source: "image/cg01.tlg", kind: "image" },
    cg02: { url: "image/cg02.webp", source: "image/cg02.tlg", kind: "image" },
    bg01: { url: "bg/bg01.webp", source: "bg/bg01.tlg", kind: "bg" },
    aoko: { url: "image/aoko.webp", source: "fg/aoko.tlg", kind: "image" },
  },
  audio: {},
  scenarios: {},
};

test.describe("CG mode (HUD-15)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await page.route("**/assets/asset-manifest.json", (route) => route.fulfill({ json: manifest }));
    const png = png1x1(20, 40, 80);
    await page.route("**/assets/image/**", (route) => route.fulfill({ body: png, contentType: "image/png" }));
    await page.route("**/assets/bg/**", (route) => route.fulfill({ body: png, contentType: "image/png" }));
  });

  /** Ouvre Extra > Cgmode et attend la grille. */
  async function openGallery(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/");
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 15000 });
    await page.locator('[data-entry="extra"]').click();
    const entry = page.locator('[data-entry="cgmode"]');
    await expect(entry).not.toHaveAttribute("aria-disabled", "true");
    await entry.click();
    await expect(page.locator("#ui-cg .mh-cg-screen")).toBeVisible();
  }

  test("sans CG vue : grille verrouillée (« image non affichée »), aucune requête d'image", async ({ page }) => {
    await openGallery(page);
    const tiles = page.locator("#ui-cg .mh-cg-tile");
    await expect(tiles).toHaveCount(2); // 2 CG évènement, les sprites (fg/) sont exclus
    await expect(page.locator("#ui-cg .mh-cg-tile[data-locked='true']")).toHaveCount(2);
    const labels = page.locator("#ui-cg .mh-cg-tile-locked");
    await expect(labels).toHaveCount(2);
    for (const text of await labels.allTextContents()) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
    await expect(page.locator("#ui-cg .mh-cg-thumb")).toHaveCount(0);

    // La bascule Arrière-plan a sa propre entrée (verrouillée ici aussi).
    await page.locator('.mh-cg-tab[data-category="background"]').click();
    await expect(page.locator("#ui-cg .mh-cg-tile")).toHaveCount(1);
    await expect(page.locator("#ui-cg .mh-cg-tile[data-locked='true']")).toHaveCount(1);

    // Échap referme la galerie et rend le focus à l'entrée Cgmode.
    await page.keyboard.press("Escape");
    await expect(page.locator("#ui-cg .mh-cg-screen")).toHaveCount(0);
    await expect(page.locator('[data-entry="cgmode"]')).toBeFocused();
  });

  test("CG vue persistée : vignette calculée à l'exécution, visionneuse zoom + suivant", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("mahoyo.cg", JSON.stringify(["cg01"]));
    });
    await openGallery(page);
    const tiles = page.locator("#ui-cg .mh-cg-tile");
    await expect(tiles).toHaveCount(2);
    const first = tiles.first();
    await expect(first).toHaveAttribute("data-locked", "false");
    const thumb = first.locator("img.mh-cg-thumb");
    await expect(thumb).toHaveAttribute("src", /\/assets\/image\/cg01\.webp$/);
    // L'image de la tuile est bien chargée (PNG 1×1 servi par la route de test).
    expect(await thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    // La CG non vue reste verrouillée.
    await expect(tiles.nth(1)).toHaveAttribute("data-locked", "true");

    await first.click();
    const viewer = page.locator("#ui-cg .mh-cg-viewer");
    await expect(viewer).toBeVisible();
    await expect(page.locator("#ui-cg .mh-cg-viewer-image")).toHaveAttribute("src", /\/assets\/image\/cg01\.webp$/);
    await expect(page.locator(".mh-cg-viewer-caption")).toHaveText("1 / 1");

    const zoom = () =>
      page.locator(".mh-cg-viewer-frame").evaluate((el) => getComputedStyle(el).getPropertyValue("--mh-cg-zoom").trim());
    expect(await zoom()).toBe("1");
    await page.locator(".mh-cg-viewer-button").nth(3).click(); // « + »
    expect(await zoom()).toBe("1.5");
    await page.keyboard.press("+");
    expect(await zoom()).toBe("2");
    await page.locator(".mh-cg-viewer-button").nth(2).click(); // « 1:1 »
    expect(await zoom()).toBe("1");

    // Une seule CG déverrouillée : précédent/suivant bouclent sur elle-même.
    await page.locator(".mh-cg-viewer-next").click();
    await expect(page.locator(".mh-cg-viewer-caption")).toHaveText("1 / 1");
    // Échap ferme la visionneuse, pas l'écran.
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(page.locator("#ui-cg .mh-cg-screen")).toBeVisible();
  });
});
