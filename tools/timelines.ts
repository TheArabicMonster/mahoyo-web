/**
 * Génère `timelines.json` (timelines d'animation simplifiées) à partir des scripts.
 *
 * Usage : npm run timelines -- <dossier d'assets>
 *
 * Lit `<dossier>/scenario/*.ks` et écrit `<dossier>/timelines.json`. Le fichier dérive
 * des fichiers de l'utilisateur et ne doit jamais être commité (le `.gitignore`
 * l'exclut par son nom).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { buildTimelines } from "./timeline-lib.js";

function main(): void {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage : npm run timelines -- <dossier d'assets>");
    process.exit(1);
  }
  const scenario = join(dir, "scenario");
  if (!existsSync(scenario)) {
    console.error(`Dossier introuvable : ${scenario}`);
    process.exit(1);
  }

  const scripts = new Map<string, string>();
  for (const f of readdirSync(scenario)) {
    if (f.toLowerCase().endsWith(".ks")) scripts.set(f, readFileSync(join(scenario, f), "utf-8"));
  }

  const { data, failures } = buildTimelines(scripts);
  const out = join(dir, "timelines.json");
  writeFileSync(out, JSON.stringify(data, null, 1) + "\n", "utf-8");

  const files = Object.keys(data.scripts);
  const scenes = files.reduce((n, f) => n + Object.keys(data.scripts[f]!).length, 0);
  console.log(`Timelines écrites : ${out}`);
  console.log(`Scripts : ${files.length} (${scenes} scènes) sur ${scripts.size} lus`);
  for (const f of failures) console.warn(`Ignoré : ${f}`);
}

main();
