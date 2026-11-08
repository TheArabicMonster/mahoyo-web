/**
 * Test d'intégration : mise en page du flowchart sur le graphe réel (205 nœuds, 243 arêtes).
 *
 * Nécessite les assets locaux (MAHOYO_ASSETS_DIR ou public/assets). Le graphe est lu dans
 * `story-graph.json` (généré par `npm run chain`) s'il existe, sinon reconstruit depuis
 * `story-chain.json` (sans chapitres ni arcs) ; `MAHOYO_STORY_GRAPH` désigne un autre fichier.
 * Sans graphe ni table, le test est ignoré. Aucun texte original n'est affiché.
 *
 * @vitest-environment node
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { parseStoryChain } from "@/core/story-chain.js";
import { parseStoryGraph, type StoryGraph } from "@/core/flow-graph.js";
import { layoutFlowchart } from "@/core/flow-layout.js";
import { buildStoryGraph } from "../../tools/story-graph-lib.js";
import { hasAssets, assetsDir } from "./skip-if-no-assets.js";

function loadGraph(): { graph: StoryGraph; withGroups: boolean } | null {
  const override = process.env.MAHOYO_STORY_GRAPH;
  const generated = override ?? (hasAssets && assetsDir ? join(assetsDir, "story-graph.json") : "");
  if (generated !== "" && existsSync(generated)) {
    const graph = parseStoryGraph(JSON.parse(readFileSync(generated, "utf-8")));
    if (graph) return { graph, withGroups: graph.nodes.some((n) => n.arc !== undefined) };
  }
  const chainPath = hasAssets && assetsDir ? join(assetsDir, "story-chain.json") : "";
  if (chainPath !== "" && existsSync(chainPath)) {
    const chain = parseStoryChain(JSON.parse(readFileSync(chainPath, "utf-8")));
    if (chain) return { graph: buildStoryGraph(chain), withGroups: false };
  }
  return null;
}

const loaded = loadGraph();

describe.skipIf(loaded === null)("Mise en page du flowchart (vrai graphe)", () => {
  const graph = loaded?.graph ?? { version: 1 as const, first: "", nodes: [], edges: [] };
  const layout = layoutFlowchart(graph);

  it("place les 205 nœuds et les 243 arêtes", () => {
    expect(layout.nodes).toHaveLength(graph.nodes.length);
    expect(layout.edges).toHaveLength(graph.edges.length);
    expect(graph.nodes).toHaveLength(205);
    expect(graph.edges).toHaveLength(243);
  });

  it("calcule la mise en page en moins de 100 ms", () => {
    layoutFlowchart(graph);
    const t0 = performance.now();
    layoutFlowchart(graph);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it("est déterministe", () => {
    expect(JSON.stringify(layoutFlowchart(graph))).toBe(JSON.stringify(layout));
  });

  it("ne chevauche aucun nœud et dessine des arêtes orthogonales qui évitent les nœuds", () => {
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i]!;
        const b = layout.nodes[j]!;
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
      }
    }
    let crossings = 0;
    for (const e of layout.edges) {
      for (let k = 0; k + 1 < e.points.length; k++) {
        const p = e.points[k]!;
        const q = e.points[k + 1]!;
        expect(p.x === q.x || p.y === q.y).toBe(true);
        for (const n of layout.nodes) {
          if (n.id === e.from || n.id === e.to) continue;
          if (Math.max(p.x, q.x) > n.x && Math.min(p.x, q.x) < n.x + n.width && Math.max(p.y, q.y) > n.y && Math.min(p.y, q.y) < n.y + n.height) crossings++;
        }
      }
    }
    expect(crossings).toBe(0);
  });

  it("compte les fins atteignables depuis le début, sans compteur sur les extrémités isolées", () => {
    expect(layout.endings.length).toBeGreaterThanOrEqual(1);
    const isolated = graph.nodes.filter((n) => !graph.edges.some((e) => e.from === n.id || e.to === n.id));
    for (const n of isolated) {
      expect(layout.endings).not.toContain(n.id);
      if (n.id !== graph.first) expect(layout.nodes.find((x) => x.id === n.id)?.section).toBe("bonus");
    }
  });

  it("le goûter (13 entrées, 13 sorties) est un interlude partagé unique", () => {
    const tea = layout.nodes.find((n) => n.id === "teatime");
    expect(tea?.hub).toBe(true);
    expect(layout.edges.filter((e) => e.to === "teatime")).toHaveLength(13);
    expect(layout.edges.filter((e) => e.from === "teatime")).toHaveLength(13);
  });

  it.skipIf(!loaded?.withGroups)("regroupe par chapitre : chaque groupe dans un rectangle disjoint", () => {
    expect(layout.groups.length).toBeGreaterThan(10);
    for (let i = 0; i < layout.groups.length; i++) {
      for (let j = i + 1; j < layout.groups.length; j++) {
        const a = layout.groups[i]!;
        const b = layout.groups[j]!;
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
      }
    }
    expect(layout.sections.map((s) => s.id)).toEqual(["main", "bonus"]);
  });
});
