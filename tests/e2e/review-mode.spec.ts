import { test, expect, type ConsoleMessage } from "@playwright/test";

/**
 * Mode revue (#403) : HUD/overlay d'aide visibles, F2 fonctionne **sans clic préalable**,
 * flag enregistré (catégorie + note + toast), et aucune erreur service worker/MIME.
 */
test.describe("mode revue (#403)", () => {
  test("?review=1 : aide, F2 sans clic → flag présent, console propre", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message: ConsoleMessage) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/?review=1");
    const hud = page.locator("#mh-review-hud");
    await expect(hud).toBeVisible();
    await expect(hud).toContainText("Marquer (F2)");
    await expect(hud).toContainText("Exporter (F3)");

    // Overlay d'aide au premier lancement, dismissible au clavier.
    const help = page.locator("#mh-review-help");
    await expect(help).toBeVisible();
    await expect(help).toContainText("Fermez le navigateur pour terminer");
    await page.keyboard.press("Enter");
    await expect(help).toBeHidden();

    // F2 sans clic préalable : le panneau s'ouvre, 1 = catégorie Texte, Entrée valide.
    await page.keyboard.press("F2");
    const panel = page.locator('#mh-review-panel[data-open="true"]');
    await expect(panel).toBeVisible();
    await page.keyboard.press("1");
    await page.locator(".mh-review-note").fill("test e2e focus");
    await page.keyboard.press("Enter");
    await expect(page.locator("#mh-review-toast")).toContainText("Flag #1 enregistré — Texte");
    await expect(hud).toContainText("1");

    const flags = (await page.evaluate(() => JSON.parse(localStorage.getItem("mahoyo-review-flags") ?? "[]"))) as {
      category: string;
      note: string;
      script: { scriptName: string | null };
    }[];
    expect(flags).toHaveLength(1);
    expect(flags[0]!.category).toBe("texte");
    expect(flags[0]!.note).toBe("test e2e focus");
    // Flag posé depuis l'écran titre : pas encore de script courant (runtime absent), c'est normal.

    // En jeu, le flag porte bien le script et la position d'instruction.
    await page.locator(".mh-ui-new-game").click();
    await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game", { timeout: 15000 });
    await page.keyboard.press("F2");
    await expect(page.locator('#mh-review-panel[data-open="true"]')).toBeVisible();
    await page.keyboard.press("2"); // Sprite
    await page.keyboard.press("Enter");
    await expect(page.locator("#mh-review-toast")).toContainText("Flag #2 enregistré — Sprite");
    const gameFlags = (await page.evaluate(() => JSON.parse(localStorage.getItem("mahoyo-review-flags") ?? "[]"))) as {
      category: string;
      script: { scriptName: string | null; page: number | null; instruction: number | null };
      scene: { bg: string | null };
    }[];
    expect(gameFlags).toHaveLength(2);
    expect(gameFlags[1]!.category).toBe("sprite");
    expect(gameFlags[1]!.script.scriptName).toBeTruthy();
    expect(gameFlags[1]!.script.page).not.toBeNull();

    const swErrors = errors.filter((text) => /service worker|MIME type|sw\.js/i.test(text));
    expect(swErrors).toEqual([]);
  });

  test("sans ?review=1 : aucun HUD, aucun écouteur", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#mh-review-hud")).toHaveCount(0);
    expect(await page.evaluate(() => Boolean((window as unknown as { __mhReview?: unknown }).__mhReview))).toBe(false);
  });
});
