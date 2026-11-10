import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * #97 : audit WCAG 2.1 AA de l'application (reste de l'app après les écrans système, WEB-06/#211).
 *
 * L'audit axe-core porte sur **la page entière** de chaque vue atteignable : titre, Extra, Archive,
 * les quatre onglets de configuration, menu système, confirmation, sauvegarde, chargement,
 * historique, jeu (prologue, menu de choix), flowchart, galerie CG et visionneuse. Il tourne en
 * Chromium **et** en Firefox (projets Playwright).
 *
 * Les écrans système sont déjà couverts en détail par `tests/e2e/system-a11y.spec.ts` ; ce spec
 * complète l'audit AA global et les critères transverses (zoom, taille de texte, couleurs forcées).
 */

const overlay = (page: Page) => page.locator("#ui-overlay");

async function boot(page: Page, options: { progress?: unknown } = {}): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript((progress) => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
    if (progress) localStorage.setItem("mahoyo.story-progress", JSON.stringify(progress));
  }, options.progress ?? null);
  await page.goto("/");
  await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });
}

async function startGame(page: Page): Promise<void> {
  await page.locator(".mh-ui-new-game").click();
  await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
  await expect(overlay(page)).toHaveAttribute("data-screen", "game");
}

async function openPause(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator(".mh-sysmenu")).toBeVisible();
}

/** Audit WCAG 2.0/2.1/2.2 A+AA de la page courante : aucune violation tolérée. */
async function auditAa(page: Page, label: string): Promise<void> {
  // Les fondus d'ouverture peuvent fausser les mesures de contraste : on attend les animations finies.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const detail = results.violations
    .map(
      (violation) =>
        `${violation.id} [${violation.impact}] — ${violation.nodes
          .flatMap((node) => node.target)
          .map(String)
          .join(", ")}`,
    )
    .join("\n");
  expect(results.violations, `Violations axe-core (${label}) :\n${detail}`).toEqual([]);
}

test.describe("Audit WCAG AA (#97) : vues", () => {
  test("écran titre, Extra et Archive", async ({ page }) => {
    await boot(page, { progress: { visited: ["1-0"], finished: [], choices: [], endings: [] } });
    await auditAa(page, "titre");

    await page.locator('[data-entry="extra"]').click();
    await expect(page.locator(".mh-ui-title-extra-menu")).toBeVisible();
    await auditAa(page, "extra");

    const archive = page.locator('[data-entry="archive"]');
    if ((await archive.getAttribute("aria-disabled")) !== "true") {
      await archive.click();
      await expect(page.locator(".mh-ui-title-extra")).toBeVisible();
      await auditAa(page, "archive");
    }
  });

  test("configuration : les quatre onglets", async ({ page }) => {
    await boot(page);
    await page.locator('[data-entry="config"]').first().click();
    await expect(page.locator(".mh-cfg")).toBeVisible();
    const tabs = page.locator('.mh-cfg [role="tab"]');
    const count = await tabs.count();
    expect(count).toBe(4);
    for (let index = 0; index < count; index++) {
      await tabs.nth(index).click();
      await auditAa(page, `config-onglet-${index + 1}`);
    }
  });

  test("menu système et confirmation", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openPause(page);
    await auditAa(page, "menu système");

    await page.locator('.mh-sysmenu [data-entry="title"]').click();
    await expect(page.locator(".mh-ui-confirm")).toBeVisible();
    await auditAa(page, "confirmation");
  });

  test("sauvegarde et chargement", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openPause(page);
    await page.locator('.mh-sysmenu [data-entry="save"]').click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "save");
    await auditAa(page, "sauvegarde");

    await page.keyboard.press("Escape");
    await page.locator('.mh-sysmenu [data-entry="load"]').click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "load");
    await auditAa(page, "chargement");
  });

  test("historique", async ({ page }) => {
    await boot(page);
    await startGame(page);
    for (let index = 0; index < 25; index++) await page.keyboard.press("Enter");
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    await openPause(page);
    await page.locator('.mh-sysmenu [data-entry="backlog"]').click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "backlog");
    await auditAa(page, "historique");
  });

  test("jeu : prologue (HUD et texte) puis menu de choix", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    await auditAa(page, "jeu-prologue");

    for (let index = 0; index < 200; index++) {
      if ((await page.locator(".mh-ui-choices button").count()) > 0) break;
      await page.keyboard.press("Enter");
    }
    await expect(page.locator(".mh-ui-choices button").first()).toBeVisible({ timeout: 20000 });
    await auditAa(page, "jeu-choix");
  });

  test("flowchart", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openPause(page);
    await page.locator('.mh-sysmenu [data-entry="flowchart"]').click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "flowchart");
    await expect(page.locator(".mh-flow-screen")).toBeVisible();
    await auditAa(page, "flowchart");
  });

  test("CG mode et visionneuse", async ({ page }) => {
    await boot(page);
    await page.locator('[data-entry="extra"]').click();
    const cg = page.locator('[data-entry="cgmode"]');
    await expect(cg).not.toHaveAttribute("aria-disabled", "true");
    await cg.click();
    await expect(page.locator(".mh-cg-tile").first()).toBeVisible();
    await auditAa(page, "cg-galerie");

    const unlocked = page.locator(".mh-cg-tile[data-locked='false']").first();
    await expect(unlocked).toBeVisible();
    await unlocked.click();
    await expect(page.locator(".mh-cg-viewer")).toBeVisible();
    await auditAa(page, "cg-visionneuse");
  });
});

test.describe("WCAG AA (#97) : critères transverses", () => {
  test("le zoom du navigateur n'est pas bloqué (1.4.4) et axe le confirme", async ({ page }) => {
    await boot(page);
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).not.toBeNull();
    expect(viewport!.toLowerCase()).not.toContain("user-scalable=no");
    expect(viewport!.toLowerCase()).not.toContain("maximum-scale");
    // Règle axe `meta-viewport` (déjà incluse dans l'audit global ci-dessus, vérifiée explicitement).
    const results = await new AxeBuilder({ page }).withRules(["meta-viewport"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("taille de texte réglable (1.4.4) : le réglage agit sur le texte du jeu", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    const fontSize = () =>
      page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".mh-stage-text")!).fontSize));
    const before = await fontSize();
    expect(before).toBeGreaterThan(0);

    await openPause(page);
    await page.locator('.mh-sysmenu [data-entry="config"]').click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "settings");
    const slider = page.locator('input[name="fontScale"]');
    await expect(slider).toHaveCount(1);
    await slider.evaluate((element) => {
      const input = element as HTMLInputElement;
      input.value = "2";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "game");
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    expect(await fontSize(), "la taille du texte n'a pas augmenté avec le réglage").toBeGreaterThan(before);
  });

  test("couleurs forcées : l'interface reste visible et utilisable", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await boot(page);
    await expect(page.locator(".mh-ui-title-screen")).toBeVisible();
    await expect(page.locator('[data-entry="flowchart"]')).toBeVisible();
    await startGame(page);
    await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
  });
});
