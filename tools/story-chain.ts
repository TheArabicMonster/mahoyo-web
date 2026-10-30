/**
 * Génère `story-chain.json` (enchaînement des scripts) à partir de `main.gc`.
 *
 * Usage : npm run chain -- <chemin/main.gc> <dossier d'assets>
 *
 * `main.gc` se trouve dans l'archive `data.xp3` du jeu (dossier `others/`) une
 * fois extraite. Le fichier généré est écrit dans le dossier d'assets (ignoré
 * par git) : il dérive des fichiers de l'utilisateur et ne doit jamais être
 * commité.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { buildStoryChainFromGc } from "./story-chain-lib.js";

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

  const build = buildStoryChainFromGc(readFileSync(gcPath));
  const outFile = join(outDir, "story-chain.json");
  writeFileSync(outFile, JSON.stringify(build.chain, null, 2) + "\n", "utf-8");

  const scripts = Object.keys(build.chain.next).length;
  const branching = Object.values(build.chain.next).filter((r) => new Set(r.map((x) => x.to)).size > 1).length;
  console.log(`Table d'enchaînement écrite : ${outFile}`);
  console.log(`Blocs : ${build.blocks} (dont ${build.scriptedBlocks} avec script)`);
  console.log(`Scripts : ${scripts} dont ${branching} avec plusieurs suites`);
  console.log(`Premier script : ${build.chain.first}`);
  if (build.sharedScripts.length > 0) {
    console.log(`Interludes partagés par plusieurs blocs (représentés par « then ») : ${build.sharedScripts.length}`);
  }
  if (build.danglingRoutes > 0) console.log(`Routes vers un bloc introuvable ignorées : ${build.danglingRoutes}`);
}

main();
