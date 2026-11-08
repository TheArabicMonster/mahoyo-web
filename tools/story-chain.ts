/**
 * Génère `story-chain.json` (enchaînement des scripts) et `story-graph.json` (graphe
 * typé pour le flowchart) à partir de `main.gc`.
 *
 * Usage : npm run chain -- <chemin/main.gc> <dossier d'assets>
 *
 * `main.gc` se trouve dans l'archive `data.xp3` du jeu (dossier `others/`) une
 * fois extraite. Les fichiers générés sont écrits dans le dossier d'assets (ignoré
 * par git) : ils dérivent des fichiers de l'utilisateur et ne doivent jamais être
 * commités. Les vignettes du graphe viennent de `<dossier>/scenario/*.ks` s'il existe.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { buildStoryChain, decodeGc, parseTjs, scriptPlacements } from "./story-chain-lib.js";
import { buildStoryGraph, firstImageOf, nodeId, summarizeGraph } from "./story-graph-lib.js";

/** Première image de chaque script de `<assets>/scenario` (clés = identifiants de nœud). */
function readThumbs(assetsDir: string): Map<string, string> {
  const thumbs = new Map<string, string>();
  const dir = join(assetsDir, "scenario");
  if (!existsSync(dir)) return thumbs;
  for (const file of readdirSync(dir).sort()) {
    if (!file.toLowerCase().endsWith(".ks")) continue;
    const image = firstImageOf(readFileSync(join(dir, file), "utf-8"));
    if (image !== undefined) thumbs.set(nodeId(file), image);
  }
  return thumbs;
}

function main(): void {
  const [gcPath, outDir] = process.argv.slice(2);
  if (!gcPath || !outDir) {
    console.error("Usage : npm run chain -- <chemin/main.gc> <dossier d'assets>");
    process.exit(1);
  }
  if (!existsSync(gcPath)) {
    console.error(`main.gc introuvable : ${gcPath}`);
    process.exit(1);
  }

  const tjs = parseTjs(decodeGc(readFileSync(gcPath)));
  const build = buildStoryChain(tjs);
  const outFile = join(outDir, "story-chain.json");
  writeFileSync(outFile, JSON.stringify(build.chain, null, 2) + "\n", "utf-8");

  const thumbs = readThumbs(outDir);
  const graph = buildStoryGraph(build.chain, { placements: scriptPlacements(tjs, build.chain.chapters), thumbs });
  const graphFile = join(outDir, "story-graph.json");
  writeFileSync(graphFile, JSON.stringify(graph, null, 2) + "\n", "utf-8");

  const scripts = Object.keys(build.chain.next).length;
  const branching = Object.values(build.chain.next).filter((r) => new Set(r.map((x) => x.to)).size > 1).length;
  console.log(`Table d'enchaînement écrite : ${outFile}`);
  console.log(`Blocs : ${build.blocks} (dont ${build.scriptedBlocks} avec script)`);
  console.log(`Scripts : ${scripts} dont ${branching} avec plusieurs suites`);
  console.log(`Premier script : ${build.chain.first}`);
  if (build.sharedScripts.length > 0) {
    console.log(`Interludes partagés par plusieurs blocs (représentés par « then ») : ${build.sharedScripts.length}`);
  }

  const g = summarizeGraph(graph);
  console.log(`Graphe de scénario écrit : ${graphFile}`);
  console.log(`Nœuds : ${g.nodes} (dont ${g.choiceNodes} à choix, ${g.interludes} interludes, ${g.ends} fins, ${g.isolated} isolés)`);
  console.log(`Arêtes : ${g.edges} (dont ${g.choiceEdges} libellées, ${g.conditionalEdges} conditionnelles)`);
  console.log(`Fins atteignables depuis le premier script : ${g.reachableEnds}`);
  const withThumb = graph.nodes.filter((n) => n.thumb !== undefined).length;
  console.log(`Vignettes : ${withThumb} scripts sur ${g.nodes}${thumbs.size === 0 ? " (dossier scenario/ absent ou vide)" : ""}`);

  if (build.danglingRoutes > 0) console.log(`Routes vers un bloc introuvable ignorées : ${build.danglingRoutes}`);
}

main();
