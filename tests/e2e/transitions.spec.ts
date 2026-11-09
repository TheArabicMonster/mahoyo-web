import { test, expect } from "@playwright/test";

/**
 * HUD-14 (#205) : transitions plein écran standard, vérifiées dans le vrai navigateur (Chromium).
 *
 * Les durées sont lues par le module dans les tokens `--mh-dur-*` de `tokens.css` (via
 * `transitions.css`). Les mesures de temps réelles ne sont pas comparées à la milliseconde ; on
 * vérifie la séquence des phases et l'ordre de grandeur des tokens, le détail exact étant couvert
 * par `tests/unit/ui/transitions.test.ts` (horloge simulée).
 */

type PhaseRecord = { phase: string; at: number };

/** Installe un observateur de phase avant l'action ; renvoie les enregistrements via `window.__mhPhases`. */
async function watchTransition(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const curtain = document.getElementById("ui-transition");
    if (!curtain) throw new Error("rideau #ui-transition absent");
    const records: PhaseRecord[] = [
      { phase: curtain.getAttribute("data-phase") ?? "idle", at: performance.now() },
    ];
    new MutationObserver(() => {
      records.push({ phase: curtain.getAttribute("data-phase") ?? "idle", at: performance.now() });
    }).observe(curtain, { attributes: true, attributeFilter: ["data-phase"] });
    (window as unknown as { __mhPhases: PhaseRecord[] }).__mhPhases = records;
  });
}

test.describe("Transitions plein écran (HUD-14)", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("titre → jeu : fondu au noir puis apparition, rideau dans #ui-overlay", async ({ page }) => {
    await page.goto("/");
    await page.locator("#viewport").waitFor();
    await page.locator(".mh-ui-new-game").waitFor();

    // Le rideau est posé dans l'overlay (donc sous #ui-loading, z-index 300) et couvre tout le viewport.
    const geometry = await page.evaluate(() => {
      const curtain = document.getElementById("ui-transition")!;
      const overlay = document.getElementById("ui-overlay")!;
      const viewport = document.getElementById("viewport")!;
      const c = curtain.getBoundingClientRect();
      const v = viewport.getBoundingClientRect();
      return {
        parentIsOverlay: curtain.parentElement === overlay,
        zIndex: getComputedStyle(curtain).zIndex,
        sameSize: Math.abs(c.width - v.width) < 1 && Math.abs(c.height - v.height) < 1,
        ariaHidden: curtain.getAttribute("aria-hidden"),
        // Durée résolue par le navigateur : 1200 ms depuis `--mh-dur-scene-out`.
        out: getComputedStyle(curtain).getPropertyValue("--mh-transition-out").trim(),
        hold: getComputedStyle(curtain).getPropertyValue("--mh-transition-hold").trim(),
        in: getComputedStyle(curtain).getPropertyValue("--mh-transition-in").trim(),
        tokenOut: getComputedStyle(document.documentElement).getPropertyValue("--mh-dur-scene-out").trim(),
      };
    });
    expect(geometry.parentIsOverlay).toBe(true);
    expect(geometry.zIndex).toBe("250");
    expect(geometry.sameSize).toBe(true);
    expect(geometry.ariaHidden).toBe("true");
    expect(geometry.out).toBe("1200ms");
    expect(geometry.hold).toBe("200ms");
    expect(geometry.in).toBe("850ms");
    expect(geometry.tokenOut).toBe("1200ms");

    await watchTransition(page);
    await page.locator(".mh-ui-new-game").click();
    await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
    await page.waitForFunction(
      () => document.getElementById("ui-transition")?.getAttribute("data-phase") === "idle",
    );

    const phases = await page.evaluate(
      () => (window as unknown as { __mhPhases: PhaseRecord[] }).__mhPhases,
    );
    const sequence = phases.map((p) => p.phase);
    expect(sequence).toEqual(expect.arrayContaining(["out", "black", "in", "idle"]));
    expect(sequence.lastIndexOf("in")).toBeLessThan(sequence.lastIndexOf("idle"));
    const outAt = phases.find((p) => p.phase === "out")!;
    const blackAt = phases.find((p) => p.phase === "black")!;
    const inAt = phases.find((p) => p.phase === "in")!;
    const idleAt = [...phases].reverse().find((p) => p.phase === "idle")!;
    // Tokens appliqués : fondu ≥ 1,1 s (1,2 s mesuré), apparition ≥ 0,75 s (0,85 s mesuré).
    expect(blackAt.at - outAt.at).toBeGreaterThanOrEqual(1100);
    expect(idleAt.at - inAt.at).toBeGreaterThanOrEqual(750);
    // Critère d'acceptation : aucun noir prolongé > 1 s quand les assets sont prêts.
    expect(inAt.at - blackAt.at).toBeLessThanOrEqual(1000);
    // Le rideau ne bloque plus les entrées une fois la transition finie.
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("ui-transition")!).pointerEvents)).toBe(
      "none",
    );
  });

  test("prefers-reduced-motion : aucune transition ni flash noir", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.locator(".mh-ui-new-game").waitFor();

    // Les tokens de mouvement sont à 0 ms (tokens.css) : le module ne joue aucune transition.
    const tokens = await page.evaluate(() => ({
      out: getComputedStyle(document.documentElement).getPropertyValue("--mh-dur-scene-out").trim(),
      resolved: getComputedStyle(document.getElementById("ui-transition")!)
        .getPropertyValue("--mh-transition-out")
        .trim(),
    }));
    expect(tokens).toEqual({ out: "0ms", resolved: "0ms" });

    await watchTransition(page);
    await page.locator(".mh-ui-new-game").click();
    await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });

    const state = await page.evaluate(() => {
      const curtain = document.getElementById("ui-transition")!;
      const phases = (window as unknown as { __mhPhases: PhaseRecord[] }).__mhPhases.map((p) => p.phase);
      return {
        phases,
        phase: curtain.getAttribute("data-phase"),
        running: document.getElementById("ui-overlay")!.classList.contains("mh-ui-transition-running"),
      };
    });
    // Aucune phase intermédiaire : le player affiche directement la scène.
    expect(state.phase).toBe("idle");
    expect(state.running).toBe(false);
    expect(state.phases).toEqual(["idle"]);
  });
});
