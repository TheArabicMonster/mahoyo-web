/**
 * Capture du **journal d'exécution** d'un script KAG (#318).
 *
 * Rejoue un script `.ks` avec le vrai `Runtime` (sans navigateur) et écrit un JSON des événements
 * pertinents : `@trans`, `@bg`, `@bgact`, `@playtimeline`, `@fg`/`@chgfg`/`@partbg`/animations…
 * avec paramètres du script, état résolu (fore/back), durée déclarée/effective, transition résolue
 * et keyframes normalisés. Aucun texte du jeu n'est capturé.
 *
 * Usage :
 *   npm run journal:capture -- 1-0.ks --out /tmp/mahoyo-journal/port.json [--speed-factor 1.25]
 *
 * Assets : `MAHOYO_ASSETS_DIR`, à défaut `public/assets` (jamais commités).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { lex } from "../src/kag/lexer.js";
import { parse } from "../src/kag/parser.js";
import { Runtime } from "../src/kag/runtime.js";
import type { RuntimeJournalEntry } from "../src/kag/journal.js";
import type { ParsedScript } from "../src/kag/types.js";
import { annotateSource, buildLineMap } from "./trace-visual.js";

const DEFAULT_MAX_STEPS = 20_000;

type Cli = {
  script: string;
  assetsDir: string;
  out: string;
  maxSteps: number;
  speedFactor: number;
};

function parseArgs(argv: string[]): Cli {
  let script = "1-0.ks";
  let assetsDir = process.env.MAHOYO_ASSETS_DIR ?? join(process.cwd(), "public", "assets");
  let out = "";
  let maxSteps = DEFAULT_MAX_STEPS;
  let speedFactor = 1;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--assets") assetsDir = argv[++i] ?? assetsDir;
    else if (arg === "--out") out = argv[++i] ?? out;
    else if (arg === "--max-steps") maxSteps = Number(argv[++i] ?? maxSteps) || maxSteps;
    else if (arg === "--speed-factor") speedFactor = Number(argv[++i] ?? speedFactor) || 1;
    else if (!arg.startsWith("--")) script = arg;
  }
  if (!out) {
    out = join("/tmp", "mahoyo-journal", `${basename(script).replace(/\.ks$/i, "")}.json`);
  }
  return { script, assetsDir: resolve(assetsDir), out, maxSteps, speedFactor };
}

async function loadScenario(assetsDir: string, storage: string): Promise<ParsedScript | null> {
  const candidates = [storage, `${storage}.ks`, `${storage}.KS`].map((name) =>
    join(assetsDir, "scenario", name),
  );
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    return parse(lex(readFileSync(path, "utf-8")));
  }
  return null;
}

/** Exécute le script et renvoie les entrées de journal (exporté pour les tests). */
export async function captureJournal(
  scriptPath: string,
  assetsDir: string,
  options: { maxSteps?: number; speedFactor?: number } = {},
): Promise<{ entries: RuntimeJournalEntry[]; warnings: string[]; steps: number }> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const text = readFileSync(scriptPath, "utf-8");
  const script = parse(lex(annotateSource(text)));
  const lineMap = buildLineMap(script);
  const pageLines = script.pages.map((page) => page.instructions.map((ins) => lineMap.get(ins)?.line ?? null));

  const warnings: string[] = [];
  const runtime = new Runtime(script, basename(scriptPath));
  runtime.onWarning = (message: string) => {
    if (!message.includes("__line")) warnings.push(message);
  };
  runtime.scriptLoader = (storage: string) => loadScenario(assetsDir, storage);

  const entries: RuntimeJournalEntry[] = [];
  runtime.onJournal = (entry: RuntimeJournalEntry) => {
    // Ligne source (best effort) : page/instruction du runtime → table de lignes du script.
    const line = pageLines[entry.position.page]?.[entry.position.instruction] ?? null;
    entries.push({ ...entry, position: { ...entry.position, ...(line === null ? {} : { line }) } });
  };
  runtime.journalSpeedFactor = options.speedFactor ?? 1;

  let steps = 0;
  while (steps < maxSteps) {
    const step = runtime.step();
    steps++;
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

  return { entries, warnings: [...new Set(warnings)], steps };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const scriptPath = resolve(join(cli.assetsDir, "scenario", cli.script));
  if (!existsSync(scriptPath)) {
    throw new Error(`script introuvable : ${scriptPath}`);
  }
  const result = await captureJournal(scriptPath, cli.assetsDir, {
    maxSteps: cli.maxSteps,
    speedFactor: cli.speedFactor,
  });
  mkdirSync(dirname(cli.out), { recursive: true });
  writeFileSync(
    cli.out,
    JSON.stringify(
      {
        script: basename(cli.script),
        assetsDir: cli.assetsDir,
        generatedAt: new Date().toISOString(),
        speedFactor: cli.speedFactor,
        steps: result.steps,
        warnings: result.warnings,
        entries: result.entries,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(
    `[journal:capture] ${basename(cli.script)} : ${result.steps} steps, ${result.entries.length} événements journalisés, ${result.warnings.length} warning(s).`,
  );
  console.log(`Journal JSON : ${cli.out}`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
