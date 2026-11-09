import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * WEB-01 (#203) : gestes et barre d'actions rapides tactiles. Émulation tactile de Chromium (`hasTouch`,
 * `isMobile`, téléphone en paysage 844×390) ; les cibles sont mesurées en pixels RÉELS (le viewport 1280×720
 * est réduit d'un facteur ≈ 0,54 sur ce téléphone, c'est pourquoi la feuille convertit 48 px réels en px logiques).
 */

const PHONE = { width: 844, height: 390 };

async function startGame(page: Page, tap: boolean): Promise<void> {
  await page.goto("/");
  const start = page.locator(".mh-ui-new-game");
  if (tap) await start.tap();
  else await start.click();
  await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
}

/** Lit quelques pages (appuis tactiles) pour que l'historique ne soit plus vide (#201 : historique vide = toast, pas d'écran). */
async function readPages(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.touchscreen.tap(PHONE.width / 2, PHONE.height / 2);
    await page.waitForTimeout(250);
  }
}

const SWIPE_UP = [
  { type: "start", x: 420, y: 300, wait: 60 },
  { type: "move", x: 420, y: 250, wait: 30 },
  { type: "move", x: 420, y: 200, wait: 30 },
  { type: "move", x: 420, y: 150, wait: 30 },
  { type: "end", x: 420, y: 150 },
] as const;

const touchRoot = (page: Page) => page.locator("#ui-touch");
const menu = (page: Page) => page.locator(".mh-sysmenu");

async function realBox(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  return b;
}

/** Séquence tactile brute (CDP) : permet appui long et balayage, que `touchscreen` ne sait pas faire. */
async function touchSequence(page: Page, steps: { type: "start" | "move" | "end"; x: number; y: number; wait?: number }[]) {
  const cdp = await page.context().newCDPSession(page);
  for (const s of steps) {
    const type = { start: "touchStart", move: "touchMove", end: "touchEnd" }[s.type] as "touchStart" | "touchMove" | "touchEnd";
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: s.type === "end" ? [] : [{ x: s.x, y: s.y }] });
    if (s.wait) await page.waitForTimeout(s.wait);
  }
  await cdp.detach();
}

test.describe("Tactile (émulation téléphone en paysage)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test("le bouton de menu et la barre rapide sont présents ; pas de Exit", async ({ page }) => {
    await startGame(page, true);
    await expect(touchRoot(page)).toBeVisible();
    await expect(page.locator(".mh-touch-menu")).toBeVisible();
    const ids = await page.locator(".mh-touch-action").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.touch));
    expect(ids).toEqual(["qsave", "qload", "auto", "skip", "backlog", "fullscreen"]);
    await expect(page.locator("#ui-touch [data-touch=exit], #ui-touch [data-touch=exitgame]")).toHaveCount(0);
    // aria-label via le dictionnaire.
    await expect(page.locator(".mh-touch-menu")).toHaveAttribute("aria-label", "Menu");
    await expect(page.locator(".mh-touch-bar")).toHaveAttribute("aria-label", "Actions rapides");
  });

  test("toutes les cibles font au moins 44 px réels et restent dans l'écran", async ({ page }) => {
    await startGame(page, true);
    await expect(touchRoot(page)).toBeVisible();
    const scale = await page.evaluate(() => {
      const o = document.querySelector<HTMLElement>("#ui-overlay")!;
      return o.getBoundingClientRect().width / o.offsetWidth;
    });
    expect(scale).toBeLessThan(0.7); // sans compensation, 48 px logiques ne feraient que ≈ 26 px réels
    const targets = page.locator(".mh-touch-menu, .mh-touch-action");
    const n = await targets.count();
    expect(n).toBe(7);
    for (let i = 0; i < n; i++) {
      const b = await realBox(targets.nth(i));
      expect(b.width, `largeur de la cible ${i}`).toBeGreaterThanOrEqual(44);
      expect(b.height, `hauteur de la cible ${i}`).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(PHONE.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(PHONE.height + 0.5);
    }
    // Le bouton de menu est dans le coin haut-droit de la scène.
    const vp = await realBox(page.locator("#viewport"));
    const mb = await realBox(page.locator(".mh-touch-menu"));
    expect(mb.x + mb.width).toBeGreaterThan(vp.x + vp.width * 0.9);
    expect(mb.y).toBeLessThan(vp.y + vp.height * 0.15);
  });

  test("pas de zoom ni de défilement de page : touch-action none en jeu, pan seulement ailleurs", async ({ page }) => {
    await startGame(page, true);
    const css = await page.evaluate(() => ({
      overlay: getComputedStyle(document.querySelector("#ui-overlay")!).touchAction,
      body: getComputedStyle(document.body).touchAction,
      overscroll: getComputedStyle(document.body).overscrollBehaviorY,
    }));
    expect(css.overlay).toBe("none");
    expect(css.body).toBe("pan-x pan-y");
    expect(css.overscroll).toBe("none");
    await page.mouse.wheel(0, 400);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY, document.scrollingElement!.scrollTop])).toEqual([0, 0, 0]);
  });

  test("un appui simple avance le texte", async ({ page }) => {
    await startGame(page, true);
    const text = page.locator("#text");
    // Attend la fin de la frappe : sinon le texte changerait sans appui.
    let previous = "";
    await expect
      .poll(
        async () => {
          const current = await text.innerText();
          const stable = current === previous;
          previous = current;
          return stable;
        },
        { intervals: [500], timeout: 10000 },
      )
      .toBe(true);
    const before = previous;
    await page.touchscreen.tap(PHONE.width / 2, PHONE.height / 2);
    await expect.poll(async () => text.innerText(), { timeout: 8000 }).not.toBe(before);
    await expect(menu(page)).toHaveCount(0);
  });

  test("le bouton de menu ouvre le menu système, « Back » le referme", async ({ page }) => {
    await startGame(page, true);
    await page.locator(".mh-touch-menu").tap();
    await expect(menu(page)).toBeVisible();
    await expect(touchRoot(page)).toBeHidden(); // la barre cède la place au menu
    await page.locator(".mh-sysmenu-back").tap();
    await expect(menu(page)).toHaveCount(0);
    await expect(touchRoot(page)).toBeVisible();
  });

  test("appui long sur la scène = menu système (et le relâchement n'avance pas)", async ({ page, browserName }) => {
    // `touchSequence` passe par CDP (`Input.dispatchTouchEvent`), disponible dans Chromium seulement.
    test.skip(browserName !== "chromium", "séquence tactile brute via CDP : Chromium uniquement");
    await startGame(page, true);
    await touchSequence(page, [
      { type: "start", x: 420, y: 200, wait: 800 },
      { type: "end", x: 420, y: 200 },
    ]);
    await expect(menu(page)).toBeVisible();
    await page.waitForTimeout(300);
    await expect(menu(page)).toBeVisible(); // pas refermé par un contextmenu ou un click résiduel
  });

  test("balayage vers le haut = historique ; à vide, un toast et aucun écran (#201)", async ({ page, browserName }) => {
    // `touchSequence` passe par CDP (`Input.dispatchTouchEvent`), disponible dans Chromium seulement.
    test.skip(browserName !== "chromium", "séquence tactile brute via CDP : Chromium uniquement");
    await startGame(page, true);
    await touchSequence(page, [...SWIPE_UP]);
    // Selon l'avancement du premier point de clic l'historique peut déjà contenir une page : on ne vérifie le
    // toast que s'il est vide (le cas déterministe est couvert par les tests unitaires du player).
    if ((await page.locator(".mh-bl").count()) === 0) {
      await expect(page.locator(".mh-toast")).toHaveCount(1);
      await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game");
    }
    await readPages(page, 6);
    await touchSequence(page, [...SWIPE_UP]);
    await expect(page.locator(".mh-bl")).toBeVisible();
  });

  test("la barre : Auto bascule le mode, Q.Load ouvre le chargement, Historique l'écran d'historique", async ({ page }) => {
    await startGame(page, true);
    const auto = page.locator('[data-touch="auto"]');
    await expect(auto).toHaveAttribute("aria-pressed", "false");
    await auto.tap();
    await expect(auto).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".mh-ui-badge-auto")).toBeVisible();
    await auto.tap();
    await expect(auto).toHaveAttribute("aria-pressed", "false");

    await page.locator('[data-touch="qload"]').tap();
    await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "load");
    await page.keyboard.press("Escape");

    await readPages(page, 6);
    await page.locator('[data-touch="backlog"]').tap();
    await expect(page.locator(".mh-bl")).toBeVisible();
  });

  test("le focus clavier est visible sur les boutons tactiles", async ({ page }) => {
    await startGame(page, true);
    await page.locator('[data-touch="skip"]').focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const outline = await page.locator('[data-touch="skip"]').evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(outline).toBe("solid");
  });

  test("la barre disparaît sur l'écran titre", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".mh-ui-new-game")).toBeVisible();
    await expect(touchRoot(page)).toBeHidden();
  });
});

test.describe("Desktop souris : aucune commande tactile", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("ni barre ni bouton de menu ; clic droit, Échap et clic fonctionnent comme avant", async ({ page }) => {
    await startGame(page, false);
    await expect(page.locator("#ui-touch")).toHaveCount(0);
    await expect(page.locator(".mh-touch-menu, .mh-touch-bar, .mh-touch-action")).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelector("#ui-overlay")!.classList.contains("mh-ui-touch"))).toBe(false);

    await page.mouse.click(400, 300, { button: "right" });
    await expect(menu(page)).toBeVisible();
    await page.mouse.click(400, 300, { button: "right" });
    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator("#ui-touch")).toHaveCount(0);
  });
});
