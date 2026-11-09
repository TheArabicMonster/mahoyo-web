import { test, expect, type Page } from "@playwright/test";
import { PLACEHOLDER_SCRIPT_MARKERS } from "./placeholders.js";

/**
 * #94 : parcours complet e2e, en mode placeholders, sur Chromium **et** Firefox desktop.
 *
 * Démarrage (titre → Start) → lecture de plusieurs pages → choix validé → sauvegarde puis
 * chargement (aller-retour après rechargement) → changement de chapitre par enchaînement.
 *
 * Le support de test est le jeu de placeholders généré par `tests/e2e/placeholders.ts` :
 * `story-chain.json` fait se terminer `1-0.ks` sur un **choix** de deux voies, la voie choisie
 * (`1-1a.ks`) s'enchaîne automatiquement vers `2-0.ks` (changement de chapitre), puis la fin.
 *
 * Stabilité : `prefers-reduced-motion` neutralise les transitions plein écran et les animations
 * WAAPI sont figées ; aucun `waitForTimeout` — les attentes portent sur le DOM et les textes.
 */

const text = (page: Page) => page.locator("#text");

/** Repart d'un stockage vide au premier chargement (pas après un `reload` du test). */
async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
    // Fige les animations WAAPI (les transitions CSS sont déjà neutralisées par reduced-motion).
    // @ts-ignore — stub volontairement minimal, comme dans `player.spec.ts`.
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
  await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game");
}

/** Texte de la page, sans le glyphe d'attente (▽/▼) que le renderer pose dans `#text`. */
const pageText = async (page: Page): Promise<string> =>
  (await text(page).innerText()).replace(/[▽▼]/g, "").trim();

/** Attend la fin de la frappe : l'indicateur de clic n'apparaît qu'au point d'arrêt. */
const waitForStop = (page: Page) =>
  expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });

/**
 * Avance d'une page et renvoie son texte une fois la frappe terminée. L'indicateur est visible au
 * départ, un appui passe à la page suivante ; on attend le nouveau point d'arrêt avant de rendre.
 */
async function nextPage(page: Page): Promise<string> {
  await waitForStop(page);
  const previous = await pageText(page);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Enter");
    const current = await pageText(page);
    if (current !== previous && current.length > 0) {
      await waitForStop(page);
      return pageText(page);
    }
  }
  throw new Error("La page n'a pas changé après 8 appuis (frappe bloquée ?)");
}

/** Appuie sur Entrée jusqu'à ce que `check()` soit vrai, sans attente arbitraire. */
async function advanceUntil(page: Page, check: () => Promise<boolean>, label: string, max = 220): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await check()) return;
    await page.keyboard.press("Enter");
  }
  if (await check()) return;
  throw new Error(`Parcours complet : condition jamais atteinte (${label}) après ${max} avancées`);
}

const isVisible = (page: Page, selector: string) => page.locator(selector).first().isVisible();

test.describe("Parcours complet (#94)", () => {
  test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });

  test("titre → lecture → choix → sauvegarde/chargement → chapitre suivant", async ({ page }) => {
    await boot(page);
    await startGame(page);

    // 1. Lecture de quelques pages du prologue : le texte change à chaque page.
    await waitForStop(page);
    const firstPage = await pageText(page);
    expect(firstPage).toContain(PLACEHOLDER_SCRIPT_MARKERS.prologue);
    expect(firstPage).toContain("page 01");
    const secondPage = await nextPage(page);
    expect(secondPage).not.toBe(firstPage);
    expect(secondPage).toContain("page 02");
    await nextPage(page);

    // 2. Fin du prologue : la table d'enchaînement propose un choix à deux options.
    await advanceUntil(page, () => isVisible(page, ".mh-ui-choice"), "menu de choix");
    const choices = page.locator(".mh-ui-choice");
    await expect(choices).toHaveCount(2);
    await expect(choices.nth(0)).toHaveText("Accompagner Aoko");
    await expect(choices.nth(1)).toHaveText("Suivre Alice");

    // 3. Choix validé : la voie A s'ouvre (changement de chapitre par enchaînement).
    await choices.nth(0).click();
    await expect(text(page)).toContainText(PLACEHOLDER_SCRIPT_MARKERS.voieA, { timeout: 15000 });
    await expect(text(page)).not.toContainText(PLACEHOLDER_SCRIPT_MARKERS.voieB);
    await waitForStop(page);
    expect(await pageText(page)).toContain("page 01");

    // 4. Sauvegarde dans un emplacement libre : la fiche porte le titre du chapitre en cours.
    const savedText = await pageText(page);
    await page.mouse.click(640, 360, { button: "right" });
    await page.locator("[data-quick-menu='save']").click();
    const slot = page.locator("[data-slot='3']");
    await expect(slot.locator(".mh-sl-save")).toBeVisible();
    await slot.locator(".mh-sl-save").click();
    await expect(page.locator("#ui-toast")).toContainText("Sauvegardé");
    await expect(slot.locator(".mh-sl-scene")).toContainText("Voie A");
    await expect(slot.locator("time")).toHaveText(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);

    // 5. Rechargement de la page, puis chargement de la sauvegarde : même chapitre, même page.
    await page.reload();
    await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });
    await page.locator("[data-entry='load']").click();
    const loaded = page.locator("[data-slot='3']");
    await expect(loaded.locator(".mh-sl-scene")).toContainText("Voie A");
    await loaded.locator(".mh-sl-load").click();
    await expect(page.locator(".mh-ui-confirm-yes")).toBeFocused();
    await page.locator(".mh-ui-confirm-yes").click();
    await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game", { timeout: 15000 });
    // La page restaurée est exactement la page sauvegardée (texte identique, glyphe d'attente exclu).
    await expect.poll(() => pageText(page), { timeout: 15000 }).toBe(savedText);

    // 6. Enchaînement automatique de fin de chapitre : `1-1a.ks` mène à `2-0.ks`.
    await advanceUntil(
      page,
      async () => (await pageText(page)).includes(PLACEHOLDER_SCRIPT_MARKERS.chapitre2),
      "chapitre 2",
    );
    await expect(text(page)).toContainText(PLACEHOLDER_SCRIPT_MARKERS.chapitre2);

    // 7. Fin de l'histoire (aucune route après `2-0.ks`) : retour à l'écran titre.
    await advanceUntil(page, () => isVisible(page, ".mh-ui-title-screen"), "retour au titre", 60);
    await expect(page.locator(".mh-ui-title-screen")).toBeVisible();
  });
});
