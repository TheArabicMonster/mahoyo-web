/**
 * Mesure reproductible des performances du player (#100).
 *
 * Pipeline complet (`npm run perf`) :
 *   1. génère les placeholders e2e dans un dossier temporaire (aucun asset du jeu) ;
 *   2. build de production (`tsc && vite build`) en mesurant la durée ;
 *   3. tailles du bundle JS/CSS (gzip) et, si disponible, du manifest d'assets ;
 *   4. sert `dist/` via `vite preview` et mesure dans Chromium headless : temps de premier rendu
 *      (écran titre), requêtes et octets du démarrage, mémoire JS, images/s pendant la transition
 *      titre → jeu ;
 *   5. compare aux budgets de `tools/perf-budgets.ts` et affiche un rapport PASS/FAIL.
 *
 * Modes :
 *   --static-only   pas de navigateur : build + tailles + manifest seulement ;
 *   --no-build      réutilise le `dist/` existant (pas de build, durée non mesurée) ;
 *   --warn-only     n'échoue pas (exit 0) en cas de budget dépassé — utilisé par la CI non bloquante.
 *
 * Usage :
 *   npm run perf
 *   npm run perf -- --no-build --static-only --warn-only
 *
 * Aucun asset sous copyright n'est lu : les placeholders sont générés par `tests/e2e/placeholders.ts`.
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { chromium, type Browser } from "playwright";
import { generatePlaceholderAssets } from "../tests/e2e/placeholders.js";
import { PERF_BUDGETS } from "./perf-budgets.js";
import {
  checkBudgets,
  collectBundleMetrics,
  collectManifestMetrics,
  formatBytes,
  formatMs,
  percentile,
  type BrowserMetrics,
  type BudgetUnit,
  type PerfMetrics,
} from "./perf-lib.js";

const ROOT = resolve(import.meta.dirname, "..");
const DIST_DIR = join(ROOT, "dist");
const REPORT_PATH = join(ROOT, "reports", "perf.json");

type Cli = {
  staticOnly: boolean;
  noBuild: boolean;
  warnOnly: boolean;
  assetsDir: string;
  manifestPath: string | null;
  jsonPath: string;
};

function parseArgs(argv: readonly string[]): Cli {
  const cli: Cli = {
    staticOnly: false,
    noBuild: false,
    warnOnly: false,
    assetsDir: process.env.MAHOYO_E2E_ASSETS?.trim() || join(tmpdir(), "mahoyo-perf-assets"),
    manifestPath: null,
    jsonPath: REPORT_PATH,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--static-only") cli.staticOnly = true;
    else if (arg === "--no-build") cli.noBuild = true;
    else if (arg === "--warn-only") cli.warnOnly = true;
    else if (arg === "--assets") cli.assetsDir = resolve(argv[++i] ?? cli.assetsDir);
    else if (arg === "--manifest") cli.manifestPath = resolve(argv[++i] ?? "");
    else if (arg === "--json") cli.jsonPath = resolve(argv[++i] ?? cli.jsonPath);
    else if (arg === "--help") {
      console.log("Usage : npm run perf -- [--static-only] [--no-build] [--warn-only] [--assets <dir>] [--manifest <fichier>] [--json <fichier>]");
      process.exit(0);
    } else {
      console.warn(`[perf] argument ignoré : ${arg}`);
    }
  }
  return cli;
}

/** Build de production avec les placeholders du dossier d'assets ; renvoie la durée murale (ms). */
function build(assetsDir: string): number {
  console.log("[perf] build de production…");
  const started = Date.now();
  const result = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, MAHOYO_E2E_ASSETS: assetsDir },
  });
  const elapsed = Date.now() - started;
  if (result.status !== 0) throw new Error(`build en échec (code ${result.status})`);
  console.log(`[perf] build terminé en ${(elapsed / 1000).toFixed(1)} s`);
  return elapsed;
}

/** Port libre choisi par l'OS. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // serveur pas encore prêt
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`serveur preview non disponible : ${url}`);
}

/** Démarre `vite preview` sur `dist/` et renvoie le process + l'URL. */
async function startPreview(): Promise<{ url: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const viteBin = join(ROOT, "node_modules", ".bin", "vite");
  const child = spawn(viteBin, ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForServer(url);
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  }
  return {
    url,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((done) => child.once("exit", () => done()));
    },
  };
}

/** Mesure navigateur : premier rendu, réseau, mémoire, fluidité de la transition titre → jeu. */
async function measureBrowser(url: string): Promise<BrowserMetrics | null> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    let startupRequests = 0;
    page.on("request", () => {
      startupRequests++;
    });

    const started = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator(".mh-ui-title-screen").waitFor({ state: "visible", timeout: 30000 });
    const firstRenderMs = Date.now() - started;

    // Note : `page.evaluate` reçoit des **expressions chaînes**, pas des callbacks TS. `tsx` compile
    // les callbacks avec le helper esbuild `__name` (keepNames), absent du navigateur.
    const timing = (await page.evaluate(`(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paints = performance.getEntriesByType("paint");
      const fcp = paints.find((p) => p.name === "first-contentful-paint");
      const resources = performance.getEntriesByType("resource");
      const heap = performance.memory;
      return {
        domContentLoadedMs: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
        loadEventMs: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd - nav.startTime : 0,
        firstContentfulPaintMs: fcp ? fcp.startTime : null,
        startupTransferBytes: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
        heapUsedBytes: heap ? heap.usedJSHeapSize : null,
      };
    })()`)) as {
      domContentLoadedMs: number;
      loadEventMs: number;
      firstContentfulPaintMs: number | null;
      startupTransferBytes: number;
      heapUsedBytes: number | null;
    };

    // Fluidité pendant la transition titre → jeu : échantillonne les intervalles entre images.
    await page.evaluate(`(() => {
      const w = window;
      w.__perfFrames = [];
      const start = performance.now();
      let last = start;
      function loop(t) {
        w.__perfFrames.push(t - last);
        last = t;
        if (t - start < 2500) requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    })()`);
    await page.locator(".mh-ui-new-game").click();
    await page.waitForTimeout(2600);
    const deltas = (
      (await page.evaluate("window.__perfFrames.slice(2)")) as number[]
    ).filter((d) => Number.isFinite(d) && d > 0 && d < 1000);
    const meanDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const transitionFps = meanDelta > 0 ? 1000 / meanDelta : null;
    const transitionP95FrameMs = deltas.length > 0 ? percentile(deltas, 0.95) : null;
    const transitionMaxFrameMs = deltas.length > 0 ? Math.max(...deltas) : null;

    return {
      firstRenderMs,
      domContentLoadedMs: timing.domContentLoadedMs,
      loadEventMs: timing.loadEventMs,
      firstContentfulPaintMs: timing.firstContentfulPaintMs,
      startupRequests,
      startupTransferBytes: timing.startupTransferBytes,
      heapUsedBytes: timing.heapUsedBytes,
      transitionFps,
      transitionP95FrameMs,
      transitionMaxFrameMs,
    };
  } catch (err) {
    console.warn(`[perf] mesures navigateur indisponibles : ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function printReport(metrics: PerfMetrics): boolean {
  const checks = checkBudgets(metrics, PERF_BUDGETS);
  const unit = (value: number, u: BudgetUnit): string =>
    u === "bytes" ? formatBytes(value) : u === "ms" ? formatMs(value) : u === "fps" ? `${value.toFixed(1)} fps` : `${value}`;
  console.log("\n=== Performance du player (placeholders) ===");
  console.log(`Bundle JS   : ${formatBytes(metrics.bundle.js.rawBytes)} brut → ${formatBytes(metrics.bundle.js.gzipBytes)} gzip`);
  console.log(`Bundle CSS  : ${formatBytes(metrics.bundle.css.rawBytes)} brut → ${formatBytes(metrics.bundle.css.gzipBytes)} gzip`);
  if (metrics.manifest) {
    console.log(
      `Manifest    : ${formatBytes(metrics.manifest.rawBytes)} brut → ${formatBytes(metrics.manifest.gzipBytes)} gzip ` +
        `(${metrics.manifest.images} images, ${metrics.manifest.audio} audio, ${metrics.manifest.scenarios} scripts)`,
    );
  } else {
    console.log("Manifest    : n/a (checkout nu — mesurer avec --manifest <dossier assets>)");
  }
  if (metrics.browser) {
    const b = metrics.browser;
    console.log(`Premier rendu : ${formatMs(b.firstRenderMs)} (DCL ${formatMs(b.domContentLoadedMs)}, load ${formatMs(b.loadEventMs)})`);
    console.log(
      `Démarrage   : ${b.startupRequests} requêtes, ${formatBytes(b.startupTransferBytes)} transférés` +
        (b.firstContentfulPaintMs !== null ? `, FCP ${formatMs(b.firstContentfulPaintMs)}` : ""),
    );
    console.log(`Mémoire JS  : ${b.heapUsedBytes === null ? "n/a" : formatBytes(b.heapUsedBytes)}`);
    if (b.transitionFps !== null) {
      console.log(
        `Transition  : ${b.transitionFps.toFixed(1)} fps, p95 ${formatMs(b.transitionP95FrameMs ?? 0)}, max ${formatMs(b.transitionMaxFrameMs ?? 0)}`,
      );
    }
  }
  console.log("\nBudgets :");
  let ok = true;
  for (const c of checks) {
    const symbol = c.skipped ? "…" : c.ok ? "✓" : "✗";
    const measured = c.measured === null ? "n/a" : unit(c.measured, c.unit);
    const margin = c.margin === null ? "" : ` (marge ${(c.margin * 100).toFixed(1)} %)`;
    console.log(`  ${symbol} ${c.label.padEnd(34)} ${measured.padStart(12)} / ≤ ${unit(c.budget, c.unit)}${margin}`);
    if (!c.skipped && !c.ok) ok = false;
  }
  console.log("");
  return ok;
}

function writeReport(metrics: PerfMetrics, checks: ReturnType<typeof checkBudgets>, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ metrics, budgets: PERF_BUDGETS, checks }, null, 2), "utf-8");
  console.log(`[perf] rapport JSON : ${path}`);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  let buildMs: number | null = null;
  if (!cli.noBuild) {
    if (!existsSync(join(cli.assetsDir, "assets", "asset-manifest.json"))) {
      generatePlaceholderAssets(cli.assetsDir);
      console.log(`[perf] placeholders générés dans ${cli.assetsDir}`);
    }
    buildMs = build(cli.assetsDir);
  }
  const bundle = collectBundleMetrics(DIST_DIR);
  const manifest = collectManifestMetrics(cli.manifestPath ?? join(ROOT, "public", "assets"));

  let browser: BrowserMetrics | null = null;
  if (!cli.staticOnly) {
    const preview = await startPreview();
    try {
      browser = await measureBrowser(preview.url);
    } finally {
      await preview.stop();
    }
  } else {
    console.log("[perf] mode statique : mesures navigateur ignorées");
  }

  const metrics: PerfMetrics = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    buildMs,
    bundle,
    manifest,
    browser,
  };
  const ok = printReport(metrics);
  const checks = checkBudgets(metrics, PERF_BUDGETS);
  writeReport(metrics, checks, cli.jsonPath);

  if (!ok) {
    const message = "[perf] budget(s) dépassé(s) — voir le tableau ci-dessus et docs/PERFORMANCE.md";
    if (cli.warnOnly) {
      console.warn(`${message} (--warn-only : non bloquant)`);
      return;
    }
    console.error(message);
    process.exitCode = 1;
  }
}

await main();
