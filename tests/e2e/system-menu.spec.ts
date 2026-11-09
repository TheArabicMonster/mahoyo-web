import { test, expect, type Page } from "@playwright/test";

/** HUD-06 (#194) : menu système plein cadre (clic droit, Échap, retour au titre avec confirmation). */

async function startGame(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.locator(".mh-ui-new-game").click();
  await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
}

const menu = (page: Page) => page.locator(".mh-sysmenu");

test.describe("Menu système (HUD-06)", () => {
  test("le clic droit ouvre le menu, un second clic droit le referme", async ({ page }) => {
    await startGame(page);
    await expect(menu(page)).toHaveCount(0);
    await page.mouse.click(400, 300, { button: "right" });
    await expect(menu(page)).toBeVisible();
    await expect(page.locator("#ui-pause")).toHaveClass(/mh-ui-night-veil/);
    await page.mouse.click(400, 300, { button: "right" });
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator("#ui-pause")).not.toHaveClass(/mh-ui-night/);
  });

  test("Échap ouvre puis ferme le menu ; « Back » le referme aussi", async ({ page }) => {
    await startGame(page);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeVisible();
    await page.locator(".mh-sysmenu-back").click();
    await expect(menu(page)).toHaveCount(0);
  });

  test("9 entrées dans l'ordre d'origine, sans exitgame ; le focus clavier est visible et piégé", async ({ page }) => {
    await startGame(page);
    await page.keyboard.press("Escape");
    const ids = await page.locator(".mh-sysmenu-entry").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.entry));
    expect(ids).toEqual(["save", "load", "config", "auto", "skip", "backlog", "flowchart", "graphic", "title"]);

    // Focus initial sur la première entrée, anneau visible (clavier).
    await expect(page.locator('[data-entry="save"]')).toBeFocused();
    const outline = await page.locator('[data-entry="save"]').evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(outline).toBe("solid");

    // Maj+Tab depuis la première entrée boucle sur « Back » ; Tab depuis « Back » revient à la première.
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".mh-sysmenu-back")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-entry="save"]')).toBeFocused();
  });

  test("retour au titre : confirmation avec Non par défaut, Non reste dans le menu", async ({ page }) => {
    await startGame(page);
    await page.mouse.click(400, 300, { button: "right" });
    await page.locator('[data-entry="title"]').click();
    const dialog = page.locator(".mh-ui-confirm-box");
    await expect(dialog).toBeVisible();
    await expect(page.locator(".mh-ui-confirm-no")).toBeFocused();

    await page.keyboard.press("Enter"); // Non
    await expect(dialog).toHaveCount(0);
    await expect(menu(page)).toBeVisible();
  });

  test("retour au titre : Oui ramène à l'écran titre", async ({ page }) => {
    await startGame(page);
    await page.mouse.click(400, 300, { button: "right" });
    await page.locator('[data-entry="title"]').click();
    await page.locator(".mh-ui-confirm-yes").click();
    await expect(page.locator(".mh-ui-new-game")).toBeVisible({ timeout: 15000 });
    await expect(menu(page)).toHaveCount(0);
  });

  test("à 1280×720 : colonne à droite, en-tête et « Back » aux positions de l'original (±2 %)", async ({ page }) => {
    await startGame(page);
    await page.mouse.click(400, 300, { button: "right" });
    await expect(menu(page)).toBeVisible();
    // Laisse finir l'apparition de 270 ms avant de mesurer.
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const origin = document.querySelector("#ui-overlay")!.getBoundingClientRect();
      const box = (sel: string) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { x: r.left - origin.left, y: r.top - origin.top, cy: r.top - origin.top + r.height / 2 };
      };
      return {
        w: origin.width,
        h: origin.height,
        save: box('[data-entry="save"]'),
        title: box('[data-entry="title"]'),
        head: box(".mh-sysmenu-head"),
        back: box(".mh-sysmenu-back"),
      };
    });
    expect(m.w).toBe(1280);
    expect(m.h).toBe(720);
    const near = (value: number, target: number, tol: number) => expect(Math.abs(value - target)).toBeLessThanOrEqual(tol);
    const tx = 0.02 * 1280;
    const ty = 0.02 * 720;
    near(m.save.x, 1092, tx); // colonne x >= 1638 @1080
    near(m.save.cy, 115, ty); // 1re entrée : 172 @1080
    near(m.title.cy, 445, ty); // 9e entrée : 667 @1080
    near(m.head.x, 1087, tx);
    near(m.head.y, 29, ty);
    near(m.back.x, 1095, tx);
    near(m.back.y + 14, 676, ty); // centre vertical de « Back » : 999-1031 @1080
  });

  test("sans animation sous prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startGame(page);
    await page.mouse.click(400, 300, { button: "right" });
    const animation = await page.locator("#ui-pause").evaluate((e) => getComputedStyle(e).animationName);
    expect(animation).toBe("none");
  });
});
