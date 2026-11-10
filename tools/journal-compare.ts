/**
 * Compare deux journaux/captures d'exécution en les **alignant par événement** (#318).
 *
 * Usage :
 *   npm run journal:compare -- left.json right.json \
 *     [--out /tmp/mahoyo-journal/compare.json] [--md /tmp/mahoyo-journal/compare.md] \
 *     [--left-label port] [--right-label original] [--speed-factor 1]
 *
 * Les deux entrées peuvent être :
 * - un journal complet produit par `npm run journal:capture` ;
 * - une liste d'événements annotés (relevés vidéo) :
 *   `[{ "command": "trans", "occurrence": 1, "durationMs": 1200, "displacement": {"x":0,"y":0} }]`.
 *
 * Sortie : JSON (rapport structuré) + Markdown (table lisible). Aucun texte du jeu.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { compareEvents, eventsFromSource, renderComparisonMarkdown } from "./journal-compare-lib.js";

type Cli = {
  left: string;
  right: string;
  out: string;
  md: string | null;
  leftLabel: string;
  rightLabel: string;
  speedFactor: number;
};

function parseArgs(argv: string[]): Cli {
  let left = "";
  let right = "";
  let out = join("/tmp", "mahoyo-journal", "compare.json");
  let md: string | null = join("/tmp", "mahoyo-journal", "compare.md");
  let leftLabel = "gauche";
  let rightLabel = "droite";
  let speedFactor = 1;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--out") out = argv[++i] ?? out;
    else if (arg === "--md") md = argv[++i] ?? md;
    else if (arg === "--no-md") md = null;
    else if (arg === "--left-label") leftLabel = argv[++i] ?? leftLabel;
    else if (arg === "--right-label") rightLabel = argv[++i] ?? rightLabel;
    else if (arg === "--speed-factor") speedFactor = Number(argv[++i] ?? speedFactor) || 1;
    else if (!arg.startsWith("--")) {
      if (left === "") left = arg;
      else if (right === "") right = arg;
    }
  }
  if (left === "" || right === "") {
    throw new Error("usage : journal-compare <left.json> <right.json> [--out ...] [--md ...]");
  }
  return { left, right, out, md, leftLabel, rightLabel, speedFactor };
}

function readSource(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf-8"));
}

function main(): void {
  const cli = parseArgs(process.argv.slice(2));
  const left = eventsFromSource(readSource(cli.left));
  const right = eventsFromSource(readSource(cli.right), cli.speedFactor);
  const comparison = compareEvents(left, right);
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    left: { path: cli.left, label: cli.leftLabel, events: left.length },
    right: { path: cli.right, label: cli.rightLabel, events: right.length },
    comparison,
  };
  mkdirSync(dirname(cli.out), { recursive: true });
  writeFileSync(cli.out, JSON.stringify(report, null, 2), "utf-8");
  if (cli.md) {
    mkdirSync(dirname(cli.md), { recursive: true });
    writeFileSync(
      cli.md,
      renderComparisonMarkdown(comparison, {
        left: `${cli.leftLabel} (${cli.left})`,
        right: `${cli.rightLabel} (${cli.right})`,
        generatedAt,
        speedFactor: cli.speedFactor,
      }),
      "utf-8",
    );
  }
  const summary = comparison.summary;
  console.log(
    `[journal:compare] ${summary.matched} appariés, ${summary.leftOnly} gauche seule, ${summary.rightOnly} droite seule ; médiane |Δ durée effective| = ${summary.medianAbsEffectiveDurationDeltaMs ?? "—"} ms ; déplacement max = ${summary.maxDisplacementDelta ?? "—"} px.`,
  );
  console.log(`Rapport JSON : ${cli.out}`);
  if (cli.md) console.log(`Rapport Markdown : ${cli.md}`);
}

main();
