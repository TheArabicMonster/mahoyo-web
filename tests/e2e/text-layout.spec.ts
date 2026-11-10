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


/**
 * Pas des glyphes (1 em) et caractères par ligne (#320) : la ligne de 34 `あ` de la page longue
 * doit mesurer 34 × 26 px logiques (32,5 px écran à 1280), et le wrap doit rester identique quand
 * la fenêtre change (layout logique 1024×576, seule la transformation d'échelle change).
 */
const fullWidthRun = (page: Page) =>
  page.evaluate(() => {
    const units = [...document.querySelectorAll<HTMLElement>(".mh-text-unit")]
      .filter((unit) => unit.textContent === "あ")
      .map((unit) => unit.getBoundingClientRect())
      .sort((a, b) => (Math.abs(a.top - b.top) > 1 ? a.top - b.top : a.left - b.left));
    if (units.length < 2) return null;
    const stage = document.querySelector<HTMLElement>(".mh-stage")!;
    const stageRect = stage.getBoundingClientRect();
    const scale = stageRect.width / stage.offsetWidth;
    const firstLineTop = units[0]!.top;
    const firstLine = units.filter((rect) => Math.abs(rect.top - firstLineTop) <= 1);
    const pitch = firstLine.length > 1 ? (firstLine[1]!.left - firstLine[0]!.left) / scale : null;
    return {
      count: units.length,
      firstLineCount: firstLine.length,
      pitchLogical: pitch,
      fontSize: parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".mh-stage-text")!).fontSize),
    };
  });

const lineSignature = (page: Page) =>
  page.evaluate(() => {
    const units = [...document.querySelectorAll<HTMLElement>(".mh-text-unit")].filter(
      (unit) => !unit.classList.contains("mh-text-unit-hidden"),
    );
    const lines = new Map<number, number>();
    for (const unit of units) {
      const rect = unit.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const top = Math.round(rect.top * 2) / 2;
      lines.set(top, (lines.get(top) ?? 0) + (unit.textContent ?? "").length);
    }
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count);
  });

async function reachLongPageEnd(page: Page): Promise<void> {
  await boot(page);
  await page.locator(".mh-ui-new-game").click();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
  await advanceToLongPage(page);
  await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => page.locator(".mh-text-unit.mh-text-unit-hidden").count(), { timeout: 30000 }).toBe(0);
}

test("pas des glyphes = 1 em (26 px logiques) et 34 caractères pleine chasse par ligne (#320)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reachLongPageEnd(page);
  const run = await fullWidthRun(page);
  expect(run).not.toBeNull();
  expect(run!.fontSize).toBeCloseTo(26, 3); // valeur CSS du repère logique
  expect(run!.pitchLogical).not.toBeNull();
  expect(run!.pitchLogical!).toBeCloseTo(26, 0); // 1 em = 26 px logiques (±0,5)
  expect(run!.pitchLogical! / 26).toBeGreaterThan(0.98);
  expect(run!.pitchLogical! / 26).toBeLessThan(1.02);
  expect(run!.firstLineCount).toBe(34); // floor((1024-2*69)/26) = 34
});

test("le wrap est identique à 1280×720 et 1920×1080 (layout logique constant, paysage) (#320)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await reachLongPageEnd(page);
  const base = await lineSignature(page);
  expect(base.length).toBeGreaterThanOrEqual(6); // page longue multi-lignes

  // Le paysage conserve le repère logique 1024×576 : seule l'échelle change.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload();
  await reachLongPageEnd(page);
  expect(await lineSignature(page)).toEqual(base);

  // Depuis #210 (décision propriétaire 4), le portrait n'est PAS une simple mise à l'échelle :
  // le texte passe dans une zone dédiée sous la scène, à taille réelle (wrap différent assumé).
  // On y vérifie la disposition (zone sous la scène) et la stabilité du wrap à taille constante.
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.reload();
  await reachLongPageEnd(page);
  const portraitBase = await lineSignature(page);
  expect(portraitBase.length).toBeGreaterThanOrEqual(6);
  const geometry = await page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>(".mh-stage")!.getBoundingClientRect();
    const box = document.querySelector<HTMLElement>("#textbox")!.getBoundingClientRect();
    return { sceneBottom: scene.bottom, boxTop: box.top };
  });
  expect(geometry.boxTop).toBeGreaterThanOrEqual(geometry.sceneBottom - 1);
  await page.reload();
  await reachLongPageEnd(page);
  expect(await lineSignature(page)).toEqual(portraitBase); // déterministe à taille portrait constante
});


/**
 * Golden 5 pages (#320) : pour 5 pages du prologue, la signature des retours à la ligne (nombre de
 * caractères par ligne visible) doit être **identique** aux trois formats d'écran — la mise en page
 * est logique (1024×576), seule la transformation d'échelle change.
 */
async function collectFivePageSignatures(page: Page): Promise<number[][]> {
  await boot(page);
  await page.locator(".mh-ui-new-game").click();
  const signatures: number[][] = [];
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 40 && signatures.length < 5; attempt++) {
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    const content = await text(page).innerText();
    const marker = /page (\d{2})/.exec(content)?.[1];
    if (marker && !seen.has(marker)) {
      seen.add(marker);
      signatures.push(await lineSignature(page));
    }
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
  }
  return signatures;
}

test("golden 5 pages : retours à la ligne identiques à 1280×720 et 1920×1080 (paysage) (#320)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const reference = await collectFivePageSignatures(page);
  expect(reference).toHaveLength(5);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload();
  expect(await collectFivePageSignatures(page)).toEqual(reference);

  // Portrait (#210) : zone de texte dédiée à taille réelle — golden propre au portrait (déterministe),
  // volontairement différent du paysage (ce n'est plus une simple mise à l'échelle).
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.reload();
  const portrait = await collectFivePageSignatures(page);
  expect(portrait).toHaveLength(5);
  await page.reload();
  expect(await collectFivePageSignatures(page)).toEqual(portrait);
});
