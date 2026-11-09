import { test, expect, type Page } from "@playwright/test";

/**
 * FLOW-08 (#207) : intégration du flowchart (docs/ANALYSE_HUD_ORIGINAL.md §7.3).
 *
 * Vérifie de bout en bout que la vue FLOW-05/06/07 (celle de #197/#202/#206, et non l'ancien écran en
 * liste) est branchée sur ses trois points d'entrée — écran titre, menu système en jeu, route
 * `#/flowchart` — et que les décisions du propriétaire n°2 et n°5 sont tenues : jamais dans Extra ni
 * dans l'historique, position courante mise en évidence, anti-spoiler configurable (« tout révéler »).
 *
 * Fixtures entièrement originales (aucun texte du jeu) : graphe, table d'enchaînement, index de langue
 * et script KAG minimal routés. Deux chapitres : `CHAPITRE-UN` (visité) et `TITLE-SECRET` (jamais
 * visité, entièrement masqué par défaut). Le script courant est `1-0`.
 */

const NODES = [
  { id: "1-0", file: "1-0.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "1-1", file: "1-1.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "fork", file: "fork.ks", kind: "choice", chapter: "c-one", arc: "ARC-ONE" },
  { id: "optA", file: "optA.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "optB", file: "optB.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "secret", file: "secret.ks", kind: "normal", chapter: "c-secret", arc: "ARC-SECRET" },
] as const;

const EDGES = [
  { from: "1-0", to: "1-1", kind: "normal" },
  { from: "1-1", to: "fork", kind: "normal" },
  { from: "fork", to: "optA", kind: "choice", choice: "CHOIX-A" },
  { from: "fork", to: "optB", kind: "choice", choice: "CHOIX-B" },
  { from: "optA", to: "secret", kind: "normal" },
  { from: "optB", to: "secret", kind: "normal" },
];

const graph = { version: 1, first: "1-0", nodes: NODES, edges: EDGES };

const chain = {
  version: 1,
  first: "1-0.ks",
  next: {},
  chapters: [
    { id: "c-one", label: "CHAPITRE-UN", file: "1-0.ks", arc: "ARC-ONE" },
    { id: "c-secret", label: "TITLE-SECRET", file: "secret.ks", arc: "ARC-SECRET" },
  ],
};

/** Index de langue minimal : force le français sans traduire le scénario. */
const langFr = { version: 1, language: "fr", label: "Français", credits: "", scripts: [], strict: [], skipped: [] };

/** Script KAG original minimal, pour que « Nouvelle partie » affiche du texte sans asset du jeu. */
const script = "*start|\nTexte de test e2e pour l'intégration.[l][r]\n";

/** Progression : `1-0` est la position courante ; `optB` et `secret` restent non visités. */
const progress = {
  visited: ["1-0", "1-1", "fork", "optA"],
  finished: ["1-0", "1-1"],
  choices: [{ from: "fork", to: "optA" }],
  endings: [],
};

const overlay = (page: Page) => page.locator("#ui-overlay");
const hash = (page: Page) => page.evaluate(() => location.hash);

/** Ouvre le jeu sur l'écran titre avec les fixtures (aucun asset du jeu requis). */
async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/story-graph.json", (route) => route.fulfill({ json: graph }));
  await page.route("**/story-chain.json", (route) => route.fulfill({ json: chain }));
  await page.route("**/lang/fr/index.json", (route) => route.fulfill({ json: langFr }));
  await page.route("**/scenario/1-0.ks", (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: script }),
  );
  await page.addInitScript((p) => {
    localStorage.setItem("mahoyo.story-progress", JSON.stringify(p));
  }, progress);
  await page.goto("/");
  await expect(page.locator(".mh-ui-title-screen")).toBeVisible({ timeout: 15000 });
}

async function startGame(page: Page): Promise<void> {
  await page.locator(".mh-ui-new-game").click();
  await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
  await expect(overlay(page)).toHaveAttribute("data-screen", "game");
}

async function openSystemMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toHaveAttribute("data-screen", "pause");
  await expect(page.locator(".mh-sysmenu")).toBeVisible();
}

/** Vrai si le nœud courant est entièrement dans la zone visible de la carte à l'ouverture. */
async function currentOffset(page: Page): Promise<{ visible: boolean }> {
  return page.evaluate(() => {
    const s = document.querySelector(".mh-flow-scroll")!.getBoundingClientRect();
    const n = document.querySelector('.mh-flow-stage .mh-flow-node[data-state="current"]')!.getBoundingClientRect();
    return { visible: n.left >= s.left && n.top >= s.top && n.right <= s.right && n.bottom <= s.bottom };
  });
}

test.describe("Flowchart : intégration (FLOW-08)", () => {
  test("accessible depuis l'écran titre ; route #/flowchart ; absent de Extra", async ({ page }) => {
    await boot(page);

    // Entrée du menu principal (HUD-07) : ouvre la vue FLOW-05/06/07.
    const entry = page.locator('[data-entry="flowchart"]');
    await expect(entry).toBeVisible();
    await expect(entry).toHaveText("Flowchart");
    await entry.click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "flowchart");
    await expect(page.locator(".mh-flow-screen")).toBeVisible();
    await expect(page.locator(".mh-flow-scroll")).toBeVisible();
    expect(await hash(page)).toBe("#/flowchart");

    // Retour : l'écran se ferme, on revient au titre (Échap standard).
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "title");
    await expect(page.locator(".mh-ui-title-screen")).toBeVisible();

    // Décision 2 : pas d'entrée Flowchart dans Extra (sous-menu HUD-08).
    await page.locator('[data-entry="extra"]').click();
    const submenu = page.locator(".mh-ui-title-extra-menu");
    await expect(submenu).toBeVisible();
    expect(await submenu.locator(".mh-ui-title-extra-entry").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.entry))).toEqual([
      "archive",
      "cgmode",
      "soundmode",
      "back",
    ]);
    expect(await submenu.textContent()).not.toMatch(/flowchart/i);
  });

  test("route #/flowchart directe : ouvre la vue sans rechargement", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (location.hash = "#/flowchart"));
    await expect(overlay(page)).toHaveAttribute("data-screen", "flowchart");
    await expect(page.locator(".mh-flow-screen")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "title");
    expect(await hash(page)).toBe("#/title");
  });

  test("en jeu : menu système (entre backlog et graphic) ; position courante mise en évidence", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openSystemMenu(page);

    // Entrée présente à sa place (HUD-06) et branchée sur la nouvelle vue.
    const ids = await page.locator(".mh-sysmenu-entry").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.entry));
    expect(ids).toEqual(["save", "load", "config", "auto", "skip", "backlog", "flowchart", "graphic", "title"]);
    await page.locator('[data-entry="flowchart"]').click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "flowchart");
    await expect(page.locator(".mh-flow-screen")).toBeVisible();
    expect(await hash(page)).toBe("#/flowchart");

    // La position courante (script `1-0`) est le seul nœud courant, sélectionnable et visible dans la carte
    // (le centrage exact d'un graphe plus grand que la carte est couvert par `flowchart.spec.ts`).
    const current = page.locator('.mh-flow-stage .mh-flow-node[data-state="current"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("data-id", "1-0");
    await expect(current).toHaveAttribute("aria-current", "location");
    expect(await current.getAttribute("data-interactive")).toBe("true");
    const placement = await currentOffset(page);
    expect(placement.visible, "le nœud courant doit être dans la zone visible de la carte").toBe(true);
    // Le compteur reflète la progression réelle de la partie (4 scènes lues).
    await expect(page.locator('[data-counter="scenes"]')).toHaveText("Scènes lues : 4/6");

    // Échap referme l'écran et rend le menu système (écran empilé, pas la partie).
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");
  });

  test("en jeu : l'historique n'est pas un onglet Flowchart", async ({ page }) => {
    await boot(page);
    await startGame(page);
    // L'historique est vide tant que le premier point d'arrêt n'est pas atteint (HUD-12).
    await expect(page.locator("#textbox-indicator")).toBeVisible({ timeout: 20000 });
    await openSystemMenu(page);
    await page.locator('[data-entry="backlog"]').click();
    await expect(overlay(page)).toHaveAttribute("data-screen", "backlog");
    await expect(page.locator(".mh-bl")).toBeVisible();
    expect(await page.locator("#ui-overlay [data-entry='flowchart']").count()).toBe(0);
    expect(await page.locator(".mh-bl").textContent()).not.toMatch(/flowchart/i);
  });

  test("« tout révéler » (décision 5) : réglage de la config pris en compte par la vue", async ({ page }) => {
    await boot(page);
    await startGame(page);
    await openSystemMenu(page);

    // Anti-spoiler par défaut : silhouettes pour les scènes non visitées, aucun nœud « révélé non visité ».
    await page.locator('[data-entry="flowchart"]').click();
    await expect(page.locator(".mh-flow-screen")).toBeVisible();
    await expect(page.locator('.mh-flow-stage .mh-flow-node[data-state="hidden"]').first()).toBeVisible();
    expect(await page.locator('.mh-flow-stage .mh-flow-node[data-state="unvisited"]').count()).toBe(0);
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");

    // Bascule dans la config (HUD-09) : réglage persisté puis relu à l'ouverture suivante.
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
    // Tout révélé : plus aucune silhouette, les scènes non visitées passent en « non visitée » (○),
    // et le chapitre secret n'est plus verrouillé.
    expect(await page.locator('.mh-flow-stage .mh-flow-node[data-state="hidden"]').count()).toBe(0);
    expect(await page.locator('.mh-flow-stage .mh-flow-node[data-state="unvisited"]').count()).toBeGreaterThan(0);
    await expect(page.locator('.mh-flow-group[data-locked="true"]')).toHaveCount(0);
    // Le réglage est partagé avec la config (lecture du même `flowchartRevealAll`).
    await page.keyboard.press("Escape");
    await page.locator('[data-entry="config"]').click();
    await expect(page.locator('input[name="flowchartRevealAll"]')).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveAttribute("data-screen", "pause");
  });
});
