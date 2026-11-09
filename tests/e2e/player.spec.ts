import { test, expect } from "@playwright/test";
import { PLACEHOLDER_OPENING } from "./placeholders.js";

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

    // Le player démarre sur l'écran titre : lancer le prologue par « Start ».
    await page.locator(".mh-ui-new-game").click();

    const textEl = page.locator("#text");
    await textEl.waitFor({ timeout: 10000 });
    await expect(textEl).toContainText(/\S{5}/, { timeout: 10000 });

    // Le stage doit contenir un sprite/partbg ou un bg.
    const stage = page.locator(".mh-stage");
    await expect(stage).toBeVisible();
  });

  test("le texte de jeu fait 34 px de corps et 51 px d'interligne à 1280×720 (#182)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    // Le player démarre sur le menu titre : lancer une nouvelle partie.
    await page.locator(".mh-ui-new-game").click();
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

  /**
   * #70 : l'ouverture du prologue de la fixture placeholders reproduit la géométrie du vrai `1-0.ks`
   * (`@partbg … center=748 width=522 height=576 srcleft=542` sur une image 1120×672, voir
   * `PLACEHOLDER_OPENING` et `npm run trace:visual -- 1-0.ks`). Le wrapper doit occuper
   * x ∈ [487, 1009] dans le repère logique 1024×576, à convertir dans le viewport 1280×720 (×1,25),
   * et l'image interne (décalée de -srcleft) doit couvrir tout le cadre, sans décalage.
   */
  test("opening du prologue : bounding box du wrapper partbg et image interne dans le cadre (#70)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    // Animations figées : WAAPI neutralisée et mouvement réduit (transitions HUD instantanées).
    await page.addInitScript(() => {
      // @ts-ignore
      window.Element.prototype.animate = function () {
        return { play: () => this, pause: () => this, cancel: () => this, finish: () => this, onfinish: null };
      };
    });
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await page.locator(".mh-ui-new-game").click();
    // L'ouverture est jouée dès l'entrée dans le prologue : le texte de la première page confirme
    // que la scène d'ouverture est appliquée, puis on attend le calque partbg.
    await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
    const partbg = page.locator(".mh-stage-partbg").first();
    await expect(partbg).toBeVisible({ timeout: 15000 });

    const m = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>(".mh-stage")!;
      const stageRect = stage.getBoundingClientRect();
      // Repère logique du stage (1024×576) agrandi dans le viewport (×1,25 à 1280×720).
      const k = stageRect.width / stage.offsetWidth;
      const rel = (el: Element) => {
        const b = el.getBoundingClientRect();
        return {
          left: (b.left - stageRect.left) / k,
          right: (b.right - stageRect.left) / k,
          top: (b.top - stageRect.top) / k,
          bottom: (b.bottom - stageRect.top) / k,
        };
      };
      const wrapper = document.querySelector<HTMLElement>(".mh-stage-partbg")!;
      const img = wrapper.querySelector<HTMLImageElement>(".mh-stage-partbg-img")!;
      return {
        wrapper: rel(wrapper),
        img: rel(img),
        imgLoaded: img.complete && img.naturalWidth > 0,
        natural: { width: img.naturalWidth, height: img.naturalHeight },
      };
    });

    const w = m.wrapper;
    const round = (v: number) => Math.round(v);
    // Wrapper : 522 × 576 centré en (748, 288) → x ∈ [487, 1009], y ∈ [0, 576].
    expect(round(w.left)).toBe(PLACEHOLDER_OPENING.center - PLACEHOLDER_OPENING.width / 2);
    expect(round(w.right)).toBe(PLACEHOLDER_OPENING.center + PLACEHOLDER_OPENING.width / 2);
    expect(round(w.right - w.left)).toBe(PLACEHOLDER_OPENING.width);
    expect(Math.abs(w.top)).toBeLessThanOrEqual(1);
    expect(round(w.bottom - w.top)).toBe(PLACEHOLDER_OPENING.height);

    // L'image interne est chargée et décalée de -srcleft : elle couvre tout le wrapper (aucun trou).
    expect(m.imgLoaded).toBe(true);
    expect(m.natural).toEqual({ width: PLACEHOLDER_OPENING.imageWidth, height: PLACEHOLDER_OPENING.imageHeight });
    expect(round(m.img.left)).toBe(round(w.left - PLACEHOLDER_OPENING.srcLeft));
    expect(round(m.img.right)).toBe(round(w.left - PLACEHOLDER_OPENING.srcLeft) + PLACEHOLDER_OPENING.imageWidth);
    const overlapWidth = Math.min(w.right, m.img.right) - Math.max(w.left, m.img.left);
    const overlapHeight = Math.min(w.bottom, m.img.bottom) - Math.max(w.top, m.img.top);
    expect(overlapWidth).toBeGreaterThanOrEqual(PLACEHOLDER_OPENING.width - 1);
    expect(overlapHeight).toBeGreaterThanOrEqual(PLACEHOLDER_OPENING.height - 1);
  });
});
