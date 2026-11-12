/**
 * #407 : `[l]` coupe la ligne AVANT d'afficher l'icône de clic (fini l'icône au milieu d'une
 * phrase) ; la suite du texte n'apparaît qu'après le clic. Script injecté, sans asset.
 */
import { test, expect, type Page } from "@playwright/test";

const SCRIPT = `*page0|
Quelques minutes plus tard, [l]ils trouvèrent un être vivant sous le capot de la voiture.[l]
@pg
`;

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
  });
  await page.route("**/assets/scenario/1-0.ks", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: SCRIPT }),
  );
  await page.goto("/");
  await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });
  await page.locator(".mh-ui-new-game").click();
  await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game");
}

test("l'icône [l] est en fin de ligne, la suite attend le clic (#407)", async ({ page }) => {
  await boot(page);
  const text = page.locator("#text");
  await expect(text).toContainText("Quelques minutes plus tard", { timeout: 15000 });
  // La suite de la phrase n'est PAS encore affichée : l'attente [l] est en fin de ligne.
  await expect(text).not.toContainText("ils trouvèrent un être vivant");
  await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 5000 });
  const firstLine = await text.innerText();
  expect(firstLine).toContain("Quelques minutes plus tard");
  // Le clic révèle la suite (même si la frappe est encore en cours).
  await page.keyboard.press("Enter");
  await expect(text).toContainText("ils trouvèrent un être vivant", { timeout: 15000 });
});
