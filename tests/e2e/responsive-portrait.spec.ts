import { test, expect, type Page } from "@playwright/test";

/**
 * #210 (WEB-02) — portrait : scène 16:9 en lettrebox en haut et **zone de texte dédiée sous la
 * scène** (décision propriétaire 4, aucune superposition), écrans système reflowés et cibles
 * tactiles ≥ 44 px. Le paysage (desktop) doit rester inchangé.
 */

const text = (page: Page) => page.locator("#text");

async function boot(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
    // @ts-ignore — stub volontairement minimal, comme les autres specs e2e.
    Element.prototype.animate = function () {
      return { play: () => this, pause: () => this, cancel: () => this, finish: () => this, onfinish: null };
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });
}

async function startGame(page: Page): Promise<void> {
  await page.locator(".mh-ui-new-game").click();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
  await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game");
}

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

async function boxes(page: Page): Promise<{ scene: Box; textbox: Box; text: { font: number } }> {
  return page.evaluate(() => {
    const rect = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const sceneEl = document.querySelector<HTMLElement>(".mh-stage")!;
    const textboxEl = document.querySelector<HTMLElement>("#textbox")!;
    const textEl = document.querySelector<HTMLElement>(".mh-stage-text")!;
    return {
      scene: rect(sceneEl),
      textbox: rect(textboxEl),
      text: { font: Number.parseFloat(getComputedStyle(textEl).fontSize) },
    };
  });
}

test.describe("Portrait (#210)", () => {
  for (const [label, width, height] of [
    ["téléphone 390×844", 390, 844],
    ["tablette 768×1024", 768, 1024],
  ] as const) {
    test(`${label} : texte dans une zone dédiée sous la scène, sans superposition`, async ({ page }) => {
      await boot(page, width, height);
      await startGame(page);
      const { scene, textbox, text: t } = await boxes(page);

      // Scène 16:9 en haut, à la largeur de l'écran (lettrebox) : ~219 px de haut sur 390 px.
      expect(Math.abs(scene.width - width)).toBeLessThanOrEqual(2);
      expect(Math.abs(scene.height - width * (9 / 16))).toBeLessThanOrEqual(2);
      expect(scene.top).toBeLessThanOrEqual(1);

      // La boîte de texte est **sous** la scène : boîtes englobantes disjointes.
      expect(textbox.top).toBeGreaterThanOrEqual(scene.bottom - 1);
      expect(textbox.height).toBeGreaterThan(0);
      expect(textbox.width).toBeGreaterThan(width * 0.8);

      // Lisibilité : taille de police réelle ≥ 14 px, pas de défilement horizontal.
      expect(t.font).toBeGreaterThanOrEqual(14);
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflowX).toBe(false);
    });
  }

  test("paysage 1280×720 : le texte reste dans la scène (aucune régression)", async ({ page }) => {
    await boot(page, 1280, 720);
    await startGame(page);
    const { scene, textbox } = await boxes(page);
    // Desktop : la boîte de texte est superposée à la scène (comportement v1.0 inchangé).
    expect(textbox.top).toBeLessThan(scene.bottom);
    // Le dock portrait n'est pas affiché.
    const dockDisplay = await page
      .locator("#portrait-text-dock")
      .evaluate((el) => getComputedStyle(el).display)
      .catch(() => "missing");
    expect(dockDisplay === "none" || dockDisplay === "missing").toBe(true);
    // Le stage garde son agrandissement 1.25 (repère 1280×720).
    const transform = await page.locator(".mh-stage").evaluate((el) => (el as HTMLElement).style.transform);
    expect(transform === "" || transform.includes("1.25")).toBe(true);
  });

  test("cibles tactiles ≥ 44 px en portrait (titre et menu système)", async ({ page }) => {
    await boot(page, 390, 844);

    // Écran titre : chaque entrée du menu doit faire ≥ 44 px de haut.
    const titleEntries = page.locator(".mh-ui-title-menu .mh-ui-title-entry");
    await expect(titleEntries.first()).toBeVisible({ timeout: 15000 });
    const titleHeights = await titleEntries.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    expect(titleHeights.length).toBeGreaterThan(0);
    for (const h of titleHeights) expect(h).toBeGreaterThanOrEqual(44);

    // Menu système en jeu : entrées ≥ 44 px.
    await startGame(page);
    await page.keyboard.press("Escape");
    const entries = page.locator(".mh-sysmenu-entry");
    await expect(entries.first()).toBeVisible({ timeout: 10000 });
    const heights = await entries.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });
});
