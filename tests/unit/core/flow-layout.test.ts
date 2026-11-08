import { describe, it, expect } from "vitest";
import { layoutFlowchart } from "@/core/flow-layout.js";
import type { FlowLayout, GraphEdge, GraphNode, StoryGraph } from "@/core/flow-graph.js";

/** Graphe factice original : identifiants courts, groupes optionnels (`id@arc`). */
function graph(spec: string[], links: string[], first?: string): StoryGraph {
  const nodes: GraphNode[] = spec.map((s) => {
    const [id, arc, kind] = s.split("@") as [string, string | undefined, string | undefined];
    return { id: id!, file: `${id}.ks`, kind: (kind as GraphNode["kind"]) ?? "normal", ...(arc ? { arc, chapter: arc.toLowerCase() } : {}) };
  });
  const edges: GraphEdge[] = links.map((l) => {
    const [from, to, kind] = l.split(/[>:]/) as [string, string, string | undefined];
    return { from: from!, to: to!, kind: (kind as GraphEdge["kind"]) ?? "normal" };
  });
  return { version: 1, first: first ?? nodes[0]!.id, nodes, edges };
}

function node(layout: FlowLayout, id: string) {
  const n = layout.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`nœud absent : ${id}`);
  return n;
}
const cx = (layout: FlowLayout, id: string) => node(layout, id).x + node(layout, id).width / 2;

/** Vérifie les invariants géométriques communs à toutes les mises en page. */
function expectSound(layout: FlowLayout): void {
  // Aucun chevauchement de nœuds.
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i]!;
      const b = layout.nodes[j]!;
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap, `${a.id} chevauche ${b.id}`).toBe(false);
    }
  }
  // Les nœuds d'un groupe sont dans son rectangle ; deux groupes ne se chevauchent pas.
  for (const g of layout.groups) {
    for (const id of g.nodeIds) {
      const n = node(layout, id);
      expect(n.x).toBeGreaterThanOrEqual(g.x);
      expect(n.y).toBeGreaterThanOrEqual(g.y + g.headerHeight);
      expect(n.x + n.width).toBeLessThanOrEqual(g.x + g.width + 1e-6);
      expect(n.y + n.height).toBeLessThanOrEqual(g.y + g.height + 1e-6);
    }
  }
  for (let i = 0; i < layout.groups.length; i++) {
    for (let j = i + 1; j < layout.groups.length; j++) {
      const a = layout.groups[i]!;
      const b = layout.groups[j]!;
      expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height, `${a.id} chevauche ${b.id}`).toBe(false);
    }
  }
  // Arêtes : segments horizontaux ou verticaux, qui ne traversent aucun autre nœud.
  for (const e of layout.edges) {
    expect(e.points.length).toBeGreaterThanOrEqual(2);
    for (let k = 0; k + 1 < e.points.length; k++) {
      const p = e.points[k]!;
      const q = e.points[k + 1]!;
      expect(p.x === q.x || p.y === q.y, `${e.from}>${e.to} segment oblique`).toBe(true);
      const [x1, x2] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
      const [y1, y2] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
      for (const n of layout.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        const crosses = x2 > n.x && x1 < n.x + n.width && y2 > n.y && y1 < n.y + n.height;
        expect(crosses, `${e.from}>${e.to} traverse ${n.id}`).toBe(false);
      }
    }
  }
}

describe("layoutFlowchart — chaîne", () => {
  const g = graph(["a", "b", "c", "d"], ["a>b", "b>c", "c>d"]);
  const layout = layoutFlowchart(g);

  it("un niveau par script, alignés en colonne", () => {
    expect(layout.nodes.map((n) => n.level)).toEqual([0, 1, 2, 3]);
    expect(new Set(layout.nodes.map((n) => n.x)).size).toBe(1);
    const ys = layout.nodes.map((n) => n.y);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys);
  });

  it("arêtes droites de deux points, bord bas vers bord haut", () => {
    const e = layout.edges[0]!;
    expect(e.points).toHaveLength(2);
    expect(e.points[0]!.y).toBe(node(layout, "a").y + node(layout, "a").height);
    expect(e.points[1]!.y).toBe(node(layout, "b").y);
    expect(e.reversed).toBe(false);
    expect(e.external).toBe(false);
  });

  it("un seul groupe, une seule section, une fin atteignable", () => {
    expect(layout.groups).toHaveLength(1);
    expect(layout.sections.map((s) => s.id)).toEqual(["main"]);
    expect(layout.endings).toEqual(["d"]);
    expectSound(layout);
  });
});

describe("layoutFlowchart — choix et fusion", () => {
  const g = graph(["a", "b", "c", "d", "e"], ["a>b:choice", "a>c:choice", "b>d", "c>d", "d>e"]);
  const layout = layoutFlowchart(g);

  it("les options d'un choix partagent le niveau suivant, dans l'ordre du graphe", () => {
    expect(node(layout, "b").level).toBe(1);
    expect(node(layout, "c").level).toBe(1);
    expect(node(layout, "b").y).toBe(node(layout, "c").y);
    expect(node(layout, "b").x).toBeLessThan(node(layout, "c").x);
  });

  it("le nœud de fusion est centré sous ses deux parents, le choix au-dessus", () => {
    expect(node(layout, "d").level).toBe(2);
    expect(cx(layout, "d")).toBeCloseTo((cx(layout, "b") + cx(layout, "c")) / 2, 5);
    expect(cx(layout, "a")).toBeCloseTo((cx(layout, "b") + cx(layout, "c")) / 2, 5);
  });

  it("les arêtes d'un choix gardent leur indice et leur nature", () => {
    expect(layout.edges.map((e) => [e.index, e.kind])).toEqual([
      [0, "choice"],
      [1, "choice"],
      [2, "normal"],
      [3, "normal"],
      [4, "normal"],
    ]);
    expectSound(layout);
  });
});

describe("layoutFlowchart — arête longue", () => {
  it("contourne les nœuds intermédiaires et place le niveau par le plus long chemin", () => {
    const g = graph(["a", "b", "c", "d"], ["a>b", "b>c", "c>d", "a>d"]);
    const layout = layoutFlowchart(g);
    expect(node(layout, "d").level).toBe(3);
    const long = layout.edges[3]!;
    expect(long.points.length).toBeGreaterThan(2);
    expectSound(layout);
  });
});

describe("layoutFlowchart — interlude partagé", () => {
  // Deux chapitres reliés par un interlude sans chapitre ni arc (comme le goûter).
  const g = graph(
    ["a1@A", "a2@A", "tea@@interlude", "b1@B", "b2@B", "c1@C"],
    ["a1>a2", "a2>tea", "tea>b1", "b1>b2", "b2>tea", "tea>c1"],
  );
  const layout = layoutFlowchart(g);

  it("reste un nœud unique, à part, dans la colonne de droite", () => {
    expect(layout.nodes.filter((n) => n.id === "tea")).toHaveLength(1);
    const tea = node(layout, "tea");
    expect(tea.hub).toBe(true);
    expect(tea.groupId).toBeNull();
    const rightOfGroups = Math.max(...layout.groups.map((gr) => gr.x + gr.width));
    expect(tea.x).toBeGreaterThan(rightOfGroups);
    expect(layout.width).toBeGreaterThanOrEqual(tea.x + tea.width);
  });

  it("les groupes suivent l'ordre du récit à travers l'interlude", () => {
    expect(layout.groups.map((gr) => gr.chapter)).toEqual(["a", "b", "c"]);
    const ys = layout.groups.map((gr) => gr.y);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys);
  });

  it("l'interlude est à la hauteur moyenne de ses voisins", () => {
    const tea = node(layout, "tea");
    const neighbors = ["a2", "b1", "b2", "c1"].map((id) => node(layout, id).y);
    const avg = neighbors.reduce((s, v) => s + v, 0) / neighbors.length;
    expect(Math.abs(tea.y - avg)).toBeLessThan(layout.height / 2);
    expect(tea.y).toBeGreaterThanOrEqual(0);
  });

  it("ses arêtes sont externes et orthogonales, sans traverser de nœud", () => {
    const touching = layout.edges.filter((e) => e.from === "tea" || e.to === "tea");
    expect(touching).toHaveLength(4);
    expect(touching.every((e) => e.external)).toBe(true);
    expectSound(layout);
  });
});

describe("layoutFlowchart — cycle", () => {
  const g = graph(["a", "b", "c"], ["a>b", "b>c", "c>a"]);
  const layout = layoutFlowchart(g);

  it("termine, avec une seule arête retournée, tracée de c vers a", () => {
    expect(node(layout, "a").level).toBe(0);
    expect(node(layout, "c").level).toBe(2);
    const back = layout.edges.find((e) => e.from === "c" && e.to === "a")!;
    expect(back.reversed).toBe(true);
    expect(layout.edges.filter((e) => e.reversed)).toHaveLength(1);
    const first = back.points[0]!;
    const last = back.points[back.points.length - 1]!;
    expect(first.y).toBe(node(layout, "c").y);
    expect(last.y).toBe(node(layout, "a").y + node(layout, "a").height);
    expectSound(layout);
  });

  it("une boucle sur un nœud et une double arête sont tolérées", () => {
    const l = layoutFlowchart(graph(["a", "b"], ["a>a", "a>b", "b>a", "a>b:choice"]));
    expect(l.edges).toHaveLength(4);
    expectSound(l);
  });
});

describe("layoutFlowchart — groupes, sections et fins", () => {
  // Deux chapitres reliés, une page annexe jamais atteinte, trois extrémités isolées.
  const g = graph(
    ["s1@A", "s2@A", "e1@A", "t1@B", "t2@B", "t3@B", "x1@W", "x2@W", "x3@W", "iso1@Z", "iso2@Z", "iso3@Z"],
    ["s1>s2", "s2>e1", "e1>t1", "t1>t2", "t2>t3", "x1>x2", "x2>x3"],
    "s1",
  );
  const layout = layoutFlowchart(g);

  it("range les nœuds atteignables dans la section principale, le reste dans Bonus", () => {
    expect(layout.sections.map((s) => s.id)).toEqual(["main", "bonus"]);
    const main = layout.sections[0]!;
    const bonus = layout.sections[1]!;
    expect(main.nodeIds).toEqual(["s1", "s2", "e1", "t1", "t2", "t3"]);
    expect(bonus.nodeIds).toEqual(["x1", "x2", "x3", "iso1", "iso2", "iso3"]);
    expect(bonus.y).toBeGreaterThanOrEqual(main.y + main.height);
    expect(bonus.headerHeight).toBeGreaterThan(0);
    for (const id of bonus.nodeIds) expect(node(layout, id).section).toBe("bonus");
  });

  it("ne compte comme fins que les extrémités atteignables depuis le début", () => {
    expect(layout.endings).toEqual(["t3"]);
    expect(node(layout, "t3").ending).toBe(true);
    expect(node(layout, "x3").ending).toBe(false);
    expect(node(layout, "iso1").ending).toBe(false);
  });

  it("un groupe par page et par section, avec chapitre et arc", () => {
    expect(layout.groups.map((gr) => [gr.id, gr.chapter, gr.arc])).toEqual([
      ["main:A", "a", "A"],
      ["main:B", "b", "B"],
      ["bonus:W", "w", "W"],
      ["bonus:Z", "z", "Z"],
    ]);
    expectSound(layout);
  });

  it("les extrémités isolées sont sur un même niveau", () => {
    expect(new Set(["iso1", "iso2", "iso3"].map((id) => node(layout, id).y)).size).toBe(1);
  });

  it("un script isolé qui est le premier script n'est pas une fin", () => {
    const l = layoutFlowchart(graph(["only"], []));
    expect(l.endings).toEqual([]);
    expect(l.sections.map((s) => s.id)).toEqual(["main"]);
  });
});

describe("layoutFlowchart — cas limites", () => {
  it("graphe vide", () => {
    const l = layoutFlowchart({ version: 1, first: "x", nodes: [], edges: [] });
    expect(l).toEqual({ width: 0, height: 0, nodes: [], edges: [], groups: [], sections: [], endings: [] });
  });

  it("ignore les arêtes vers un nœud inconnu et les doublons de nœud", () => {
    const base = graph(["a", "b"], ["a>b"]);
    const l = layoutFlowchart({ ...base, nodes: [...base.nodes, base.nodes[0]!], edges: [...base.edges, { from: "a", to: "zzz", kind: "normal" }] });
    expect(l.nodes).toHaveLength(2);
    expect(l.edges).toHaveLength(1);
  });

  it("premier script inconnu : tout est dans la section principale", () => {
    const l = layoutFlowchart(graph(["a", "b"], ["a>b"], "inconnu"));
    expect(l.sections.map((s) => s.id)).toEqual(["main"]);
  });

  it("respecte les dimensions demandées", () => {
    const l = layoutFlowchart(graph(["a", "b"], ["a>b"]), { nodeWidth: 100, nodeHeight: 20 });
    expect(node(l, "a").width).toBe(100);
    expect(node(l, "a").height).toBe(20);
  });
});

describe("layoutFlowchart — déterminisme", () => {
  const g = graph(
    ["a@A", "b@A", "c@A", "d@A", "e@A", "t@@interlude", "f@B", "g@B"],
    ["a>b:choice", "a>c:choice", "b>d", "c>d", "a>e", "d>t", "e>t", "t>f", "f>g", "g>a"],
  );

  it("deux appels identiques donnent exactement le même résultat", () => {
    expect(layoutFlowchart(g)).toEqual(layoutFlowchart(g));
    expect(JSON.stringify(layoutFlowchart(g))).toBe(JSON.stringify(layoutFlowchart(structuredClone(g))));
  });

  it("ne dépend pas de la progression du joueur (aucune entrée de progression)", () => {
    expect(layoutFlowchart.length).toBeLessThanOrEqual(2);
    expectSound(layoutFlowchart(g));
  });
});

describe("layoutFlowchart — performance", () => {
  /** Graphe factice de 200 nœuds : couches, fusions, sauts de niveaux, quelques retours. */
  function generated(count: number): StoryGraph {
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const spec: string[] = [];
    const links: string[] = [];
    for (let i = 0; i < count; i++) spec.push(`n${i}@C${Math.floor(i / 25)}`);
    for (let i = 1; i < count; i++) {
      links.push(`n${i - 1 - Math.floor(rand() * Math.min(i, 3))}>n${i}`);
      if (rand() < 0.3) links.push(`n${Math.floor(rand() * i)}>n${i}`);
      if (rand() < 0.05 && i > 10) links.push(`n${i}>n${Math.floor(rand() * i)}`);
    }
    return graph(spec, links);
  }

  it("200 nœuds en moins de 100 ms", () => {
    const g = generated(200);
    layoutFlowchart(g); // échauffement du moteur JS
    const t0 = performance.now();
    const layout = layoutFlowchart(g);
    const ms = performance.now() - t0;
    expect(layout.nodes).toHaveLength(200);
    expect(ms).toBeLessThan(100);
  });

  it("un seul grand groupe de 200 nœuds reste sain et rapide", () => {
    const g = graph(
      Array.from({ length: 200 }, (_, i) => `m${i}`),
      Array.from({ length: 199 }, (_, i) => `m${Math.max(0, i - (i % 7))}>m${i + 1}`),
    );
    const t0 = performance.now();
    const layout = layoutFlowchart(g);
    expect(performance.now() - t0).toBeLessThan(100);
    expectSound(layout);
  });
});
