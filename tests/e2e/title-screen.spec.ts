import { test, expect } from "@playwright/test";

/**
 * HUD-07 (#195) : écran titre à 1280×720 (positions de docs/ANALYSE_HUD_ORIGINAL.md §2.1, ±2 %),
 * clavier, absence d'Exit, accès au choix de chapitre par Extra. Les placeholders n'ont pas les
 * images d'interface : c'est donc le repli CSS qui est mesuré.
 */
test.describe("Écran titre", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.locator(".mh-ui-title-screen").waitFor({ timeout: 15000 });
  });

  test("positions du logo et du menu conformes à l'original (±2 %)", async ({ page }) => {
    const m = await page.evaluate(() => {
      const vp = document.querySelector("#viewport")!.getBoundingClientRect();
      const rel = (el: Element) => {
        const r = el.getBoundingClientRect();
        return {
          left: (r.left - vp.left) / vp.width,
          right: (r.right - vp.left) / vp.width,
          top: (r.top - vp.top) / vp.height,
          bottom: (r.bottom - vp.top) / vp.height,
          cx: (r.left - vp.left + r.width / 2) / vp.width,
          cy: (r.top - vp.top + r.height / 2) / vp.height,
        };
      };
      return {
        logo: rel(document.querySelector(".mh-ui-title-logo")!),
        entries: [...document.querySelectorAll(".mh-ui-title-entry")].map((e) => rel(e)),
        legal: rel(document.querySelector(".mh-ui-title-legal")!),
      };
    });
    const tol = 0.02;
    // Logo : x 334-941, y 123-295 @1280×720.
    expect(Math.abs(m.logo.left - 334 / 1280)).toBeLessThan(tol);
    expect(Math.abs(m.logo.right - 941 / 1280)).toBeLessThan(tol);
    expect(Math.abs(m.logo.top - 123 / 720)).toBeLessThan(tol);
    expect(Math.abs(m.logo.bottom - 295 / 720)).toBeLessThan(tol);
    // Menu : centré en x ; centres y = 415 puis pas de 49 px (Start, Load, [Continuer], Flowchart, Config, Extra).
    m.entries.forEach((e, i) => {
      expect(Math.abs(e.cx - 0.5)).toBeLessThan(tol);
      expect(Math.abs(e.cy - (415 + 49 * i) / 720)).toBeLessThan(tol);
    });
    // Mention de droits : centrée, y 684-693 @720.
    expect(Math.abs(m.legal.cx - 0.5)).toBeLessThan(tol);
    expect(Math.abs((m.legal.top + m.legal.bottom) / 2 - 688.5 / 720)).toBeLessThan(tol);
  });

  test("entrées dans l'ordre, sans Exit", async ({ page }) => {
    const labels = await page.locator(".mh-ui-title-menu button").allTextContents();
    expect(labels.slice(0, 2)).toEqual(["Start", "Load"]);
    expect(labels.slice(-3)).toEqual(["Flowchart", "Config", "Extra"]);
    expect(labels.join(" ")).not.toMatch(/exit|quit|quitter/i);
    expect(await page.locator(".mh-ui-title-menu").evaluate((n) => n.tagName)).toBe("NAV");
  });

  test("survol bleu, repos brun, focus visible au clavier", async ({ page }) => {
    const color = (sel: string) => page.locator(sel).evaluate((n) => getComputedStyle(n).color);
    expect(await color('[data-entry="load"]')).toBe("rgb(31, 24, 22)");
    await page.hover('[data-entry="load"]');
    await expect.poll(() => color('[data-entry="load"]')).toBe("rgb(40, 67, 172)");
    await page.mouse.move(2, 2);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const focused = page.locator(".mh-ui-title-entry:focus-visible");
    await expect(focused).toHaveText("Load");
    expect(await focused.evaluate((n) => getComputedStyle(n).outlineStyle)).toBe("solid");
  });

  test("Extra donne accès au choix de chapitre, Échap revient", async ({ page }) => {
    await page.keyboard.press("ArrowUp"); // dernière entrée : Extra
    await page.keyboard.press("Enter");
    await expect(page.locator(".mh-ui-title-extra")).toBeVisible();
    expect(await page.locator(".mh-ui-script").count()).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".mh-ui-title-extra")).toHaveCount(0);
    await expect(page.locator('[data-entry="extra"]')).toBeFocused();
  });
});
