import { test, expect, type Page } from "@playwright/test";

/**
 * HUD-09 (#200) : écran de configuration au design d'origine à 1280×720 (docs/ANALYSE_HUD_ORIGINAL.md §2.9,
 * docs/DESIGN.md §9.10), clavier, bascule « tout révéler » persistée, réglages par défaut avec confirmation.
 * Les placeholders n'ont pas les images d'interface : c'est le repli CSS qui est mesuré.
 */

async function openConfig(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.locator(".mh-ui-title-screen").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Config" }).first().click();
  await page.locator(".mh-cfg").waitFor();
}

const storedSettings = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("mahoyo.settings") ?? "{}") as { flowchartRevealAll?: boolean });

test.describe("Configuration (HUD-09)", () => {
  test("mise en page conforme à l'original à 1280×720, sans défilement ni débordement", async ({ page }) => {
    await openConfig(page);
    const rects = await page.evaluate(() => {
      const vp = document.querySelector("#viewport")!.getBoundingClientRect();
      const r = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { x: b.left - vp.left, y: b.top - vp.top, right: b.right - vp.left, bottom: b.bottom - vp.top };
      };
      return {
        cols: [...document.querySelectorAll(".mh-cfg-col")].map((c) => ({ ...r(c), overflow: c.scrollHeight - c.clientHeight })),
        panels: [...document.querySelectorAll(".mh-cfg-panel")].map(r),
        tabs: [...document.querySelectorAll(".mh-cfg-tab")].map(r),
        back: r(document.querySelector(".mh-cfg-back")!),
        reset: r(document.querySelector(".mh-cfg-reset")!),
        night: document.querySelector("#ui-menu")!.classList.contains("mh-ui-night"),
      };
    });
    const near = (a: number, b: number, tol = 3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
    expect(rects.night).toBe(true);
    // Colonnes : gauche 50–508, droite 540–1230 ; haut des panneaux y = 143 ; aucune barre de défilement.
    const [left, right] = rects.cols as [(typeof rects.cols)[number], (typeof rects.cols)[number]];
    near(left.x, 50);
    near(left.right, 508, 4);
    near(right.x, 540);
    near(right.right, 1230, 8);
    near(rects.panels[0]!.y, 143);
    for (const c of rects.cols) expect(c.overflow).toBeLessThanOrEqual(0);
    for (const p of rects.panels) expect(p.bottom).toBeLessThanOrEqual(633 + 2);
    // Onglets : Système commence en x = 553, y 38–71 ; quatre onglets dans l'ordre, sans chevauchement.
    near(rects.tabs[0]!.x, 553);
    for (let i = 1; i < rects.tabs.length; i++) expect(rects.tabs[i]!.x).toBeGreaterThan(rects.tabs[i - 1]!.right);
    expect(rects.tabs[0]!.y).toBeGreaterThanOrEqual(28);
    expect(rects.tabs[0]!.bottom).toBeLessThanOrEqual(76);
    // Pied : « Retour » centré (x 598–688, y 677–699), « Réglages par défaut » 1030–1230 × 663–700.
    near((rects.back.x + rects.back.right) / 2, 643, 4);
    near(rects.back.y, 677, 3);
    near(rects.reset.x, 1030);
    near(rects.reset.right, 1230);
    near(rects.reset.y, 663);
    near(rects.reset.bottom, 700);
  });

  test("onglets au clavier, focus visible", async ({ page }) => {
    await openConfig(page);
    await expect(page.locator('[data-tab="system"]')).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-tab="message"]')).toBeFocused();
    await expect(page.locator('[data-tab="message"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('input[name="textSpeedUnread"]')).toBeVisible();
    await page.keyboard.press("End");
    await expect(page.locator('[data-tab="shortcuts"]')).toBeFocused();
    await expect(page.locator(".mh-ui-key")).toHaveCount(28);
    const outline = await page.locator('[data-tab="shortcuts"]').evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(outline).toBe("solid");
    // Tab entre dans le panneau (un seul onglet est dans l'ordre de tabulation).
    await page.keyboard.press("Tab");
    await expect(page.locator(".mh-ui-key").first()).toBeFocused();
  });

  test("« tout révéler » est persisté, « Réglages par défaut » le remet à false après confirmation", async ({ page }) => {
    await openConfig(page);
    const toggle = page.locator('input[name="flowchartRevealAll"]');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect.poll(async () => (await storedSettings(page)).flowchartRevealAll).toBe(true);

    // Rechargé : la valeur est restituée. Depuis WEB-04 (#204) le hash `#/config` est routé : le
    // rechargement rouvre directement l'écran de configuration (plus d'écran titre intermédiaire).
    await page.reload();
    await expect(page).toHaveURL(/#\/config$/);
    await page.locator(".mh-cfg").waitFor({ timeout: 15000 });
    await expect(page.locator('input[name="flowchartRevealAll"]')).toBeChecked();

    // Non (présélectionné) : rien ne change.
    await page.locator(".mh-ui-reset").click();
    await expect(page.locator(".mh-ui-confirm-no")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".mh-ui-confirm-box")).toHaveCount(0);
    await expect(page.locator('input[name="flowchartRevealAll"]')).toBeChecked();

    // Oui : réglages par défaut.
    await page.locator(".mh-ui-reset").click();
    await page.locator(".mh-ui-confirm-yes").click();
    await expect(page.locator('input[name="flowchartRevealAll"]')).not.toBeChecked();
    await expect.poll(async () => (await storedSettings(page)).flowchartRevealAll).toBe(false);
  });

  test("« Retour » et Échap ferment l'écran", async ({ page }) => {
    await openConfig(page);
    await page.locator(".mh-cfg-back").click();
    await expect(page.locator(".mh-cfg")).toHaveCount(0);
    await page.getByRole("button", { name: "Config" }).first().click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".mh-cfg")).toHaveCount(0);
  });
});
