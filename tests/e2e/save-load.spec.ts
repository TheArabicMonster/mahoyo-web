import { test, expect, type Page } from "@playwright/test";

/** Ouvre l'écran de sauvegarde depuis le jeu (clic droit puis menu rapide). */
async function openSaveScreen(page: Page): Promise<void> {
  await page.mouse.click(640, 360, { button: "right" });
  await page.locator("[data-quick-menu='save']").click();
  await expect(page.locator(".mh-sl-save").first()).toBeVisible();
}

test.describe("Écrans de sauvegarde et de chargement (#196)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      // Le player doit repartir d'un stockage vide au premier chargement seulement (pas après `reload`).
      if (!sessionStorage.getItem("e2e-cleared")) {
        localStorage.clear();
        sessionStorage.setItem("e2e-cleared", "1");
      }
    });
  });

  test("aller-retour : sauvegarder dans un emplacement, recharger la page, charger", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Nouvelle partie").click();
    const text = page.locator("#text");
    await expect(text).toContainText(/\S{5}/, { timeout: 15000 });

    await openSaveScreen(page);
    const slot3 = page.locator("[data-slot='3']");
    // Le premier point d'arrêt peut ne pas être atteint tout de suite : on réessaie jusqu'à « Sauvegardé ».
    await expect(async () => {
      await slot3.locator(".mh-sl-save").click();
      await expect(page.locator("#ui-toast")).toContainText("Sauvegardé", { timeout: 1500 });
    }).toPass({ timeout: 15000 });
    // L'écran se rafraîchit : la fiche est pleine, avec titre de scène et date au format de l'original.
    await expect(slot3.locator("time")).toHaveText(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
    await expect(slot3.locator(".mh-sl-scene")).not.toBeEmpty();
    const title = (await slot3.locator(".mh-sl-scene").textContent()) ?? "";

    // Commentaire et verrou persistent après rechargement.
    await slot3.locator(".mh-sl-comment").fill("Avant le choix");
    await slot3.locator(".mh-sl-comment").press("Enter");
    await slot3.locator(".mh-sl-lock input").check();
    await expect(slot3.locator(".mh-sl-delete")).toBeDisabled();
    await page.waitForTimeout(150);

    await page.reload();
    await page.getByRole("button", { name: /^Charger$/ }).first().click();
    const loaded = page.locator("[data-slot='3']");
    await expect(loaded.locator(".mh-sl-scene")).toHaveText(title);
    await expect(loaded.locator(".mh-sl-comment")).toHaveValue("Avant le choix");
    await expect(loaded.locator(".mh-sl-lock input")).toBeChecked();
    await expect(loaded.locator(".mh-sl-delete")).toBeDisabled();

    // Charger : confirmation (Oui présélectionné), puis retour en jeu.
    await loaded.locator(".mh-sl-load").click();
    const yes = page.locator(".mh-ui-confirm-yes");
    await expect(yes).toBeVisible();
    await expect(yes).toBeFocused();
    await yes.click();
    await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game", { timeout: 15000 });
    await expect(text).toContainText(/\S{5}/);
  });

  test("navigation entre pages, clavier, et géométrie à 1280×720 sans débordement", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Charger$/ }).first().click();
    await expect(page.locator(".mh-sl")).toBeVisible();

    await expect(page.locator("article.mh-sl-card")).toHaveCount(8);
    await expect(page.locator(".mh-sl-page")).toHaveCount(15);
    await page.locator(".mh-sl-page").nth(14).click();
    await expect(page.locator("[data-slot='118']")).toBeVisible();
    await expect(page.locator(".mh-sl-page[aria-current='page']")).toHaveText("15");
    await page.keyboard.press("PageUp");
    await expect(page.locator(".mh-sl-page[aria-current='page']")).toHaveText("14");

    // Flèches dans la grille puis Échap.
    await page.locator(".mh-sl-page").nth(0).click();
    await page.locator("[data-slot='auto']").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-slot='quick']")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("[data-slot='2']")).toBeFocused();

    const geo = await page.evaluate(() => {
      const vp = document.querySelector("#viewport")!.getBoundingClientRect();
      const rel = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { l: b.left - vp.left, t: b.top - vp.top, r: b.right - vp.left, b: b.bottom - vp.top, w: b.width, h: b.height };
      };
      const cards = [...document.querySelectorAll(".mh-sl-card")].map(rel);
      const screen = document.querySelector(".mh-sl") as HTMLElement;
      return {
        vp: { w: vp.width, h: vp.height },
        cards,
        pager: rel(document.querySelector(".mh-sl-pager")!),
        back: rel(document.querySelector(".mh-sl-back")!),
        scroll: { w: screen.scrollWidth, h: screen.scrollHeight },
        inner: [...document.querySelectorAll(".mh-sl-card")].some((c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1),
        night: document.querySelector("#ui-menu")!.classList.contains("mh-ui-night"),
      };
    });
    expect(geo.night).toBe(true);
    expect(geo.cards).toHaveLength(8);
    // Fiches de 497 × 135 px dans le repère logique 1280×720, 2 colonnes × 4 lignes.
    for (const c of geo.cards) {
      expect(Math.abs(c.w - 497)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.h - 135)).toBeLessThanOrEqual(2);
      expect(c.l).toBeGreaterThanOrEqual(0);
      expect(c.r).toBeLessThanOrEqual(geo.vp.w);
      expect(c.t).toBeGreaterThanOrEqual(0);
      expect(c.b).toBeLessThanOrEqual(geo.vp.h);
    }
    expect(new Set(geo.cards.map((c) => Math.round(c.l))).size).toBe(2);
    expect(new Set(geo.cards.map((c) => Math.round(c.t))).size).toBe(4);
    expect(geo.pager.b).toBeLessThanOrEqual(geo.vp.h);
    expect(geo.back.b).toBeLessThanOrEqual(geo.vp.h);
    expect(geo.back.r).toBeLessThanOrEqual(geo.vp.w);
    expect(geo.scroll.w).toBeLessThanOrEqual(geo.vp.w);
    expect(geo.scroll.h).toBeLessThanOrEqual(geo.vp.h);
    expect(geo.inner).toBe(false);

    await page.keyboard.press("Escape");
    await expect(page.locator(".mh-sl")).toHaveCount(0);
  });
});
