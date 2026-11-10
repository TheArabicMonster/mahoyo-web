/**
 * Diagnostic de l'ouverture (#352) — mesure reproductible du flash blanc, du panoramique final
 * et de la synchro musique/animations, sur assets réels locaux.
 *
 * Le player est lancé avec les **assets réels** (jamais commités), l'enchaînement est forcé sur
 * `opening.ks`, et l'ouverture est jouée jusqu'au retour à l'écran titre. Pendant la lecture :
 * - une image JPEG toutes ~100 ms (analyse de luminance/fondus) ;
 * - un échantillon DOM (fond : storage/position ; calques de timeline : position/opacité ;
 *   animations WAAPI : durées) et le journal audio (HTMLAudioElement.play/pause) toutes ~100 ms.
 *
 * Mesures produites :
 *  1. **flash blanc** : luminance par image, intervalles au-dessus du seuil, pic (temps, durée,
 *     luminance, ratio vs médiane), avant/après la première image de l'ouverture ;
 *  2. **panoramique final** : position du fond aux instants clés (`157 400`, `173 750`, `176 900`,
 *     `187 000` ms du modèle) vs `timelines.json` (keyframes + `moves`, interpolation `accel`) ;
 *     position des calques `12_手前c` et `00_タイトル` ; écart en px ;
 *  3. **synchro musique/animations** : horodatage des changements de fond observés vs `at` du
 *     modèle, lancement audio observé vs `audio[].at`, durées d'animation demandées vs `fade` ;
 *  4. **transition ouverture → titre** : durée, opacité, absence de coupure.
 *
 * Mode `--reference <video>` : extraction d'images de la vidéo OP du propriétaire (ffmpeg requis)
 * puis alignement temporel (corrélation des luminances) et comparaison flash/cuts/MAE finale.
 *
 * Captures, rapports et vidéo restent **hors dépôt** (`--out`, défaut `/tmp/mahoyo-opening`).
 *
 * Usage : MAHOYO_E2E_ASSETS=/chemin/vers/public npm run diag:opening
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { createServer as createHttpServer } from "http";
import { createServer as createNetServer } from "net";
import { extname, join, resolve } from "path";
import { chromium } from "playwright";
import { easeProgress } from "../src/core/easing.js";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_OUT = "/tmp/mahoyo-opening";
/** Instantanés du modèle (ms du `@playtimeline`) auxquels on compare le rendu final. */
const KEY_TIMES = [162400, 173750, 176900, 187000];
/** Seuil de luminance pour un « flash blanc » (image blanche ≈ 0,95 ; scène sombre ≈ 0,1). */
const FLASH_MIN_LUMINANCE = 0.7;
/** Durée minimale d'un flash (images consécutives × cadence). */
const FLASH_MIN_MS = 120;
/** Seuil de coupure (saut de luminance d'une image hors fondu). */
const CUT_DELTA = 0.3;

type Cli = {
  assets: string;
  out: string;
  reference: string | null;
  maxSeconds: number;
  strict: boolean;
};

function parseArgs(argv: readonly string[]): Cli {
  const cli: Cli = {
    assets: process.env.MAHOYO_E2E_ASSETS?.trim() || join(ROOT, "public"),
    out: DEFAULT_OUT,
    reference: null,
    maxSeconds: 260,
    strict: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--assets") cli.assets = resolve(argv[++i] ?? cli.assets);
    else if (arg === "--out") cli.out = resolve(argv[++i] ?? cli.out);
    else if (arg === "--reference") cli.reference = resolve(argv[++i] ?? "");
    else if (arg === "--max-seconds") cli.maxSeconds = Number.parseInt(argv[++i] ?? "", 10) || cli.maxSeconds;
    else if (arg === "--strict") cli.strict = true;
    else if (arg === "--help") {
      console.log("Usage : npm run diag:opening -- [--assets <public>] [--out <dir>] [--reference <video>] [--max-seconds N] [--strict]");
      process.exit(0);
    } else console.warn(`[opening] argument ignoré : ${arg}`);
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

async function waitForHttp(url: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // pas prêt
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`serveur non disponible : ${url}`);
}

function startFileServer(rootDir: string): Promise<{ url: string; stop: () => Promise<void> }> {
  return new Promise((ok) => {
    const server = createHttpServer((req, res) => {
      const url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><html><body></body></html>");
        return;
      }
      const path = join(rootDir, url);
      if (!path.startsWith(rootDir) || !existsSync(path)) {
        res.writeHead(404).end();
        return;
      }
      const type = extname(path) === ".png" ? "image/png" : "image/jpeg";
      res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
      res.end(readFileSync(path));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      ok({ url: `http://127.0.0.1:${port}`, stop: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

// ── Modèle `timelines.json` ──────────────────────────────────────────────────

type SceneBg = { at: number; storage: string; fade?: number; left?: number; top?: number; zoomx?: number; zoomy?: number; rotate?: number };
type SceneMove = { at: number; left?: number; top?: number; time: number; accel?: number };
type SceneLayer = { at: number; id: string; storage?: string; x?: number; y?: number; opacity?: number; z?: number; time?: number; accel?: number };
type SceneAudio = { at: number; channel: string; storage?: string; action?: string };
type OpeningScene = {
  name: string;
  duration: number;
  bg: SceneBg[];
  moves: SceneMove[];
  layers: SceneLayer[];
  audio: SceneAudio[];
};

type Position = { left: number; top: number };
type BgState = Position & { storage: string };

/** Position attendue du fond à `t` (ms du modèle), `moves` interpolés avec `accel` (même loi que le renderer). */
function expectedBgAt(scene: OpeningScene, time: number): BgState {
  let state: BgState = { storage: scene.bg[0]?.storage ?? "black", left: scene.bg[0]?.left ?? 0, top: scene.bg[0]?.top ?? 0 };
  let move: { at: number; from: Position; to: Position; time: number; accel: number } | null = null;
  const events: ({ kind: "bg"; bg: SceneBg } | { kind: "move"; move: SceneMove })[] = [
    ...scene.bg.map((bg) => ({ kind: "bg" as const, bg })),
    ...scene.moves.map((m) => ({ kind: "move" as const, move: m })),
  ].sort((a, b) => (a.kind === "bg" ? a.bg.at : a.move.at) - (b.kind === "bg" ? b.bg.at : b.move.at));
  for (const event of events) {
    const at = event.kind === "bg" ? event.bg.at : event.move.at;
    if (at > time) break;
    if (event.kind === "bg") {
      state = { storage: event.bg.storage, left: event.bg.left ?? state.left, top: event.bg.top ?? state.top };
      move = null;
    } else {
      const target = { left: event.move.left ?? state.left, top: event.move.top ?? state.top };
      if (event.move.time <= 0) {
        state = { ...state, ...target };
        move = null;
      } else {
        move = { at, from: { left: state.left, top: state.top }, to: target, time: event.move.time, accel: event.move.accel ?? 0 };
      }
    }
  }
  let left = state.left;
  let top = state.top;
  if (move && time >= move.at && time <= move.at + move.time) {
    const p = easeProgress(move.accel, (time - move.at) / move.time);
    left = move.from.left + (move.to.left - move.from.left) * p;
    top = move.from.top + (move.to.top - move.from.top) * p;
  } else if (move) {
    left = move.to.left;
    top = move.to.top;
  }
  return { storage: state.storage, left, top };
}

/** État attendu d'un calque de timeline à `t` (position/opacité interpolées avec `time`/`accel`). */
function expectedLayerAt(scene: OpeningScene, id: string, time: number): { x: number; y: number; opacity: number } | null {
  const events = scene.layers.filter((layer) => layer.id === id).sort((a, b) => a.at - b.at);
  if (events.length === 0) return null;
  let current = { x: events[0]!.x ?? 0, y: events[0]!.y ?? 0, opacity: events[0]!.opacity ?? 1 };
  let active: { from: typeof current; to: typeof current; at: number; time: number; accel: number } | null = null;
  for (const event of events) {
    if (event.at > time) break;
    const target = { x: event.x ?? current.x, y: event.y ?? current.y, opacity: event.opacity ?? current.opacity };
    if (!event.time || event.time <= 0) {
      current = target;
      active = null;
    } else {
      active = { from: { ...current }, to: target, at: event.at, time: event.time, accel: event.accel ?? 0 };
      current = target;
    }
  }
  if (active && time >= active.at && time <= active.at + active.time) {
    const p = easeProgress(active.accel, (time - active.at) / active.time);
    return {
      x: active.from.x + (active.to.x - active.from.x) * p,
      y: active.from.y + (active.to.y - active.from.y) * p,
      opacity: active.from.opacity + (active.to.opacity - active.from.opacity) * p,
    };
  }
  return current;
}

// ── Capture ──────────────────────────────────────────────────────────────────

type DomSample = {
  t: number;
  phase: string | null;
  overlay: string | null;
  title: boolean;
  bg: { storage: string; left: number | null; top: number | null };
  layers: { id: string; storage: string; left: number; top: number; opacity: number }[];
  animations: { id: string; duration: number; state: string; current: number | null }[];
  audio: { t: number; src: string; kind: string }[];
};

function decodeStorage(url: string): string {
  if (url === "none") return "";
  const match = url.match(/url\((['"]?)(.*?)\1\)/);
  const rawUrl = (match ? match[2] : url).trim();
  const file = rawUrl.split("/").pop() ?? "";
  try {
    return decodeURIComponent(file).replace(/\.(png|jpg|jpeg|webp)$/i, "");
  } catch {
    return file.replace(/\.(png|jpg|jpeg|webp)$/i, "");
  }
}

async function capture(cli: Cli): Promise<{ framesDir: string; samples: DomSample[]; audio: { t: number; src: string; kind: string }[]; perfBase: number; titleAtMs: number | null }> {
  const framesDir = join(cli.out, "frames");
  mkdirSync(framesDir, { recursive: true });
  const port = await freePort();
  const viteBin = join(ROOT, "node_modules", ".bin", "vite");
  const log = join(cli.out, "vite.log");
  const server = spawn(viteBin, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, MAHOYO_E2E_ASSETS: cli.assets, MAHOYO_E2E_REAL_ASSETS: "1" },
  });
  void log;
  const baseUrl = `http://127.0.0.1:${port}/`;
  await waitForHttp(baseUrl);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => console.warn("[opening] erreur page :", error.message));
  await page.addInitScript(() => {
    const log: { t: number; src: string; kind: string }[] = [];
    (window as unknown as { __audioLog: typeof log }).__audioLog = log;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      try {
        log.push({ t: performance.now(), src: this.currentSrc || this.src, kind: "play" });
      } catch {
        // ignore
      }
      return originalPlay.call(this).catch(() => undefined);
    };
    const originalPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      try {
        log.push({ t: performance.now(), src: this.currentSrc || this.src, kind: "pause" });
      } catch {
        // ignore
      }
      return originalPause.call(this);
    };
  });

  const chain = JSON.parse(readFileSync(join(cli.assets, "assets", "story-chain.json"), "utf-8"));
  chain.first = "opening.ks";
  chain.chapters = [{ id: "opening", label: "Ouverture", file: "opening.ks", arc: "Ouverture" }];
  chain.next["opening.ks"] = [];
  await page.route("**/story-chain.json", (route) => route.fulfill({ json: chain }));

  const samples: DomSample[] = [];
  let frameIndex = 0;
  let titleAtMs: number | null = null;
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator(".mh-ui-new-game").waitFor({ state: "visible", timeout: 30000 });
    await page.locator(".mh-ui-new-game").click();
    const perfBase = await page.evaluate(() => performance.now());
    const start = Date.now();
    let gameSeen = false;
    while (Date.now() - start < cli.maxSeconds * 1000) {
      const sample = (await page.evaluate(() => {
        const bg = document.querySelector(".mh-stage-bg") as HTMLElement | null;
        const pos = bg ? getComputedStyle(bg).backgroundPosition.split(" ") : [];
        const layers = Array.from(document.querySelectorAll<HTMLElement>("#stage-timeline > .mh-stage-tl-layer")).map((el) => {
          const img = el.querySelector("img");
          const style = getComputedStyle(el);
          return {
            id: el.dataset.layerId ?? "",
            storage: img ? img.getAttribute("src") ?? "" : "",
            left: Number.parseFloat(style.left),
            top: Number.parseFloat(style.top),
            opacity: Number.parseFloat(style.opacity),
          };
        });
        return {
          phase: document.querySelector("#ui-transition")?.getAttribute("data-phase") ?? null,
          overlay: document.querySelector("#ui-overlay")?.getAttribute("data-screen") ?? null,
          title: Boolean(document.querySelector(".mh-ui-title-screen")),
          bg: {
            storage: bg ? getComputedStyle(bg).backgroundImage : "none",
            left: pos[0] ? Number.parseFloat(pos[0]) : null,
            top: pos[1] ? Number.parseFloat(pos[1]) : null,
          },
          layers,
          animations: (document.getAnimations() as Animation[])
            .map((animation) => {
              const effect = animation.effect as KeyframeEffect | null;
              const target = effect?.target as HTMLElement | null;
              const timing = effect?.getTiming();
              const duration = typeof timing?.duration === "number" ? timing.duration : null;
              if (duration === null || duration < 80) return null;
              const id = `${target?.id || target?.className || "?"}:${Math.round(duration)}`;
              return { id, duration: Math.round(duration), state: animation.playState as string, current: animation.currentTime === null ? null : Math.round(Number(animation.currentTime)) };
            })
            .filter((entry): entry is { id: string; duration: number; state: string; current: number | null } => entry !== null),
          audio: ((window as unknown as { __audioLog?: { t: number; src: string; kind: string }[] }).__audioLog ?? []).slice(-4),
        };
      })) as Omit<DomSample, "t"> & { audio: { t: number; src: string; kind: string }[] };
      const t = Date.now() - start;
      samples.push({ t, ...sample });
      await page.screenshot({ path: join(framesDir, `frame_${String(frameIndex).padStart(5, "0")}.jpg`), type: "jpeg", quality: 62 });
      frameIndex++;
      if (sample.overlay === "game") gameSeen = true;
      if (gameSeen && sample.title) {
        titleAtMs = t;
        break;
      }
      await page.waitForTimeout(60);
    }
    const audio = await page.evaluate(() => ((window as unknown as { __audioLog?: { t: number; src: string; kind: string }[] }).__audioLog ?? []).slice());
    writeFileSync(
      join(cli.out, "timeline.json"),
      JSON.stringify({ perfBase, samples, frames: frameIndex, titleAtMs }, null, 2),
      "utf-8",
    );
    return { framesDir, samples, audio, perfBase, titleAtMs };
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ── Analyse ─────────────────────────────────────────────────────────────────

type FrameLuminance = { t: number; value: number };

function analyzeFlash(frames: FrameLuminance[]): {
  median: number;
  intervals: { startMs: number; endMs: number; durationMs: number; peak: number; peakMs: number; ratio: number }[];
} {
  const sorted = frames.map((f) => f.value).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const threshold = Math.max(FLASH_MIN_LUMINANCE, median + 0.35);
  const intervals: { startMs: number; endMs: number; durationMs: number; peak: number; peakMs: number; ratio: number }[] = [];
  let i = 0;
  while (i < frames.length) {
    if (frames[i]!.value < threshold) {
      i++;
      continue;
    }
    let j = i;
    let peak = frames[i]!.value;
    let peakMs = frames[i]!.t;
    while (j + 1 < frames.length && (frames[j + 1]!.value >= threshold || (j + 2 < frames.length && frames[j + 2]!.value >= threshold))) {
      j++;
      if (frames[j]!.value > peak) {
        peak = frames[j]!.value;
        peakMs = frames[j]!.t;
      }
    }
    const startMs = frames[i]!.t;
    const endMs = frames[j]!.t;
    if (endMs - startMs >= FLASH_MIN_MS) {
      intervals.push({ startMs, endMs, durationMs: endMs - startMs + 100, peak, peakMs, ratio: median > 0 ? peak / median : 0 });
    }
    i = j + 1;
  }
  return { median, intervals };
}

function nearestSample(samples: DomSample[], t: number): DomSample | null {
  let best: DomSample | null = null;
  let bestDiff = Infinity;
  for (const sample of samples) {
    const diff = Math.abs(sample.t - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = sample;
    }
  }
  return best;
}

type SceneAnalysis = { scene: OpeningScene; scheduleOffsetMs: number; firstImageMs: number };

/** Choisit la scène du modèle (4 ou 7 selon `cf.speffect`) qui correspond au fond observé. */
function resolveScene(model: Record<string, OpeningScene>, samples: DomSample[]): SceneAnalysis {
  const observed = samples
    .map((sample) => decodeStorage(sample.bg.storage))
    .filter((storage) => storage !== "" && storage !== "black" && storage !== "white" && storage !== "none");
  let bestKey = Object.keys(model)[0]!;
  let bestScore = -1;
  for (const [key, scene] of Object.entries(model)) {
    const expected = scene.bg.map((entry) => entry.storage);
    const score = expected.filter((storage) => observed.includes(storage)).length;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  const scene = model[bestKey]!;
  const firstExpected = (scene.bg[1] ?? scene.bg[0])!;
  const firstObserved = samples.find((sample) => decodeStorage(sample.bg.storage) === firstExpected.storage && sample.t > 1500);
  const firstImageMs = firstObserved?.t ?? 0;
  const scheduleOffsetMs = firstObserved ? firstObserved.t - (firstExpected.at ?? 0) : 0;
  return { scene, scheduleOffsetMs, firstImageMs };
}

async function analyzeFrames(fileServerUrl: string, frames: number): Promise<number[]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(fileServerUrl + "/");
    await page.addScriptTag({
      content: String.raw`
window.__luminances = async (urls) => {
  const load = (src) => new Promise((ok, ko) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ko(new Error(src)); im.src = src; });
  const canvas = document.createElement("canvas");
  canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const out = [];
  for (const url of urls) {
    const im = await load(url);
    ctx.clearRect(0, 0, 160, 90); ctx.drawImage(im, 0, 0, 160, 90);
    const data = ctx.getImageData(0, 0, 160, 90).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) / 255;
    out.push(sum / (160 * 90));
  }
  return out;
};
`,
    });
    const urls = Array.from({ length: frames }, (_, index) => `${fileServerUrl}/frames/frame_${String(index).padStart(5, "0")}.jpg`);
    return (await page.evaluate(`window.__luminances(${JSON.stringify(urls)})`)) as number[];
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Extrait des images d'une vidéo de référence (ffmpeg requis) pour comparaison. */
function extractReferenceFrames(video: string, outDir: string): string[] | null {
  mkdirSync(outDir, { recursive: true });
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", "fps=10", "-q:v", "4", join(outDir, "ref_%05d.jpg")], { encoding: "utf-8" });
  if (result.error || result.status !== 0) {
    console.warn(`[opening] ffmpeg indisponible ou échec : ${result.error?.message ?? result.stderr}`);
    return null;
  }
  return readdirSync(outDir).filter((file) => file.endsWith(".jpg")).sort();
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return -1;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i]!;
    meanB += b[i]!;
  }
  meanA /= n;
  meanB /= n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  return denA > 0 && denB > 0 ? num / Math.sqrt(denA * denB) : -1;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(cli.out, { recursive: true });
  const timelines = JSON.parse(readFileSync(join(cli.assets, "assets", "timelines.json"), "utf-8")) as {
    scripts: Record<string, Record<string, OpeningScene>>;
  };
  const openingModel = timelines.scripts["opening.ks"];
  if (!openingModel) throw new Error("timelines.json : script opening.ks absent");

  console.log(`[opening] assets : ${cli.assets}`);
  console.log(`[opening] sortie : ${cli.out}`);
  const { framesDir, samples, audio, perfBase, titleAtMs } = await capture(cli);
  console.log(`[opening] capture : ${samples.length} échantillons DOM, ${existsSync(framesDir) ? "images" : "aucune image"} ; titre à ${titleAtMs === null ? "non atteint" : `${Math.round(titleAtMs / 1000)} s`}`);

  const { scene, scheduleOffsetMs, firstImageMs } = resolveScene(openingModel as Record<string, OpeningScene>, samples);
  console.log(`[opening] scène modèle : ${scene.name ?? ""} (durée ${scene.duration} ms), décalage d'ordonnancement ≈ ${Math.round(scheduleOffsetMs)} ms`);

  const fileServer = await startFileServer(cli.out);
  const browser = await chromium.launch();
  try {
    const frameCount = readdirSync(framesDir).filter((file) => file.endsWith(".jpg")).length;
    const luminances = await analyzeFrames(fileServer.url, frameCount);
    const frames: FrameLuminance[] = luminances.map((value, index) => ({ t: samples[Math.min(index, samples.length - 1)]?.t ?? index * 100, value }));
    const flash = analyzeFlash(frames);
    const firstImageFrame = frames.find((frame) => frame.t >= firstImageMs) ?? null;
    // Coupures hors flash : sauts d'une image > CUT_DELTA en dehors des intervalles de flash.
    const cuts = frames
      .map((frame, index) => (index === 0 ? null : { t: frame.t, delta: Math.abs(frame.value - frames[index - 1]!.value) }))
      .filter((entry): entry is { t: number; delta: number } => entry !== null && entry.delta > CUT_DELTA)
      .filter((entry) => !flash.intervals.some((interval) => entry.t >= interval.startMs - 200 && entry.t <= interval.endMs + 200));

    // ── Panoramique final : positions du fond aux instants clés du modèle ──
    const bgCheckpoints = KEY_TIMES.map((modelTime) => {
      const sampleTime = modelTime + scheduleOffsetMs;
      const expected = expectedBgAt(scene, modelTime);
      const lastSample = samples.at(-1)?.t ?? 0;
      const observed = sampleTime <= lastSample - 500 ? nearestSample(samples, sampleTime) : null;
      const observedStorage = observed ? decodeStorage(observed.bg.storage) : "";
      return {
        modelTimeMs: modelTime,
        expected: { storage: expected.storage, left: Math.round(expected.left * 100) / 100, top: Math.round(expected.top * 100) / 100 },
        observed: observed ? { storage: observedStorage, left: observed.bg.left, top: observed.bg.top, sampleMs: Math.round(observed.t) } : null,
        deltaPx: observed && observed.bg.left !== null && observed.bg.top !== null ? {
          x: Math.round((observed.bg.left - expected.left) * 100) / 100,
          y: Math.round((observed.bg.top - expected.top) * 100) / 100,
        } : null,
      };
    });

    // ── Calques finaux : 12_手前c (L8) et 00_タイトル (L6/L11) ──
    const layerCheckpoints = ["L8", "L11"].flatMap((layerId) =>
      KEY_TIMES.map((modelTime) => {
        const expected = expectedLayerAt(scene, layerId, modelTime);
        const lastSampleT = samples.at(-1)?.t ?? 0;
        const observed = modelTime + scheduleOffsetMs <= lastSampleT - 500 ? nearestSample(samples, modelTime + scheduleOffsetMs) : null;
        const layer = observed?.layers.find((entry) => entry.id === layerId) ?? null;
        return {
          layerId,
          modelTimeMs: modelTime,
          expected: expected ? { x: Math.round(expected.x * 10) / 10, y: Math.round(expected.y * 10) / 10, opacity: Math.round(expected.opacity * 100) / 100 } : null,
          observed: layer ? { x: Math.round(layer.left * 10) / 10, y: Math.round(layer.top * 10) / 10, opacity: Math.round(layer.opacity * 100) / 100 } : null,
          delta: expected && layer ? { x: Math.round((layer.left - expected.x) * 10) / 10, y: Math.round((layer.top - expected.y) * 10) / 10 } : null,
        };
      }),
    );

    // ── Logo `00_タイトル` : apparition sur le ciel (panoramique final) ──
    const logoAtMs = 176750; // opacité pleine du calque L11 (173 750 + 3 000 ms)
    const logoExpected = expectedBgAt(scene, logoAtMs);
    const lastSampleForLogo = samples.at(-1)?.t ?? 0;
    const logoObserved = logoAtMs + scheduleOffsetMs <= lastSampleForLogo - 500 ? nearestSample(samples, logoAtMs + scheduleOffsetMs) : null;
    const logoOnSky = {
      atMs: logoAtMs,
      expectedBgTop: Math.round(logoExpected.top * 10) / 10,
      observedBgTop: logoObserved?.bg.top ?? null,
      observedBgStorage: logoObserved ? decodeStorage(logoObserved.bg.storage) : null,
      deltaTopPx: logoObserved && logoObserved.bg.top !== null ? Math.round((logoObserved.bg.top - logoExpected.top) * 10) / 10 : null,
    };

    // ── Sync : changements de fond observés vs modèle, audio observé vs modèle ──
    const bgChanges = samples
      .map((sample, index) => (index === 0 ? null : { t: sample.t, from: decodeStorage(samples[index - 1]!.bg.storage), to: decodeStorage(sample.bg.storage) }))
      .filter((entry): entry is { t: number; from: string; to: string } => entry !== null && entry.from !== entry.to && entry.to !== "");
    const bgSync = scene.bg.map((entry) => {
      const observed = bgChanges.find((change) => change.to === entry.storage && Math.abs(change.t - (entry.at + scheduleOffsetMs)) < 2500);
      return { expectedStorage: entry.storage, expectedAtMs: entry.at, observedAtMs: observed ? Math.round(observed.t - scheduleOffsetMs) : null, offsetMs: observed ? Math.round(observed.t - scheduleOffsetMs - entry.at) : null, matched: Boolean(observed) };
    });
    const audioSync = scene.audio.map((entry) => {
      const observed = audio.find((event) => event.kind === "play" && Math.abs(event.t - perfBase - (entry.at + scheduleOffsetMs)) < 2500);
      return { expectedAtMs: entry.at, channel: entry.channel, storage: entry.storage ?? null, observedAtMs: observed ? Math.round(observed.t - perfBase - scheduleOffsetMs) : null, offsetMs: observed ? Math.round(observed.t - perfBase - scheduleOffsetMs - entry.at) : null };
    });
    const animationDurations = [...new Set(samples.flatMap((sample) => sample.animations.map((animation) => animation.duration)))].sort((a, b) => a - b);
    const fadeDurations = [...new Set(scene.bg.map((entry) => entry.fade ?? 0).filter((fade) => fade > 0))].sort((a, b) => a - b);

    // ── Ouverture → titre ──
    const firstGame = samples.find((sample) => sample.overlay === "game" && sample.phase === "idle");
    const lastGame = [...samples].reverse().find((sample) => sample.overlay === "game");
    const titleSamples = samples.filter((sample) => sample.title);
    const phaseTimeline: { phase: string; startMs: number; endMs: number; durationMs: number }[] = [];
    let currentPhase: string | null = null;
    let phaseStart = 0;
    for (const sample of samples) {
      if (sample.phase === currentPhase) continue;
      if (currentPhase !== null) phaseTimeline.push({ phase: currentPhase, startMs: phaseStart, endMs: sample.t, durationMs: sample.t - phaseStart });
      currentPhase = sample.phase;
      phaseStart = sample.t;
    }
    const titleTransition = {
      openingStartMs: firstGame ? Math.round(firstGame.t) : null,
      openingEndMs: lastGame ? Math.round(lastGame.t) : null,
      titleAtMs: titleAtMs === null ? null : Math.round(titleAtMs),
      durationMs: firstGame && titleAtMs !== null ? Math.round(titleAtMs - lastGame!.t) : null,
      phases: phaseTimeline.filter((phase) => phase.phase !== null).slice(-4),
      openingDurationMs: firstGame && titleAtMs !== null ? Math.round(titleAtMs - firstGame.t) : null,
      expectedDurationMs: scene.duration,
      durationDeltaMs: firstGame && titleAtMs !== null ? Math.round(titleAtMs - firstGame.t - scene.duration) : null,
      closingTransitionMs: lastGame && titleAtMs !== null ? Math.round(titleAtMs - lastGame.t) : null,
    };
    const titleOpacity = titleSamples.length > 0 ? Number.parseFloat(String(titleSamples.at(-1)?.title)) : null;
    void titleOpacity;

    const report = {
      generatedAt: new Date().toISOString(),
      assets: cli.assets,
      scene: { name: scene.name, durationMs: scene.duration, scheduleOffsetMs: Math.round(scheduleOffsetMs) },
      capture: { samples: samples.length, frames: frameCount, titleAtMs: titleAtMs === null ? null : Math.round(titleAtMs) },
      flash: {
        medianLuminance: Math.round(flash.median * 1000) / 1000,
        intervals: flash.intervals.map((interval) => ({
          startMs: Math.round(interval.startMs),
          endMs: Math.round(interval.endMs),
          durationMs: Math.round(interval.durationMs),
          peakMs: Math.round(interval.peakMs),
          peakLuminance: Math.round(interval.peak * 1000) / 1000,
          ratioToMedian: Math.round(interval.ratio * 100) / 100,
          normalizedStartMs: Math.round(interval.startMs - scheduleOffsetMs),
          beforeFirstImage: interval.peakMs < firstImageMs,
        })),
        firstImageMs: Math.round(firstImageMs),
      },
      whiteFlashBeforeFirstImage: flash.intervals.some((interval) => interval.peakMs < firstImageMs),
      cutsOutsideFlash: cuts.map((cut) => ({ ms: Math.round(cut.t), delta: Math.round(cut.delta * 1000) / 1000 })),
      finalPan: bgCheckpoints,
      logoOnSky,
      layers: layerCheckpoints,
      sync: { bgChanges: bgSync, audio: audioSync, animationDurationsMs: animationDurations, expectedFadeDurationsMs: fadeDurations },
      title: titleTransition,
      calibration: { firstImageFrame: firstImageFrame?.t ?? null },
      referenceComparison: null as null | Record<string, unknown>,
    };

    writeFileSync(join(cli.out, "rapport.json"), JSON.stringify(report, null, 2), "utf-8");
    console.log("\n=== Diagnostic de l'ouverture ===");
    console.log(`Flash(s) détecté(s) : ${flash.intervals.length}`);
    for (const interval of flash.intervals) {
      console.log(`  ${Math.round(interval.startMs)}→${Math.round(interval.endMs)} ms (durée ${Math.round(interval.durationMs)} ms), pic ${Math.round(interval.peakMs)} ms L=${interval.peak.toFixed(2)} ratio×${interval.ratio.toFixed(2)}${interval.peakMs < firstImageMs ? " (avant première image)" : ""}`);
    }
    console.log(`Coupures hors flash : ${cuts.length}`);
    console.log("Panoramique final (Δ observé − modèle) :");
    for (const point of bgCheckpoints) {
      console.log(`  t=${point.modelTimeMs} ms : modèle ${point.expected.storage} @(${point.expected.left}, ${point.expected.top}) ; observé ${point.observed?.storage ?? "n/a"} @(${point.observed?.left ?? "n/a"}, ${point.observed?.top ?? "n/a"}) ; Δ=${point.deltaPx ? `(${point.deltaPx.x}, ${point.deltaPx.y}) px` : "n/a"}`);
    }
    console.log(`Logo 00_タイトル (t=${logoOnSky.atMs} ms) : fond attendu top=${logoOnSky.expectedBgTop} ; observé top=${logoOnSky.observedBgTop ?? "n/a"} (${logoOnSky.observedBgStorage ?? "n/a"}) ; Δ=${logoOnSky.deltaTopPx ?? "n/a"} px`);
    console.log("Calques :");
    for (const layer of layerCheckpoints.filter((entry) => entry.modelTimeMs === 173750)) {
      console.log(`  ${layer.layerId} t=${layer.modelTimeMs} : modèle (${layer.expected?.x}, ${layer.expected?.y}) op=${layer.expected?.opacity} ; observé (${layer.observed?.x ?? "n/a"}, ${layer.observed?.y ?? "n/a"}) op=${layer.observed?.opacity ?? "n/a"} ; Δ=${layer.delta ? `(${layer.delta.x}, ${layer.delta.y}) px` : "n/a"}`);
    }
    const bgOffsets = bgSync.filter((entry) => entry.offsetMs !== null).map((entry) => entry.offsetMs!);
    console.log(`Sync fonds : ${bgSync.filter((entry) => entry.matched).length}/${bgSync.length} changements appariés ; offsets ms = [${bgOffsets.join(", ")}]`);
    console.log(`Sync audio : ${audioSync.filter((entry) => entry.observedAtMs !== null).length}/${audioSync.length} événements appariés ; offsets ms = [${audioSync.map((entry) => entry.offsetMs ?? "n/a").join(", ")}]`);
    console.log(`Animations demandées (ms) : [${animationDurations.join(", ")}] ; fondus attendus : [${fadeDurations.join(", ")}]`);
    console.log(
      `Ouverture : ${titleTransition.openingDurationMs === null ? "titre non atteint" : `${(titleTransition.openingDurationMs / 1000).toFixed(2)} s (modèle ${(scene.duration / 1000).toFixed(2)} s, Δ=${titleTransition.durationDeltaMs} ms)`} ; ` +
        `fermeture → titre : ${titleTransition.closingTransitionMs === null ? "n/a" : `${titleTransition.closingTransitionMs} ms`} ; phases : ${titleTransition.phases.map((phase) => `${phase.phase}=${phase.durationMs} ms`).join(", ")}`,
    );

    // ── Mode référence (vidéo OP du propriétaire) ──
    if (cli.reference !== null) {
      const referenceFrames = extractReferenceFrames(cli.reference, join(cli.out, "reference-frames"));
      if (referenceFrames) {
        const referenceLuminances = await analyzeFrames(`${fileServer.url}/reference-frames`, referenceFrames.length);
        // Alignement temporel grossier (~0,1 s) par corrélation des luminances (10 im/s de référence).
        const resample = (values: number[], stepMs: number): number[] => {
          const out: number[] = [];
          for (let t = 0; t < values.length * stepMs; t += 100) {
            const position = t / stepMs;
            const index = Math.min(values.length - 1, Math.floor(position));
            const next = Math.min(values.length - 1, index + 1);
            const p = position - index;
            out.push(values[index]! * (1 - p) + values[next]! * p);
          }
          return out;
        };
        const ours = resample(luminances, 100);
        const reference = resample(referenceLuminances, 100);
        let bestLag = 0;
        let bestScore = -2;
        for (let lag = -200; lag <= 200; lag++) {
          const shifted: number[] = [];
          for (let i = 0; i < ours.length - Math.abs(lag); i++) shifted.push(reference[i + (lag > 0 ? lag : 0)] ?? 0);
          const score = pearson(ours.slice(Math.max(0, -lag)), shifted);
          if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
          }
        }
        const referenceFlash = analyzeFlash(referenceLuminances.map((value, index) => ({ t: index * 100, value })));
        report.referenceComparison = {
          frames: referenceFrames.length,
          alignmentLagMs: bestLag * 100,
          alignmentScore: Math.round(bestScore * 1000) / 1000,
          flash: {
            ours: flash.intervals.map((interval) => ({ peakMs: Math.round(interval.peakMs), durationMs: Math.round(interval.durationMs) })),
            reference: referenceFlash.intervals.map((interval) => ({ peakMs: Math.round(interval.peakMs + bestLag * 100), durationMs: Math.round(interval.durationMs) })),
          },
        };
        writeFileSync(join(cli.out, "rapport.json"), JSON.stringify(report, null, 2), "utf-8");
        console.log(`Référence : ${referenceFrames.length} images, alignement ${bestLag * 100} ms (corrélation ${bestScore.toFixed(3)})`);
      }
    }
    console.log(`\n[opening] rapport : ${join(cli.out, "rapport.json")}`);
    if (cli.strict) {
      const flashOk = flash.intervals.length >= 1;
      const panOk = bgCheckpoints.every((point) => point.deltaPx !== null);
      if (!flashOk || !panOk) process.exitCode = 1;
    }
  } finally {
    await browser.close().catch(() => undefined);
    await fileServer.stop();
  }
}

await main();
