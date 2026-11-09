import { test, expect } from "@playwright/test";

/**
 * HUD-07 (#195) : écran titre à 1280×720 (positions de docs/ANALYSE_HUD_ORIGINAL.md §2.1, ±2 %),
 * clavier, absence d'Exit. HUD-08 (#199) : sous-menu Extra en place, Archive (grisée sans progression,
 * liste de chapitres sinon), absence de Flowchart. Les placeholders n'ont pas les images d'interface :
 * c'est donc le repli CSS qui est mesuré.
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
        entries: [...document.querySelectorAll(".mh-ui-title-menu .mh-ui-title-entry")].map((e) => rel(e)),
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
    const focused = page.locator(".mh-ui-title-menu .mh-ui-title-entry:focus-visible");
    await expect(focused).toHaveText("Load");
    expect(await focused.evaluate((n) => getComputedStyle(n).outlineStyle)).toBe("solid");
  });

  test("Extra remplace les entrées sur place : Archive, Cgmode, Soundmode, Back, aux mêmes positions, sans Flowchart", async ({ page }) => {
    await page.locator('[data-entry="extra"]').click();
    const sub = page.locator(".mh-ui-title-extra-menu");
    await expect(sub).toBeVisible();
    await expect(sub.locator("button")).toHaveText(["Archive", "Cgmode", "Soundmode", "Back"]);
    await expect(page.locator(".mh-ui-title-menu")).toBeHidden(); // une fois le fondu terminé
    await expect(page.locator(".mh-ui-title-logo")).toBeVisible();
    expect(await sub.textContent()).not.toMatch(/flowchart|exit|quit/i);
    const cy = await sub.locator("button").evaluateAll((els) => {
      const vp = document.querySelector("#viewport")!.getBoundingClientRect();
      return els.map((e) => {
        const r = e.getBoundingClientRect();
        return { cx: (r.left - vp.left + r.width / 2) / vp.width, cy: (r.top - vp.top + r.height / 2 - 0) / vp.height };
      });
    });
    cy.forEach((e, i) => {
      expect(Math.abs(e.cx - 0.5)).toBeLessThan(0.02);
      expect(Math.abs(e.cy - (415 + 49 * i) / 720)).toBeLessThan(0.02);
    });
  });

  test("fondu croisé d'environ 1 s, sans animation avec prefers-reduced-motion", async ({ page }) => {
    const duration = (sel: string) =>
      page.locator(sel).evaluate((n) => getComputedStyle(n).transitionDuration.split(",")[0]!.trim());
    expect(await duration(".mh-ui-title-extra-menu")).toBe("1s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await duration(".mh-ui-title-extra-menu")).toBe("0s");
    expect(await duration(".mh-ui-title-menu")).toBe("0s");
  });

  test("sans progression : Archive et Soundmode grisés, inertes ; Cgmode ouvre la galerie ; aucun écran fantôme", async ({ page }) => {
    await page.locator('[data-entry="extra"]').click();
    // Chromium sérialise le mélange en `color(srgb r g b / a)` : on lit la transparence.
    const alpha = (sel: string) =>
      page.locator(sel).evaluate((n) => Number(getComputedStyle(n).color.match(/\/\s*([\d.]+)\)$/)?.[1] ?? 1));
    // Archive (aucune progression) et Soundmode restent grisés et inertes : le manifeste de test du
    // mode placeholders ne contient aucun BGM, donc le catalogue Sound mode (HUD-16, #209) est vide.
    for (const id of ["archive", "soundmode"]) {
      const entry = page.locator(`[data-entry="${id}"]`);
      await expect(entry).toHaveAttribute("aria-disabled", "true");
      expect(await alpha(`[data-entry="${id}"]`)).toBeCloseTo(0.3, 2);
      await entry.hover();
      expect(await alpha(`[data-entry="${id}"]`)).toBeCloseTo(0.3, 2);
      await entry.click({ force: true });
    }
    await expect(page.locator(".mh-ui-title-extra")).toHaveCount(0);
    await expect(page.locator(".mh-ui-title-extra-menu")).toBeVisible();
    // Cgmode (HUD-15, #208) n'est plus une entrée « bientôt » : la galerie est calculée depuis le
    // manifeste (ici les images de test), donc l'entrée est active et ouvre l'écran sans fantôme.
    const cgmode = page.locator('[data-entry="cgmode"]');
    await expect(cgmode).not.toHaveAttribute("aria-disabled", "true");
    expect(await alpha('[data-entry="cgmode"]')).toBe(1);
    await cgmode.click();
    await expect(page.locator("#ui-cg .mh-cg-screen")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ui-cg .mh-cg-screen")).toHaveCount(0);
    await expect(cgmode).toBeFocused();
    // Back reste actif (couleur pleine) et ramène au menu principal.
    expect(await alpha('[data-entry="back"]')).toBe(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".mh-ui-title-menu")).toBeVisible();
    await expect(page.locator('[data-entry="extra"]')).toBeFocused();
  });

  test.describe("avec une progression", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          "mahoyo.story-progress",
          JSON.stringify({ visited: ["1-0"], finished: [], choices: [], endings: [] }),
        );
      });
      await page.goto("/");
      await page.locator(".mh-ui-title-screen").waitFor({ timeout: 15000 });
    });

    test("Extra > Archive > chapitre démarre le chapitre, au clavier seul", async ({ page }) => {
      await page.keyboard.press("ArrowUp"); // dernière entrée : Extra
      await page.keyboard.press("Enter");
      const archive = page.locator('[data-entry="archive"]');
      await expect(archive).toBeFocused();
      await expect(archive).not.toHaveAttribute("aria-disabled", "true");
      await expect(archive).toHaveCSS("color", "rgb(40, 67, 172)"); // focus : bleu roi, texte plein
      await page.keyboard.press("Enter");
      await expect(page.locator(".mh-ui-title-extra")).toBeVisible();
      await expect(page.locator(".mh-ui-script").first()).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
    });

    test("Échap : Archive > Extra > menu principal", async ({ page }) => {
      await page.locator('[data-entry="extra"]').click();
      await page.locator('[data-entry="archive"]').click();
      await expect(page.locator(".mh-ui-script[data-file]")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.locator(".mh-ui-title-extra")).toHaveCount(0);
      await expect(page.locator('[data-entry="archive"]')).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.locator(".mh-ui-title-menu")).toBeVisible();
      await expect(page.locator('[data-entry="extra"]')).toBeFocused();
    });
  });
});
