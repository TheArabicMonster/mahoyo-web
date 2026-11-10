/**
 * Mesure locale des transitions réelles (#317/#316) — **assets réels uniquement**.
 *
 * Gated : `MAHOYO_E2E_REAL_ASSETS=1` + `MAHOYO_E2E_ASSETS` pointant vers le `public/` du jeu.
 * En CI placeholders, le test est ignoré (preuves compteur/oracle via `oracle:state`).
 *
 * Mesures : nombre de fondus (`overlay` de crossfade créés) pendant `1-0.ks`, et monotonie de
 * l'opacité d'au moins une animation de sprite (`@movefg`) enregistrée via `Element.animate`.
 */
import { expect, test } from "@playwright/test";

const realAssets = process.env.MAHOYO_E2E_REAL_ASSETS === "1";

test.describe("1-0.ks réel — transitions (#317)", () => {
  test.skip(!realAssets, "assets réels uniquement (MAHOYO_E2E_REAL_ASSETS=1)");

  test("fondus détectés et opacité monotone pendant les animations de sprite", async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      // Compte les overlays de crossfade créés et enregistre les animations WAAPI des sprites.
      const w = window as unknown as { __ov: number; __anims: { id: string; keyframes: unknown[] }[] };
      w.__ov = 0;
      w.__anims = [];
      const observe = () => {
        const target = document.querySelector("#stage-bg");
        if (!target) return requestAnimationFrame(observe);
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node instanceof HTMLElement && node.classList.contains("mh-stage-bg-overlay")) w.__ov += 1;
            }
          }
        }).observe(target.parentElement!, { childList: true });
      };
      observe();
      const original = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, options?: number | KeyframeAnimationOptions) {
        const el = this as HTMLElement;
        if (el.dataset?.spriteId) w.__anims.push({ id: el.dataset.spriteId, keyframes: (keyframes as Keyframe[]).map((k) => ({ ...k })) });
        return original.call(this, keyframes as Keyframe[], options);
      } as typeof Element.prototype.animate;
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.locator(".mh-ui-new-game").click();
    await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
    // Avance le prologue (textes, attentes, transitions) jusqu'à la fin du script.
    for (let i = 0; i < 240; i++) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
    }
    const metrics = await page.evaluate(() => {
      const w = window as unknown as { __ov: number; __anims: { id: string; keyframes: unknown[] }[] };
      return { overlays: w.__ov, anims: w.__anims };
    });
    // Nombre de transitions de scène mesuré localement (rapporté dans la PR ; 1-0 réel).
    expect(metrics.overlays).toBeGreaterThanOrEqual(1);
    // Au moins une animation de sprite avec une opacité strictement monotone (@movefg).
    const monotone = metrics.anims.some((anim) => {
      const values = anim.keyframes
        .map((k) => (k as { opacity?: unknown }).opacity)
        .filter((value): value is number => typeof value === "number");
      if (values.length < 2) return false;
      return values.every((value, index) => index === 0 || value >= values[index - 1]!) || values.every((value, index) => index === 0 || value <= values[index - 1]!);
    });
    expect(monotone).toBe(true);
    // Trace chiffrée pour la PR (visible dans la sortie locale).
    console.log(`[1-0 réel] overlays=${metrics.overlays} animations=${metrics.anims.length} monotone=${monotone}`);
  });
});
