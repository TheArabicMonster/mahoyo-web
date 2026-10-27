import { test, expect } from "@playwright/test";

test.describe("Player e2e", () => {
  test("démarre le prologue et affiche la scène + le texte", async ({ page }) => {
    // Intercepter et geler les animations WAAPI avant que le player ne démarre.
    await page.addInitScript(() => {
      // @ts-ignore
      window.Element.prototype.animate = function () {
        return { play: () => this, pause: () => this, cancel: () => this, finish: () => this, onfinish: null };
      };
    });

    await page.goto("/");

    // Le viewport et le texte du prologue doivent apparaître.
    const viewport = page.locator("#viewport");
    await viewport.waitFor({ timeout: 10000 });

    const textEl = page.locator("#text");
    await textEl.waitFor({ timeout: 10000 });
    await expect(textEl).toContainText("その子の影になったのは", { timeout: 10000 });

    // Le stage doit contenir un sprite/partbg ou un bg.
    const stage = page.locator(".mh-stage");
    await expect(stage).toBeVisible();
  });
});
