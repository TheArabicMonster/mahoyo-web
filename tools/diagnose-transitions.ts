/**
 * Diagnostic des transitions (`@trans`/`@bg`/`@bgact`/`@image`) — issue #316.
 *
 * Rejoue un ou plusieurs scripts `.ks` avec le vrai `Runtime` (headless) et produit un rapport
 * JSON + Markdown **sans aucun texte du jeu** :
 *   - chaque `@trans` : ligne, `time`/`rule`/`nowait`, transition résolue, durée déclarée ;
 *   - chaque changement de scène **immédiat** (`method:"none"`) : commande source, ligne ;
 *   - les **fondus interrompus** : `@trans nowait=1` suivi, dans le même pas d'exécution, d'un
 *     changement de scène immédiat — le renderer termine alors la transition en cours et la scène
 *     est un cut (`finishTransition` dans `startTransition`, `stage-renderer.ts`) ;
 *   - la vérification que la durée transmise au renderer est bien `time` (pas de facteur caché).
 *
 * Aucun correctif ici : outil de diagnostic (#316), cf. `docs/DIAGNOSTIC_TRANSITIONS.md`.
 *
 * Usage :
 *   npm run diag:transitions -- 1-0.ks 1-1.ks 4-3.ks --out /tmp/transitions.json --md /tmp/transitions.md
 * Assets : `MAHOYO_ASSETS_DIR`, à défaut `public/assets` (non commités).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { lex } from "../src/kag/lexer.js";
import { parse } from "../src/kag/parser.js";
import { Runtime } from "../src/kag/runtime.js";
import type { Instruction, PageLayer, ParsedScript } from "../src/kag/types.js";
import type { RenderEvent, TransitionSpec } from "../src/kag/events.js";
import { annotateSource, buildLineMap } from "./trace-visual.js";

const DEFAULT_MAX_STEPS = 20_000;

type Cli = {
  scripts: string[];
  assetsDir: string;
  out: string;
  md: string | null;
  maxSteps: number;
};

type TransitionRecord = {
  step: number;
  line: number | null;
  occurrence: number;
  page: PageLayer | null;
  time: number;
  rule: string | null;
  nowait: boolean;
  method: TransitionSpec["method"];
  durationMs: number;
  /** Un changement de scène immédiat suit dans le même pas (fondu interrompu). */
  cutBy: string | null;
};

type CutRecord = {
  step: number;
  line: number | null;
  command: string;
  parameters: Record<string, unknown>;
};

type ScriptDiagnosis = {
  script: string;
  steps: number;
  transitions: TransitionRecord[];
  cuts: CutRecord[];
  warnings: string[];
};

function parseArgs(argv: string[]): Cli {
  const scripts: string[] = [];
  let assetsDir = process.env.MAHOYO_ASSETS_DIR ?? join(process.cwd(), "public", "assets");
  let out = "";
  let md: string | null = "";
  let maxSteps = DEFAULT_MAX_STEPS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--assets") assetsDir = argv[++i] ?? assetsDir;
    else if (arg === "--out") out = argv[++i] ?? out;
    else if (arg === "--md") md = argv[++i] ?? md;
    else if (arg === "--no-md") md = null;
    else if (arg === "--max-steps") maxSteps = Number(argv[++i] ?? maxSteps) || maxSteps;
    else if (!arg.startsWith("--")) scripts.push(arg);
  }
  if (scripts.length === 0) scripts.push("1-0.ks");
  if (!out) out = join("/tmp", "mahoyo-diag", "transitions.json");
  if (md === "") md = join(dirname(out), "transitions.md");
  return { scripts, assetsDir: resolve(assetsDir), out, md, maxSteps };
}

async function loadScenario(assetsDir: string, storage: string): Promise<ParsedScript | null> {
  for (const name of [storage, `${storage}.ks`, `${storage}.KS`]) {
    const path = join(assetsDir, "scenario", name);
    if (!existsSync(path)) continue;
    return parse(lex(readFileSync(path, "utf-8")));
  }
  return null;
}

/** Enregistrement minimal d'un `onTrace` (aucun clone de texte). */
export type TraceRecord = {
  step: number;
  line: number | null;
  kind: string;
  parameters: Record<string, unknown>;
  /** Transition résolue si la commande émet une scène. */
  transition: TransitionSpec | null;
  /** Événements émis, réduits à leur type. */
  eventKinds: string[];
};

function sceneTransition(events: readonly RenderEvent[]): TransitionSpec | null {
  const scene = events.find((event) => event.kind === "scene") as { transition?: TransitionSpec } | undefined;
  return scene?.transition ?? null;
}

function scalarParams(instruction: Instruction): Record<string, unknown> {
  const record = instruction as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "kind" || key === "keyframes" || key === "def" || key === "crop") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

/**
 * Analyse pure d'une trace : transitions, cuts immédiats et fondus interrompus par un
 * changement de scène immédiat dans le même pas (cas `@trans nowait=1` + `@bgact page=fore`).
 */
export function analyzeTrace(records: readonly TraceRecord[]): {
  transitions: TransitionRecord[];
  cuts: CutRecord[];
} {
  const transitions: TransitionRecord[] = [];
  const cuts: CutRecord[] = [];
  const occurrences = new Map<string, number>();
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const occurrence = (occurrences.get(record.kind) ?? 0) + 1;
    occurrences.set(record.kind, occurrence);
    if (record.kind === "trans") {
      const time = typeof record.parameters.time === "number" ? record.parameters.time : 0;
      const rule = typeof record.parameters.rule === "string" ? record.parameters.rule : null;
      const nowait = record.parameters.nowait === true;
      // Un changement de scène immédiat plus loin dans le MÊME pas interrompt le fondu.
      let cutBy: string | null = null;
      if (nowait && record.transition && record.transition.method !== "none") {
        for (let j = i + 1; j < records.length && records[j]!.step === record.step; j++) {
          const next = records[j]!;
          if (next.transition?.method === "none") {
            cutBy = next.kind;
            break;
          }
        }
      }
      transitions.push({
        step: record.step,
        line: record.line,
        occurrence,
        page: null,
        time,
        rule,
        nowait,
        method: record.transition?.method ?? "none",
        durationMs: record.transition && "time" in record.transition ? record.transition.time : time,
        cutBy,
      });
    } else if (record.transition?.method === "none") {
      cuts.push({
        step: record.step,
        line: record.line,
        command: record.kind,
        parameters: record.parameters,
      });
    }
  }
  return { transitions, cuts };
}

/** Rejoue un script et renvoie le diagnostic des transitions. */
export async function diagnoseScript(
  scriptPath: string,
  assetsDir: string,
  maxSteps = DEFAULT_MAX_STEPS,
): Promise<ScriptDiagnosis> {
  const text = readFileSync(scriptPath, "utf-8");
  const script = parse(lex(annotateSource(text)));
  const lineMap = buildLineMap(script);
  const warnings: string[] = [];
  const runtime = new Runtime(script, basename(scriptPath));
  runtime.onWarning = (message: string) => {
    if (!message.includes("__line")) warnings.push(message);
  };
  runtime.scriptLoader = (storage: string) => loadScenario(assetsDir, storage);

  const records: TraceRecord[] = [];
  let step = 0;
  runtime.onTrace = (sample) => {
    records.push({
      step,
      line: lineMap.get(sample.instruction)?.line ?? null,
      kind: sample.instruction.kind,
      parameters: scalarParams(sample.instruction),
      transition: sceneTransition(sample.events),
      eventKinds: sample.events.map((event) => event.kind),
    });
  };

  while (step < maxSteps) {
    const result = runtime.step();
    step++;
    if (result.stop.kind === "end") break;
    if (result.stop.kind === "loadScript") {
      const ok = await runtime.loadScript(result.stop.file, result.stop.label, result.stop.pushCallStack ?? true);
      if (!ok) break;
      continue;
    }
    if (result.stop.kind === "choice") {
      const option = result.stop.options[0];
      if (!option || !runtime.jump(option.target)) break;
      continue;
    }
  }

  const { transitions, cuts } = analyzeTrace(records);
  return { script: basename(scriptPath), steps: step, transitions, cuts, warnings: [...new Set(warnings)] };
}

function formatMarkdown(diagnoses: readonly ScriptDiagnosis[], assetsDir: string, generatedAt: string): string {
  const lines: string[] = [];
  const totalTrans = diagnoses.reduce((sum, diagnosis) => sum + diagnosis.transitions.length, 0);
  const totalCuts = diagnoses.reduce((sum, diagnosis) => sum + diagnosis.cuts.length, 0);
  const interrupted = diagnoses.flatMap((diagnosis) => diagnosis.transitions.filter((transition) => transition.cutBy));
  lines.push("# Diagnostic des transitions (#316)");
  lines.push("");
  lines.push(`- Assets : \`${assetsDir}\` (non commités)`);
  lines.push(`- Généré : ${generatedAt}`);
  lines.push(`- Scripts : ${diagnoses.map((diagnosis) => `\`${diagnosis.script}\``).join(", ")}`);
  lines.push(`- **${totalTrans} transitions**, **${totalCuts} changements de scène immédiats**, **${interrupted.length} fondus interrompus** par un cut dans le même pas.`);
  lines.push("");
  lines.push("## Transitions");
  lines.push("");
  lines.push("| Script | n° | Ligne | time (ms) | rule | nowait | méthode résolue | durée (ms) | interrompu par |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const diagnosis of diagnoses) {
    for (const transition of diagnosis.transitions) {
      lines.push(
        `| \`${diagnosis.script}\` | ${transition.occurrence} | ${transition.line ?? "—"} | ${transition.time} | ${transition.rule ?? "crossfade (défaut)"} | ${transition.nowait ? "oui" : "non"} | ${transition.method} | ${transition.durationMs} | ${transition.cutBy ?? "—"} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Changements de scène immédiats (cuts)");
  lines.push("");
  lines.push("| Script | Ligne | Commande | Paramètres |");
  lines.push("|---|---|---|---|");
  for (const diagnosis of diagnoses) {
    for (const cut of diagnosis.cuts.slice(0, 200)) {
      lines.push(`| \`${diagnosis.script}\` | ${cut.line ?? "—"} | \`@${cut.command}\` | \`${JSON.stringify(cut.parameters)}\` |`);
    }
  }
  lines.push("");
  lines.push("> Aucun texte du jeu n'est reproduit : seuls commandes, lignes et durées figurent ici.");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const diagnoses: ScriptDiagnosis[] = [];
  for (const script of cli.scripts) {
    const scriptPath = resolve(join(cli.assetsDir, "scenario", script));
    if (!existsSync(scriptPath)) {
      console.error(`[diag:transitions] script introuvable : ${scriptPath}`);
      continue;
    }
    const diagnosis = await diagnoseScript(scriptPath, cli.assetsDir, cli.maxSteps);
    diagnoses.push(diagnosis);
    const interrupted = diagnosis.transitions.filter((transition) => transition.cutBy).length;
    console.log(
      `[diag:transitions] ${script} : ${diagnosis.steps} steps, ${diagnosis.transitions.length} transitions, ${diagnosis.cuts.length} cuts, ${interrupted} fondus interrompus.`,
    );
  }
  const generatedAt = new Date().toISOString();
  mkdirSync(dirname(cli.out), { recursive: true });
  writeFileSync(
    cli.out,
    JSON.stringify({ generatedAt, assetsDir: cli.assetsDir, diagnoses }, null, 2),
    "utf-8",
  );
  if (cli.md) {
    mkdirSync(dirname(cli.md), { recursive: true });
    writeFileSync(cli.md, formatMarkdown(diagnoses, cli.assetsDir, generatedAt), "utf-8");
  }
  const totalTrans = diagnoses.reduce((sum, diagnosis) => sum + diagnosis.transitions.length, 0);
  const totalCuts = diagnoses.reduce((sum, diagnosis) => sum + diagnosis.cuts.length, 0);
  const interrupted = diagnoses.flatMap((diagnosis) => diagnosis.transitions.filter((transition) => transition.cutBy)).length;
  console.log(`[diag:transitions] total : ${totalTrans} transitions, ${totalCuts} cuts, ${interrupted} fondus interrompus.`);
  console.log(`Rapport JSON : ${cli.out}`);
  if (cli.md) console.log(`Rapport Markdown : ${cli.md}`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
