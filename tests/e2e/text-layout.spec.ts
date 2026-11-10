import { test, expect, type Page } from "@playwright/test";
import { PLACEHOLDER_LONG_TEXT_MARKER } from "./placeholders.js";

/**
 * #314 — mise en page du texte : la page entière est mise en page une fois et la frappe révèle
 * les caractères par `visibility` (aucun reflow), avec une police **constante** (pas d'autoshrink).
 *
 * Un seul e2e pour ce lot : on atteint la page « texte long » du prologue placeholders, on relève
 * la position de la première unité et la taille de police **pendant** la frappe, puis en fin de
 * frappe : positions identiques, police identique (et identique à une page courte).
 */

const text = (page: Page) => page.locator("#text");

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
    // Frappe rapide : ce test mesure la mise en page, pas la durée du typewriter.
    localStorage.setItem("mahoyo.settings", JSON.stringify({ display: { textSpeedUnread: 1, textSpeedRead: 1 } }));
    // @ts-ignore — stub volontairement minimal, comme les autres specs e2e.
    Element.prototype.animate = function () {
      return { play: () => this, pause: () => this, cancel: () => this, finish: () => this, onfinish: null };
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".mh-ui-new-game")).toBeVisible({ timeout: 15000 });
}

/** Avance jusqu'à la page « texte long » (après les pages cm/emoji). */
async function advanceToLongPage(page: Page): Promise<void> {
  for (let i = 0; i < 16; i++) {
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    if ((await text(page).innerText()).includes(PLACEHOLDER_LONG_TEXT_MARKER)) return;
    await page.keyboard.press("Enter");
  }
  if (!(await text(page).innerText()).includes(PLACEHOLDER_LONG_TEXT_MARKER)) {
    throw new Error("La page « texte long » n'a pas été atteinte");
  }
}

const firstUnitRect = (page: Page) =>
  page.evaluate(() => {
    const unit = document.querySelector<HTMLElement>('.mh-text-unit[data-unit="0"]');
    if (!unit) return null;
    const r = unit.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

const fontMetrics = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".mh-stage-text");
    const box = document.querySelector<HTMLElement>(".mh-stage-textbox");
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      textFit: box?.dataset.textFit ?? null,
      overflowY: style.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });

test("la frappe ne réagence pas le texte et la police reste constante (texte long)", async ({ page }) => {
  await boot(page);
  await page.locator(".mh-ui-new-game").click();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });

  // Police d'une page courte de référence (page d'ouverture du prologue placeholders).
  const shortFont = await fontMetrics(page);
  expect(shortFont).not.toBeNull();

  await advanceToLongPage(page);
  // Pendant la frappe : des unités existent déjà en DOM (layout complet) mais certaines sont
  // encore masquées ; on relève la position de la première unité.
  const during = await firstUnitRect(page);
  const duringFont = await fontMetrics(page);
  expect(during).not.toBeNull();
  expect(duringFont).not.toBeNull();

  // Fin de la frappe (indicateur de page/attente affiché).
  await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
  await expect
    .poll(async () => page.locator(".mh-text-unit.mh-text-unit-hidden").count(), { timeout: 20000 })
    .toBe(0);
  const after = await firstUnitRect(page);
  const afterFont = await fontMetrics(page);

  // 1) Positions stables : aucune réorganisation pendant la frappe.
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - during!.x)).toBeLessThan(0.5);
  expect(Math.abs(after!.y - during!.y)).toBeLessThan(0.5);

  // 2) Police constante : même corps que la page courte, aucun autoshrink.
  expect(afterFont!.fontSize).toBeCloseTo(shortFont!.fontSize, 3);
  expect(afterFont!.textFit).toBe("nominal");
  expect(afterFont!.overflowY).toBe("hidden");
  // La page longue déborde bien de la zone (donc le test serait trivial si le texte tenait).
  expect(afterFont!.scrollHeight).toBeGreaterThan(afterFont!.clientHeight);

  // 3) Le texte complet est mis en page : la page longue a plusieurs lignes.
  const lineCount = await page.evaluate(() => {
    const units = [...document.querySelectorAll<HTMLElement>(".mh-text-unit")];
    return new Set(units.map((unit) => Math.round(unit.getBoundingClientRect().top))).size;
  });
  expect(lineCount).toBeGreaterThanOrEqual(6);
});
