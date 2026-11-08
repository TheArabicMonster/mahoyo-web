/**
 * Graphe de scénario. Les tables et graphes ci-dessous sont des exemples inventés ;
 * aucun contenu du jeu n'est utilisé.
 */
import { describe, it, expect } from "vitest";
import type { StoryChain } from "@/core/story-chain.js";
import { buildStoryChain, parseTjs, scriptPlacements } from "../../../tools/story-chain-lib.js";
import { buildStoryGraph, firstImageOf, nodeId, summarizeGraph } from "../../../tools/story-graph-lib.js";

/**
 * Table factice :
 *
 *   a-1 -> a-2 -> a-3 (menu : deux options) -> b-1 | c-1
 *   b-1 -> tea (then d-1) ; c-1 -> tea (then e-1)      (interlude partagé, deux suites)
 *   d-1 -> d-2 (si « flag>0 »), d-3 (sans condition)   (arête conditionnelle)
 *   d-2, d-3, e-1 : fins
 *   z-1 : bonus isolé, sans suite
 */
const chain: StoryChain = {
  version: 1,
  first: "a-1.ks",
  next: {
    "a-1.ks": [{ to: "a-2.ks" }],
    "a-2.ks": [{ to: "a-3.ks" }],
    "a-3.ks": [
      { to: "b-1.ks", choice: "Option B" },
      { to: "c-1.ks", choice: "Option C" },
    ],
    "b-1.ks": [{ to: "tea.ks", then: ["d-1.ks"] }],
    "c-1.ks": [{ to: "tea.ks", then: ["e-1.ks"] }],
    "d-1.ks": [{ to: "d-2.ks", condition: "flag>0" }, { to: "d-3.ks" }],
    "d-2.ks": [],
    "d-3.ks": [],
    "e-1.ks": [],
    "z-1.ks": [],
  },
};

const kinds = (g: ReturnType<typeof buildStoryGraph>): Record<string, string> =>
  Object.fromEntries(g.nodes.map((n) => [n.id, n.kind]));

describe("buildStoryGraph", () => {
  const graph = buildStoryGraph(chain);

  it("un nœud par script cité, identifié par son nom sans extension", () => {
    expect(graph.version).toBe(1);
    expect(graph.first).toBe("a-1");
    expect(graph.nodes.map((n) => n.id)).toEqual(["a-1", "a-2", "a-3", "b-1", "c-1", "tea", "d-1", "e-1", "d-2", "d-3", "z-1"]);
    expect(graph.nodes.find((n) => n.id === "tea")!.file).toBe("tea.ks");
  });

  it("classe les nœuds : normal, choix, interlude, fin", () => {
    expect(kinds(graph)).toEqual({
      "a-1": "normal",
      "a-2": "normal",
      "a-3": "choice",
      "b-1": "normal",
      "c-1": "normal",
      tea: "interlude",
      "d-1": "normal",
      "e-1": "end",
      "d-2": "end",
      "d-3": "end",
      "z-1": "end",
    });
  });

  it("un choix : toutes les arêtes sortantes sont libellées", () => {
    expect(graph.edges.filter((e) => e.from === "a-3")).toEqual([
      { from: "a-3", to: "b-1", kind: "choice", choice: "Option B" },
      { from: "a-3", to: "c-1", kind: "choice", choice: "Option C" },
    ]);
  });

  it("un interlude partagé est un seul nœud, avec plusieurs arêtes entrantes et une suite par contexte", () => {
    expect(graph.nodes.filter((n) => n.kind === "interlude")).toHaveLength(1);
    expect(graph.edges.filter((e) => e.to === "tea").map((e) => e.from)).toEqual(["b-1", "c-1"]);
    expect(graph.edges.filter((e) => e.from === "tea").map((e) => e.to)).toEqual(["d-1", "e-1"]);
  });

  it("une arête conditionnelle porte sa condition", () => {
    expect(graph.edges.filter((e) => e.from === "d-1")).toEqual([
      { from: "d-1", to: "d-2", kind: "conditional", condition: "flag>0" },
      { from: "d-1", to: "d-3", kind: "normal" },
    ]);
  });

  it("une option libellée et conditionnelle reste une arête de choix qui garde sa condition", () => {
    const g = buildStoryGraph({
      version: 1,
      first: "a.ks",
      next: { "a.ks": [{ to: "b.ks", choice: "X", condition: "k>0" }, { to: "c.ks", choice: "Y" }], "b.ks": [], "c.ks": [] },
    });
    expect(g.edges[0]).toEqual({ from: "a", to: "b", kind: "choice", choice: "X", condition: "k>0" });
    expect(kinds(g).a).toBe("choice");
  });

  it("un `then` à plusieurs éléments est déroulé en arêtes normales, libellé sur la première", () => {
    const g = buildStoryGraph({
      version: 1,
      first: "a.ks",
      next: { "a.ks": [{ to: "i.ks", then: ["j.ks", "k.ks"], choice: "Aller" }, { to: "b.ks", choice: "Rester" }], "b.ks": [], "k.ks": [] },
    });
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.kind}`)).toEqual(["a>i:choice", "i>j:normal", "j>k:normal", "a>b:choice"]);
    expect(kinds(g)).toMatchObject({ i: "interlude", j: "interlude", k: "end" });
  });

  it("ne duplique ni nœud ni arête", () => {
    const g = buildStoryGraph({
      version: 1,
      first: "a.ks",
      next: { "a.ks": [{ to: "b.ks" }, { to: "b.ks" }], "b.ks": [] },
    });
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
  });

  it("les noms de scripts sont comparés sans tenir compte de la casse", () => {
    const g = buildStoryGraph({ version: 1, first: "A-1.ks", next: { "A-1.ks": [{ to: "b-1.KS" }], "B-1.ks": [] } });
    expect(g.nodes.map((n) => n.id)).toEqual(["a-1", "b-1"]);
    expect(nodeId("Teatime.KS")).toBe("teatime");
  });

  it("est déterministe : mêmes entrées, même sortie octet pour octet", () => {
    const again = buildStoryGraph(structuredClone(chain));
    expect(JSON.stringify(again)).toBe(JSON.stringify(graph));
  });

  it("joint les vignettes et les chapitres aux nœuds sans en inventer", () => {
    const g = buildStoryGraph(chain, {
      thumbs: new Map([["a-1", "image-a"]]),
      placements: new Map([["a-1", { chapter: "a-1", arc: "Arc A" }], ["z-1", { arc: "Bonus" }]]),
    });
    expect(g.nodes[0]).toEqual({ id: "a-1", file: "a-1.ks", kind: "normal", chapter: "a-1", arc: "Arc A", thumb: "image-a" });
    expect(g.nodes.find((n) => n.id === "z-1")).toEqual({ id: "z-1", file: "z-1.ks", kind: "end", arc: "Bonus" });
    expect(g.nodes.find((n) => n.id === "a-2")).toEqual({ id: "a-2", file: "a-2.ks", kind: "normal" });
  });
});

describe("summarizeGraph", () => {
  it("compte nœuds, arêtes, choix, interludes, fins et isolés", () => {
    expect(summarizeGraph(buildStoryGraph(chain))).toEqual({
      nodes: 11,
      edges: 10,
      choiceNodes: 1,
      choiceEdges: 2,
      conditionalEdges: 1,
      interludes: 1,
      ends: 4,
      reachableEnds: 3,
      isolated: 1,
    });
  });
});

describe("firstImageOf", () => {
  it("renvoie le nom (sans extension) du premier fond qui n'est pas un aplat", () => {
    const source = ["*page0|", "@bg storage=black", "@fg storage=sprite-x center=1", "@bg time=10 rule=crossfade storage=fond-1.png", "@bg storage=fond-2"].join("\n");
    expect(firstImageOf(source)).toBe("fond-1");
  });

  it("lit aussi la forme en balise [bg …] et ignore les couleurs unies", () => {
    expect(firstImageOf("texte [bg storage=white] suite [bg time=5 storage=fond-9]")).toBe("fond-9");
    expect(firstImageOf("@bg storage=red\n@bg storage=gray")).toBeUndefined();
  });

  it("garde un nom contenant des points ou des caractères non ASCII", () => {
    expect(firstImageOf("@bg storage=bg01.館-(昼)")).toBe("bg01.館-(昼)");
  });

  it("renvoie undefined sans fond", () => {
    expect(firstImageOf("@fg storage=sprite\ntexte")).toBeUndefined();
    expect(firstImageOf("")).toBeUndefined();
  });
});

describe("scriptPlacements", () => {
  const block = (id: number, script: string, routes: number[] = []): string =>
    `%[ "id" => int ${id}, "script" => string "${script}", "routes" => [ ${routes
      .map((to) => `%[ "arrival" => int ${to}, "condition" => void, "alternative" => string "" ]`)
      .join(", ")} ] ]`;
  const page = (title: string, blocks: string[]): string => `%[ "title" => string "${title}", "blocks" => [ ${blocks.join(", ")} ] ]`;
  const tjs = parseTjs(
    `%[ "first" => int 1, "pages" => [ ` +
      [
        page("Un", [block(1, "a-1.ks", [2]), block(2, "a-2.ks", [10])]),
        page("Deux", [block(10, "tea.ks", [3]), block(3, "b-1.ks", [4]), block(4, "b-2.ks", [11])]),
        page("Trois", [block(11, "tea.ks", [5]), block(5, "c-1.ks")]),
      ].join(", ") +
      ` ] ]`,
  );
  const build = buildStoryChain(tjs);
  const placements = scriptPlacements(tjs, build.chain.chapters);

  it("rattache chaque script à sa page et au chapitre principal de celle-ci", () => {
    expect(placements.get("a-2")).toEqual({ chapter: "a-1", arc: "Un" });
    expect(placements.get("b-2")).toEqual({ chapter: "b-1", arc: "Deux" });
    expect(placements.get("c-1")).toEqual({ chapter: "c-1", arc: "Trois" });
  });

  it("n'attribue aucune page à un interlude partagé par plusieurs pages", () => {
    expect(placements.has("tea")).toBe(false);
  });

  it("alimente le graphe : le goûter n'a ni chapitre ni arc, les autres nœuds si", () => {
    const graph = buildStoryGraph(build.chain, { placements });
    const tea = graph.nodes.find((n) => n.id === "tea")!;
    expect(tea).toEqual({ id: "tea", file: "tea.ks", kind: "interlude" });
    expect(graph.nodes.filter((n) => n.id !== "tea").every((n) => n.chapter !== undefined && n.arc !== undefined)).toBe(true);
    expect(graph.edges.filter((e) => e.to === "tea").map((e) => e.from)).toEqual(["a-2", "b-2"]);
  });

  it("une page sans chapitre garde son arc seul ; sans titre, l'arc est « page N »", () => {
    const g = parseTjs(`%[ "first" => int 1, "pages" => [ %[ "blocks" => [ ${block(1, "x.ks")} ] ] ] ]`);
    expect(scriptPlacements(g, []).get("x")).toEqual({ arc: "page 0" });
  });
});
