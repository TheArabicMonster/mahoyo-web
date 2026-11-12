import { test, expect } from "@playwright/test";

/**
 * Captures du mode revue (#415) : html2canvas doit produire une image 16:9 **plein cadre**
 * (pas de bandes noires à droite/en bas, causées par `transform: scale(1.25)` non appliqué) et
 * rendre le cadre de texte CSS (placeholder `txtwindow02` en bleu nuit, cf. `placeholders.ts`).
 */
test.describe("captures du mode revue (#415)", () => {
  test("capture 16:9 plein cadre, sans bandes, cadre de texte rendu", async ({ page }) => {
    await page.goto("/?review=1");
    await expect(page.locator("#mh-review-hud")).toBeVisible();
    // Aide du premier lancement : Entrée la ferme.
    await page.keyboard.press("Enter");

    await page.locator(".mh-ui-new-game").click();
    await expect(page.locator("#ui-overlay")).toHaveAttribute("data-screen", "game", { timeout: 15000 });
    // Laisse la scène + le cadre (image de fond CSS) se poser.
    await page.waitForTimeout(2000);

    await page.keyboard.press("F2");
    await expect(page.locator('#mh-review-panel[data-open="true"]')).toBeVisible();
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
    await expect(page.locator("#mh-review-toast")).toContainText("Flag #1 enregistré", { timeout: 15000 });

    const stats = await page.evaluate(async () => {
      const dump = await (window as unknown as { __mhReview: { dump: () => Promise<unknown> } }).__mhReview.dump();
      const capture = (dump as { flags: { capture: string | null }[] }).flags.at(-1)?.capture ?? null;
      if (!capture) return { capture: null as string | null };
      const image = new Image();
      image.src = capture;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixel = (x: number, y: number): [number, number, number] => {
        const data = context.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return [data[0]!, data[1]!, data[2]!];
      };
      return {
        capture,
        width: image.naturalWidth,
        height: image.naturalHeight,
        topLeft: pixel(8, 8),
        rightEdge: pixel(image.naturalWidth - 8, image.naturalHeight * 0.5),
        bottomEdge: pixel(image.naturalWidth * 0.5, image.naturalHeight - 8),
        bottomRight: pixel(image.naturalWidth - 8, image.naturalHeight - 8),
      };
    });

    expect(stats.capture, "capture JPEG présente").toBeTruthy();
    expect(stats.capture!.length, "capture non vide").toBeGreaterThan(10_000);
    expect(stats.width, "largeur capture").toBe(960);
    expect(stats.height, "hauteur capture").toBe(540);
    expect(stats.width! / stats.height!, "format 16:9").toBeCloseTo(16 / 9, 2);

    // Cadre de texte placeholder = bleu nuit (28, 44, 84). S'il manquait, la scène serait noire.
    const distance = (a: number[], b: number[]): number => Math.max(...a.map((value, index) => Math.abs(value - b[index]!)));
    const frameColor = [28, 44, 84];
    expect(distance(stats.topLeft!, frameColor), "coin haut-gauche = cadre rendu (pas de fond noir)").toBeLessThan(60);
    expect(distance(stats.bottomRight!, frameColor), "coin bas-droit = cadre rendu (pas de bande noire)").toBeLessThan(60);
    // Sans bandes noires : les bords ont la teinte du cadre, pas (0,0,0).
    expect(distance(stats.rightEdge!, stats.topLeft!), "bord droit homogène (pas de bande)").toBeLessThan(60);
    expect(distance(stats.bottomEdge!, stats.topLeft!), "bord bas homogène (pas de bande)").toBeLessThan(60);
  });
});
