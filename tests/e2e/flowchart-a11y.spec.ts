import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * FLOW-07 (#206) : accessibilité du flowchart.
 *
 * Couvre le contrat DOM de l'issue : audit axe-core (WCAG 2.0/2.1/2.2 A+AA), parcours clavier par
 * arêtes (Tab, flèches, Home/End, Entrée, Échap), région `aria-live`, équivalent liste `.mh-flow-a11y`,
 * anti-spoiler (décision 5) et mode portrait.
 *
 * Le graphe et la table d'enchaînement sont des fixtures **originales** (aucun texte du jeu), servies à
 * la place de `story-graph.json` / `story-chain.json`. Le scénario est un script KAG minimal routé :
 * le test ne dépend donc pas des assets locaux du jeu. La locale `fr` est forcée (index de langue vide)
 * pour que les libellés annoncés soient déterministes.
 *
 * Graphe :
 * - chapitre « c-one » (CHAPITRE-UN, tout ou partie visité) : pre0 → pre1 → pre2 → 1-0 (courant) →
 *   pre3 → pre4 → fork (choix, 2 options) → optA/optB (optB non visité) → pre5 ;
 * - chapitre « c-secret » (TITLE-SECRET, entièrement non visité) : secret-choice (choix, 2 options
 *   masquées) → secret-a/secret-b → secret-2 → secret-3 → secret-4.
 *
 * Les index `data-n` / `data-a11y-node` sont ceux de `graph.nodes`, jamais des identifiants de script.
 */

type TestNode = {
  id: string;
  file: string;
  kind: "normal" | "choice" | "end";
  chapter?: string;
  arc?: string;
};

type TestEdge = { from: string; to: string; kind: "normal" | "choice"; choice?: string };

const NODES: TestNode[] = [
  { id: "pre0", file: "pre0.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "pre1", file: "pre1.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "pre2", file: "pre2.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "1-0", file: "1-0.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "pre3", file: "pre3.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "pre4", file: "pre4.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "fork", file: "fork.ks", kind: "choice", chapter: "c-one", arc: "ARC-ONE" },
  { id: "optA", file: "optA.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "optB", file: "optB.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "pre5", file: "pre5.ks", kind: "normal", chapter: "c-one", arc: "ARC-ONE" },
  { id: "secret-choice", file: "secret-choice.ks", kind: "choice", chapter: "c-secret", arc: "ARC-SECRET" },
  { id: "secret-a", file: "secret-a.ks", kind: "normal", chapter: "c-secret", arc: "ARC-SECRET" },
  { id: "secret-b", file: "secret-b.ks", kind: "normal", chapter: "c-secret", arc: "ARC-SECRET" },
  { id: "secret-2", file: "secret-2.ks", kind: "normal", chapter: "c-secret", arc: "ARC-SECRET" },
  { id: "secret-3", file: "secret-3.ks", kind: "normal", chapter: "c-secret", arc: "ARC-SECRET" },
  { id: "secret-4", file: "secret-4.ks", kind: "normal", chapter: "c-secret", arc: "ARC-SECRET" },
];

const EDGES: TestEdge[] = [
  { from: "pre0", to: "pre1", kind: "normal" },
  { from: "pre1", to: "pre2", kind: "normal" },
  { from: "pre2", to: "1-0", kind: "normal" },
  { from: "1-0", to: "pre3", kind: "normal" },
  { from: "pre3", to: "pre4", kind: "normal" },
  { from: "pre4", to: "fork", kind: "normal" },
  { from: "fork", to: "optA", kind: "choice", choice: "CHOIX-A" },
  { from: "fork", to: "optB", kind: "choice", choice: "CHOIX-B" },
  { from: "optA", to: "pre5", kind: "normal" },
  { from: "optB", to: "pre5", kind: "normal" },
  { from: "pre5", to: "secret-choice", kind: "normal" },
  { from: "secret-choice", to: "secret-a", kind: "choice", choice: "CHOIX-SECRET-A" },
  { from: "secret-choice", to: "secret-b", kind: "choice", choice: "CHOIX-SECRET-B" },
  { from: "secret-a", to: "secret-2", kind: "normal" },
  { from: "secret-b", to: "secret-2", kind: "normal" },
  { from: "secret-2", to: "secret-3", kind: "normal" },
  { from: "secret-3", to: "secret-4", kind: "normal" },
];

const graph = { version: 1, first: "pre0", nodes: NODES, edges: EDGES };

/** Table d'enchaînement : deux chapitres, le premier script du jeu est `1-0.ks` (partie neuve). */
const chain = {
  version: 1,
  first: "1-0.ks",
  next: {},
  chapters: [
    { id: "c-one", label: "CHAPITRE-UN", file: "1-0.ks", arc: "ARC-ONE" },
    { id: "c-secret", label: "TITLE-SECRET", file: "secret-choice.ks", arc: "ARC-SECRET" },
  ],
};

/** Index de langue minimal : force la locale `fr` sans fournir de traduction de scénario. */
const langFr = { version: 1, language: "fr", label: "Français", credits: "", scripts: [], strict: [], skipped: [] };

/** Script KAG minimal, original, pour que « Nouvelle partie » affiche du texte sans asset du jeu. */
const script = "*start|\nTexte de test e2e pour le flowchart.[l][r]\n";

const visited = ["pre0", "pre1", "pre2", "1-0", "pre3", "pre4", "fork", "optA", "pre5"];
const finished = ["pre0", "pre1", "pre2", "pre3", "pre4", "optA"];
const progress = {
  visited,
  finished,
  choices: [{ from: "fork", to: "optA" }],
  endings: [],
};

const HIDDEN_LABEL = "Scène non découverte";
const ID = new Map(NODES.map((n, i) => [i, n.id]));
const INDEX = new Map(NODES.map((n, i) => [n.id, i]));
const HIDDEN_CHOICE_INDEX = INDEX.get("secret-choice")!;
const HIDDEN_NODE_INDEX = INDEX.get("optB")!;

const nodeId = (index: number): string => ID.get(index) ?? `#${index}`;

function adjacent(a: string, b: string): boolean {
  return EDGES.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

type ActiveNode = { index: number; id: string | null; label: string | null; tabIndex: number | null; role: string | null };

/** Nœud de la carte qui a le focus (`document.activeElement`), ou index -1. */
async function activeNode(page: Page): Promise<ActiveNode> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !el.classList.contains("mh-flow-node")) {
      return { index: -1, id: null, label: null, tabIndex: null, role: null };
    }
    return {
      index: Number(el.dataset.n),
      id: el.dataset.id ?? null,
      label: el.getAttribute("aria-label"),
      tabIndex: el.tabIndex,
      role: el.getAttribute("role"),
    };
  });
}

type SetupOptions = {
  width?: number;
  height?: number;
  /** Sème `mahoyo.settings` avec « tout révéler » avant le chargement. */
  revealAll?: boolean;
};

/** Même parcours que `flowchart.spec.ts` : partie neuve, Échap, entrée « Flowchart ». */
async function setup(page: Page, options: SetupOptions = {}): Promise<void> {
  const { width = 1280, height = 720, revealAll = false } = options;
  await page.setViewportSize({ width, height });
  await page.route("**/story-graph.json", (route) => route.fulfill({ json: graph }));
  await page.route("**/story-chain.json", (route) => route.fulfill({ json: chain }));
  await page.route("**/lang/fr/index.json", (route) => route.fulfill({ json: langFr }));
  await page.route("**/scenario/1-0.ks", (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: script }),
  );
  await page.addInitScript(
    ({ p, reveal }) => {
      localStorage.setItem("mahoyo.story-progress", JSON.stringify(p));
      if (reveal) localStorage.setItem("mahoyo.settings", JSON.stringify({ flowchartRevealAll: true }));
    },
    { p: progress, reveal: revealAll },
  );
  await page.goto("/");
  await page.locator(".mh-ui-new-game").click();
  await expect(page.locator("#text")).toContainText(/\S{5}/, { timeout: 15000 });
  await page.keyboard.press("Escape");
  await page.locator('[data-entry="flowchart"]').click();
  // `.mh-flow-node` sert aussi aux échantillons de la légende (masqués en portrait) : viser la carte.
  await page.locator(".mh-flow-stage .mh-flow-node").first().waitFor();
}

type ViolationSummary = {
  id: string;
  impact?: string | null;
  help: string;
  nodes: readonly { target: readonly unknown[] }[];
};

function formatViolations(violations: readonly ViolationSummary[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} [${v.impact ?? "n/a"}] ${v.help}\n    ${v.nodes
          .flatMap((n) => n.target)
          .map(String)
          .join(", ")}`,
    )
    .join("\n");
}

/** Audit axe-core sur l'écran flowchart, tags WCAG 2.0/2.1/2.2 A et AA. */
async function axeAudit(page: Page): Promise<{ violations: ViolationSummary[] }> {
  return new AxeBuilder({ page })
    .include(".mh-flow-screen")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
}

async function expectNoViolations(page: Page): Promise<void> {
  const results = await axeAudit(page);
  // Trace complète utile au rapport (le détail lisible est dans les messages d'assertion).
  console.log(
    `[axe] ${results.violations.length} violation(s) : ${
      results.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nœud(s))`).join(", ") || "aucune"
    }`,
  );
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  // Pas d'exclusion de règle : une violation ici est un écart d'implémentation à corriger. Le nom
  // accessible du nœud courant contient le texte visible « Ici » (WCAG 2.1 SC 2.5.3).
  expect(serious, `Violations axe-core graves ou critiques :\n${formatViolations(serious)}`).toEqual([]);
  // Zéro violation est l'objectif du contrat : pas d'exclusion de règle ni de filtre d'impact.
  expect(
    results.violations,
    `Violations axe-core sur .mh-flow-screen :\n${formatViolations(results.violations)}`,
  ).toEqual([]);
}

test.describe("Flowchart : accessibilité (FLOW-07)", () => {
  test("audit axe-core WCAG 2.x A/AA : aucune violation", async ({ page }) => {
    await setup(page);
    await expectNoViolations(page);
  });

  test("parcours clavier : Tab, flèches par arête, Home/End, Entrée, Échap", async ({ page }) => {
    await setup(page);
    const scroller = page.locator(".mh-flow-scroll");
    const live = page.locator(".mh-flow-live");
    await expect(scroller).toBeFocused();
    await expect(live).toHaveAttribute("role", "status");
    await expect(live).toHaveAttribute("aria-live", "polite");
    await expect(live).toHaveAttribute("aria-atomic", "true");
    // La région reste dans l'arbre d'accessibilité (masquage visuel seulement, jamais `display: none`).
    expect(await live.evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
    expect(await live.evaluate((el) => getComputedStyle(el).visibility)).not.toBe("hidden");

    // Tab atteint le nœud actif (roving tabindex : un seul nœud à 0, les autres à -1).
    let active = await activeNode(page);
    for (let i = 0; i < 12 && active.index < 0; i++) {
      await page.keyboard.press("Tab");
      active = await activeNode(page);
    }
    expect(active.index, "Tab doit atteindre un nœud de la carte").toBeGreaterThanOrEqual(0);
    expect(active.tabIndex).toBe(0);
    expect(active.role).toBe("button");
    expect(nodeId(active.index)).toBe("1-0"); // position courante découverte
    expect(active.label).toContain("1-0");
    // Exactement un arrêt de tabulation sur la carte (roving tabindex).
    await expect(page.locator('.mh-flow-stage .mh-flow-node[tabindex="0"]')).toHaveCount(1);
    await expect(page.locator('.mh-flow-node[data-id="1-0"]')).toHaveAttribute("aria-current", "location");
    await expect(live).toHaveText(active.label!);

    // Flèche bas : le focus passe à un voisin par arête, annoncé dans `aria-live`.
    const startIndex = active.index;
    await page.keyboard.press("ArrowDown");
    const down = await activeNode(page);
    expect(down.index, "ArrowDown doit déplacer le focus").not.toBe(startIndex);
    expect(
      adjacent(nodeId(startIndex), nodeId(down.index)),
      `${nodeId(startIndex)} n'est pas voisin de ${nodeId(down.index)}`,
    ).toBe(true);
    expect(down.tabIndex).toBe(0);
    await expect(page.locator('.mh-flow-stage .mh-flow-node[tabindex="0"]')).toHaveCount(1);
    await expect(live).toHaveText(down.label!);

    // Flèche haut : autre voisin par arête, jamais le nœud déjà focalisé.
    const beforeUp = down.index;
    await page.keyboard.press("ArrowUp");
    const up = await activeNode(page);
    expect(up.index).not.toBe(beforeUp);
    expect(adjacent(nodeId(beforeUp), nodeId(up.index))).toBe(true);
    await expect(live).toHaveText(up.label!);

    // Home/End : premier/dernier nœud de l'ordre de la liste accessible (pas l'ordre de `graph.nodes`).
    const order = await page.$$eval(".mh-flow-a11y-node", (els) =>
      els.map((el) => Number((el as HTMLElement).dataset.a11yNode)),
    );
    expect(order.length).toBe(NODES.length);
    await page.keyboard.press("Home");
    const home = await activeNode(page);
    expect(home.index).toBe(order[0]);
    await expect(live).toHaveText(home.label!);
    await page.keyboard.press("End");
    const end = await activeNode(page);
    expect(end.index).toBe(order[order.length - 1]);
    expect(end.label).toBe(HIDDEN_LABEL); // dernier nœud : masqué, aucun identifiant annoncé
    await expect(live).toHaveText(HIDDEN_LABEL);

    // Entrée ouvre le volet de détails du nœud découvert focalisé.
    await page.keyboard.press("Home");
    const firstNode = page.locator(`.mh-flow-node[data-n="${order[0]}"]`);
    await expect(firstNode).toBeFocused();
    await page.keyboard.press("Enter");
    const detail = page.locator(".mh-flow-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("pre0");

    // Échap ferme le volet et rend le focus au nœud ; l'Échap suivant ferme l'écran.
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(firstNode).toBeFocused();
    await expect(page.locator(".mh-flow-screen")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".mh-flow-screen")).toHaveCount(0);
  });

  test("anti-spoiler : nœud masqué et chapitre non visité sans fuite", async ({ page }) => {
    await setup(page);
    const hiddenNode = page.locator(`.mh-flow-stage .mh-flow-node[data-n="${HIDDEN_CHOICE_INDEX}"]`);
    const hiddenButton = page.locator(`.mh-flow-a11y [data-a11y-node="${HIDDEN_CHOICE_INDEX}"]`);

    // Structure de l'équivalent liste : titre, nav étiquetée, une `<ul>` par chapitre, un bouton par nœud.
    await expect(page.locator(".mh-flow-a11y-title")).toHaveText("Parcours du scénario");
    await expect(page.locator(".mh-flow-a11y-nav")).toHaveAttribute("aria-labelledby", "mh-flow-a11y-title");
    await expect(page.locator(".mh-flow-a11y-list")).toHaveCount(1);
    await expect(page.locator(".mh-flow-a11y-nodes")).toHaveCount(2);
    await expect(page.locator(".mh-flow-a11y-node")).toHaveCount(NODES.length);

    // Nœud de la carte : bouton annoncé « Scène non découverte », sans identifiant de script.
    await expect(hiddenNode).toHaveAttribute("data-state", "hidden");
    await expect(hiddenNode).toHaveAttribute("role", "button");
    await expect(hiddenNode).toHaveAttribute("aria-label", HIDDEN_LABEL);
    await expect(hiddenNode).toHaveAttribute("aria-disabled", "true");
    expect(await hiddenNode.getAttribute("data-id")).toBeNull();
    expect(await hiddenNode.getAttribute("title")).toBeNull();
    const outer = (await hiddenNode.evaluate((el) => el.outerHTML)).toLowerCase();
    for (const leak of ["secret", "title-secret", "choix-secret", "arc-secret"]) {
      expect(outer, `outerHTML du nœud masqué ne doit pas contenir « ${leak} »`).not.toContain(leak);
    }

    // Équivalent liste : même libellé, aucun identifiant, aucun nombre d'options.
    await expect(hiddenButton).toHaveText(HIDDEN_LABEL);
    await expect(hiddenButton).toHaveAttribute("aria-label", HIDDEN_LABEL);
    await expect(hiddenButton).toHaveAttribute("tabindex", "-1");
    const hiddenText = (await hiddenButton.textContent()) ?? "";
    expect(hiddenText).not.toMatch(/\d/);
    expect(hiddenText).not.toMatch(/option|choix/i);
    const hiddenPlain = page.locator(`.mh-flow-a11y [data-a11y-node="${HIDDEN_NODE_INDEX}"]`);
    await expect(hiddenPlain).toHaveText(HIDDEN_LABEL);

    // Chapitre entièrement non visité : titre « ??? », jamais le libellé du chapitre.
    const chapter = page
      .locator(".mh-flow-a11y-chapter")
      .filter({ has: page.locator(`[data-a11y-node="${HIDDEN_CHOICE_INDEX}"]`) });
    await expect(chapter.locator(".mh-flow-a11y-chapter-title")).toHaveText("???");
    await expect(chapter).toHaveAttribute("data-a11y-locked", "true");
    const a11yText = (await page.locator(".mh-flow-a11y").textContent()) ?? "";
    for (const leak of ["TITLE-SECRET", "secret-choice", "secret-a", "secret-b", "CHOIX-SECRET"]) {
      expect(a11yText, `la liste accessible ne doit pas révéler « ${leak} »`).not.toContain(leak);
    }
    // Le titre du groupe sur la carte est masqué de la même façon.
    const lockedGroup = page.locator('.mh-flow-group[data-locked="true"]');
    await expect(lockedGroup).toHaveCount(1);
    await expect(lockedGroup.locator(".mh-flow-group-title")).toHaveText("???");

    // Le chapitre visité garde bien son titre (le test ne passe pas parce que tout est masqué).
    await expect(page.locator(".mh-flow-a11y-chapter-title").first()).toHaveText("CHAPITRE-UN");
  });

  test("portrait : aside masqué, aimantation verticale par chapitre, zoom ajusté à la largeur", async ({ page }) => {
    await setup(page, { width: 720, height: 1280 });

    expect(await page.locator(".mh-flow-aside").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    expect(await page.locator(".mh-flow-scroll").evaluate((el) => getComputedStyle(el).scrollSnapType)).toContain("y");
    const alignments = await page
      .locator(".mh-flow-group")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).scrollSnapAlign));
    expect(alignments.length).toBeGreaterThan(0);
    for (const align of alignments) expect(align).toBe("start");

    // Le zoom initial tient la largeur : le contenu mis à l'échelle ne dépasse pas la zone visible.
    const fit = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(".mh-flow-scroll")!;
      const sizer = document.querySelector<HTMLElement>(".mh-flow-sizer")!;
      return {
        zoom: Number(scroller.dataset.zoom),
        clientWidth: scroller.clientWidth,
        sizerWidth: Number.parseFloat(getComputedStyle(sizer).width),
        output: document.querySelector(".mh-flow-zoom-value")?.textContent ?? "",
      };
    });
    expect(fit.zoom).toBeGreaterThan(0);
    expect(fit.zoom).toBeLessThanOrEqual(100);
    expect(fit.sizerWidth).toBeLessThanOrEqual(fit.clientWidth + 1);
    expect(fit.output).toContain(`${fit.zoom} %`);

    // On peut passer d'un chapitre à l'autre par défilement.
    const scroller = page.locator(".mh-flow-scroll");
    const before = await scroller.evaluate((el) => el.scrollTop);
    await page.locator(".mh-flow-group").last().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before + 10);

    // La liste équivalente reste dans l'arbre d'accessibilité en portrait (pas `display: none`).
    expect(await page.locator(".mh-flow-a11y").evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
  });

  test("mode « tout révéler » : titres démasqués et aucune violation axe", async ({ page }) => {
    await setup(page, { revealAll: true });

    // Le réglage est bien pris en compte : plus de silhouette, le chapitre secret est nommé.
    // (`.mh-flow-node` existe aussi dans la légende : ne compter que les nœuds de la carte.)
    await expect(page.locator('.mh-flow-stage .mh-flow-node[data-state="hidden"]')).toHaveCount(0);
    const locked = page.locator('.mh-flow-group[data-locked="true"]');
    await expect(locked).toHaveCount(0);
    const titles = await page.locator(".mh-flow-a11y-chapter-title").allTextContents();
    expect(titles).toContain("TITLE-SECRET");

    await expectNoViolations(page);
  });
});
