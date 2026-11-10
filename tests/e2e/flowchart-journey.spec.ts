import { test, expect, type Page } from "@playwright/test";

/**
 * FLOW-09 (#212) : parcours du flowchart vérifié de bout en bout avec les placeholders e2e
 * (aucun asset ni texte du jeu), sur Chromium et Firefox.
 *
 * Contrairement aux specs FLOW-06/07/08 qui sèment une progression factice, ce spec **joue** le
 * prologue des placeholders jusqu'au choix, valide une voie, puis ouvre le flowchart depuis le menu
 * système. Il couvre les critères de l'issue :
 * 1. jouer jusqu'à un choix et le valider ;
 * 2. ouvrir le flowchart depuis le menu système : nœud visité et **position courante** mis en
 *    évidence, compteurs, libellé du chemin emprunté ;
 * 3. nœuds non visités en **silhouettes sans titre** (anti-spoiler) ;
 * 4. « tout révéler » activé dans la configuration, puis constaté dans la vue ;
 * 5. « Relire depuis ici » sur un nœud visité, avec confirmation (« Non » par défaut) ;
 * 6. accès au flowchart depuis l'écran titre.
 *
 * Le graphe est une fixture originale (aucun texte du jeu) cohérente avec `story-chain.json` des
 * placeholders : `1-0` → choix « Accompagner Aoko » / « Suivre Alice » → `1-1a` ou `1-1b` → `2-0`.
 */

const nodes = [
  { id: "1-0", file: "1-0.ks", kind: "normal", chapter: "1-0", arc: "Prologue" },
  { id: "1-1a", file: "1-1a.ks", kind: "normal", chapter: "1-1a", arc: "Chapitre 1" },
  { id: "1-1b", file: "1-1b.ks", kind: "normal", chapter: "1-1b", arc: "Chapitre 1" },
  { id: "2-0", file: "2-0.ks", kind: "normal", chapter: "2-0", arc: "Chapitre 2" },
];
const edges = [
  { from: "1-0", to: "1-1a", kind: "choice", choice: "Accompagner Aoko" },
  { from: "1-0", to: "1-1b", kind: "choice", choice: "Suivre Alice" },
  { from: "1-1a", to: "2-0", kind: "normal" },
  { from: "1-1b", to: "2-0", kind: "normal" },
];
const graph = { version: 1, first: "1-0", nodes, edges };

const text = (page: Page) => page.locator("#text");
const overlay = (page: Page) => page.locator("#ui-overlay");
const hash = (page: Page) => page.evaluate(() => location.hash);
const card = (page: Page) => page.locator(".mh-flow-stage");
const node = (page: Page, id: string) => card(page).locator(`.mh-flow-node[data-id="${id}"]`);

const waitForStop = (page: Page) =>
  expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });

/** Appuie sur Entrée jusqu'à ce que `check()` soit vrai, sans attente arbitraire. */
async function advanceUntil(page: Page, check: () => Promise<boolean>, label: string, max = 240): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await check()) return;
    await page.keyboard.press("Enter");
  }
  if (await check()) return;
  throw new Error(`Parcours flowchart : condition jamais atteinte (${label}) après ${max} avancées`);
}

/** Ouvre le jeu depuis l'écran titre, avec animations figées et graphe fixture routé. */
async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/story-graph.json", (route) => route.fulfill({ json: graph }));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-cleared")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-cleared", "1");
    }
    // Fige les animations WAAPI (les transitions HUD sont déjà neutralisées par reduced-motion).
    // @ts-ignore: stub de test — signature volontairement réduite de WAAPI
    Element.prototype.animate = function () {
      return { play: () => this, pause: () => this, cancel: () => this, finish: () => this, onfinish: null };
    };
  });
  await page.goto("/");
  await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });
}

/** Start → lit le prologue jusqu'au menu de choix, puis valide la voie A. */
async function playToChoice(page: Page): Promise<void> {
  await page.locator(".mh-ui-new-game").click();
  await expect(text(page)).toContainText(/\S{5}/, { timeout: 15000 });
  await expect(overlay(page)).toHaveAttribute("data-screen", "game");

  await advanceUntil(page, () => page.locator(".mh-ui-choice").first().isVisible(), "menu de choix");
  const choices = page.locator(".mh-ui-choice");
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toHaveText("Accompagner Aoko");
  await expect(choices.nth(1)).toHaveText("Suivre Alice");
  await choices.nth(0).click();
  await expect(text(page)).toContainText("Chapitre 1 — Voie A", { timeout: 15000 });
  await waitForStop(page);
}

/** Ouvre le flowchart depuis le menu système (Échap → entrée Flowchart). */
async function openFlowchartFromMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toHaveAttribute("data-screen", "pause");
  await page.locator('[data-entry="flowchart"]').click();
  await expect(overlay(page)).toHaveAttribute("data-screen", "flowchart");
  await expect(page.locator(".mh-flow-screen")).toBeVisible();
}

/** Nœud entièrement dans la zone visible de la carte à l'ouverture. */
async function currentVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const scroll = document.querySelector(".mh-flow-scroll")!.getBoundingClientRect();
    const current = document.querySelector('.mh-flow-stage .mh-flow-node[data-state="current"]')!.getBoundingClientRect();
    return current.left >= scroll.left && current.top >= scroll.top && current.right <= scroll.right && current.bottom <= scroll.bottom;
  });
}

test.describe("Flowchart : parcours complet (FLOW-09)", () => {
  test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });

  test("jouer → choix validé → flowchart (position courante, silhouettes, tout révéler, relire, titre)", async ({
    page,
  }) => {
    await boot(page);
    await playToChoice(page);

    // 1. Ouverture depuis le menu système : position courante et progression réelle de la partie.
    await openFlowchartFromMenu(page);
    expect(await hash(page)).toBe("#/flowchart");
    const current = card(page).locator('.mh-flow-node[data-state="current"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("data-id", "1-1a");
    await expect(current).toHaveAttribute("aria-current", "location");
    expect(await currentVisible(page), "le nœud courant doit être visible dans la carte").toBe(true);
    // Le prologue terminé est un nœud « terminé », la progression vient du jeu réel (pas d'état semé).
    await expect(node(page, "1-0")).toHaveAttribute("data-state", "finished");
    await expect(page.locator('[data-counter="scenes"]')).toHaveText("Scènes lues : 2/4");

    // Le chemin emprunté est libellé ; l'option non prise reste masquée (anti-spoiler).
    const takenLabels = await page.locator(".mh-flow-choice").allTextContents();
    expect(takenLabels.join(" ")).toContain("Accompagner Aoko");
    expect(takenLabels.join(" ")).not.toContain("Suivre Alice");

    // 2. Nœuds non visités : silhouettes sans identifiant, groupes verrouillés sans titre.
    await expect(card(page).locator('.mh-flow-node[data-state="hidden"]')).toHaveCount(2);
    await expect(card(page).locator(".mh-flow-node[data-state='unvisited']")).toHaveCount(0);
    // La mise en page regroupe les nœuds par arc : Prologue (1-0), Chapitre 1 (1-1a + 1-1b, dont un
    // seul est découvert) et Chapitre 2 (2-0, intégralement non visité) → un seul groupe verrouillé.
    await expect(page.locator('.mh-flow-group[data-locked="true"]')).toHaveCount(1);
    const stageText = (await card(page).innerText()).replace(/\s+/g, " ");
    for (const leak of ["Voie B", "Épilogue", "1-1b", "2-0", "Suivre Alice"]) {
      expect(stageText, `la carte ne doit pas révéler « ${leak} »`).not.toContain(leak);
    }
    // Les silhouettes sont inertes : ni identifiant, ni clic de relecture possible.
    const hiddenNodes = card(page).locator('.mh-flow-node[data-state="hidden"]');
    for (const hidden of await hiddenNodes.all()) {
      await expect(hidden).toHaveAttribute("aria-disabled", "true");
      expect(await hidden.getAttribute("data-id")).toBeNull();
      expect(await hidden.getAttribute("data-interactive")).toBeNull();
    }

    // 3. « Tout révéler » depuis la configuration (HUD-09), puis constat dans la vue.
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");
    await page.locator('[data-entry="config"]').click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "settings");
    const toggle = page.locator('input[name="flowchartRevealAll"]');
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");
    await page.locator('[data-entry="flowchart"]').click();
    await expect(page.locator(".mh-flow-screen")).toBeVisible();

    await expect(card(page).locator('.mh-flow-node[data-state="hidden"]')).toHaveCount(0);
    const unvisited = card(page).locator('.mh-flow-node[data-state="unvisited"]');
    await expect(unvisited).toHaveCount(2);
    const revealedIds = await unvisited.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id).sort());
    expect(revealedIds).toEqual(["1-1b", "2-0"]);
    await expect(page.locator('.mh-flow-group[data-locked="true"]')).toHaveCount(0);
    const revealedText = (await card(page).innerText()).replace(/\s+/g, " ");
    expect(revealedText).toContain("Chapitre 2 — Épilogue");
    // La position courante n'a pas bougé et reste mise en évidence.
    await expect(card(page).locator('.mh-flow-node[data-state="current"]')).toHaveAttribute("data-id", "1-1a");

    // 4. « Relire depuis ici » sur un nœud visité, avec confirmation (« Non » par défaut).
    await node(page, "1-0").click();
    const detail = page.locator(".mh-flow-detail");
    await expect(detail).toBeVisible();
    await page.locator(".mh-flow-replay").click();
    await expect(page.locator(".mh-ui-confirm")).toBeVisible();
    await expect(page.locator(".mh-ui-confirm-no")).toBeFocused();
    await page.keyboard.press("Enter"); // Non
    await expect(page.locator(".mh-ui-confirm")).toHaveCount(0);
    await expect(page.locator(".mh-flow-screen")).toBeVisible(); // rien n'a été lancé

    await page.locator(".mh-flow-replay").click();
    await page.locator(".mh-ui-confirm-yes").click();
    await expect(page.locator(".mh-flow-screen")).toHaveCount(0);
    await expect(overlay(page)).toHaveAttribute("data-screen", "game", { timeout: 15000 });
    await expect(text(page)).toContainText("Page de test e2e", { timeout: 15000 });
    // La relecture a bien relancé le prologue : c'est lui la position courante désormais.
    await openFlowchartFromMenu(page);
    await expect(card(page).locator('.mh-flow-node[data-state="current"]')).toHaveAttribute("data-id", "1-0");
    await expect(node(page, "1-1a")).toHaveAttribute("data-state", "visited");

    // 5. Accès depuis l'écran titre : la position courante n'y existe plus, la progression reste.
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");
    await page.locator('[data-entry="title"]').click();
    await page.locator(".mh-ui-confirm-yes").click();
    await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });

    const entry = page.locator('[data-entry="flowchart"]');
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "flowchart");
    await expect(page.locator(".mh-flow-screen")).toBeVisible();
    expect(await hash(page)).toBe("#/flowchart");
    await expect(card(page).locator('.mh-flow-node[data-state="current"]')).toHaveCount(0);
    await expect(node(page, "1-1a")).toHaveAttribute("data-state", "visited");
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "title");
    await expect(page.locator(".mh-ui-title-screen")).toBeVisible();
  });
});
