/**
 * Générateur de fixtures de Step[] pour les tests des agents.
 *
 * Ces fixtures sont produites par le vrai runtime KAG à partir de samples
 * représentatifs. Elles servent de référence pour implémenter StageRenderer,
 * AudioPlayer, UIManager et Player sans avoir besoin du moteur KAG complet.
 */
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { Step } from "@/kag/events.js";
import fs from "fs";
import path from "path";

const FIXTURES: { name: string; source: string }[] = [
  {
    name: "prologue",
    source: `
*page0|
@bg time=500 storage=black
@fg storage=青子 center=512 vcenter=288 index=1000
魔女の夜へようこそ。[l]
ここから物語が始まる。
@pg
`,
  },
  {
    name: "transition",
    source: `
*page0|
@bg page=back storage=sunset
@fg page=back storage=青子 center=512 vcenter=288 index=1000
@trans time=1200
夕焼けがきれいだ。
@pg
`,
  },
  {
    name: "audio",
    source: `
*page0|
@play storage=m01
@se storage=se01
@wait time=500
@fadebgm time=2000
@pg
`,
  },
];

function generateSteps(source: string): Step[] {
  const runtime = new Runtime(parse(lex(source)), "sample.ks");
  const steps: Step[] = [];
  while (true) {
    const step = runtime.step();
    steps.push(step as Step);
    if (step.stop.kind === "end") break;
  }
  return steps;
}

const outDir = path.resolve(process.cwd(), "tests/fixtures");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

for (const { name, source } of FIXTURES) {
  const steps = generateSteps(source);
  const filePath = path.join(outDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(steps, null, 2));
  console.log(`Generated ${filePath} (${steps.length} steps)`);
}
