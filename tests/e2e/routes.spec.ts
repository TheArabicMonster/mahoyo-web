import { test, expect, type Page } from "@playwright/test";

/**
 * WEB-04 (#204) : routes d'URL des écrans (`#/title`, `#/game`, `#/load`, `#/save`, `#/config`, `#/backlog`,
 * `#/flowchart`). Le conteneur `#ui-overlay` porte l'écran affiché dans `data-screen`.
 */

const screen = (page: Page) => page.locator("#ui-overlay");
const hash = (page: Page) => page.evaluate(() => location.hash);

async function boot(page: Page, url: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
  });
  await page.goto(url);
  // Témoin de non-rechargement : disparaît si la page est rechargée.
  await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", /.+/, { timeout: 15000 });
  await page.evaluate(() => ((window as unknown as { __noReload?: number }).__noReload = 1));
}

const noReload = (page: Page) => page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload === 1);

async function startGame(page: Page): Promise<void> {
  await page.locator(".mh-ui-new-game").click();
  await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
  await expect(screen(page)).toHaveAttribute("data-screen", "game");
}

test.describe("Routes d'URL (WEB-04)", () => {
  test("sans hash : #/title", async ({ page }) => {
    await boot(page, "/");
    await expect(screen(page)).toHaveAttribute("data-screen", "title");
    expect(await hash(page)).toBe("#/title");
  });

  for (const [route, dataScreen] of [
    ["load", "load"],
    ["config", "settings"],
    ["flowchart", "flowchart"],
  ] as const) {
    test(`lien direct #/${route} : écran ouvert, précédent le ferme (titre), sans rechargement`, async ({ page }) => {
      await boot(page, `/#/${route}`);
      await expect(screen(page)).toHaveAttribute("data-screen", dataScreen);
      expect(await hash(page)).toBe(`#/${route}`);

      await page.goBack();
      await expect(screen(page)).toHaveAttribute("data-screen", "title");
      expect(await hash(page)).toBe("#/title");
      expect(await noReload(page)).toBe(true);

      await page.goForward();
      await expect(screen(page)).toHaveAttribute("data-screen", dataScreen);
      expect(await noReload(page)).toBe(true);
    });
  }

  for (const route of ["game", "save", "backlog", "inconnue"]) {
    test(`lien direct #/${route} sans partie : repli sur le titre`, async ({ page }) => {
      await boot(page, `/#/${route}`);
      await expect(screen(page)).toHaveAttribute("data-screen", "title");
      expect(await hash(page)).toBe("#/title");
    });
  }

  test("le bouton de l'interface qui ferme un écran dépile l'historique, sans boucle", async ({ page }) => {
    await boot(page, "/");
    const before = await page.evaluate(() => history.length);
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-entry="config"]').click();
      await expect(screen(page)).toHaveAttribute("data-screen", "settings");
      expect(await hash(page)).toBe("#/config");
      await page.keyboard.press("Escape");
      await expect(screen(page)).toHaveAttribute("data-screen", "title");
      await expect.poll(() => hash(page)).toBe("#/title");
    }
    expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(before + 1);
    expect(await noReload(page)).toBe(true);
  });

  test("en partie : #/game, menu système sans entrée d'historique, écrans empilés fermés par précédent", async ({ page }) => {
    await boot(page, "/");
    await startGame(page);
    expect(await hash(page)).toBe("#/game");

    await page.keyboard.press("Escape"); // raccourci existant : menu système
    await expect(screen(page)).toHaveAttribute("data-screen", "pause");
    expect(await hash(page)).toBe("#/game");

    await page.locator('[data-entry="config"]').click();
    await expect(screen(page)).toHaveAttribute("data-screen", "settings");
    expect(await hash(page)).toBe("#/config");
    await page.goBack();
    await expect(screen(page)).toHaveAttribute("data-screen", "pause");
    expect(await hash(page)).toBe("#/game");

    await page.locator('[data-entry="save"]').click();
    await expect(screen(page)).toHaveAttribute("data-screen", "save");
    expect(await hash(page)).toBe("#/save");
    await page.goBack();
    await expect(screen(page)).toHaveAttribute("data-screen", "pause");

    // L'historique vide ne s'ouvre pas (HUD-12, #201) : attendre le premier point d'arrêt, qui le remplit.
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    await page.locator('[data-entry="backlog"]').click();
    await expect(screen(page)).toHaveAttribute("data-screen", "backlog");
    expect(await hash(page)).toBe("#/backlog");
    await page.goBack();
    await expect(screen(page)).toHaveAttribute("data-screen", "pause");

    await page.locator('[data-entry="flowchart"]').click();
    await expect(screen(page)).toHaveAttribute("data-screen", "flowchart");
    expect(await hash(page)).toBe("#/flowchart");
    await page.goBack();
    await expect(screen(page)).toHaveAttribute("data-screen", "pause");

    await page.keyboard.press("Escape"); // referme le menu : retour à la partie
    await expect(screen(page)).toHaveAttribute("data-screen", "game");
    expect(await hash(page)).toBe("#/game");
    expect(await noReload(page)).toBe(true);
  });

  test("en partie : un lien #/load ouvre le chargement, précédent reprend la partie", async ({ page }) => {
    await boot(page, "/");
    await startGame(page);
    await page.evaluate(() => (location.hash = "#/load"));
    await expect(screen(page)).toHaveAttribute("data-screen", "load");
    await page.goBack();
    await expect(screen(page)).toHaveAttribute("data-screen", "game");
    expect(await hash(page)).toBe("#/game");
    expect(await noReload(page)).toBe(true);
  });

  test("en partie : #/title demande confirmation (Non par défaut) ; refuser garde la partie et l'URL", async ({ page }) => {
    await boot(page, "/");
    await startGame(page);
    await page.evaluate(() => (location.hash = "#/title"));
    await expect(page.locator(".mh-ui-confirm-box")).toBeVisible();
    await expect(page.locator(".mh-ui-confirm-no")).toBeFocused();
    await page.keyboard.press("Enter"); // Non
    await expect(page.locator(".mh-ui-confirm-box")).toHaveCount(0);
    await expect(screen(page)).toHaveAttribute("data-screen", "game");
    await expect.poll(() => hash(page)).toBe("#/game");
    expect(await noReload(page)).toBe(true);
  });

  // Avec les placeholders de la CI, `Player.returnToTitle` ne rend pas la main (voir system-menu.spec.ts) :
  // ce parcours se vérifie avec les vrais assets locaux, `MAHOYO_E2E_REAL_ASSETS=1`.
  test("en partie : #/title confirmé ramène au titre (assets réels)", async ({ page }) => {
    test.skip(!process.env.MAHOYO_E2E_REAL_ASSETS, "nécessite les vrais assets locaux");
    await boot(page, "/");
    await startGame(page);
    await page.evaluate(() => (location.hash = "#/title"));
    await page.locator(".mh-ui-confirm-yes").click();
    await expect(screen(page)).toHaveAttribute("data-screen", "title", { timeout: 15000 });
    await expect.poll(() => hash(page)).toBe("#/title");
    expect(await noReload(page)).toBe(true);
  });

  test("rechargement sur #/game : plus de partie, repli sur le titre", async ({ page }) => {
    await boot(page, "/");
    await startGame(page);
    await page.reload();
    await expect(screen(page)).toHaveAttribute("data-screen", "title");
    expect(await hash(page)).toBe("#/title");
  });
});
