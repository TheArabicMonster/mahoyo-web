import { test, expect, type Page } from "@playwright/test";
import { PLACEHOLDER_CM_MARKER } from "./placeholders.js";

/**
 * #86 — `@cm` vide la page.
 *
 * Un seul e2e pour ce lot (protocole Lead) : la première page du prologue de test affiche un
 * marqueur puis `@cm` la vide avant un `@s` (point d'arrêt). On vérifie que le texte de la page
 * devient vide **sans** que la boîte soit masquée, puis qu'un clic passe à la page suivante.
 * Les animations WAAPI sont figées et `prefers-reduced-motion` neutralise les transitions.
 */

const text = (page: Page) => page.locator("#text");

/** Texte de la page, sans le glyphe d'attente (▽/▼) du renderer. */
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
  await expect(page.locator(".mh-ui-new-game")).toBeVisible({ timeout: 15000 });
}

/** Avance jusqu'à la page de test `@cm` (3ᵉ page du prologue de test, #86). */
async function advanceToCmPage(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    // Attendre le point d'arrêt AVANT de lire le texte et d'appuyer : sinon on peut appuyer au
    // milieu de la frappe et exécuter @cm avant d'avoir vu le marqueur.
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    if ((await pageText(page)).includes(PLACEHOLDER_CM_MARKER)) return;
    await page.keyboard.press("Enter");
  }
  if (!(await pageText(page)).includes(PLACEHOLDER_CM_MARKER)) {
    throw new Error("La page de test @cm n'a pas été atteinte");
  }
}

test("la page est vidée au @cm (le texte disparaît, la boîte reste affichée)", async ({ page }) => {
  await boot(page);
  await page.locator(".mh-ui-new-game").click();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
  await advanceToCmPage(page);

  // Fin de la frappe : l'indicateur de clic n'apparaît qu'au point d'arrêt de `[l]`.
  await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });

  // Acquitter le `[l]` puis exécuter `@cm` (et `@s`) : le texte de la page doit devenir vide.
  await expect
    .poll(
      async () => {
        await page.keyboard.press("Enter");
        return pageText(page);
      },
      { timeout: 15000, intervals: [100, 200, 400] },
    )
    .toBe("");

  // La boîte de texte n'est pas masquée par @cm (pas d'état @textoff) : elle reste visible.
  const box = page.locator(".mh-stage-textbox");
  await expect(box).toBeVisible();
  const opacity = await box.evaluate((el) => (el as HTMLElement).style.opacity);
  expect(opacity).toBe("1");

  // Le clic suivant passe à la page suivante du prologue de test.
  await page.keyboard.press("Enter");
  await expect(text(page)).not.toContainText(PLACEHOLDER_CM_MARKER, { timeout: 15000 });
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
});
