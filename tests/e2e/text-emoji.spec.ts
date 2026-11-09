import { test, expect, type Page } from "@playwright/test";
import { PLACEHOLDER_EMOJI_MARKER } from "./placeholders.js";

/**
 * #284 — emoji `[graph]` inline (un seul e2e pour ce lot).
 *
 * La page de test du prologue placeholders contient `[heart]` ; le runtime l'expanse en
 * `[graph storage=heart26 alt="(ハート)"]` (taille de message par défaut) et le rendu insère une
 * image inline dans `.mh-stage-text`. On vérifie l'image, sa source résolue, son `alt`
 * d'accessibilité et son chargement effectif.
 */

const text = (page: Page) => page.locator("#text");

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
  await expect(page.locator(".mh-ui-new-game")).toBeVisible({ timeout: 15000 });
}

/** Avance jusqu'à la page `[heart]` (4ᵉ page du prologue de test). */
async function advanceToEmojiPage(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    if ((await text(page).innerText()).includes(PLACEHOLDER_EMOJI_MARKER)) return;
    await page.keyboard.press("Enter");
  }
  throw new Error("La page de test emoji n'a pas été atteinte");
}

test("un emoji [heart] est rendu inline dans le texte (img.mh-stage-graph, alt, source)", async ({ page }) => {
  await boot(page);
  await page.locator(".mh-ui-new-game").click();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
  await advanceToEmojiPage(page);

  const graph = page.locator(".mh-stage-text img.mh-stage-graph");
  await expect(graph).toBeVisible({ timeout: 10000 });
  expect(await graph.getAttribute("alt")).toBe("(ハート)");
  expect(await graph.getAttribute("src")).toContain("heart26");

  const loaded = await graph.evaluate((el) => {
    const img = el as HTMLImageElement;
    return { complete: img.complete, width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(loaded.complete).toBe(true);
  expect(loaded.width).toBeGreaterThan(0);
  expect(loaded.height).toBeGreaterThan(0);

  // Le texte encadrant reste lisible : l'image est bien dans le flux, pas un sprite de scène.
  expect(await text(page).innerText()).toContain(PLACEHOLDER_EMOJI_MARKER);
});
