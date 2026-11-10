/**
 * Mesure du débordement du texte sur le corpus KAG (#319) — CLI headless.
 *
 * Pour chaque page de texte du corpus (runtime KAG headless), mesure dans Chromium (et Firefox en
 * option) la hauteur rendue vs la zone de texte du cadre image, avec les polices du port, puis
 * produit un rapport JSON + Markdown (aucun texte du jeu : noms de scripts, positions, métriques).
 *
 * Deux configurations sont mesurées côte à côte :
 * - **config actuelle** : `FRAME_TEXT_AREA` du port (marge gauche 14 %) et police nominale
 *   `FRAME_TEXT_REM` (1,7 rem = 34 px écran) ;
 * - **config proposée** : marge gauche issue de la mesure vidéo de l'original (114/1708 ≈ 6,67 %)
 *   et police nominale recommandée par le ratio de glyphe du propriétaire (18,5/22 → ~1,43 rem),
 *   plus conversion ×0,8 des `@font size=` si on suppose le repère 1280 (hypothèse mesurée).
 *
 * Ce script **ne modifie pas le runtime de rendu** : il fournit les mesures et la formule pour
 * #314. Mode placeholders (aucun asset du jeu) : rapport partiel + avertissement explicite.
 *
 * Usage :
 *   npm run text:overflow                          # assets locaux si dispo, sinon placeholders
 *   npm run text:overflow -- --placeholders        # force les placeholders (CI)
 *   npm run text:overflow -- --browsers chromium,firefox --max-pages 500
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { chromium, firefox, type BrowserType } from "playwright";
import { listCorpus } from "./audit-lib.js";
import { generateFullReadCorpus } from "../tests/e2e/placeholders.js";
import { FRAME_TEXT_AREA, FRAME_TEXT_LINE_HEIGHT } from "../src/renderer/text-fit.js";
import {
  GAME_TEXT_FONT_STACK,
  LAYOUT_LOGICAL,
  LAYOUT_PROVENANCE,
  NOMINAL_STAGE_PX,
  STAGE_SCALE,
  STAGE_SIZE,
  buildMarkdownReport,
  classifyMeasurement,
  compareFontSize,
  currentLeftMarginScreenPx,
  extractTextPages,
  originalLeftMarginScreenPx,
  pageMeta,
  stageToScreenPx,
  summarizeVerdicts,
  textAreaHeightStagePx,
  type BrowserOverflowReport,
  type NominalSceneAnalysis,
  type GlyphProbe,
  type LayoutValidation,
  type PageVerdict,
  type TextOverflowReport,
  type TextPage,
} from "./text-overflow-lib.js";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_REPORT_JSON = join(ROOT, "reports", "text-overflow.json");
const DEFAULT_REPORT_MD = join(ROOT, "reports", "text-overflow.md");

/** Marge gauche de l'original d'après la mesure vidéo de #319 : 114 px sur 1708 px. */
const REFERENCE_LEFT_MARGIN = { left: 114, width: 1708 };

/** Écart d'encre (x-height/capitale) mesuré par le propriétaire (#314) : port 22 px vs original 18,5 px. */
const INK_RATIO = 22 / 18.5;

/** Config actuelle du port : dérivée des fractions et du rem actuels, exprimée en px logiques. */
const CURRENT_LAYOUT = {
  leftLogicalPx: FRAME_TEXT_AREA.left * STAGE_SIZE.width,
  rightLogicalPx: FRAME_TEXT_AREA.right * STAGE_SIZE.width,
  topLogicalPx: FRAME_TEXT_AREA.top * STAGE_SIZE.height,
  fontLogicalPx: NOMINAL_STAGE_PX,
  lineHeightLogicalPx: NOMINAL_STAGE_PX * FRAME_TEXT_LINE_HEIGHT,
};

/** Config logique proposée (arbitrage Opus 5.5) : marges 69 px, police 26 px, interligne 40,8 px. */
const PROPOSED_LAYOUT = {
  leftLogicalPx: LAYOUT_LOGICAL.horizontalMarginPx,
  rightLogicalPx: LAYOUT_LOGICAL.horizontalMarginPx,
  topLogicalPx: LAYOUT_LOGICAL.verticalMarginPx,
  fontLogicalPx: LAYOUT_LOGICAL.fontPx,
  lineHeightLogicalPx: LAYOUT_LOGICAL.lineHeightPx,
};

const CHARS = ["M", "x", "あ"];

type Cli = {
  placeholders: boolean;
  browsers: string[];
  maxPages: number;
  maxScripts: number;
  assetsDir: string | null;
  jsonPath: string;
  mdPath: string;
  snapshotPath: string | null;
};

function parseArgs(argv: readonly string[]): Cli {
  const cli: Cli = {
    placeholders: false,
    browsers: ["chromium"],
    maxPages: 4000,
    maxScripts: 300,
    assetsDir: process.env.MAHOYO_ASSETS_DIR?.trim() || null,
    jsonPath: DEFAULT_REPORT_JSON,
    mdPath: DEFAULT_REPORT_MD,
    snapshotPath: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--placeholders") cli.placeholders = true;
    else if (arg === "--browsers") cli.browsers = (argv[++i] ?? "chromium").split(",").map((b) => b.trim()).filter(Boolean);
    else if (arg === "--max-pages") cli.maxPages = Number.parseInt(argv[++i] ?? "", 10) || cli.maxPages;
    else if (arg === "--max-scripts") cli.maxScripts = Number.parseInt(argv[++i] ?? "", 10) || cli.maxScripts;
    else if (arg === "--assets") cli.assetsDir = resolve(argv[++i] ?? "");
    else if (arg === "--json") cli.jsonPath = resolve(argv[++i] ?? cli.jsonPath);
    else if (arg === "--md") cli.mdPath = resolve(argv[++i] ?? cli.mdPath);
    else if (arg === "--snapshot") cli.snapshotPath = resolve(argv[++i] ?? "");
    else if (arg === "--help") {
      console.log("Usage : npm run text:overflow -- [--placeholders] [--browsers chromium,firefox] [--max-pages N] [--max-scripts N] [--assets <dir>] [--json <f>] [--md <f>] [--snapshot <f>]");
      process.exit(0);
    } else console.warn(`[text-overflow] argument ignoré : ${arg}`);
  }
  return cli;
}

/** Dossier d'assets : MAHOYO_ASSETS_DIR/--assets, sinon public/assets, sinon null (placeholders). */
function resolveAssetsDir(cli: Cli): string | null {
  if (cli.placeholders) return null;
  const candidates = [cli.assetsDir, join(ROOT, "public", "assets")].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    if (existsSync(join(dir, "asset-manifest.json"))) return dir;
  }
  return null;
}

/** Corpus de placeholders généré dans un dossier temporaire (aucun asset du jeu). */
function placeholderScenarioDir(): { dir: string; warning: string } {
  const publicDir = join(tmpdir(), "mahoyo-text-overflow-assets");
  generateFullReadCorpus(publicDir, 221);
  return {
    dir: join(publicDir, "assets", "scenario"),
    warning:
      "Mode placeholders : corpus synthétique (pages courtes, aucun asset ni texte du jeu). Rapport PARTIEL : " +
      "il ne prouve rien sur les pages du vrai corpus ; relancer avec MAHOYO_ASSETS_DIR en local.",
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** HTML de mesure d'une page : runs et tailles de script, converties ou non (hypothèse ×0,8). */
function pageHtml(page: TextPage, convertScriptSizes: boolean): string {
  return page.runs
    .map((run) => {
      const text = escapeHtml(run.text);
      if (run.scriptSize === undefined) return text;
      const cssPx = convertScriptSizes ? run.scriptSize * (STAGE_SIZE.width / 1280) : run.scriptSize;
      return `<span style="font-size:${cssPx}px">${text}</span>`;
    })
    .join("");
}

type Config = {
  id: "current" | "proposed";
  leftLogicalPx: number;
  rightLogicalPx: number;
  topLogicalPx: number;
  fontLogicalPx: number;
  lineHeightLogicalPx: number;
  convertScriptSizes: boolean;
  label: string;
};

const CONFIGS: Config[] = [
  {
    id: "current",
    ...CURRENT_LAYOUT,
    convertScriptSizes: false,
    label: "config actuelle du port (marge 14 %, police 1,7 rem)",
  },
  {
    id: "proposed",
    ...PROPOSED_LAYOUT,
    convertScriptSizes: false,
    label: "config logique proposée (marge 69 px, police 26 px)",
  },
];

/** Page de mesure autonome : stage 1024×576 agrandi ×1,25, marges logiques en px. */
function measureDocument(): string {
  const config = CONFIGS[0]!;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: #000; }
    #stage { position: relative; width: ${STAGE_SIZE.width}px; height: ${STAGE_SIZE.height}px;
             transform: scale(${STAGE_SCALE}); transform-origin: 0 0; }
    #text { position: absolute; left: ${config.leftLogicalPx}px; right: ${config.rightLogicalPx}px; top: ${config.topLogicalPx}px;
            font-family: ${GAME_TEXT_FONT_STACK}; font-size: ${config.fontLogicalPx}px;
            line-height: ${config.lineHeightLogicalPx}px; letter-spacing: 0.06em; white-space: pre-wrap; color: #fff; }
  </style></head><body><div id="stage"><div id="text"></div></div></body></html>`;
}

type ProbeResult = { label: string; char: string; cssSize: number; ascent: number; descent: number; width: number };
type PitchResult = { label: string; cssSize: number; pitch: number };

type BrowserMeasurement = {
  /** Hauteur mesurée par page et par config (px du stage), + débordement horizontal. */
  pages: { height: number[]; widthOverflow: boolean[] }[];
  probes: ProbeResult[];
  /** Pas des glyphes (largeur moyenne de あ répété / 10) par taille mesurée. */
  pitches: PitchResult[];
  fontFamily: string;
  notoLoaded: boolean;
};

/** Mesure toutes les pages dans un navigateur ; null si le navigateur n'est pas installé. */
async function measureInBrowser(
  browserType: BrowserType,
  browserName: string,
  pages: readonly TextPage[],
  probeSizes: readonly { label: string; cssPx: number }[],
): Promise<BrowserMeasurement | null> {
  let browser: Awaited<ReturnType<BrowserType["launch"]>> | null = null;
  try {
    browser = await browserType.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.setContent(measureDocument(), { waitUntil: "load" });
    await page.evaluate(`Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))])`);

    const payload = {
      fontStack: GAME_TEXT_FONT_STACK,
      configs: CONFIGS.map((c) => ({
        id: c.id,
        left: c.leftLogicalPx,
        right: c.rightLogicalPx,
        top: c.topLogicalPx,
        font: c.fontLogicalPx,
        lineHeight: c.lineHeightLogicalPx,
      })),
      pages: pages.map((p) => ({ current: pageHtml(p, false), proposed: pageHtml(p, true) })),
      probes: probeSizes.flatMap((probe) => CHARS.map((char) => ({ label: probe.label, char, cssSize: probe.cssPx }))),
      pitchSizes: probeSizes.map((probe) => ({ label: probe.label, cssSize: probe.cssPx })),
    };
    const result = (await page.evaluate(`(() => {
      const payload = ${JSON.stringify(payload)};
      const text = document.getElementById("text");
      const out = { configs: [], probes: [], pitches: [], fontFamily: "", notoLoaded: false };
      const pairs = payload.configs.map((c) => [c, Object.fromEntries(payload.pages.map((p, i) => [i, p[c.id]]))]);
      for (const [config, htmlById] of pairs) {
        text.style.left = config.left + "px";
        text.style.right = config.right + "px";
        text.style.top = config.top + "px";
        text.style.fontSize = config.font + "px";
        text.style.lineHeight = config.lineHeight + "px";
        const heights = [];
        const widthOverflow = [];
        for (let i = 0; i < payload.pages.length; i++) {
          text.innerHTML = htmlById[i];
          heights.push(text.scrollHeight);
          widthOverflow.push(text.scrollWidth > text.clientWidth + 0.5);
        }
        out.configs.push({ id: config.id, heights, widthOverflow });
      }
      out.fontFamily = getComputedStyle(text).fontFamily;
      out.notoLoaded = document.fonts.check('16px "Noto Serif JP"');
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      for (const probe of payload.probes) {
        ctx.font = "400 " + probe.cssSize + "px " + payload.fontStack;
        const m = ctx.measureText(probe.char);
        out.probes.push({ label: probe.label, char: probe.char, cssSize: probe.cssSize, ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent, width: m.width });
      }
      for (const size of payload.pitchSizes) {
        ctx.font = "400 " + size.cssSize + "px " + payload.fontStack;
        const m = ctx.measureText("ああああああああああ");
        out.pitches.push({ label: size.label, cssSize: size.cssSize, pitch: m.width / 10 });
      }
      return out;
    })()`)) as {
      configs: { id: string; heights: number[]; widthOverflow: boolean[] }[];
      probes: BrowserMeasurement["probes"];
      pitches: PitchResult[];
      fontFamily: string;
      notoLoaded: boolean;
    };

    const pagesOut = pages.map((_, index) => {
      const current = result.configs.find((c) => c.id === "current")!;
      const proposed = result.configs.find((c) => c.id === "proposed")!;
      return {
        height: [current.heights[index]!, proposed.heights[index]!],
        widthOverflow: [current.widthOverflow[index]!, proposed.widthOverflow[index]!],
      };
    });
    console.log(`[text-overflow] ${browserName} : ${pages.length} pages mesurées (police résolue : ${result.fontFamily})`);
    return {
      pages: pagesOut,
      probes: result.probes,
      pitches: result.pitches,
      fontFamily: result.fontFamily,
      notoLoaded: result.notoLoaded,
    };
  } catch (err) {
    console.warn(`[text-overflow] ${browserName} indisponible : ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function verdictsFor(measurement: BrowserMeasurement, pages: readonly TextPage[], configIndex: 0 | 1): PageVerdict[] {
  const config = CONFIGS[configIndex]!;
  const areaHeightPx = STAGE_SIZE.height - 2 * config.topLogicalPx;
  return pages.map((page, index) =>
    classifyMeasurement(page, {
      nominalHeightPx: measurement.pages[index]!.height[configIndex]!,
      areaHeightPx,
      widthOverflow: measurement.pages[index]!.widthOverflow[configIndex]!,
    }),
  );
}

/** Mesures de validation de la mise en page logique proposée (pas des glyphes, caractères/ligne, symétrie). */
function computeValidation(measurement: BrowserMeasurement, verdictsCurrent: readonly PageVerdict[], verdictsProposed: readonly PageVerdict[]): LayoutValidation {
  const proposedPitch = measurement.pitches.find((p) => p.label === "nominal-propose");
  const expectedStagePx = LAYOUT_LOGICAL.fontPx;
  const measuredStagePx = proposedPitch?.pitch ?? 0;
  const tolerance = 0.02;
  const ratio = expectedStagePx > 0 ? measuredStagePx / expectedStagePx : 0;
  const widthCurrent = STAGE_SIZE.width - CURRENT_LAYOUT.leftLogicalPx - CURRENT_LAYOUT.rightLogicalPx;
  const widthProposed = STAGE_SIZE.width - PROPOSED_LAYOUT.leftLogicalPx - PROPOSED_LAYOUT.rightLogicalPx;
  const lines = (verdicts: readonly PageVerdict[]): number[] => verdicts.map((v) => v.nominalHeightPx / LAYOUT_LOGICAL.lineHeightPx);
  const p95 = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * 0.95;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    return lo === hi ? sorted[lo]! : sorted[lo]! * (hi - index) + sorted[hi]! * (index - lo);
  };
  return {
    glyphPitch:
      proposedPitch === undefined
        ? null
        : {
            fontLogicalPx: expectedStagePx,
            expectedStagePx,
            measuredStagePx,
            ratio,
            tolerance,
            ok: Math.abs(ratio - 1) <= tolerance,
          },
    charsPerLine: {
      currentPort: Math.floor(widthCurrent / CURRENT_LAYOUT.fontLogicalPx),
      proposed: Math.floor(widthProposed / LAYOUT_LOGICAL.fontPx),
      expectedOriginal: Math.floor(widthProposed / LAYOUT_LOGICAL.fontPx),
      widthCurrentStagePx: widthCurrent,
      widthProposedStagePx: widthProposed,
    },
    marginSymmetry: {
      leftStagePx: PROPOSED_LAYOUT.leftLogicalPx,
      rightStagePx: PROPOSED_LAYOUT.rightLogicalPx,
      deltaStagePx: Math.abs(PROPOSED_LAYOUT.leftLogicalPx - PROPOSED_LAYOUT.rightLogicalPx),
      ok: Math.abs(PROPOSED_LAYOUT.leftLogicalPx - PROPOSED_LAYOUT.rightLogicalPx) <= 1,
    },
    linesPerPage: { currentP95: p95(lines(verdictsCurrent)), proposedP95: p95(lines(verdictsProposed)) },
    inkRatio: INK_RATIO,
  };
}

/** Snapshot versionnable des pages restant en débordement avec la config proposée (aucun texte). */
export type OverflowSnapshot = {
  generatedAt: string;
  mode: "assets" | "placeholders";
  config: string;
  count: number;
  pages: { script: string; page: number; nonSpaceChars: number; fillRatio: number; safetyPx: number; lines: number }[];
};

function buildSnapshot(verdicts: readonly PageVerdict[], mode: "assets" | "placeholders"): OverflowSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    config: "logique : marge 69 px, police 26 px, interligne 40,8 px",
    count: verdicts.filter((v) => v.overflow).length,
    pages: verdicts
      .filter((v) => v.overflow)
      .map((v) => ({
        script: v.page.script,
        page: v.page.page,
        nonSpaceChars: v.page.nonSpaceChars,
        fillRatio: Math.round(v.fillRatio * 1000) / 1000,
        safetyPx: Math.round(v.safetyPx * 10) / 10,
        lines: Math.max(1, Math.round(v.nominalHeightPx / LAYOUT_LOGICAL.lineHeightPx)),
      })),
  };
}

/** Scènes (3 max) pour l'analyse de taille nominale : pages avec `@font size=` en priorité. */
function nominalScenes(
  pages: readonly TextPage[],
): { scenes: NominalSceneAnalysis[]; scriptSizes: number[]; probeSizes: { label: string; cssPx: number }[] } {
  const withSize = pages.filter((p) => p.scriptSizes.length > 0).slice(0, 3);
  // 3 scènes au minimum ; sans `@font size=` dans le corpus, on mesure la police nominale.
  const chosen = (withSize.length > 0 ? withSize : pages.slice(0, 3)).filter(Boolean);
  const scriptSizes = [...new Set(chosen.flatMap((p) => p.scriptSizes))];
  const scenes = chosen.map((page) => ({
    script: page.script,
    page: page.page,
    scriptSizes: page.scriptSizes,
    comparisons: page.scriptSizes.map((size) => compareFontSize(size)),
  }));
  const probeSizes: { label: string; cssPx: number }[] = [
    { label: "nominal-actuel", cssPx: NOMINAL_STAGE_PX },
    { label: "nominal-propose", cssPx: LAYOUT_LOGICAL.fontPx },
    ...scriptSizes.flatMap((size) => [
      { label: `script-${size}`, cssPx: size },
      { label: `script-${size}-converti`, cssPx: size * (STAGE_SIZE.width / 1280) },
    ]),
  ];
  return { scenes, scriptSizes, probeSizes };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const assetsDir = resolveAssetsDir(cli);
  const warnings: string[] = [];
  let scenarioDir: string;
  let mode: "assets" | "placeholders";
  if (assetsDir) {
    mode = "assets";
    scenarioDir = join(assetsDir, "scenario");
    if (!existsSync(scenarioDir)) {
      warnings.push(`Dossier scenario introuvable : ${scenarioDir} — bascule en placeholders.`);
      const placeholder = placeholderScenarioDir();
      scenarioDir = placeholder.dir;
      warnings.push(placeholder.warning);
      mode = "placeholders";
    }
  } else {
    mode = "placeholders";
    const placeholder = placeholderScenarioDir();
    scenarioDir = placeholder.dir;
    warnings.push(placeholder.warning);
  }

  // Corpus : scripts narratifs (système/chiffrés exclus par `listCorpus`).
  const corpus = listCorpus(scenarioDir);
  const scripts = corpus.auditableScripts.slice(0, cli.maxScripts);
  const pages: TextPage[] = [];
  for (const script of scripts) {
    const text = corpus.scriptTexts.get(script) ?? readFileSync(join(scenarioDir, script), "utf-8");
    for (const page of extractTextPages(text, script, { maxPagesPerScript: 500 })) {
      pages.push(page);
      if (pages.length >= cli.maxPages) break;
    }
    if (pages.length >= cli.maxPages) break;
  }
  console.log(`[text-overflow] corpus : ${scripts.length} script(s), ${pages.length} page(s) mesurée(s) [${mode}]`);

  const { scenes, scriptSizes, probeSizes } = nominalScenes(pages);
  if (mode === "placeholders") {
    warnings.push("Analyse de taille nominale sur les placeholders : aucune taille `@font size=` du vrai corpus.");
  } else if (scriptSizes.length === 0) {
    warnings.push(
      "Aucun `@font size=` dans les pages mesurées : la taille nominale par défaut (FRAME_TEXT_REM) est la seule " +
        "variable de taille ; l'analyse compare donc la police nominale au ratio de glyphe de l'original (#314).",
    );
  }

  const browserReports: BrowserOverflowReport[] = [];
  const glyphProbes: GlyphProbe[] = [];
  let validation: LayoutValidation | null = null;
  for (const name of cli.browsers) {
    const type = name === "firefox" ? firefox : name === "chromium" ? chromium : null;
    if (!type) {
      warnings.push(`Navigateur inconnu ignoré : ${name}`);
      continue;
    }
    const measurement = await measureInBrowser(type, name, pages, probeSizes);
    if (!measurement) continue;
    for (const probe of measurement.probes) {
      let group = glyphProbes.find((g) => g.browser === name && g.stageFontPx === probe.cssSize);
      if (!group) {
        group = { browser: name, fontFamily: measurement.fontFamily, stageFontPx: probe.cssSize, screenFontPx: stageToScreenPx(probe.cssSize), entries: [] };
        glyphProbes.push(group);
      }
      group.entries.push({ char: probe.char, ascentPx: probe.ascent, descentPx: probe.descent, widthPx: probe.width });
    }
    const verdictsCurrent = verdictsFor(measurement, pages, 0);
    const verdictsProposed = verdictsFor(measurement, pages, 1);
    browserReports.push({
      browser: name,
      verdicts: verdictsCurrent,
      summary: summarizeVerdicts(verdictsCurrent),
      proposed: { verdicts: verdictsProposed, summary: summarizeVerdicts(verdictsProposed) },
    });
    if (validation === null) validation = computeValidation(measurement, verdictsCurrent, verdictsProposed);
    warnings.push(
      `[${name}] config logique (marge 69, police 26) : ${verdictsProposed.filter((v) => v.overflow).length}/${pages.length} pages en débordement ` +
        `(config actuelle : ${verdictsCurrent.filter((v) => v.overflow).length}/${pages.length}).`,
    );
  }

  let snapshotInfo: TextOverflowReport["snapshot"] = null;
  if (cli.snapshotPath && browserReports[0]?.proposed) {
    const snapshot = buildSnapshot(browserReports[0].proposed.verdicts, mode);
    mkdirSync(dirname(cli.snapshotPath), { recursive: true });
    writeFileSync(cli.snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
    snapshotInfo = { path: cli.snapshotPath, count: snapshot.count };
    console.log(`[text-overflow] snapshot : ${snapshot.count} page(s) en débordement → ${cli.snapshotPath}`);
  }

  const box = {
    nominalFontPx: NOMINAL_STAGE_PX,
    lineHeight: NOMINAL_STAGE_PX * FRAME_TEXT_LINE_HEIGHT,
    areaHeightPx: textAreaHeightStagePx(),
    leftMarginStagePx: FRAME_TEXT_AREA.left * STAGE_SIZE.width,
  };
  const originalMargin = originalLeftMarginScreenPx(REFERENCE_LEFT_MARGIN);
  const report: TextOverflowReport = {
    generatedAt: new Date().toISOString(),
    mode,
    assetsDir,
    scenarioDir: mode === "assets" ? scenarioDir : null,
    scripts: scripts.length,
    pages: pages.length,
    measuredPages: browserReports[0]?.summary.pages ?? 0,
    browsers: browserReports,
    nominal: scenes,
    box,
    originalMarginScreenPx: originalMargin,
    marginDeltaScreenPx: currentLeftMarginScreenPx() - originalMargin,
    layout: LAYOUT_PROVENANCE,
    validation,
    snapshot: snapshotInfo,
    glyphProbes,
    warnings,
  };

  // Rapport JSON sans texte du jeu : on retire les runs/textes des pages.
  const json = {
    ...report,
    browsers: browserReports.map((b) => ({
      ...b,
      verdicts: b.verdicts.map((v) => ({ ...v, page: pageMeta(v.page) })),
      summary: { ...b.summary, worstPages: b.summary.worstPages.map((v) => ({ ...v, page: pageMeta(v.page) })) },
      proposed: b.proposed && {
        verdicts: b.proposed.verdicts.map((v) => ({ ...v, page: pageMeta(v.page) })),
        summary: {
          ...b.proposed.summary,
          worstPages: b.proposed.summary.worstPages.map((v) => ({ ...v, page: pageMeta(v.page) })),
        },
      },
    })),
    nominal: scenes,
    glyphProbes,
  };
  mkdirSync(join(ROOT, "reports"), { recursive: true });
  writeFileSync(cli.jsonPath, JSON.stringify(json, null, 2), "utf-8");
  mkdirSync(dirname(cli.mdPath), { recursive: true });
  writeFileSync(cli.mdPath, buildMarkdownReport(report), "utf-8");

  const primary = browserReports[0];
  console.log("\n=== Débordement du texte (corpus) ===");
  if (primary) {
    const s = primary.summary;
    console.log(`Pages : ${s.pages} — débordent à la taille nominale : ${s.overflowing} (${(s.overflowRatio * 100).toFixed(2)} %)`);
    console.log(`p95 remplissage : ${(s.p95FillRatio * 100).toFixed(1)} % ; marge minimale : ${s.worstSafetyPx.toFixed(1)} px (stage)`);
    console.log(`Marge gauche : ${currentLeftMarginScreenPx().toFixed(1)} px écran (port) vs ${originalMargin.toFixed(1)} px (original) → +${report.marginDeltaScreenPx.toFixed(1)} px`);
    console.log(
      `Config logique proposée : marge ${LAYOUT_LOGICAL.horizontalMarginPx} px logiques (${stageToScreenPx(LAYOUT_LOGICAL.horizontalMarginPx).toFixed(1)} px écran), ` +
        `police ${LAYOUT_LOGICAL.fontPx} px logiques (${stageToScreenPx(LAYOUT_LOGICAL.fontPx).toFixed(1)} px écran)`,
    );
    if (validation) {
      console.log(
        `Validation : pas des glyphes ×${validation.glyphPitch?.ratio.toFixed(3) ?? "n/a"} (attendu 1 ±2 %), ` +
          `caractères/ligne ${validation.charsPerLine.currentPort} → ${validation.charsPerLine.proposed}, ` +
          `marges symétriques écart ${validation.marginSymmetry.deltaStagePx} px`,
      );
    }
    console.log(`Écart d'encre ×${INK_RATIO.toFixed(3)} : cosmétique (approximation text-font-metrics), ne justifie pas de réduire la police`);
  } else {
    console.log("Aucune mesure navigateur disponible (navigateur absent ?).");
  }
  for (const warning of warnings) console.warn(`[text-overflow] ${warning}`);
  console.log(`\n[text-overflow] rapport JSON : ${cli.jsonPath}`);
  console.log(`[text-overflow] rapport Markdown : ${cli.mdPath}`);
}

await main();
