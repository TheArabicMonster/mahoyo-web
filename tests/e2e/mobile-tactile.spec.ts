import { test, expect, type Page } from "@playwright/test";
import { PLACEHOLDER_LONG_TEXT_MARKER } from "./placeholders.js";

/**
 * #98 (WEB-01/mobile) — gestes tactiles, orientation et petits viewports.
 *
 * Émulation tactile Playwright : `hasTouch` + viewport de téléphone/tablette (Chromium). Les
 * descripteurs `devices[...]` avec `isMobile` sont réservés à Chromium/WebKit ; Firefox ne supporte
 * pas `isMobile`, on utilise donc `hasTouch` + viewport explicite pour que la non-régression Firefox
 * tourne aussi. Les gestes multi-points (CDP `Input.dispatchTouchEvent`) ne sont disponibles que sur
 * Chromium : appui long et balayages sont marqués `skip` sur Firefox (le tap et l'orientation
 * restent testés sur les deux navigateurs).
 */

/** Android Chrome (Pixel 5) : 393×851 CSS. */
const ANDROID = { viewport: { width: 393, height: 851 }, hasTouch: true, deviceScaleFactor: 2.75 };
/** iPhone 13 (Safari) : 390×844 CSS — émulation Chromium (WebKit n'est pas un projet de la CI). */
const IPHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 };

const text = (page: Page) => page.locator("#text");
const pageText = async (page: Page): Promise<string> =>
  (await text(page).innerText()).replace(/[▽▼]/g, "").trim();

async function boot(page: Page): Promise<void> {
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
  await page.locator(".mh-ui-new-game").tap();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
  await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game");
}

/** Attend la fin de la frappe (texte stable deux lectures de suite). */
async function waitTextStable(page: Page): Promise<string> {
  let previous = "";
  for (let i = 0; i < 40; i++) {
    const current = await pageText(page);
    if (current.length > 0 && current === previous) return current;
    previous = current;
    await page.waitForTimeout(100);
  }
  return pageText(page);
}

/** Séquence tactile brute (CDP, Chromium seulement) : appui long et balayages. */
async function touchSequence(
  page: Page,
  steps: { type: "start" | "move" | "end"; x: number; y: number; wait?: number }[],
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  for (const step of steps) {
    const type = { start: "touchStart", move: "touchMove", end: "touchEnd" }[step.type] as
      | "touchStart"
      | "touchMove"
      | "touchEnd";
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: step.type === "end" ? [] : [{ x: step.x, y: step.y }],
    });
    if (step.wait) await page.waitForTimeout(step.wait);
  }
  await cdp.detach();
}

async function longPress(page: Page, x: number, y: number): Promise<void> {
  await touchSequence(page, [
    { type: "start", x, y, wait: 700 },
    { type: "end", x, y },
  ]);
}

async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await touchSequence(page, [
    { type: "start", x: from.x, y: from.y, wait: 40 },
    { type: "move", x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, wait: 30 },
    { type: "move", x: to.x, y: to.y, wait: 30 },
    { type: "end", x: to.x, y: to.y },
  ]);
}

async function sceneBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const r = document.querySelector(".mh-stage")!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

test.describe("Mobile — Android Chrome (émulation)", () => {
  test.use(ANDROID);

  test("un tap sur la scène avance le texte", async ({ page }) => {
    await boot(page);
    await startGame(page);
    const before = await waitTextStable(page);
    const scene = await sceneBox(page);
    await page.touchscreen.tap(scene.x + scene.width / 2, scene.y + scene.height / 2);
    await expect.poll(async () => (await waitTextStable(page)) !== before, { timeout: 15000 }).toBe(true);
  });

  test("appui long sur la scène = menu système", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP Input.dispatchTouchEvent : Chromium uniquement");
    await boot(page);
    await startGame(page);
    await waitTextStable(page);
    const scene = await sceneBox(page);
    await longPress(page, scene.x + scene.width / 2, scene.y + scene.height / 2);
    await expect(page.locator(".mh-sysmenu")).toBeVisible({ timeout: 10000 });
    await page.keyboard.press("Escape");
  });

  test("balayage vers la droite = retour arrière (rollback)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP Input.dispatchTouchEvent : Chromium uniquement");
    await boot(page);
    await startGame(page);
    const scene = await sceneBox(page);
    const center = { x: scene.x + scene.width / 2, y: scene.y + scene.height / 2 };
    // Lit quelques pages pour alimenter l'historique (rollback exige > 1 entrée).
    for (let i = 0; i < 3; i++) {
      await waitTextStable(page);
      await page.touchscreen.tap(center.x, center.y);
      await page.waitForTimeout(250);
    }
    const current = await waitTextStable(page);
    await swipe(page, { x: scene.x + scene.width * 0.2, y: center.y }, { x: scene.x + scene.width * 0.8, y: center.y });
    await expect.poll(async () => (await waitTextStable(page)) !== current, { timeout: 15000 }).toBe(true);
  });
});

test.describe("Mobile — iPhone (émulation Chromium)", () => {
  test.use(IPHONE);

  test("tap, orientation et scroll du dock texte", async ({ page, browserName }) => {
    await boot(page);
    await startGame(page);
    const initial = await waitTextStable(page);
    // Non-régression tap.
    await page.touchscreen.tap(195, 100);
    await expect.poll(async () => (await waitTextStable(page)) !== initial, { timeout: 15000 }).toBe(true);

    // Orientation portrait → paysage → portrait sans perte de texte.
    const beforeRotate = await waitTextStable(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    expect(await pageText(page)).toBe(beforeRotate);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    expect(await pageText(page)).toBe(beforeRotate);

    test.skip(browserName !== "chromium", "CDP Input.dispatchTouchEvent : Chromium uniquement");
    // Atteint la page « texte long » (#314) : le dock portrait défile au doigt sans avancer.
    for (let i = 0; i < 40; i++) {
      if ((await pageText(page)).includes(PLACEHOLDER_LONG_TEXT_MARKER)) break;
      await page.waitForTimeout(120);
      await page.keyboard.press("Enter");
    }
    await expect.poll(async () => (await pageText(page)).includes(PLACEHOLDER_LONG_TEXT_MARKER), { timeout: 15000 }).toBe(true);
    // Attend la fin de la frappe : un re-rendu du texte après coup remettrait scrollTop à 0.
    await expect
      .poll(async () => page.locator(".mh-text-unit.mh-text-unit-hidden").count(), { timeout: 30000 })
      .toBe(0);
    await page.waitForTimeout(200);
    const metrics = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".mh-stage-text")!;
      const scene = document.querySelector(".mh-stage")!.getBoundingClientRect();
      return { overflow: el.scrollHeight > el.clientHeight + 1, scrollTop: el.scrollTop, sceneBottom: scene.bottom };
    });
    expect(metrics.overflow).toBe(true);
    expect(metrics.scrollTop).toBe(0);
    const mid = 195;
    await swipe(page, { x: mid, y: metrics.sceneBottom + 250 }, { x: mid, y: metrics.sceneBottom + 120 });
    await page.waitForTimeout(200);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".mh-stage-text")!;
      return { scrollTop: el.scrollTop, hasMarker: el.textContent!.includes("Page longue") };
    });
    expect(after.scrollTop).toBeGreaterThan(0);
    expect(after.hasMarker).toBe(true); // pas d'avance déclenchée par le glissement
  });
});

test.describe("Petits viewports (#98)", () => {
  test.use({ hasTouch: true });

  test("360×640 portrait : scène 16:9 entière, texte lisible sous la scène, pas de scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await boot(page);
    await startGame(page);
    await waitTextStable(page);
    const m = await page.evaluate(() => {
      const scene = document.querySelector(".mh-stage")!.getBoundingClientRect();
      const box = document.querySelector("#textbox")!.getBoundingClientRect();
      const font = Number.parseFloat(getComputedStyle(document.querySelector(".mh-stage-text")!).fontSize);
      return {
        scene: { x: scene.x, y: scene.y, w: scene.width, h: scene.height, bottom: scene.bottom },
        boxTop: box.top,
        font,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    expect(Math.abs(m.scene.w - 360)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.scene.h - 360 * (9 / 16))).toBeLessThanOrEqual(2);
    expect(m.scene.y).toBeLessThanOrEqual(1);
    expect(m.boxTop).toBeGreaterThanOrEqual(m.scene.bottom - 1);
    expect(m.font).toBeGreaterThanOrEqual(14);
    expect(m.overflowX).toBe(false);
  });

  test("640×360 paysage : la scène 16:9 remplit l'écran (repère #177 inchangé)", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await boot(page);
    await startGame(page);
    await waitTextStable(page);
    const m = await page.evaluate(() => {
      const scene = document.querySelector(".mh-stage")!.getBoundingClientRect();
      const box = document.querySelector("#textbox")!.getBoundingClientRect();
      return { w: scene.width, h: scene.height, sceneBottom: scene.bottom, boxTop: box.top };
    });
    // Échelle 0,5 : la scène 1280×720 logique est réduite exactement à 640×360.
    expect(Math.abs(m.w - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.h - 360)).toBeLessThanOrEqual(2);
    // En paysage, le texte reste dans la scène (comportement desktop conservé).
    expect(m.boxTop).toBeLessThan(m.sceneBottom);
  });
});
