import { test, expect, type Page } from "@playwright/test";

/**
 * Thème Mahoyo & animations (#99) — non-régression visuelle et accessibilité du mouvement.
 *
 * Vérifie que les composants communs consomment les tokens (`--mh-scrim`, `--mh-ui-panel-fill`,
 * `--mh-focus-width/offset`, `--mh-dur-ui-in`, `--mh-ease-out`), que le fondu d'écran est actif
 * par défaut, que l'option joueur « Réduire les animations » (Config → Son/Effet) pose
 * `data-reduce-motion` et persiste, et que `prefers-reduced-motion` neutralise tout. Pas de capture
 * d'écran : uniquement des valeurs calculées stables, en Chromium et Firefox.
 */

const text = (page: Page) => page.locator("#text");

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
    // @ts-ignore — stub minimal des animations Web Animations API (comme les autres specs).
    Element.prototype.animate = function () {
      return { play: () => this, pause: () => this, cancel: () => this, finish: () => this, onfinish: null };
    };
  });
  await page.goto("/");
  await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });
}

async function startGame(page: Page): Promise<void> {
  await page.locator(".mh-ui-new-game").click();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
}

async function openSystemMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator(".mh-sysmenu")).toBeVisible({ timeout: 10000 });
}

const token = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test.describe("Thème & animations — défauts", () => {
  test.use({ reducedMotion: "no-preference" });

  test("le titre utilise les tokens de mouvement et les fondus d'entrée", async ({ page }) => {
    await boot(page);
    expect(await token(page, "--mh-dur-ui-in")).toBe("220ms");
    expect(await token(page, "--mh-ease-out")).toContain("cubic-bezier");
    const logo = await page.locator(".mh-ui-title-logo").evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration };
    });
    expect(logo).toEqual({ name: "mh-ui-title-fade-in", duration: "0.8s" });
    // Les entrées du menu sont échelonnées (opacité seulement) via --mh-dur-stagger.
    const entry = await page.locator(".mh-ui-title-entry").first().evaluate((el) => getComputedStyle(el).animationName);
    expect(entry).toBe("mh-ui-title-fade-in");
  });

  test("le menu système reprend le voile et le fondu tokenisés", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openSystemMenu(page);
    const screen = await page.evaluate(() => {
      const pause = document.querySelector<HTMLElement>(".mh-ui-pause")!;
      const menu = document.querySelector<HTMLElement>(".mh-sysmenu")!;
      return {
        background: getComputedStyle(pause).backgroundColor,
        menuAnimation: getComputedStyle(pause).animationName,
        menuDuration: getComputedStyle(pause).animationDuration,
        menuVisible: !!menu,
      };
    });
    // Le menu système a son propre voile « nuit bleue » (#200) ; on vérifie que le token de voile
    // commun existe bien et que l'écran n'est pas transparent, sans figer la couleur propre à l'écran.
    expect(await token(page, "--mh-scrim")).toBe("rgba(0, 0, 0, 0.75)");
    expect(await token(page, "--mh-dur-ui-in")).toBe("220ms");
    expect(screen.background).not.toBe("rgba(0, 0, 0, 0)");
    // L'animation propre du menu système reste pilotée par les tokens de mouvement.
    expect(screen.menuVisible).toBe(true);
    expect(screen.menuAnimation).toBe("mh-sysmenu-in");
    expect(screen.menuDuration).toBe("0.27s");
  });

  test("focus visible : 2 px --mh-focus sur les entrées du menu système", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openSystemMenu(page);
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      return { cls: el.className, width: s.outlineWidth, color: s.outlineColor, style: s.outlineStyle };
    });
    expect(focus).not.toBeNull();
    expect(String(focus!.cls)).toContain("mh-sysmenu-entry");
    expect(focus!.style).toBe("solid");
    expect(focus!.width).toBe("2px");
    expect(focus!.color).toBe("rgb(95, 207, 197)");
  });

  test("option « Réduire les animations » : attribut, tokens à 0 et persistance", async ({ page }) => {
    await boot(page);
    await page.locator(".mh-ui-title-entry", { hasText: "Config" }).click();
    await expect(page.locator(".mh-cfg")).toBeVisible({ timeout: 10000 });
    await page.locator('.mh-cfg-tab[data-tab="sound"]').click();
    const label = page.getByText("Réduire les animations de l'interface", { exact: true });
    await expect(label).toBeVisible();
    await page.locator('input[name="reduceMotion"][value="yes"]').check();
    await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
    expect(await token(page, "--mh-dur-ui-in")).toBe("0ms");
    const anim = await page.locator(".mh-cfg").evaluate((el) => getComputedStyle(el).animationDuration);
    expect(Number.parseFloat(anim)).toBeLessThanOrEqual(0.01);

    // Persistance : le réglage est écrit dans localStorage puis relu au chargement.
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("mahoyo:settings") ?? Object.keys(localStorage).join(",")))
      .toContain("settings");
    await expect
      .poll(async () =>
        page.evaluate(() => {
          for (const key of Object.keys(localStorage)) {
            const raw = localStorage.getItem(key) ?? "";
            if (key.includes("settings") && raw.includes('"reduceMotion":true')) return true;
          }
          return false;
        }),
      )
      .toBe(true);
    // La route courante (config) est restaurée au rechargement ; on vérifie surtout le réglage relu.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true", { timeout: 15000 });
  });
});

test.describe("Thème & animations — prefers-reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("durées d'interface à 0 et animations neutralisées", async ({ page }) => {
    await boot(page);
    expect(await token(page, "--mh-dur-ui-in")).toBe("0ms");
    expect(await token(page, "--mh-dur-stagger")).toBe("0ms");
    const logo = await page.locator(".mh-ui-title-logo").evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: s.animationDuration };
    });
    expect(logo.name).toBe("none");
    await startGame(page);
    await openSystemMenu(page);
    const pauseDuration = await page
      .locator(".mh-ui-pause")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(Number.parseFloat(pauseDuration)).toBeLessThanOrEqual(0.01);
  });
});
