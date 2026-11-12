/**
 * #382 : la touche d'avance rapide configurée (Maj par défaut) engage réellement le skip
 * maintenu et le relâchement l'arrête. Mode placeholders, sans attendre d'horloge arbitraire.
 */
import { test, expect, type Page } from "@playwright/test";

const text = (page: Page) => page.locator("#text");
const pageText = async (page: Page): Promise<string> =>
  (await text(page).innerText()).replace(/[▽▼]/g, "").trim();

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
    // Portée « tout » pour que la première lecture (placeholders non lus) engage le skip.
    const key = "mahoyo.settings";
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ display: { fastForwardScope: "all" } }));
    }
    // @ts-ignore — fige les animations WAAPI, comme les autres tests e2e.
    Element.prototype.animate = function () {
      return { play: () => this, pause: () => this, cancel: () => this, finish: () => this, onfinish: null };
    };
  });
  await page.goto("/");
  await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });
  await page.locator(".mh-ui-new-game").click();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
  await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game");
  await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
}

test.describe("avance rapide touche configurée (#382)", () => {
  test("maintenir Maj accélère et relâcher arrête", async ({ page }) => {
    await boot(page);
    const before = await pageText(page);
    await page.keyboard.down("Shift");
    await expect(page.locator(".mh-ui-badge-skip")).toBeVisible({ timeout: 5000 });
    // Le skip enchaîne les pages : le texte change sans nouvel appui.
    await expect
      .poll(async () => pageText(page), { timeout: 5000, intervals: [50, 100, 200] })
      .not.toBe(before);
    await page.keyboard.up("Shift");
    // Relâchement : le mode skip est rendu au mode précédent (badge masqué). Le texte peut encore
    // finir sa frappe/transition en cours, ce n'est pas un signe de skip maintenu.
    await expect(page.locator(".mh-ui-badge-skip")).toBeHidden({ timeout: 5000 });
  });

  test("Ctrl reste une avance rapide rétrocompatible quand ce n'est pas la touche choisie", async ({ page }) => {
    await boot(page);
    await page.keyboard.down("Control");
    await expect(page.locator(".mh-ui-badge-skip")).toBeVisible({ timeout: 5000 });
    await page.keyboard.up("Control");
    await expect(page.locator(".mh-ui-badge-skip")).toBeHidden({ timeout: 5000 });
  });
});
