import { test, expect, type Page } from "@playwright/test";

/**
 * FLOW-06 (#202) : pan, zoom, centrage, clic sur un nœud et « Relire depuis ici », à 1280×720.
 * Le graphe est un graphe factice original (aucun texte du jeu), servi à la place de `story-graph.json` ;
 * le script courant `1-0` (seul script des placeholders) est placé au niveau 30, donc bas dans la carte.
 */

const ids = ["pre0", ...Array.from({ length: 29 }, (_, i) => `pre${i + 1}`), "1-0", "post1", "post2", "post3", "post4", "post5"];
const nodes = ids.map((id) => ({ id, file: id === "1-0" ? "1-0.ks" : `${id}.ks`, kind: "normal", chapter: "c1", arc: "ARC-TEST" }));
nodes.push({ id: "fork", file: "fork.ks", kind: "choice", chapter: "c1", arc: "ARC-TEST" }, { id: "optA", file: "optA.ks", kind: "normal", chapter: "c1", arc: "ARC-TEST" }, { id: "optB", file: "optB.ks", kind: "normal", chapter: "c1", arc: "ARC-TEST" });
const edges: { from: string; to: string; kind: string; choice?: string }[] = [];
for (let i = 0; i < ids.length - 1; i++) edges.push({ from: ids[i]!, to: ids[i + 1]!, kind: "normal" });
edges.push({ from: "pre3", to: "fork", kind: "normal" }, { from: "fork", to: "optA", kind: "choice", choice: "OPTION-TEST-A" }, { from: "fork", to: "optB", kind: "choice", choice: "OPTION-TEST-B" });
edges.push({ from: "optA", to: "pre5", kind: "normal" }, { from: "optB", to: "pre5", kind: "normal" });
const graph = { version: 1, first: "pre0", nodes, edges };

const visited = [...ids.slice(0, 31), "fork", "optA"];
const progress = { visited, finished: visited.slice(0, 30), choices: [{ from: "fork", to: "optA" }], endings: [] };

async function setup(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/story-graph.json", (route) => route.fulfill({ json: graph }));
  await page.addInitScript((p) => {
    if (!localStorage.getItem("mahoyo.story-progress")) localStorage.setItem("mahoyo.story-progress", JSON.stringify(p));
  }, progress);
  await page.goto("/");
  await page.locator(".mh-ui-new-game").click();
  await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
  await page.keyboard.press("Escape");
  await page.locator('[data-entry="flowchart"]').click();
  await page.locator(".mh-flow-node").first().waitFor();
}

const scroller = (page: Page) => page.locator(".mh-flow-scroll");
const view = (page: Page) =>
  page.evaluate(() => {
    const s = document.querySelector<HTMLElement>(".mh-flow-scroll")!;
    return { zoom: s.dataset.zoom, left: s.scrollLeft, top: s.scrollTop, w: s.clientWidth, h: s.clientHeight };
  });

test.describe("Flowchart : interactions (FLOW-06)", () => {
  test("zoom (boutons, Ctrl + molette, clavier), pan (glisser, molette, flèches, Début)", async ({ page }) => {
    await setup(page);
    await expect(scroller(page)).toBeFocused();
    expect((await view(page)).zoom).toBe("100");

    await page.locator(".mh-flow-zoom-in").click();
    expect((await view(page)).zoom).toBe("125");
    await expect(page.locator(".mh-flow-zoom-value")).toHaveText("125 %");

    const box = (await scroller(page).boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + 200);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await view(page)).zoom).toBe("156");

    await scroller(page).focus();
    await page.keyboard.press("Home");
    await expect.poll(async () => (await view(page)).top).toBe(0);
    const before = await view(page);
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.wheel(0, 200);
    await expect.poll(async () => (await view(page)).top).toBeGreaterThan(before.top + 100);

    const afterWheel = await view(page);
    await page.mouse.move(box.x + 400, box.y + 400);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 300, { steps: 5 });
    await page.mouse.up();
    expect((await view(page)).top).toBeCloseTo(afterWheel.top + 100, 0);

    await scroller(page).focus();
    const beforeKey = (await view(page)).top;
    await page.keyboard.press("ArrowDown");
    expect((await view(page)).top).toBe(beforeKey + 96);
    await page.keyboard.press("0");
    expect((await view(page)).zoom).toBe("100");
    await page.keyboard.press("-");
    expect((await view(page)).zoom).toBe("80");
  });

  test("les libellés de choix sont lisibles : agrandis avec le zoom", async ({ page }) => {
    await setup(page);
    const label = page.locator(".mh-flow-choice").first();
    await label.scrollIntoViewIfNeeded();
    const h100 = (await label.boundingBox())!.height;
    for (let i = 0; i < 4; i++) await page.locator(".mh-flow-zoom-in").click();
    await label.scrollIntoViewIfNeeded();
    const h244 = (await label.boundingBox())!.height;
    expect(h244 / h100).toBeGreaterThan(2.3);
    const px = await label.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) * (el.getBoundingClientRect().width / (el as SVGGraphicsElement).getBBox().width));
    expect(px).toBeGreaterThanOrEqual(24); // 12 px à l'échelle 1 : >= 24 px à l'écran à 244 %
  });

  test("« Centrer » ramène le nœud courant au centre de la carte, avec ou sans mouvement réduit", async ({ page }) => {
    await setup(page);
    const centerOffset = () =>
      page.evaluate(() => {
        const s = document.querySelector(".mh-flow-scroll")!.getBoundingClientRect();
        const n = document.querySelector('.mh-flow-stage .mh-flow-node[data-state="current"]')!.getBoundingClientRect();
        return { dx: n.x + n.width / 2 - (s.x + s.width / 2), dy: n.y + n.height / 2 - (s.y + s.height / 2) };
      });
    // À l'ouverture, la position courante est déjà centrée.
    const open = await centerOffset();
    expect(Math.abs(open.dy)).toBeLessThan(5);
    expect(Math.abs(open.dx)).toBeLessThan(5);

    await scroller(page).focus();
    await page.keyboard.press("Home");
    await expect.poll(async () => (await view(page)).top).toBe(0);
    await page.locator(".mh-flow-center").click();
    await expect.poll(async () => Math.abs((await centerOffset()).dy)).toBeLessThan(5);
    expect(Math.abs((await centerOffset()).dx)).toBeLessThan(5);

    // Mouvement réduit : le défilement est immédiat.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.press("Home");
    await page.locator(".mh-flow-center").click();
    expect(Math.abs((await centerOffset()).dy)).toBeLessThan(5);
  });

  test("clic : volet pour un nœud visité, rien pour une silhouette ; Échap ferme le volet puis l'écran", async ({ page }) => {
    await setup(page);
    const silhouette = page.locator('.mh-flow-stage .mh-flow-node[data-state="hidden"]').first();
    await silhouette.scrollIntoViewIfNeeded();
    await silhouette.click();
    await expect(page.locator(".mh-flow-detail")).toHaveCount(0);
    expect(await silhouette.evaluate((el) => el.hasAttribute("data-id"))).toBe(false);

    const visitedNode = page.locator('.mh-flow-node[data-id="pre2"]');
    await visitedNode.scrollIntoViewIfNeeded();
    await visitedNode.click();
    const detail = page.locator(".mh-flow-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("pre2");
    await expect(detail).toContainText("ARC-TEST");
    // Dans la carte, sans masquer la barre de « Retour ».
    const d = (await detail.boundingBox())!;
    const m = (await scroller(page).boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(m.x);
    expect(d.x + d.width).toBeLessThanOrEqual(m.x + m.width);

    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(page.locator(".mh-flow-screen")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".mh-flow-screen")).toHaveCount(0);
  });

  test("« Relire depuis ici » : Non par défaut ne lance rien, Oui relance le script", async ({ page }) => {
    await setup(page);
    const current = page.locator('.mh-flow-node[data-id="1-0"]');
    await current.scrollIntoViewIfNeeded();
    await current.click();
    await page.locator(".mh-flow-replay").click();
    await expect(page.locator(".mh-ui-confirm")).toBeVisible();
    await expect(page.locator(".mh-ui-confirm-no")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".mh-ui-confirm")).toHaveCount(0);
    await expect(page.locator(".mh-flow-screen")).toBeVisible();

    await page.locator(".mh-flow-replay").click();
    await page.locator(".mh-ui-confirm-yes").click();
    await expect(page.locator(".mh-flow-screen")).toHaveCount(0);
    await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
  });

  test("le zoom est conservé quand on rouvre l'écran", async ({ page }) => {
    await setup(page);
    await page.locator(".mh-flow-zoom-in").click();
    await page.locator(".mh-flow-zoom-in").click();
    expect((await view(page)).zoom).toBe("156");
    await page.locator(".mh-flow-back").click();
    await page.locator('[data-entry="flowchart"]').click();
    await page.locator(".mh-flow-node").first().waitFor();
    expect((await view(page)).zoom).toBe("156");
  });
});
