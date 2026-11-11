/**
 * Banc de mesure des temps de chargement entre scènes (#361, PERF-02) — baseline avant #362.
 *
 * Rejoue N changements de scène d'un script réel avec les **assets réels locaux** (ou des
 * placeholders lourds pour un usage CI, sans aucun asset sous copyright), sur un serveur
 * **`vite preview` uniquement** (jamais le dev server), et mesure :
 *  - `scene-ready` par changement de scène : de la requête réseau de l'image (`Resource Timing`)
 *    au rendu peint (2 × requestAnimationFrame), avec repli trigger → paint ;
 *  - la proportion d'images servies par le **lookahead** (requête démarrée avant le déclenchement de
 *    la scène) et les hits de cache (`transferSize === 0`) ;
 *  - les blocages > 50 ms (`longtask`, ou `long-animation-frame` si disponible) pendant les
 *    transitions ;
 *  - l'INP au clic/touche d'avance (`event` entries, repli durée max) ;
 *  - la mémoire : tas JS (`Performance.getMetrics` via CDP) + estimation du cache décodé
 *    (`image-dimensions.json` × 4 octets/pixel, pour les images chargées).
 *
 * Profils : `desktop` (sans bridage) et `mobile` (CPU throttling ×4 + réseau 10 Mbps via CDP).
 * Passes : `cold` (contexte neuf, cache HTTP vide) puis `warm` (même contexte, cache chaud).
 *
 * Mode sans assets : `--placeholders-heavy` génère des PNG de bruit synthétiques originaux
 * (1024×576 et 2048×1152) et un script de banc dédié — coût de décodage réaliste, aucun asset du jeu.
 *
 * Usage :
 *   npm run perf:scenes
 *   npm run perf:scenes -- --placeholders-heavy --scenes 6 --profiles desktop
 *
 * Rapport : `reports/perf-scenes.json` (ignoré par git). Aucun asset ni capture commité.
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "fs";
import { createServer as createNetServer } from "net";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { deflateSync } from "zlib";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { generateImageDimensions } from "./image-dimensions.js";
import { generatePlaceholderAssets } from "../tests/e2e/placeholders.js";

const ROOT = resolve(import.meta.dirname, "..");
const DIST_DIR = join(ROOT, "dist");
const DEFAULT_OUT = join(ROOT, "reports", "perf-scenes.json");
const DEFAULT_SCRIPT = "1-2.ks";
/** Nombre d'images chargées dont on estime le cache décodé (w×h×4). */
const DECODED_CACHE_BYTES_PER_PIXEL = 4;

type Profile = "desktop" | "mobile";
type Pass = "cold" | "warm";

type Cli = {
  assets: string | null;
  out: string;
  script: string;
  scenes: number;
  profiles: Profile[];
  passes: Pass[];
  placeholdersHeavy: boolean;
  build: boolean;
};

function parseArgs(argv: readonly string[]): Cli {
  const cli: Cli = {
    assets: process.env.MAHOYO_E2E_ASSETS?.trim() || null,
    out: DEFAULT_OUT,
    script: DEFAULT_SCRIPT,
    scenes: 6,
    profiles: ["desktop", "mobile"],
    passes: ["cold", "warm"],
    placeholdersHeavy: false,
    build: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--assets") cli.assets = resolve(argv[++i] ?? "");
    else if (arg === "--out") cli.out = resolve(argv[++i] ?? cli.out);
    else if (arg === "--script") cli.script = argv[++i] ?? cli.script;
    else if (arg === "--scenes") cli.scenes = Number.parseInt(argv[++i] ?? "", 10) || cli.scenes;
    else if (arg === "--profiles") cli.profiles = (argv[++i] ?? "desktop").split(",").filter((p): p is Profile => p === "desktop" || p === "mobile");
    else if (arg === "--passes") cli.passes = (argv[++i] ?? "cold,warm").split(",").filter((p): p is Pass => p === "cold" || p === "warm");
    else if (arg === "--placeholders-heavy") cli.placeholdersHeavy = true;
    else if (arg === "--no-build") cli.build = false;
    else if (arg === "--help") {
      console.log("Usage : npm run perf:scenes -- [--assets <public>] [--out <json>] [--script <ks>] [--scenes N] [--profiles desktop,mobile] [--passes cold,warm] [--placeholders-heavy] [--no-build] [--trace]");
      process.exit(0);
    } else console.warn(`[perf-scenes] argument ignoré : ${arg}`);
  }
  return cli;
}

function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const srv = createNetServer();
    srv.once("error", ko);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => ok(port));
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      // pas prêt
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`serveur non disponible : ${url}`);
}

// ── PNG de bruit synthétique (placeholders lourds, aucun asset du jeu) ──────

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** PNG truecolor 8 bits rempli de bruit pseudo-aléatoire déterministe (coût de décodage réaliste). */
export function writeNoisePng(path: string, width: number, height: number, seed: number): void {
  mkdirSync(dirname(path), { recursive: true });
  let state = seed >>> 0 || 1;
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state >>> 24;
  };
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filtre 0
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * 3;
      raw[offset] = random();
      raw[offset + 1] = random();
      raw[offset + 2] = random();
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(path, Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 6 })), pngChunk("IEND", Buffer.alloc(0))]));
}

/** Génère un corpus de placeholders lourds (PNG bruit 1024×576 / 2048×1152) + script de banc. */
export function generateHeavyBenchAssets(publicDir: string, scenes = 8): { script: string; images: number } {
  generatePlaceholderAssets(publicDir);
  const assets = join(publicDir, "assets");
  const script = "bench.ks";
  const lines: string[] = ["*start|"];
  for (let index = 1; index <= scenes; index++) {
    const width = index % 2 === 1 ? 1024 : 2048;
    const height = index % 2 === 1 ? 576 : 1152;
    writeNoisePng(join(assets, "bg", `bench_${index}.png`), width, height, index * 7919);
    lines.push(`@bg page=fore time=0 rule=crossfade storage=bench_${index}`);
    lines.push(`Page de banc ${index}.[p]`);
  }
  lines.push("@return", "");
  writeFileSync(join(assets, "scenario", script), lines.join("\n"), "utf-8");
  const manifestPath = join(assets, "asset-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    images: Record<string, { url: string; source: string; kind: string }>;
    scenarios: Record<string, { url: string; source: string; encoding: string }>;
  };
  for (let index = 1; index <= scenes; index++) {
    manifest.images[`bench_${index}`] = { url: `bg/bench_${index}.png`, source: `bg/bench_${index}.png`, kind: "image" };
  }
  manifest.scenarios.bench = { url: `scenario/${script}`, source: `scenario/${script}`, encoding: "utf-8" };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  writeFileSync(join(assets, "story-chain.json"), JSON.stringify({
    version: 1,
    first: script,
    next: {},
    chapters: [{ id: "bench", label: "Banc perf", file: script, arc: "Banc" }],
  }, null, 2), "utf-8");
  generateImageDimensions(assets);
  return { script, images: scenes };
}

// ── Build + serveur `vite preview` ──────────────────────────────────────────

function buildDist(publicDir: string | null): void {
  console.log(`[perf-scenes] build vite${publicDir ? ` (publicDir=${publicDir})` : " (publicDir par défaut)"}…`);
  const env = { ...process.env };
  if (publicDir) env.MAHOYO_E2E_ASSETS = publicDir;
  else delete env.MAHOYO_E2E_ASSETS;
  const result = spawnSync(join(ROOT, "node_modules", ".bin", "vite"), ["build", "--logLevel", "warn"], { cwd: ROOT, env, encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`vite build en échec : ${result.error?.message ?? result.stderr}`);
}

/** Lie les assets réels dans `dist/assets` (sans copier les 7 Go) pour que `vite preview` les serve. */
function linkRealAssets(realAssetsDir: string): void {
  const target = join(DIST_DIR, "assets");
  for (const name of readdirSync(realAssetsDir)) {
    const destination = join(target, name);
    if (existsSync(destination) || lstatSync(destination, { throwIfNoEntry: false })) continue;
    symlinkSync(join(realAssetsDir, name), destination, "junction");
  }
}

async function startPreview(): Promise<{ url: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const viteBin = join(ROOT, "node_modules", ".bin", "vite");
  const child = spawn(viteBin, ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForHttp(url);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return { url, stop: () => new Promise<void>((done) => { child.kill("SIGTERM"); child.once("exit", () => done()); }) };
}

// ── Mesure d'une passe ──────────────────────────────────────────────────────

type SceneSample = {
  index: number;
  storage: string;
  triggerMs: number;
  paintMs: number;
  sceneReadyMs: number;
  requestStartMs: number | null;
  transferSize: number | null;
  fromCache: boolean;
  reused: boolean;
  lookahead: boolean;
};

type RunResult = {
  profile: Profile;
  pass: Pass;
  scenes: SceneSample[];
  longTasks: { startTime: number; duration: number }[];
  events: { startTime: number; duration: number; interactionId: number }[];
  resourceImages: { name: string; startTime: number; transferSize: number }[];
  decodedCacheBytes: number;
  heapUsedBytes: number | null;
};

/** Prépare la page : observers de performance + journal exposé dans `window.__bench`. */
const BENCH_HOOKS_JS = String.raw`
(() => {
  const bench = { longTasks: [], events: [], bgChanges: [], lastBg: "" };
  window.__bench = bench;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) bench.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) bench.events.push({ startTime: entry.startTime, duration: entry.duration, interactionId: entry.interactionId || 0 });
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  } catch {}
  const watchBg = () => {
    const element = document.querySelector(".mh-stage-bg");
    if (element) {
      const bg = getComputedStyle(element).backgroundImage;
      if (bg !== bench.lastBg) {
        if (bench.lastBg !== "") bench.bgChanges.push({ at: Math.round(performance.now() * 100) / 100, bg });
        bench.lastBg = bg;
      }
    }
    requestAnimationFrame(watchBg);
  };
  requestAnimationFrame(watchBg);
})();
`;

async function installBenchHooks(page: Page): Promise<void> {
  await page.addInitScript({ content: BENCH_HOOKS_JS });
}

async function emulateProfile(page: Page, profile: Profile): Promise<void> {
  if (profile !== "mobile") return;
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (2 * 1024 * 1024) / 8,
    connectionType: "cellular3g",
  });
}

/** Détecte le changement de scène (fond) et mesure `scene-ready` (requête → paint 2 rAF). */
async function captureSceneChanges(
  page: Page,
  expectedScenes: number,
  timeoutMs: number,
): Promise<{ scenes: SceneSample[] }> {
  const startIndex = await page.evaluate(() => (window as unknown as { __bench: { bgChanges: unknown[] } }).__bench.bgChanges.length);
  console.log(`[perf-scenes] hooks : ${startIndex} changement(s) de fond avant la mesure`);
  if (process.env.PERF_DEBUG) {
    const state = await page.evaluate(() => ({
      overlay: document.querySelector("#ui-overlay")?.getAttribute("data-screen"),
      text: (document.querySelector("#text")?.textContent || "").slice(0, 40),
      bg: getComputedStyle(document.querySelector(".mh-stage-bg")!).backgroundImage.slice(-60),
      changes: (window as unknown as { __bench: { bgChanges: unknown[] } }).__bench.bgChanges.length,
    }));
    console.log("[perf-scenes] debug start", JSON.stringify(state));
  }
  const scenes: SceneSample[] = [];
  const deadline = Date.now() + timeoutMs;
  let consumed = startIndex;
  const seen = new Set<string>();
  let lastAdvance = Date.now();
  let lastSceneAt = Date.now();
  while (scenes.length < expectedScenes && Date.now() < deadline) {
    await page.waitForTimeout(40);
    const changes = await page.evaluate(() => (window as unknown as { __bench: { bgChanges: { at: number; bg: string }[] } }).__bench.bgChanges);
    if (changes.length > consumed) console.log(`[perf-scenes] fond changé (${changes.length - consumed})`);
    if (process.env.PERF_DEBUG && Date.now() % 4000 < 300) {
      const state = await page.evaluate(() => ({
        overlay: document.querySelector("#ui-overlay")?.getAttribute("data-screen"),
        text: (document.querySelector("#text")?.textContent || "").slice(0, 40),
        changes: (window as unknown as { __bench: { bgChanges: unknown[] } }).__bench.bgChanges.length,
      }));
      console.log("[perf-scenes] debug", JSON.stringify(state));
    }
    while (consumed < changes.length && scenes.length < expectedScenes) {
      const change = changes[consumed]!;
      consumed++;
      const triggerMs = change.at;
      const paintMs = await page.evaluate(
        () => new Promise<number>((resolvePaint) => requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint(performance.now())))),
      );
      // Les storages réels contiennent des parenthèses (`-(曇).png`) : découper explicitement url("…").
      const rawUrl =
        change.bg.match(/url\("([^"]*)"\)/)?.[1] ??
        change.bg.match(/url\('([^']*)'\)/)?.[1] ??
        change.bg.match(/url\((.*)\)$/)?.[1] ??
        "";
      const storage = decodeURIComponent(rawUrl.split("/").pop() ?? "").replace(/\.(png|jpg|jpeg|webp)$/i, "");
      const resources = await page.evaluate(() =>
        performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          startTime: entry.startTime,
          transferSize: (entry as PerformanceResourceTiming).transferSize,
        })),
      );
      const candidates = resources.filter((entry) => decodeURIComponent(entry.name).includes(storage)).sort((a, b) => a.startTime - b.startTime);
      // Requête « fraîche » : commencée dans les 2 s précédant l'affichage. Pour une image déjà vue,
      // une requête bien plus ancienne (ex. `black.png` chargé au démarrage) ne doit pas biaiser la
      // mesure : sans nouvelle requête, on mesure le déclenchement → paint.
      const fresh = candidates.filter((entry) => entry.startTime > triggerMs - 2000 && entry.startTime <= paintMs).at(-1) ?? null;
      const reused = seen.has(storage);
      seen.add(storage);
      const used = reused ? fresh : (candidates.filter((entry) => entry.startTime <= paintMs).at(-1) ?? null);
      const lookahead = !reused && used !== null && used.startTime < triggerMs - 20;
      const sceneReadyMs = used === null ? Math.round(paintMs - triggerMs) : Math.round(paintMs - (lookahead ? triggerMs : used.startTime));
      scenes.push({
        index: scenes.length,
        storage,
        triggerMs: Math.round(triggerMs),
        paintMs: Math.round(paintMs),
        sceneReadyMs,
        requestStartMs: used ? Math.round(used.startTime) : null,
        transferSize: used ? used.transferSize : null,
        fromCache: used ? used.transferSize === 0 : false,
        reused,
        lookahead,
      });
      lastSceneAt = Date.now();
    }
    // Avancée scriptée (mode auto du player non fiable entre deux états de chargement) : Entrée
    // toutes les ~800 ms, et immédiatement après un changement de scène.
    if (Date.now() - lastAdvance > 800 || Date.now() - lastSceneAt < 200) {
      await page.keyboard.press("Enter").catch(() => undefined);
      lastAdvance = Date.now();
    }
  }
  return { scenes };
}

/** Remplace la table d'enchaînement **avant** le chargement de l'app (elle est lue au démarrage). */
async function setupChainRoute(page: Page, script: string): Promise<void> {
  const chain = JSON.parse(readFileSync(join(process.env.MAHOYO_E2E_ASSETS ?? "", "assets", "story-chain.json"), "utf-8"));
  chain.first = script;
  chain.chapters = [{ id: "bench", label: "Banc perf", file: script, arc: "Banc" }];
  await page.route("**/story-chain.json", (route) => route.fulfill({ json: chain }));
}

async function measureRun(page: Page, profile: Profile, script: string, expectedScenes: number): Promise<RunResult> {
  void script;
  await page.locator(".mh-ui-new-game").waitFor({ state: "visible", timeout: 30000 });
  await page.locator(".mh-ui-new-game").click();
  await page.waitForTimeout(1200);
  const { scenes } = await captureSceneChanges(page, expectedScenes, 120_000);
  const bench = await page.evaluate(() => (window as unknown as { __bench: { longTasks: { startTime: number; duration: number }[]; events: { startTime: number; duration: number; interactionId: number }[] } }).__bench);
  const resourceImages = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry.name))
      .map((entry) => ({ name: entry.name, startTime: entry.startTime, transferSize: (entry as PerformanceResourceTiming).transferSize })),
  );
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const metrics = (await client.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const heapUsedBytes = metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? null;
  const dimensionsPath = join(process.env.MAHOYO_E2E_ASSETS ?? "", "assets", "image-dimensions.json");
  const dimensions = existsSync(dimensionsPath) ? (JSON.parse(readFileSync(dimensionsPath, "utf-8")) as { dimensions: Record<string, { width: number; height: number }> }).dimensions : {};
  let decodedCacheBytes = 0;
  for (const url of new Set(resourceImages.map((entry) => decodeURIComponent(entry.name.split("/").pop() ?? "").replace(/\.(png|jpe?g|webp)$/i, "")))) {
    const size = dimensions[url];
    if (size) decodedCacheBytes += size.width * size.height * DECODED_CACHE_BYTES_PER_PIXEL;
  }
  return {
    profile,
    pass: "cold",
    scenes,
    longTasks: bench.longTasks.map((task) => ({ startTime: Math.round(task.startTime), duration: Math.round(task.duration) })),
    events: bench.events.map((event) => ({ startTime: Math.round(event.startTime), duration: Math.round(event.duration), interactionId: event.interactionId })),
    resourceImages,
    decodedCacheBytes,
    heapUsedBytes,
  };
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return lo === hi ? sorted[lo]! : sorted[lo]! * (hi - index) + sorted[hi]! * (index - lo);
}

function summarize(result: RunResult): Record<string, number | null> {
  const ready = result.scenes.map((scene) => scene.sceneReadyMs);
  const transitions = result.scenes.map((scene) => scene.triggerMs);
  void transitions;
  const windows = result.scenes.map((scene) => ({ start: scene.triggerMs, end: scene.paintMs }));
  const blocking = result.longTasks.filter((task) => windows.some((window) => task.startTime >= window.start - 100 && task.startTime <= window.end + 100));
  const interactionDurations = result.events.filter((event) => (event as { interactionId?: number }).interactionId && event.interactionId > 0).map((event) => event.duration);
  return {
    scenes: result.scenes.length,
    sceneReadyP50: Math.round(percentile(ready, 0.5)),
    sceneReadyP95: Math.round(percentile(ready, 0.95)),
    lookaheadRatio: result.scenes.length > 0 ? result.scenes.filter((scene) => scene.lookahead).length / result.scenes.length : 0,
    imageReuseRatio: result.scenes.length > 0 ? result.scenes.filter((scene) => scene.reused).length / result.scenes.length : 0,
    cacheHitRatio: result.scenes.length > 0 ? result.scenes.filter((scene) => scene.fromCache).length / result.scenes.length : 0,
    longTasksOver50: blocking.filter((task) => task.duration > 50).length,
    longestLongTaskMs: blocking.reduce((max, task) => Math.max(max, task.duration), 0),
    inpMs: interactionDurations.length > 0 ? Math.round(Math.max(...interactionDurations)) : null,
    heapUsedMB: result.heapUsedBytes === null ? null : Math.round(result.heapUsedBytes / 1024 / 1024),
    decodedCacheMB: Math.round(result.decodedCacheBytes / 1024 / 1024),
  };
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const out = { generatedAt: new Date().toISOString(), machine: { platform: process.platform, arch: process.arch, node: process.version }, config: { scenes: cli.scenes, script: cli.script, profiles: cli.profiles, passes: cli.passes } };
  mkdirSync(dirname(cli.out), { recursive: true });

  let publicDir: string;
  let script: string;
  let assetsKind: "real" | "heavy-placeholders";
  if (cli.placeholdersHeavy) {
    publicDir = join(tmpdir(), "mahoyo-perf-heavy");
    const heavy = generateHeavyBenchAssets(publicDir, Math.max(8, cli.scenes));
    script = heavy.script;
    assetsKind = "heavy-placeholders";
    console.log(`[perf-scenes] placeholders lourds : ${heavy.images} PNG de bruit (1024×576 / 2048×1152) dans ${publicDir}`);
  } else {
    const real = cli.assets ?? join(ROOT, "public");
    if (!existsSync(join(real, "assets", "asset-manifest.json"))) {
      throw new Error(`assets réels introuvables dans ${real} : passer --assets <public> ou --placeholders-heavy`);
    }
    publicDir = real;
    script = cli.script;
    assetsKind = "real";
    console.log(`[perf-scenes] assets réels : ${real}`);
  }
  process.env.MAHOYO_E2E_ASSETS = publicDir;

  if (cli.build) {
    buildDist(assetsKind === "real" ? null : publicDir);
    if (assetsKind === "real") linkRealAssets(join(publicDir, "assets"));
  } else if (!existsSync(join(DIST_DIR, "index.html"))) {
    throw new Error("dist/ absent : lancer sans --no-build (ou lancer `npx vite build` avant)");
  }

  const preview = await startPreview();
  console.log(`[perf-scenes] ${preview.url} (vite preview)`);
  const results: (RunResult & { summary: Record<string, number | null> })[] = [];
  try {
    for (const profile of cli.profiles) {
      let browser: Browser | null = null;
      let context: BrowserContext | null = null;
      try {
        browser = await chromium.launch();
        for (const pass of cli.passes) {
          // Cache froid : contexte neuf (cache HTTP vide). Cache chaud : même contexte, nouvelle page.
          if (pass === "cold") {
            await browser.close().catch(() => undefined);
            browser = await chromium.launch();
            context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
          }
          const page = await context!.newPage();
          page.on("pageerror", (error) => console.warn(`[perf-scenes] erreur page (${profile}):`, error.message));
          page.on("console", (message) => { if (message.type() === "error") console.warn(`[perf-scenes] console (${profile}):`, message.text().slice(0, 160)); });
          await emulateProfile(page, profile);
          await installBenchHooks(page);
          // Le service worker du build PWA peut intercepter `/assets/**` et court-circuiter les routes
          // Playwright : on le neutralise pour un banc déterministe (HTTP cache du contexte mesuré).
          // Le service worker est bloqué par le contexte (`serviceWorkers: "block"`) : sans cela il
          // intercepte `/assets/**` et court-circuite les routes Playwright (chain, comptage réseau).
          await page.route("**/sw.js", (route) => route.abort());
          await setupChainRoute(page, script);
          await page.goto(preview.url, { waitUntil: "domcontentloaded" });
          const result = await measureRun(page, profile, script, cli.scenes);
          const summary = summarize(result);
          results.push({ ...result, pass, summary });
          console.log(`[perf-scenes] ${profile}/${pass} : ${summary.scenes} scènes, scene-ready p50=${summary.sceneReadyP50} ms p95=${summary.sceneReadyP95} ms, lookahead ${(Number(summary.lookaheadRatio) * 100).toFixed(0)} % (réutilisation ${(Number(summary.imageReuseRatio) * 100).toFixed(0)} %), cache ${(Number(summary.cacheHitRatio) * 100).toFixed(0)} %, blocages>50 ms ${summary.longTasksOver50}, INP ${summary.inpMs ?? "n/a"} ms, heap ${summary.heapUsedMB ?? "n/a"} Mo, cache décodé ~${summary.decodedCacheMB} Mo`);
          await page.close();
        }
      } finally {
        await browser?.close().catch(() => undefined);
      }
    }
  } finally {
    await preview.stop();
  }

  const report = { ...out, assets: { kind: assetsKind, dir: publicDir }, runs: results };
  writeFileSync(cli.out, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\n[perf-scenes] rapport : ${cli.out}`);
}

await main();
