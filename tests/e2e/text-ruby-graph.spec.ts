import { test, expect, type Page } from "@playwright/test";
import { PLACEHOLDER_RUBY_EMOJI_MARKER } from "./placeholders.js";

/**
 * #300 — ruby posé sur l'image inline `[graph]`.
 *
 * La page de test du prologue placeholders contient `[ruby text=ハート char=1][heart]、` : le ruby
 * doit annoter l'image emoji (`<ruby><img class="mh-stage-graph"><rt>ハート</rt></ruby>`) et non le
 * « 、 » suivant. On vérifie le DOM rendu (une seule balise ruby, image + lecture, ponctuation hors
 * ruby) et l'absence de régression sur l'image elle-même.
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

/**
 * Avance jusqu'à la page ruby + emoji. On s'appuie sur le **contenu stable** (marqueur de la page
 * ou présence de la balise `ruby`) et non sur `#textbox-indicator` : la page « texte long »
 * (#314/#320, insérée avant) et les pages en cours de frappe peuvent le laisser masqué, ce qui
 * faisait échouer l'attente initiale (#310 CI Chromium + Firefox).
 */
async function advanceToRubyEmojiPage(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if ((await text(page).innerText()).includes(PLACEHOLDER_RUBY_EMOJI_MARKER)) return;
    if ((await page.locator(".mh-stage-text ruby").count()) > 0) return;
    // Laisse la frappe/la transition démarrer avant de presser Entrée (hurry puis page suivante).
    await page.waitForTimeout(120);
    await page.keyboard.press("Enter");
  }
  throw new Error("La page de test ruby + emoji n'a pas été atteinte (marqueur/ruby absents)");
}

test("le ruby s'attache à l'image [graph] et non au texte suivant (#300)", async ({ page }) => {
  await boot(page);
  await page.locator(".mh-ui-new-game").click();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
  await advanceToRubyEmojiPage(page);

  const ruby = page.locator(".mh-stage-text ruby");
  await expect(ruby).toHaveCount(1);
  const graph = ruby.locator("img.mh-stage-graph");
  await expect(graph).toBeVisible({ timeout: 10000 });
  expect(await graph.getAttribute("alt")).toBe("(ハート)");
  expect(await graph.getAttribute("src")).toContain("heart26");
  await expect(ruby.locator("rt")).toHaveText("ハート");

  // Le « 、 » qui suit n'est pas annoté (bug initial : ruby attaché au texte suivant).
  const rubyText = await ruby.innerText();
  expect(rubyText).not.toContain("、");
  const pageText = await text(page).innerText();
  expect(pageText).toContain("、");
  // Une seule balise ruby : pas de doublon sur le texte suivant.
  await expect(page.locator(".mh-stage-text ruby")).toHaveCount(1);
});
