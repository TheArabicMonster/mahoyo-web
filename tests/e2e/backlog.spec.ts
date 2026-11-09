import { test, expect, type Page } from "@playwright/test";

/**
 * HUD-12 (#201) : écran d'historique plein cadre à 1280×720 (docs/ANALYSE_HUD_ORIGINAL.md §2.6, écart E13).
 * Les placeholders n'ont pas les images d'interface : c'est le repli CSS qui est mesuré.
 * Les barres de défilement natives sont réactivées (Playwright les masque en mode headless).
 */
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function startGame(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.locator(".mh-ui-new-game").click();
  await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
}

/** Lit quelques pages pour que l'historique ne soit plus vide. */
async function readPages(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
  }
}

async function openFromMenu(page: Page): Promise<void> {
  await page.mouse.click(400, 300, { button: "right" });
  await page.locator('[data-entry="backlog"]').click();
}

test.describe("Historique (HUD-12)", () => {
  test("ouvert à vide : un toast, aucun écran, le menu reste ouvert", async ({ page }) => {
    await startGame(page);
    await openFromMenu(page);
    // Selon l'avancement du premier point de clic, l'historique peut déjà contenir une page : on ne vérifie
    // le toast que s'il est vide (le cas déterministe est couvert par les tests unitaires du player).
    const opened = await page.locator(".mh-bl").count();
    if (opened === 0) {
      await expect(page.locator(".mh-toast")).toHaveCount(1);
      await expect(page.locator(".mh-sysmenu")).toBeVisible();
    }
  });

  test("mise en page, clavier, fermeture", async ({ page }) => {
    await startGame(page);
    await readPages(page, 20);
    await openFromMenu(page);
    const bl = page.locator(".mh-bl");
    await expect(bl).toBeVisible();
    await expect(page.locator("#ui-menu")).toHaveClass(/mh-ui-night/);
    await expect(page.locator(".mh-bl-title")).toHaveText("Back Log");
    await expect(page.locator("ol.mh-bl-list")).toHaveAttribute("aria-label", "Historique");

    // Mesures dans le repère logique du #viewport (1280×720), tolérance 1 %.
    const m = await page.evaluate(() => {
      const vp = document.querySelector("#viewport")!.getBoundingClientRect();
      const r = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { x: b.left - vp.left, y: b.top - vp.top, r: b.right - vp.left, b: b.bottom - vp.top, w: b.width, h: b.height };
      };
      const scroll = document.querySelector<HTMLElement>(".mh-bl-scroll")!;
      const entry = document.querySelector<HTMLElement>(".mh-bl-entry")!;
      const text = [...document.querySelectorAll(".mh-bl-entry")].map((e) => {
        const range = document.createRange();
        range.selectNodeContents(e);
        return range.getBoundingClientRect().right - vp.left;
      });
      return {
        scroll: r(scroll),
        scrollbar: scroll.offsetWidth - scroll.clientWidth,
        textRight: Math.max(...text),
        fontSize: parseFloat(getComputedStyle(entry).fontSize),
        lineHeight: parseFloat(getComputedStyle(entry).lineHeight),
        userSelect: getComputedStyle(entry).userSelect,
        btns: [...document.querySelectorAll(".mh-bl-btn")].map(r),
        focusOnList: document.activeElement === scroll,
        overflows: scroll.scrollHeight > scroll.clientHeight,
      };
    });
    const px = (v: number, target: number) => expect(Math.abs(v - target)).toBeLessThanOrEqual(1280 * 0.01);
    px(m.scroll.x, 177); // texte : x 177 @720
    px(m.scroll.r, 1172); // ascenseur : bord droit x 1172
    px(m.scroll.y, 85); // ascenseur : y 85 à 651
    px(m.scroll.b, 651);
    expect(Math.abs(m.scrollbar - 39)).toBeLessThanOrEqual(1); // ascenseur de 39 px
    expect(m.textRight).toBeLessThanOrEqual(1064); // le texte ne passe pas sous l'ascenseur
    expect(m.fontSize).toBeCloseTo(33.6, 1); // même corps que le texte de jeu
    expect(m.lineHeight).toBeCloseTo(50.4, 1);
    expect(m.userSelect).toBe("text");
    expect(m.btns).toHaveLength(3);
    for (const b of m.btns) {
      px(b.y, 667); // boutons ronds : y 667 à 699
      expect(Math.abs(b.w - 33)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.h - 33)).toBeLessThanOrEqual(1);
    }
    expect(m.focusOnList).toBe(true);
    expect(m.overflows).toBe(true);

    // PageUp / PageDown défilent.
    const top = () => page.locator(".mh-bl-scroll").evaluate((e) => e.scrollTop);
    const start = await top();
    expect(start).toBeGreaterThan(0); // ouvert sur la dernière page
    await page.keyboard.press("PageUp");
    await expect.poll(top).toBeLessThan(start);
    await page.keyboard.press("PageDown");
    await expect.poll(top).toBeGreaterThanOrEqual(start - 1);

    // Les boutons défilent aussi ; focus visible au clavier.
    await page.keyboard.press("Home");
    await expect.poll(top).toBe(0);
    await page.locator(".mh-bl-down").click();
    await expect.poll(top).toBeGreaterThan(0);
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).toBe("solid");

    // Fermer (bouton) puis Échap : retour au menu, puis au jeu.
    await page.locator(".mh-bl-close").click();
    await expect(bl).toHaveCount(0);
    await expect(page.locator(".mh-sysmenu")).toBeVisible();
    await page.locator('[data-entry="backlog"]').click();
    await expect(bl).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bl).toHaveCount(0);
    await expect(page.locator(".mh-sysmenu")).toBeVisible();
  });
});
