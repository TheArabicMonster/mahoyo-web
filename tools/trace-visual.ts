/**
 * Trace visuelle headless d'un script KAG (issue #249).
 *
 * Rejoue un script `.ks` avec le vrai `Runtime` (sans navigateur) et journalise,
 * pour chaque commande visuelle :
 *   - son emplacement `script:ligne` (les lignes sont injectées dans le flux de
 *     tokens sous forme de `@__line`, commande no-op ignorée par le moteur) ;
 *   - la commande brute (attributs du script) ;
 *   - le storage déclaré → clé normalisée → URL résolue dans le manifeste ;
 *   - la page visée (fore/back) ;
 *   - les évènements émis par le moteur ;
 *   - l'état visible résultant des deux pages (fond, calques, position, zoom,
 *     rotation, crop `@partbg`) et, pour un partbg, la **zone source réellement
 *     visible** avec le modèle de rendu actuel comparée au rect déclaré.
 *
 * Entrées : un script parmi les assets locaux (non commités). Exemple :
 *
 *   npm run trace:visual -- 1-0.ks --md docs/PROLOGUE_TIMELINE.md
 *   npm run trace:visual -- 1-2.ks --out /tmp/trace-1-2.json
 *
 * Les assets sont cherchés dans `MAHOYO_ASSETS_DIR`, à défaut dans `public/assets`.
 * Les sorties par défaut sont écrites sous `/tmp/mahoyo-trace/` (jamais dans le
 * dépôt) : elles citent des noms d'assets du jeu, pas son texte.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { lex } from "../src/kag/lexer.js";
import { parse } from "../src/kag/parser.js";
import { Runtime, type PageState, type RuntimeTraceSample } from "../src/kag/runtime.js";
import { createAssetResolver } from "../src/core/asset-resolver.js";
import { storageKey } from "../src/core/storage-key.js";
import type { AssetManifest } from "../src/core/asset-manifest.js";
import type { Instruction, PageLayer, ParsedScript } from "../src/kag/types.js";
import type { RenderEvent, StopReason } from "../src/kag/events.js";

/** Corps d'un partbg, dupliqué du renderer pour être affiché sans DOM (documenté §4). */
type CropInfo = {
  width: number;
  height: number;
  srcLeft: number;
  srcTop: number;
  srcZoomX: number;
  srcZoomY: number;
  bgStorage?: string;
};

/** Dimensions natives d'une image (uniquement les PNG, format des assets installés). */
type ImageSize = { width: number; height: number };

type RawStorage = { raw: string | null; key: string | null; url: string | null };

type SampleTrace = {
  line: number | null;
  /** Page/instruction du runtime au moment de la commande (pages = séparées par @pg). */
  pos: { page: number; instruction: number };
  raw: string;
  command: string;
  /** Instruction réellement exécutée (nom de commande interne). */
  instr: string;
  storage: RawStorage;
  page: PageLayer | null;
  events: string[];
  /** État affiché (fore) après la commande. */
  fore: string;
  /** État préparé (back) après la commande. */
  back: string;
  /** Détail du crop partbg avec la zone source réellement visible. */
  crops: string[];
};

type StepTrace = {
  index: number;
  page: number;
  instruction: number;
  stop: StopReason["kind"];
  events: number;
  /** Nombre de caractères de texte saisis (jamais le texte lui-même). */
  textLength: number;
  fore: string;
};

type TraceReport = {
  script: string;
  assetsDir: string;
  generatedAt: string;
  steps: number;
  samples: SampleTrace[];
  warnings: string[];
  missingImages: string[];
};

type Cli = {
  script: string;
  assetsDir: string;
  out: string;
  md: string | null;
  maxSteps: number;
  verbose: boolean;
};

const DEFAULT_MAX_STEPS = 20_000;

function parseArgs(argv: string[]): Cli {
  let script = "1-0.ks";
  let assetsDir = process.env.MAHOYO_ASSETS_DIR ?? join(process.cwd(), "public", "assets");
  let out = "";
  let md: string | null = null;
  let maxSteps = DEFAULT_MAX_STEPS;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--assets") assetsDir = argv[++i] ?? assetsDir;
    else if (arg === "--out") out = argv[++i] ?? out;
    else if (arg === "--md") md = argv[++i] ?? md;
    else if (arg === "--max-steps") maxSteps = Number(argv[++i] ?? maxSteps) || maxSteps;
    else if (arg === "--verbose") verbose = true;
    else if (!arg.startsWith("--")) script = arg;
  }
  if (!out) out = join("/tmp", "mahoyo-trace", `${basename(script).replace(/\.ks$/i, "")}.json`);
  return { script, assetsDir: resolve(assetsDir), out, md, maxSteps, verbose };
}

/**
 * Insère une commande `@__line N` avant chaque ligne exécutable, pour retrouver
 * le numéro de ligne source depuis n'importe quelle instruction de la trace.
 * Lignes ignorées : vides, commentaires, labels, contenu des blocs `@iscript`
 * (TJS brut) et corps de `@macro` (dépliés plus tard hors du flux principal).
 */
export function annotateSource(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inScript = false;
  let macroDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    if (inScript) {
      out.push(line);
      if (trimmed.startsWith("@endscript")) inScript = false;
      continue;
    }
    if (trimmed.startsWith("@iscript")) {
      out.push(`@__line n=${i + 1}`);
      inScript = true;
      out.push(line);
      continue;
    }
    if (trimmed.startsWith("@macro")) macroDepth++;
    const skip =
      trimmed === "" ||
      trimmed.startsWith(";") ||
      trimmed.startsWith("*") ||
      macroDepth > 0;
    if (!skip) out.push(`@__line n=${i + 1}`);
    out.push(line);
    if (trimmed.startsWith("@endmacro") && macroDepth > 0) macroDepth--;
  }
  return out.join("\n");
}

/** Ligne source d'une instruction : `exact` = la commande commence sur cette ligne. */
export type LineInfo = { line: number; exact: boolean };

/** Associe chaque instruction (y compris dans les branches @if) à sa ligne source. */
export function buildLineMap(script: ParsedScript): WeakMap<Instruction, LineInfo> {
  const map = new WeakMap<Instruction, LineInfo>();
  const walk = (instructions: readonly Instruction[], inherited: number | null): void => {
    let line = inherited;
    let nextExact = false;
    for (const instruction of instructions) {
      if (instruction.kind === "raw" && instruction.command === "__line") {
        line = Number(instruction.args.n ?? "0") || null;
        nextExact = true;
        continue;
      }
      if (line !== null) map.set(instruction, { line, exact: nextExact });
      nextExact = false;
      if (instruction.kind === "conditional") {
        for (const branch of instruction.branches) walk(branch.instructions, line);
      }
    }
  };
  for (const page of script.pages) walk(page.instructions, null);
  return map;
}

/** Lit largeur/hauteur d'un PNG (IHDR) sans décoder l'image. */
export function readPngSize(path: string): ImageSize | null {
  try {
    const buf = readFileSync(path);
    if (buf.length < 24) return null;
    if (buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function loadManifest(assetsDir: string): AssetManifest | undefined {
  const path = join(assetsDir, "asset-manifest.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as AssetManifest;
}

function imageLocalPath(assetsDir: string, url: string | null): string | null {
  if (!url) return null;
  const rel = url.replace(/^\/?assets\//, "");
  return join(assetsDir, rel);
}

/** Page 1024×576 : résumé lisible du fond et des calques. */
export function formatPage(page: PageState): string {
  const bg = page.background ? `bg=${page.background}` : "bg=—";
  const pos =
    page.bgLeft !== undefined || page.bgTop !== undefined
      ? `@(${page.bgLeft ?? "?"},${page.bgTop ?? "?"})`
      : "@centre";
  const tr = [page.bgZoomX, page.bgZoomY, page.bgRotate].some((v) => v !== undefined)
    ? ` zoom=(${page.bgZoomX ?? 100},${page.bgZoomY ?? 100})% rot=${page.bgRotate ?? 0}°`
    : "";
  if (page.layers.length === 0) return `${bg}${pos}${tr} | calques: aucun`;
  const layers = [...page.layers]
    .sort((a, b) => a.index - b.index)
    .map((layer) => {
      const crop = layer.crop ? " [partbg]" : "";
      const opacity = layer.opacity === 1 ? "" : ` op=${round3(layer.opacity)}`;
      const z = ` z=${layer.index}`;
      return `${layer.id}«${layer.storage}»${crop}@(${layer.center},${layer.vcenter})${z}${opacity}`;
    });
  return `${bg}${pos}${tr} | calques(${page.layers.length}): ${layers.join(" ; ")}`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Zone source réellement visible dans le wrapper d'un partbg avec le modèle de
 * rendu actuel : `translate(-srcleft,-srctop) scale(srczoom/100)` autour du
 * centre de l'image (voir `PartBgPlugin` / doc §4). Sans dimension connue, on
 * retombe sur le rect déclaré (le modèle est alors identique à srczoom=100).
 */
export function visibleSourceRect(
  crop: CropInfo,
  size: ImageSize | null,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!size) return null;
  const W = size.width;
  const H = size.height;
  const sx = crop.srcZoomX / 100;
  const sy = crop.srcZoomY / 100;
  if (sx === 0 || sy === 0) return null;
  const visible = (p: number, c: number, t: number, s: number): number => c + (p - c - t) / s;
  const x0 = visible(0, W / 2, -crop.srcLeft, sx);
  const x1 = visible(crop.width, W / 2, -crop.srcLeft, sx);
  const y0 = visible(0, H / 2, -crop.srcTop, sy);
  const y1 = visible(crop.height, H / 2, -crop.srcTop, sy);
  return { x0: round2(x0), y0: round2(y0), x1: round2(x1), y1: round2(y1) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatCrop(layer: { storage: string; crop: CropInfo }, size: ImageSize | null): string {
  const c = layer.crop;
  const declared = `rect déclaré x[${c.srcLeft},${c.srcLeft + c.width}] y[${c.srcTop},${c.srcTop + c.height}]`;
  const zoom = ` srczoom=(${c.srcZoomX},${c.srcZoomY})%`;
  const bg = c.bgStorage ? ` bgstorage=${c.bgStorage}` : "";
  const visible = visibleSourceRect(c, size);
  if (!visible) return `«${layer.storage}» ${declared}${zoom}${bg} (dimensions inconnues)`;
  const dx = round2(visible.x0 - c.srcLeft);
  const dy = round2(visible.y0 - c.srcTop);
  const shift = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ? ` DÉCALAGE dx=${dx} dy=${dy}` : "";
  return (
    `«${layer.storage}» ${declared}${zoom}${bg} ; ` +
    `source visible x[${visible.x0},${visible.x1}] y[${visible.y0},${visible.y1}] ` +
    `(image ${size!.width}×${size!.height})${shift}`
  );
}

function summarizeEvents(events: readonly RenderEvent[]): string[] {
  return events.map((event) => {
    switch (event.kind) {
      case "scene":
        return `scene(${event.transition.method}${"time" in event.transition && event.transition.time ? ` ${event.transition.time}ms` : ""})`;
      case "animate":
        return `animate(${event.target}${event.def.loop ? " loop" : ""})`;
      case "text":
        return `text(${event.segments.length} seg)`;
      case "audio":
        return `audio(${event.event.kind}/${event.event.channel})`;
      case "textbox":
        return "textbox";
      default:
        return event.kind;
    }
  });
}

function countTextChars(events: readonly RenderEvent[]): number {
  let total = 0;
  for (const event of events) {
    if (event.kind !== "text") continue;
    for (const segment of event.segments) if ("text" in segment) total += segment.text.length;
  }
  return total;
}

function countVisualChars(events: readonly RenderEvent[]): number {
  return events.filter((event) => event.kind !== "text" && event.kind !== "audio").length;
}

function rawStorageOf(rawLine: string): string | null {
  const match = /(?:^|\s)storage=("[^"]*"|'[^']*'|[^\s\]]+)/.exec(rawLine);
  if (!match) return null;
  return (match[1] ?? "").replace(/^["']|["']$/g, "");
}

function commandNameOf(rawLine: string): string {
  const match = /^\s*@(\w+)/.exec(rawLine);
  return match ? `@${match[1]}` : rawLine.trim().slice(0, 40);
}

function summarizeInstruction(instruction: Instruction): string {
  if (instruction.kind === "raw") return `@${instruction.command}`;
  return instruction.kind;
}

async function loadScenario(assetsDir: string, storage: string): Promise<ParsedScript | null> {
  const candidates = [storage, `${storage}.ks`, `${storage}.KS`].map((name) => join(assetsDir, "scenario", name));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    return parse(lex(readFileSync(path, "utf-8")));
  }
  return null;
}

/** Rejoue un script et renvoie la trace complète. Exporté pour les tests. */
export async function runTrace(scriptPath: string, assetsDir: string, maxSteps = DEFAULT_MAX_STEPS): Promise<{
  report: TraceReport;
  steps: StepTrace[];
  rawLines: string[];
}> {
  const manifest = loadManifest(assetsDir);
  const resolver = createAssetResolver({ baseUrl: "/assets", manifest });
  const missingImages = new Set<string>();
  const imageSizeCache = new Map<string, ImageSize | null>();

  const imageSizeOf = (storage: string): ImageSize | null => {
    const key = storageKey(storage);
    if (imageSizeCache.has(key)) return imageSizeCache.get(key) ?? null;
    const path = imageLocalPath(assetsDir, resolver.image(storage));
    const size = path ? readPngSize(path) : null;
    if (!size) missingImages.add(key);
    imageSizeCache.set(key, size);
    return size;
  };

  const text = readFileSync(scriptPath, "utf-8");
  const annotated = annotateSource(text);
  const script = parse(lex(annotated));
  const lineMap = buildLineMap(script);
  const rawLines = text.split(/\r?\n/);

  const warnings: string[] = [];
  const runtime = new Runtime(script, basename(scriptPath));
  runtime.onWarning = (message: string) => {
    if (!message.includes("__line")) warnings.push(message);
  };
  runtime.scriptLoader = (storage: string) => loadScenario(assetsDir, storage);

  const samples: SampleTrace[] = [];
  runtime.onTrace = (sample: RuntimeTraceSample) => {
    // Les commandes d'annotation ne font pas partie de la trace : ce sont des marqueurs de ligne.
    if (sample.instruction.kind === "raw" && sample.instruction.command === "__line") return;
    const info = lineMap.get(sample.instruction) ?? null;
    const line = info?.line ?? null;
    const rawLine = line !== null ? (rawLines[line - 1] ?? "") : "";
    const exact = info?.exact === true;
    const raw = exact ? rawStorageOf(rawLine) : null;
    const key = raw !== null ? storageKey(raw) : null;
    // Les commandes audio n'ont pas de storage image : ne pas les compter comme images manquantes.
    const kind = sample.instruction.kind;
    const audioKind = kind === "se" || kind === "play" || kind === "playstop" || kind === "playpause" ||
      kind === "playresume" || kind === "fadebgm" || kind === "seact" || kind === "sestop" || kind === "fadese";
    const url = raw === null ? null : audioKind ? resolver.se(raw) : resolver.image(raw);
    const crops: string[] = [];
    for (const layer of [...sample.fore.layers, ...sample.back.layers]) {
      if (!layer.crop) continue;
      const label = sample.fore.layers.includes(layer) ? "fore" : "back";
      crops.push(`${label}: ${formatCrop({ storage: layer.storage, crop: layer.crop as CropInfo }, imageSizeOf(layer.storage))}`);
    }
    samples.push({
      line,
      pos: { page: sample.position.page, instruction: sample.position.instruction },
      raw: exact ? rawLine.trim() : summarizeInstruction(sample.instruction),
      command: exact ? commandNameOf(rawLine) : summarizeInstruction(sample.instruction),
      instr: summarizeInstruction(sample.instruction),
      storage: { raw, key, url },
      page: sample.page,
      events: summarizeEvents(sample.events),
      fore: formatPage(sample.fore),
      back: formatPage(sample.back),
      crops,
    });
  };

  const steps: StepTrace[] = [];
  let stepCount = 0;
  while (stepCount < maxSteps) {
    const step = runtime.step();
    stepCount++;
    const pages = runtime.debugPages();
    steps.push({
      index: stepCount,
      page: step.position.page,
      instruction: step.position.instruction,
      stop: step.stop.kind,
      events: countVisualChars(step.events),
      textLength: countTextChars(step.events),
      fore: formatPage(pages.fore),
    });
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
    // click / wait / waitFor / timeline : la trace avance comme un joueur qui clique.
  }

  return {
    report: {
      script: basename(scriptPath),
      assetsDir,
      generatedAt: new Date().toISOString(),
      steps: stepCount,
      samples,
      warnings: [...new Set(warnings)],
      missingImages: [...missingImages],
    },
    steps,
    rawLines,
  };
}

function formatMarkdown(script: string, samples: SampleTrace[]): string {
  const lines: string[] = [];
  lines.push(`# Timeline visuelle — \`${script}\``);
  lines.push("");
  lines.push(
    "Générée par `npm run trace:visual -- " +
      `${script} --md <fichier>\`. Aucun texte du jeu n'est reproduit : ` +
      "seuls les noms de commandes, d'assets et les états de rendu (positions, zoom, crop) figurent ici.",
  );
  lines.push("");
  lines.push("Colonnes : ligne source, commande, storage déclaré (clé normalisée), page visée, puis état visible.");
  lines.push("");
  let currentPage = -1;
  // Seules les commandes qui touchent une page (fond/calques/transitions) composent la timeline
  // visuelle : audio, texte et évènements système n'y figurent pas.
  const visual = samples.filter((sample) => sample.page !== null);
  for (const sample of visual) {
    const pageIndex = sample.pos.page;
    if (pageIndex !== currentPage) {
      currentPage = pageIndex;
      lines.push("");
      lines.push(`## Page ${pageIndex}`);
      lines.push("");
      lines.push("| ligne | commande | storage | page | état visible après |");
      lines.push("|---|---|---|---|---|");
    }
    const storage = sample.storage.raw
      ? `\`${sample.storage.raw}\`${sample.storage.key && sample.storage.key !== sample.storage.raw ? ` → \`${sample.storage.key}\`` : ""}`
      : "—";
    const revealed = sample.events.includes("scene") || sample.command === "@trans";
    const state = revealed ? `affiche fore : ${sample.fore}` : `prépare ${sample.page} : ${sample.back}`;
    const crops = sample.crops.length > 0 ? `<br>${sample.crops.join("<br>")}` : "";
    // Les `|` des états de page casseraient les cellules du tableau markdown.
    const cell = (text: string): string => text.replace(/\|/g, "\\|");
    lines.push(
      `| ${sample.line ?? "?"} | \`${sample.command}\` | ${cell(storage)} | ${sample.page ?? "—"} | ${cell(state)}${cell(crops)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}


function formatConsole(
  script: string,
  samples: SampleTrace[],
  steps: StepTrace[],
  warnings: string[],
  missing: string[],
  verbose: boolean,
): string {
  const out: string[] = [];
  out.push(`# ${script} — ${steps.length} steps, ${samples.length} commandes visuelles`);
  if (warnings.length > 0) out.push(`Warnings (${warnings.length}): ${warnings.slice(0, 10).join(" | ")}`);
  if (missing.length > 0) out.push(`Images absentes (${missing.length}): ${missing.slice(0, 10).join(", ")}`);
  if (!verbose) return out.join("\n");
  for (const sample of samples) {
    out.push("");
    out.push(`### ${sample.line ?? "?"}: ${sample.raw}`);
    out.push(`  commande   : ${sample.command}`);
    out.push(
      `  storage    : ${sample.storage.raw ?? "—"} → ${sample.storage.key ?? "—"} → ${sample.storage.url ?? "—"}`,
    );
    out.push(`  page       : ${sample.page ?? "—"}`);
    out.push(`  évènements : ${sample.events.length > 0 ? sample.events.join(", ") : "aucun"}`);
    out.push(`  fore       : ${sample.fore}`);
    out.push(`  back       : ${sample.back}`);
    for (const crop of sample.crops) out.push(`  crop       : ${crop}`);
  }
  return out.join("\n");
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const scriptPath = join(cli.assetsDir, "scenario", basename(cli.script));
  if (!existsSync(scriptPath)) {
    console.error(`Script introuvable : ${scriptPath}`);
    console.error(`Assets cherchés dans : ${cli.assetsDir} (MAHOYO_ASSETS_DIR ou public/assets)`);
    process.exit(1);
  }
  const { report, steps } = await runTrace(scriptPath, cli.assetsDir, cli.maxSteps);
  mkdirSync(dirname(cli.out), { recursive: true });
  writeFileSync(cli.out, JSON.stringify({ ...report, stepDetails: steps }, null, 2));
  if (cli.md) {
    mkdirSync(dirname(cli.md), { recursive: true });
    writeFileSync(cli.md, formatMarkdown(report.script, report.samples));
  }
  console.log(
    formatConsole(report.script, report.samples, steps, report.warnings, report.missingImages, cli.verbose),
  );
  console.log(`\nTrace JSON : ${cli.out}`);
  if (cli.md) console.log(`Timeline   : ${cli.md}`);
  if (report.missingImages.length > 0) {
    console.error(`Assets manquants : ${report.missingImages.length} (voir la trace)`);
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
