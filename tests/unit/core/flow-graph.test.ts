import { describe, it, expect } from "vitest";
import { choiceLabelLines, endingProgress, groupTitle, parseStoryGraph } from "@/core/flow-graph.js";

const valid = {
  version: 1,
  first: "a",
  nodes: [
    { id: "a", file: "a.ks", kind: "normal", chapter: "a", arc: "Un" },
    { id: "b", file: "b.ks", kind: "end", thumb: "fond" },
  ],
  edges: [{ from: "a", to: "b", kind: "choice", choice: "Option" }],
};

describe("parseStoryGraph", () => {
  it("accepte un graphe valide", () => {
    expect(parseStoryGraph(valid)).toEqual(valid);
  });

  it("refuse une forme inattendue", () => {
    expect(parseStoryGraph(null)).toBeNull();
    expect(parseStoryGraph("graphe")).toBeNull();
    expect(parseStoryGraph({ ...valid, version: 2 })).toBeNull();
    expect(parseStoryGraph({ ...valid, first: 3 })).toBeNull();
    expect(parseStoryGraph({ ...valid, nodes: "x" })).toBeNull();
    expect(parseStoryGraph({ ...valid, edges: {} })).toBeNull();
  });

  it("refuse un nœud ou une arête mal formés", () => {
    expect(parseStoryGraph({ ...valid, nodes: [{ id: "", file: "a.ks", kind: "normal" }] })).toBeNull();
    expect(parseStoryGraph({ ...valid, nodes: [{ id: "a", file: "a.ks", kind: "inconnu" }] })).toBeNull();
    expect(parseStoryGraph({ ...valid, nodes: [{ id: "a", file: "a.ks", kind: "normal", arc: 4 }] })).toBeNull();
    expect(parseStoryGraph({ ...valid, edges: [{ from: "a", to: "b", kind: "autre" }] })).toBeNull();
    expect(parseStoryGraph({ ...valid, edges: [{ from: "a", to: "b", kind: "normal", choice: 1 }] })).toBeNull();
  });

  it("refuse les identifiants en double, un premier script absent et une arête orpheline", () => {
    expect(parseStoryGraph({ ...valid, nodes: [valid.nodes[0], valid.nodes[0]] })).toBeNull();
    expect(parseStoryGraph({ ...valid, first: "zzz" })).toBeNull();
    expect(parseStoryGraph({ ...valid, edges: [{ from: "a", to: "zzz", kind: "normal" }] })).toBeNull();
  });
});

describe("choiceLabelLines", () => {
  it("coupe sur la séquence littérale \\n et sur les vrais sauts de ligne", () => {
    expect(choiceLabelLines("Une\\nDeux")).toEqual(["Une", "Deux"]);
    expect(choiceLabelLines("Une\nDeux\r\nTrois")).toEqual(["Une", "Deux", "Trois"]);
  });

  it("écarte les lignes vides et garde un libellé simple intact", () => {
    expect(choiceLabelLines("Simple")).toEqual(["Simple"]);
    expect(choiceLabelLines("\\nA\\n\\nB\\n")).toEqual(["A", "B"]);
    expect(choiceLabelLines("")).toEqual([]);
  });
});

describe("groupTitle", () => {
  const chapters = [{ id: "c1", label: "Chapitre un" }];
  it("préfère le libellé du chapitre, puis l'arc, puis l'identifiant", () => {
    expect(groupTitle({ chapter: "c1", arc: "Arc" }, chapters)).toBe("Chapitre un");
    expect(groupTitle({ chapter: "c2", arc: "Arc" }, chapters)).toBe("Arc");
    expect(groupTitle({ arc: "Arc" })).toBe("Arc");
    expect(groupTitle({ chapter: "c2" }, chapters)).toBe("c2");
    expect(groupTitle({})).toBe("");
  });
});

describe("endingProgress", () => {
  it("ne compte que les fins atteignables (les autres identifiants sont ignorés)", () => {
    const layout = { endings: ["fin-a", "fin-b"] };
    expect(endingProgress(layout, [])).toEqual({ reached: 0, total: 2 });
    expect(endingProgress(layout, ["fin-a", "bonus-isole", "fin-a"])).toEqual({ reached: 1, total: 2 });
    expect(endingProgress({ endings: [] }, ["fin-a"])).toEqual({ reached: 0, total: 0 });
  });
});
