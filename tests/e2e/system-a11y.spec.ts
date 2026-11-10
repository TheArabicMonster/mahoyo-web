import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * WEB-06 (#211) : accessibilité des écrans système (docs/ANALYSE_HUD_ORIGINAL.md §3, écart E31 ;
 * docs/DESIGN.md §10). Couvre les écrans refaits : titre et Extra/Archive, menu système, confirmation,
 * sauvegarde/chargement, historique et configuration (le flowchart a son propre lot, FLOW-07/#206).
 *
 * Trois familles de preuves :
 * - audit axe-core (WCAG 2.0/2.1/2.2 A+AA) sans aucune violation sur chaque écran ;
 * - parcours 100 % clavier : chaque arrêt de tabulation a un focus visible (contour ≥ 2 px), le focus
 *   reste dans les dialogues, et `Échap` ferme toujours l'écran superposé ;
 * - sémantique (dialog/aria-modal, tablist, list, status, aria-live) et `prefers-reduced-motion`.
 */

const overlay = (page: Page) => page.locator("#ui-overlay");

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
  });
  await page.goto("/");
  await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });
}

async function startGame(page: Page): Promise<void> {
  await page.locator(".mh-ui-new-game").click();
  await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
}

async function openPause(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator(".mh-sysmenu")).toBeVisible();
}

async function openSystemEntry(page: Page, entry: string): Promise<void> {
  if ((await page.locator(".mh-sysmenu").count()) === 0) await openPause(page);
  await page.locator(`.mh-sysmenu [data-entry="${entry}"]`).click();
}

/** Lecture de quelques pages : l'historique ne s'ouvre qu'une fois non vide (HUD-12). */
async function readPages(page: Page, count = 20): Promise<void> {
  for (let i = 0; i < count; i++) await page.keyboard.press("Enter");
  await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
}

async function audit(page: Page, selector: string): Promise<void> {
  // Un fondu d'ouverture peut être en cours (ex. confirmation, 150 ms) : axe-core mesure alors des
  // couleurs mélangées par l'opacité et croit à un contraste insuffisant. On attend les animations finies.
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  // Trace utile en cas d'échec : règle, impact et sélecteurs fautifs.
  const detail = results.violations
    .map((v) => `${v.id} [${v.impact}] ${v.help} → ${v.nodes.flatMap((n) => n.target).map(String).join(", ")}`)
    .join("\n");
  expect(results.violations, `Violations axe-core :\n${detail}`).toEqual([]);
}

type FocusStop = { tag: string; cls: string; inside: boolean; outlineStyle: string; outlineWidth: number; outlineOffset: number };

/** Parcourt le focus au clavier (`Tab`) dans `scope` et renvoie chaque arrêt, sans dépasser `scope`. */
async function tabStops(page: Page, scope: string, max = 40): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate((scopeSel) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: (el.className || "").toString().slice(0, 50),
        inside: !!el.closest(scopeSel),
        outlineStyle: s.outlineStyle,
        outlineWidth: Number.parseFloat(s.outlineWidth) || 0,
        outlineOffset: Number.parseFloat(s.outlineOffset) || 0,
      };
    }, scope);
    if (!stop) break;
    stops.push(stop);
    // Boucle de focus : on s'arrête quand un écran revient sur son premier arrêt.
    if (stops.length > 2 && stop.tag === stops[0]!.tag && stop.cls === stops[0]!.cls && stop.inside) {
      const first = stops[0]!;
      if (stop.outlineWidth === first.outlineWidth && stop.outlineOffset === first.outlineOffset) break;
    }
    if (!stop.inside) break;
  }
  return stops;
}

/** Chaque arrêt de tabulation doit porter un focus visible (DESIGN §10 : contour ≥ 2 px, décalage ≥ 1 px). */
function expectVisibleFocus(stops: readonly FocusStop[], label: string): void {
  expect(stops.length, `${label} : aucun arrêt de tabulation`).toBeGreaterThan(0);
  for (const stop of stops) {
    expect(stop.inside, `${label} : ${stop.tag}.${stop.cls} hors de l'écran`).toBe(true);
    expect(stop.outlineStyle, `${label} : ${stop.tag}.${stop.cls} sans focus visible`).toBe("solid");
    expect(stop.outlineWidth, `${label} : ${stop.tag}.${stop.cls} contour trop fin`).toBeGreaterThanOrEqual(2);
    expect(stop.outlineOffset, `${label} : ${stop.tag}.${stop.cls} sans décalage`).toBeGreaterThanOrEqual(1);
  }
}

test.use({ viewport: { width: 1280, height: 720 } });

test.describe("Écrans système : audit axe-core (WEB-06)", () => {
  test("écran titre et sous-menu Extra", async ({ page }) => {
    await boot(page);
    await audit(page, ".mh-ui-title-screen");
    await page.locator('[data-entry="extra"]').click();
    await expect(page.locator(".mh-ui-title-extra-menu")).toBeVisible();
    await audit(page, ".mh-ui-title-screen");
  });

  test("configuration", async ({ page }) => {
    await boot(page);
    await page.locator('[data-entry="config"]').first().click();
    await expect(page.locator(".mh-cfg")).toBeVisible();
    await audit(page, ".mh-cfg");
  });

  test("menu système", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openPause(page);
    await audit(page, ".mh-sysmenu");
  });

  test("sauvegarde et chargement", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openPause(page);
    await openSystemEntry(page, "save");
    await expect(overlay(page)).toHaveAttribute("data-screen", "save");
    await audit(page, "#ui-overlay");
    await page.keyboard.press("Escape");
    await openSystemEntry(page, "load");
    await expect(overlay(page)).toHaveAttribute("data-screen", "load");
    await audit(page, "#ui-overlay");
  });

  test("historique", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await readPages(page);
    await openPause(page);
    await openSystemEntry(page, "backlog");
    await expect(overlay(page)).toHaveAttribute("data-screen", "backlog");
    await audit(page, ".mh-bl");
  });

  test("confirmation", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openPause(page);
    await openSystemEntry(page, "title");
    await expect(page.locator(".mh-ui-confirm")).toBeVisible();
    await audit(page, ".mh-ui-confirm");
  });
});

test.describe("Écrans système : clavier, focus visible et Échap (WEB-06)", () => {
  test("titre et Extra : chaque entrée a un focus visible ; Échap referme Extra", async ({ page }) => {
    await boot(page);
    expectVisibleFocus(await tabStops(page, ".mh-ui-title-menu"), "titre");
    await page.locator('[data-entry="extra"]').click();
    await expect(page.locator(".mh-ui-title-extra-menu")).toBeVisible();
    expectVisibleFocus(await tabStops(page, ".mh-ui-title-extra-menu"), "Extra");
    await page.keyboard.press("Escape");
    await expect(page.locator(".mh-ui-title-menu")).toBeVisible();
    await expect(page.locator(".mh-ui-title-extra-menu")).not.toBeVisible();
  });

  test("configuration : focus visible, focus piégé, Échap ferme", async ({ page }) => {
    await boot(page);
    await page.locator('[data-entry="config"]').first().click();
    const cfg = page.locator(".mh-cfg");
    // Attendre l'écran ET son état stabilisé avant de parcourir au clavier : en Firefox, les zones
    // défilantes de la config deviennent focalisables (focus visible vérifié) et le focus initial est
    // posé par programme.
    await expect(overlay(page)).toHaveAttribute("data-screen", "settings");
    await expect(cfg).toBeVisible();
    expectVisibleFocus(await tabStops(page, ".mh-cfg", 30), "config");
    await expect(overlay(page)).toHaveAttribute("data-screen", "settings");
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "title", { timeout: 15000 });
  });

  test("menu système : focus visible, focus piégé, Échap ferme", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openPause(page);
    expectVisibleFocus(await tabStops(page, ".mh-sysmenu", 24), "menu système");
    await page.keyboard.press("Escape");
    await expect(page.locator(".mh-sysmenu")).toHaveCount(0);
    await expect(overlay(page)).toHaveAttribute("data-screen", "game");
  });

  test("sauvegarde/chargement et historique : focus visible, focus piégé, Échap ferme", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openPause(page);

    await openSystemEntry(page, "save");
    await expect(overlay(page)).toHaveAttribute("data-screen", "save");
    expectVisibleFocus(await tabStops(page, ".mh-sl", 40), "sauvegarde");
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");

    await openSystemEntry(page, "load");
    await expect(overlay(page)).toHaveAttribute("data-screen", "load");
    expectVisibleFocus(await tabStops(page, ".mh-sl", 40), "chargement");
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");

    await page.keyboard.press("Escape"); // retour au jeu pour lire des pages
    await readPages(page);
    await openPause(page);
    await openSystemEntry(page, "backlog");
    await expect(overlay(page)).toHaveAttribute("data-screen", "backlog");
    expectVisibleFocus(await tabStops(page, ".mh-bl", 16), "historique");
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");
  });

  test("confirmation : focus visible et piégé, Échap répond Non et laisse le menu ouvert", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openPause(page);
    await openSystemEntry(page, "title");
    const dialog = page.locator(".mh-ui-confirm");
    await expect(dialog).toBeVisible();
    expectVisibleFocus(await tabStops(page, ".mh-ui-confirm", 6), "confirmation");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".mh-sysmenu")).toBeVisible();
  });
});

test.describe("Écrans système : sémantique et annonces (WEB-06)", () => {
  test("dialog/aria-modal, tablist, list, status et aria-live", async ({ page }) => {
    await boot(page);

    // Région vivante des toasts : présente avant les messages (les ajouts sont annoncés).
    const toastHost = page.locator("#ui-toast");
    await expect(toastHost).toHaveAttribute("aria-live", "polite");
    await expect(toastHost).toHaveAttribute("aria-relevant", "additions");

    // Titre : menus nommés.
    await expect(page.locator(".mh-ui-title-menu")).toHaveAttribute("aria-label", /.+/);

    // Configuration : dialogue modal + onglets ARIA.
    await page.locator('[data-entry="config"]').first().click();
    const cfg = page.locator(".mh-cfg");
    await expect(cfg).toHaveRole("dialog");
    await expect(cfg).toHaveAttribute("aria-modal", "true");
    await expect(cfg.locator(".mh-cfg-tabs")).toHaveAttribute("role", "tablist");
    await expect(cfg.locator('[role="tab"]').first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");

    await startGame(page);
    await openPause(page);
    // Menu système : dialogue modal nommé par son en-tête.
    const menu = page.locator(".mh-sysmenu");
    await expect(menu).toHaveRole("dialog");
    await expect(menu).toHaveAttribute("aria-modal", "true");
    await expect(menu).toHaveAttribute("aria-labelledby", /.+/);

    // Confirmation : dialogue modal nommé par le message.
    await openSystemEntry(page, "title");
    const confirm = page.locator(".mh-ui-confirm");
    await expect(confirm).toBeVisible();
    await expect(page.locator(".mh-ui-confirm-box")).toHaveRole("dialog");
    await expect(page.locator(".mh-ui-confirm-box")).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".mh-ui-confirm-box")).toHaveAttribute("aria-labelledby", /.+/);
    await page.keyboard.press("Escape");

    // Sauvegarde : dialogue modal nommé, grille groupée, statut annoncé.
    await openSystemEntry(page, "save");
    const save = page.locator(".mh-sl");
    await expect(save).toHaveRole("dialog");
    await expect(save).toHaveAttribute("aria-modal", "true");
    await expect(save).toHaveAttribute("aria-label", /.+/);
    await expect(save.locator(".mh-sl-grid")).toHaveAttribute("role", "group");
    await expect(save.locator(".mh-sl-sr")).toHaveAttribute("role", "status");
    await page.keyboard.press("Escape");

    // Historique : dialogue modal, liste nommée et région défilante étiquetée par le titre.
    await page.keyboard.press("Escape");
    await readPages(page);
    await openPause(page);
    await openSystemEntry(page, "backlog");
    const backlog = page.locator(".mh-bl");
    await expect(backlog).toHaveRole("dialog");
    await expect(backlog).toHaveAttribute("aria-modal", "true");
    await expect(backlog.locator(".mh-bl-list")).toHaveAttribute("role", "list");
    await expect(backlog.locator(".mh-bl-list")).toHaveAttribute("aria-label", /.+/);
    await expect(backlog.locator(".mh-bl-scroll")).toHaveAttribute("aria-labelledby", /.+/);
  });
});

test.describe("Écrans système : prefers-reduced-motion (WEB-06)", () => {
  test("aucune animation ni transition sous mouvement réduit", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page);

    // Le fondu croisé du titre est déjà neutralisé (tokens à 0 ms).
    const zeroDurations = async (selector: string): Promise<boolean> => {
      const value = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).transitionDuration);
      return value.split(",").every((part) => Number.parseFloat(part.trim()) === 0);
    };
    expect(await zeroDurations(".mh-ui-title-menu"), "fondu du titre encore actif").toBe(true);

    await startGame(page);
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });

    // Plus aucune animation CSS dans la page (indicateur de clic, brume, attente, glyphes animés…).
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => getComputedStyle(el).animationName !== "none")
        .map((el) => `${el.tagName}.${String(el.className).split(" ")[0]} (${getComputedStyle(el).animationName})`)
        .slice(0, 10),
    );
    expect(animated, `Éléments encore animés : ${animated.join(", ")}`).toEqual([]);

    // Les fondus de la boîte de texte, du texte lu et de l'attente sont neutralisés (le texte « lu »
    // n'existe que lorsque le réglage de texte déjà lu est actif : on vérifie s'il est présent).
    const transitions = await page.evaluate(() =>
      [".mh-stage-textbox", ".mh-stage-text-read", ".mh-stage-wait"].map((selector) => {
        const el = document.querySelector<HTMLElement>(selector);
        return {
          selector,
          present: el !== null,
          zero: !el || getComputedStyle(el).transitionDuration.split(",").every((part) => Number.parseFloat(part.trim()) === 0),
        };
      }),
    );
    expect(transitions.find((t) => t.selector === ".mh-stage-textbox")!.present).toBe(true);
    for (const t of transitions) {
      if (t.present) expect(t.zero, `${t.selector} : transition encore active`).toBe(true);
    }
  });
});
