/**
 * Oracle d'état (#317) : rejoue chaque script narratif et enregistre, à chaque événement `text`,
 * un hash stable de l'état logique (PageState fore/back + drapeaux persistés), plus le nombre
 * d'événements `scene` émis.
 *
 * Sert de preuve de non-régression pour la refonte des pistes : le hash doit être **identique**
 * avant/après (l'état logique ne dépend pas du mode de rendu) et le compteur de `scene` doit
 * diminuer exactement du nombre de scènes immédiates supprimées.
 *
 * Usage :
 *   npm run oracle:state -- --assets public/assets --out /tmp/oracle.json
 * (assets locaux non commités ; la sortie ne contient aucun texte du jeu)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { lex } from "../src/kag/lexer.js";
import { parse } from "../src/kag/parser.js";
import { Runtime } from "../src/kag/runtime.js";
import type { ParsedScript } from "../src/kag/types.js";

type ScriptHash = { steps: number; textHashes: string[]; sceneEvents: number };

function scenarioFiles(assetsDir: string): string[] {
  const dir = join(assetsDir, "scenario");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name: string) => name.endsWith(".ks"))
    .sort()
    .map((name: string) => join(dir, name));
}

function loadScenario(assetsDir: string, storage: string): ParsedScript | null {
  for (const name of [storage, `${storage}.ks`, `${storage}.KS`]) {
    const path = join(assetsDir, "scenario", name);
    if (!existsSync(path)) continue;
    return parse(lex(readFileSync(path, "utf-8")));
  }
  return null;
}

function hashState(runtime: Runtime): string {
  const state = runtime.getSaveData().state;
  return createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16);
}

/** Rejoue un script et renvoie hash d'état aux `text` + nombre de scènes. */
export async function oracleScript(script: ParsedScript, assetsDir: string): Promise<ScriptHash> {
  const runtime = new Runtime(script, "oracle.ks");
  runtime.scriptLoader = (storage: string) => loadScenario(assetsDir, storage);
  runtime.onWarning = () => {};
  const textHashes: string[] = [];
  let sceneEvents = 0;
  let steps = 0;
  while (steps < 5000) {
    const step = runtime.step();
    steps++;
    sceneEvents += step.events.filter((event) => event.kind === "scene").length;
    if (step.events.some((event) => event.kind === "text")) textHashes.push(hashState(runtime));
    if (step.stop.kind === "end") break;
    if (step.stop.kind === "loadScript") {
      const ok = await runtime.loadScript(step.stop.file, step.stop.label, step.stop.pushCallStack ?? true);
      if (!ok) break;
      continue;
    }
    if (step.stop.kind === "choice") {
      const option = step.stop.options[0];
      if (!option || !runtime.jump(option.target)) break;
      continue;
    }
  }
  return { steps, textHashes, sceneEvents };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let assetsDir = process.env.MAHOYO_ASSETS_DIR ?? join(process.cwd(), "public", "assets");
  let out = join("/tmp", "mahoyo-oracle", "state.json");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--assets") assetsDir = argv[++i] ?? assetsDir;
    else if (argv[i] === "--out") out = argv[++i] ?? out;
  }
  const scripts: Record<string, ScriptHash> = {};
  for (const path of scenarioFiles(assetsDir)) {
    const name = path.split("/").pop()!;
    try {
      scripts[name] = await oracleScript(parse(lex(readFileSync(path, "utf-8"))), assetsDir);
    } catch (error) {
      scripts[name] = { steps: 0, textHashes: [], sceneEvents: -1 };
      console.error(`[oracle] ${name}: ${String(error)}`);
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), scripts }, null, 2));
  const totals = Object.values(scripts).reduce(
    (acc, script) => ({ steps: acc.steps + script.steps, text: acc.text + script.textHashes.length, scenes: acc.scenes + script.sceneEvents }),
    { steps: 0, text: 0, scenes: 0 },
  );
  console.log(`[oracle] ${Object.keys(scripts).length} scripts, ${totals.steps} steps, ${totals.text} événements text, ${totals.scenes} scènes.`);
  console.log(`Oracle JSON : ${out}`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
