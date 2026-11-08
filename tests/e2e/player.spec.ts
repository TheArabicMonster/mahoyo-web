import { test, expect } from "@playwright/test";

test.describe("Player e2e", () => {
  test("démarre le prologue et affiche la scène + le texte", async ({ page }) => {
    // Intercepter et geler les animations WAAPI avant que le player ne démarre.
    await page.addInitScript(() => {
      // @ts-ignore
      window.Element.prototype.animate = function () {
        return { play: () => this, pause: () => this, cancel: () => this, finish: () => this, onfinish: null };
      };
    });

    await page.goto("/");

    // Le viewport et le texte du prologue doivent apparaître.
    const viewport = page.locator("#viewport");
    await viewport.waitFor({ timeout: 10000 });

    const textEl = page.locator("#text");
    await textEl.waitFor({ timeout: 10000 });
    await expect(textEl).toContainText("その子の影になったのは", { timeout: 10000 });

    // Le stage doit contenir un sprite/partbg ou un bg.
    const stage = page.locator(".mh-stage");
    await expect(stage).toBeVisible();
  });

  test("le texte de jeu fait 34 px de corps et 51 px d'interligne à 1280×720 (#182)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    // Le player démarre sur le menu titre : lancer une nouvelle partie.
    await page.getByText("Nouvelle partie").click();
    const textEl = page.locator("#text");
    // Langue du texte selon les traductions disponibles : on attend simplement une première page.
    await expect(textEl).toContainText(/\S{5}/, { timeout: 15000 });

    const m = await page.evaluate(() => {
      const text = document.querySelector<HTMLElement>(".mh-stage-text")!;
      const stage = document.querySelector<HTMLElement>(".mh-stage")!;
      const box = document.querySelector<HTMLElement>(".mh-stage-textbox")!;
      const cs = getComputedStyle(text);
      // Le stage est dessiné en 1024×576 puis agrandi : getComputedStyle donne la valeur avant agrandissement.
      const k = stage.getBoundingClientRect().width / stage.offsetWidth;
      const area = text.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      return {
        frame: box.dataset.frameStyle,
        bodyPx: parseFloat(cs.fontSize) * k,
        linePx: parseFloat(cs.lineHeight) * k,
        textBottom: (area.bottom - stageRect.top) / stageRect.height,
        scrollOverflow: text.scrollHeight > text.clientHeight + 1,
      };
    });
    expect(m.frame).toBe("image");
    expect(m.bodyPx).toBeGreaterThanOrEqual(33);
    expect(m.bodyPx).toBeLessThanOrEqual(35);
    expect(m.linePx).toBeGreaterThanOrEqual(50);
    expect(m.linePx).toBeLessThanOrEqual(52);
    // La zone de texte s'arrête à 91,9 % de la hauteur (marge basse de 8,1 %) et ne défile pas.
    expect(m.textBottom).toBeLessThanOrEqual(0.92);
    expect(m.scrollOverflow).toBe(false);
  });
});
