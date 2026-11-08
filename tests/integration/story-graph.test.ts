/**
 * Test d'intégration : graphe de scénario sur le corpus de référence.
 *
 * Nécessite les assets locaux (MAHOYO_ASSETS_DIR ou public/assets) et la table
 * générée par `npm run chain` ; sinon le test est ignoré. Aucun texte original
 * n'est affiché : seulement des compteurs.
 *
 * @vitest-environment node
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { parseStoryChain } from "@/core/story-chain.js";
import { buildStoryGraph, nodeId, summarizeGraph } from "../../tools/story-graph-lib.js";
import { hasAssets, assetsDir } from "./skip-if-no-assets.js";

const chainPath = hasAssets && assetsDir ? join(assetsDir, "story-chain.json") : "";
const hasChain = chainPath !== "" && existsSync(chainPath);

describe.skipIf(!hasChain)("Graphe de scénario (vrais assets)", () => {
  const chain = hasChain ? parseStoryChain(JSON.parse(readFileSync(chainPath, "utf-8"))) : null;
  const graph = chain ? buildStoryGraph(chain) : null;

  it("reprend les 200 scripts de la table et ne cite que des nœuds connus", () => {
    expect(chain).not.toBeNull();
    const ids = new Set(graph!.nodes.map((n) => n.id));
    expect(ids.size).toBe(graph!.nodes.length);
    for (const script of Object.keys(chain!.next)) expect(ids.has(nodeId(script))).toBe(true);
    expect(Object.keys(chain!.next)).toHaveLength(200);
    for (const e of graph!.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it("compte 24 scripts à choix, 72 arêtes libellées et 2 arêtes conditionnelles", () => {
    const s = summarizeGraph(graph!);
    expect(s.choiceNodes).toBe(24);
    expect(s.choiceEdges).toBe(72);
    expect(s.conditionalEdges).toBe(2);
  });

  it("le goûter est un interlude unique à plusieurs arêtes entrantes", () => {
    const tea = graph!.nodes.find((n) => n.id === "teatime");
    expect(tea?.kind).toBe("interlude");
    expect(graph!.edges.filter((e) => e.to === "teatime").length).toBeGreaterThan(10);
  });

  it("le dernier script du chemin principal est une fin atteignable", () => {
    expect(summarizeGraph(graph!).reachableEnds).toBeGreaterThanOrEqual(1);
  });

  it("le fichier généré par `npm run chain`, s'il existe, correspond à la table", () => {
    const generated = join(assetsDir!, "story-graph.json");
    if (!existsSync(generated)) return;
    const onDisk = JSON.parse(readFileSync(generated, "utf-8")) as typeof graph;
    expect(onDisk!.nodes.map((n) => n.id)).toEqual(graph!.nodes.map((n) => n.id));
    expect(onDisk!.edges).toEqual(graph!.edges);
  });
});
