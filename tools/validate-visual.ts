/**
 * Validation visuelle automatisée #315/#316 (#347) — capture reproductible + mesures.
 *
 * Principe : rejoue le début du script `1-2.ks` (scène du professeur) avec les **assets réels**
 * locaux (jamais commités), capture une séquence d'images et la pose du plan rapproché
 * (`山城01(大)` + `im14青子背中(制服)`), puis mesure :
 *  1. **Sprite (#315)** : alignement décor ↔ sprite par corrélation de modèle (zone décor de la
 *     fenêtre/bureau de la frame de référence `real-f/f_0256.jpg` et buste du professeur), puis
 *     écart relatif du nœud de cravate vs décor — critère ≤ 1 % de la largeur/hauteur ;
 *  2. **Transitions (#316)** : instants de fondu détectés sur la séquence capturée (luminosité
 *     moyenne de la scène image par image), durées mesurées vs `time=` des `@trans`/`@bg` du
 *     segment, et absence de cut parasite (saut d'une image hors fondu).
 *
 * Aucun asset/capture n'est commité : tout est écrit sous `--out` (défaut /tmp/mahoyo-visual).
 * Les assets réels sont requis (validation locale, pas CI) :
 *   MAHOYO_E2E_ASSETS=/chemin/vers/public npm run validate:visual
 *
 * Prérequis : Playwright (déjà en devDependency), dossier d'assets réels (`public/assets`).
 * La capture force `story-chain.json` à démarrer sur `1-2.ks` : la séquence capturée commence à
 * l'arrivée de l'héroïne au lycée, comme la fin de l'enregistrement de référence.
 */
import { spawn } from "child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { createServer as createHttpServer } from "http";
import { createServer as createNetServer } from "net";
import { extname, join, resolve } from "path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_OUT = "/tmp/mahoyo-visual";
const DEFAULT_REFERENCE = "/tmp/mahoyo-cmp/real-f/f_0256.jpg";

/** Zone décor de la frame de référence, en coordonnées normalisées 1280×720 (bureau/étagère). */
const DECOR_BOX = { x: 560, y: 380, w: 240, h: 140 };
/** Buste du professeur (cravate + revers), coordonnées normalisées 1280×720. */
const SPRITE_BOX = { x: 900, y: 260, w: 140, h: 140 };
/** Nœud de cravate, point de contrôle relatif au décor (coordonnées normalisées 1280×720). */
const TIE_POINT = { x: 940, y: 330 };
/** Durées nominales des transitions du segment capturé (1-2.ks, pages 0→16), en ms. */
const NOMINAL_TRANSITIONS_MS = [100, 600, 1200, 1200, 1200, 600, 600, 600, 600, 600, 1200];
/** Tolérance sur les durées de fondu mesurées vs `time=`. */
const FADE_TOLERANCE = 0.3;
/** Critère d'alignement sprite vs décor (#315). */
const SPRITE_TOLERANCE_PCT = 1;

type Cli = {
  assets: string;
  out: string;
  reference: string | null;
  maxPresses: number;
  strict: boolean;
};

function parseArgs(argv: readonly string[]): Cli {
  const cli: Cli = {
    assets: process.env.MAHOYO_E2E_ASSETS?.trim() || join(ROOT, "public"),
    out: DEFAULT_OUT,
    reference: DEFAULT_REFERENCE,
    maxPresses: 400,
    strict: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--assets") cli.assets = resolve(argv[++i] ?? cli.assets);
    else if (arg === "--out") cli.out = resolve(argv[++i] ?? cli.out);
    else if (arg === "--reference") cli.reference = resolve(argv[++i] ?? "");
    else if (arg === "--max-presses") cli.maxPresses = Number.parseInt(argv[++i] ?? "", 10) || cli.maxPresses;
    else if (arg === "--strict") cli.strict = true;
    else if (arg === "--help") {
      console.log("Usage : npm run validate:visual -- [--assets <public>] [--out <dir>] [--reference <frame.jpg>] [--max-presses N] [--strict]");
      process.exit(0);
    } else console.warn(`[visual] argument ignoré : ${arg}`);
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
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`serveur non disponible : ${url}`);
}

/** Serveur statique minimal pour les images d'analyse (fichiers externes, hors dépôt). */
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
      const type = extname(path) === ".png" ? "image/png" : extname(path) === ".jpg" ? "image/jpeg" : "text/html";
      res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
      res.end(readFileSync(path));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      ok({
        url: `http://127.0.0.1:${port}`,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** Capture : joue 1-2 jusqu'au plan rapproché du professeur, enregistre la séquence. */
async function capture(cli: Cli): Promise<{
  framesDir: string;
  scenePath: string;
  timeline: { t: number; press: number; phase: string | null; animations: { id: string; duration: number; state: string; current: number | null }[] }[];
  nearPath: string | null;
}> {
  const framesDir = join(cli.out, "frames");
  mkdirSync(framesDir, { recursive: true });
  const port = await freePort();
  const viteBin = join(ROOT, "node_modules", ".bin", "vite");
  const serverLog = join(cli.out, "vite.log");
  const server = spawn(viteBin, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", openSync(serverLog, "w"), openSync(serverLog, "w")],
    env: { ...process.env, MAHOYO_E2E_ASSETS: cli.assets, MAHOYO_E2E_REAL_ASSETS: "1", MAHOYO_E2E_ASSETS_MODE: "real" },
  });
  const baseUrl = `http://127.0.0.1:${port}/`;
  await waitForHttp(baseUrl);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.warn("[visual] erreur page :", e.message));
  const chain = JSON.parse(readFileSync(join(cli.assets, "assets", "story-chain.json"), "utf-8"));
  chain.first = "1-2.ks";
  chain.chapters = [{ id: "1-2", label: "Capture 1-2", file: "1-2.ks", arc: "Capture" }];
  await page.route("**/story-chain.json", (route) => route.fulfill({ json: chain }));

  const timeline: { t: number; press: number; phase: string | null; animations: { id: string; duration: number; state: string; current: number | null }[] }[] = [];
  const start = Date.now();
  let frameIndex = 0;
  let nearPath: string | null = null;
  let scenePath = "";
  let sceneShot = false;

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.locator(".mh-ui-new-game").waitFor({ state: "visible", timeout: 30000 });
    await page.locator(".mh-ui-new-game").click();
    await page.waitForTimeout(1200);

    for (let press = 0; press < cli.maxPresses; press++) {
      const info = await page.evaluate(() => ({
        sprites: (Array.from(document.querySelectorAll("img.mh-stage-sprite")) as HTMLImageElement[]).map((img) => ({
          src: decodeURIComponent(img.getAttribute("src") || ""),
          w: img.naturalWidth,
          h: img.naturalHeight,
        })),
        phase: document.querySelector("#ui-transition")?.getAttribute("data-phase") ?? null,
        animations: (document.getAnimations() as Animation[])
          .map((animation) => {
            const effect = animation.effect as KeyframeEffect | null;
            const target = effect?.target as HTMLElement | null;
            const timing = effect?.getTiming();
            const duration = typeof timing?.duration === "number" ? timing.duration : null;
            if (duration === null || duration < 80) return null;
            const id = `${target?.className ?? target?.id ?? "?"}:${Math.round(duration)}`;
            return { id, duration: Math.round(duration), state: animation.playState as string, current: animation.currentTime === null ? null : Math.round(Number(animation.currentTime)) };
          })
          .filter((entry): entry is { id: string; duration: number; state: string; current: number | null } => entry !== null),
      }));
      const teacher = info.sprites.find((s) => s.src.includes("山城01"));
      const big = info.sprites.some((s) => s.src.includes("山城01(大)"));
      if (teacher && !nearPath) nearPath = join(cli.out, "scene-near.jpg");

      const file = join(framesDir, `frame_${String(frameIndex).padStart(4, "0")}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 80 });
      timeline.push({ t: Date.now() - start, press, phase: info.phase, animations: info.animations });
      frameIndex++;

      if (big && !sceneShot) {
        // Fin de frappe : indicateur visible ou texte stable, puis pause courte (fondu terminé).
        await page.waitForTimeout(1400);
        scenePath = join(cli.out, "scene-big.png");
        await page.screenshot({ path: scenePath, type: "png" });
        sceneShot = true;
        break;
      }
      await page.keyboard.press("Enter");
      await page.waitForTimeout(70);
    }
    if (!sceneShot) throw new Error(`plan rapproché non atteint après ${cli.maxPresses} avancées`);
    if (nearPath) await page.screenshot({ path: nearPath, type: "jpeg", quality: 90 });
  } finally {
    await browser.close().catch(() => undefined);
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }
  return { framesDir, scenePath, timeline, nearPath };
}

/** Script d'analyse injecté dans la page (pur JS, sans transformation TS, exécuté dans Chromium). */
const ANALYSIS_JS = String.raw`
window.__mahoyoAnalyze = async (payload) => {
  const load = (src) => new Promise((ok, ko) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ko(new Error("image " + src)); im.src = src; });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const gray = (im, W, H) => {
    canvas.width = W; canvas.height = H; ctx.clearRect(0, 0, W, H); ctx.drawImage(im, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data; const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = (d[i*4] * 0.299 + d[i*4+1] * 0.587 + d[i*4+2] * 0.114) / 255;
    return g;
  };
  const mean = (g) => { let s = 0; for (let i = 0; i < g.length; i++) s += g[i]; return s / g.length; };
  // NCC d'un modèle (extrait de ref) sur l'image, dans une fenêtre de recherche.
  const match = (img, W, H, ref, RW, tplBox, scales, search) => {
    const box = { x: Math.round(tplBox.x), y: Math.round(tplBox.y), w: Math.round(tplBox.w), h: Math.round(tplBox.h) };
    let best = { score: -2 };
    for (const s of scales) {
      const tw = Math.max(6, Math.round(box.w * s)), th = Math.max(6, Math.round(box.h * s));
      const tpl = new Float32Array(tw * th);
      for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
        const sx = Math.min(RW - 1, Math.round(box.x + i * s)), sy = Math.min(H - 1, Math.round(box.y + j * s));
        tpl[j * tw + i] = ref[sy * RW + sx];
      }
      let sumT = 0, sumT2 = 0; for (let k = 0; k < tpl.length; k++) { sumT += tpl[k]; sumT2 += tpl[k] * tpl[k]; }
      const n = tw * th, meanT = sumT / n, varT = sumT2 - sumT * sumT / n;
      const x0 = Math.max(0, box.x - search), x1 = Math.min(W - tw, box.x + search);
      const y0 = Math.max(0, box.y - search), y1 = Math.min(H - th, box.y + search);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let s1 = 0, s2 = 0, cross = 0, k = 0;
        for (let j = 0; j < th; j++) { const row = (y + j) * W + x; for (let i = 0; i < tw; i++) { const v = img[row + i]; s1 += v; s2 += v * v; cross += v * tpl[k++]; } }
        const meanI = s1 / n, varI = s2 - s1 * s1 / n, den = Math.sqrt(varI * varT);
        const score = den > 1e-9 ? (cross - n * meanI * meanT) / den : 0;
        if (score > best.score) best = { score, x, y, tw, th, scale: s };
      }
    }
    return best;
  };
  const W = 1280, H = 720;
  const scene = await load(payload.sceneUrl);
  // Mesure sprite optionnelle : sans frame de référence, ne pas charger une URL vide (erreur
  // « image » qui interrompait aussi la mesure des transitions, #397).
  let matches = null;
  let tie = null;
  if (payload.referenceUrl) {
    const ref = await load(payload.referenceUrl);
    const gRef = gray(ref, W, H), gScene = gray(scene, W, H);
    const search = 60;
    const decor = match(gScene, W, H, gRef, W, payload.decor, [0.97, 0.98, 0.99, 1, 1.01, 1.02, 1.03], search);
    const sprite = match(gScene, W, H, gRef, W, payload.sprite, [0.95, 0.96, 0.97, 0.98, 0.99, 1, 1.01, 1.02, 1.03, 1.04, 1.05], search);
    // Transformation "référence -> capture" de chaque modèle, appliquée au point de contrôle (nœud).
    const tf = (m, box) => ({ x: m.x + m.scale * (payload.tie.x - box.x), y: m.y + m.scale * (payload.tie.y - box.y), s: m.scale });
    const tieByDecor = tf(decor, payload.decor);
    const tieBySprite = tf(sprite, payload.sprite);
    const delta = { x: tieBySprite.x - tieByDecor.x, y: tieBySprite.y - tieByDecor.y };
    const pct = { x: Math.abs(delta.x) / W * 100, y: Math.abs(delta.y) / H * 100 };
    matches = { decor, sprite };
    tie = { byDecor: tieByDecor, bySprite: tieBySprite, delta, pct };
  }
  // Transitions : luminosité moyenne de la scène (hors bande de texte), frames de la séquence.
  const brightness = [];
  const diffs = [];
  for (const url of payload.frames) {
    const im = await load(url);
    canvas.width = 320; canvas.height = 180; ctx.clearRect(0, 0, 320, 180); ctx.drawImage(im, 0, 0, 320, 180);
    const d = ctx.getImageData(0, 0, 320, 180).data;
    let s = 0, n = 0;
    for (let y = 0; y < 130; y++) for (let x = 0; x < 320; x++) { const i = (y * 320 + x) * 4; s += (d[i] + d[i+1] + d[i+2]) / 3; n++; }
    brightness.push(s / n / 255);
  }
  for (let i = 1; i < brightness.length; i++) diffs.push(Math.abs(brightness[i] - brightness[i-1]));
  return { matches, tie, brightness, diffs, frameCount: payload.frames.length };
};
`;

type AnalysisResult = {
  matches: { decor: { score: number; x: number; y: number; scale: number }; sprite: { score: number; x: number; y: number; scale: number } } | null;
  tie: { byDecor: { x: number; y: number }; bySprite: { x: number; y: number }; delta: { x: number; y: number }; pct: { x: number; y: number } } | null;
  brightness: number[];
  diffs: number[];
  frameCount: number;
};

/** Sessions d'animations WAAPI observées (timeline) : durée demandée et durée murale mesurée. */
type AnimationSession = { id: string; duration: number; startMs: number; endMs: number; wallMs: number };

function animationSessions(timeline: { t: number; animations: { id: string; duration: number; current: number | null }[] }[]): AnimationSession[] {
  const running = new Map<string, { duration: number; startMs: number }>();
  const sessions: AnimationSession[] = [];
  for (const entry of timeline) {
    const present = new Set(entry.animations.map((a) => a.id));
    for (const [id, session] of [...running]) {
      if (!present.has(id)) {
        sessions.push({ id, duration: session.duration, startMs: session.startMs, endMs: entry.t, wallMs: entry.t - session.startMs });
        running.delete(id);
      }
    }
    for (const animation of entry.animations) {
      if (!running.has(animation.id)) {
        // `currentTime` permet d'estimer le début réel entre deux observations (poll ~80 ms).
        running.set(animation.id, { duration: animation.duration, startMs: entry.t - (animation.current ?? 0) });
      }
    }
  }
  for (const [id, session] of running) {
    sessions.push({ id, duration: session.duration, startMs: session.startMs, endMs: timeline.at(-1)?.t ?? session.startMs, wallMs: (timeline.at(-1)?.t ?? session.startMs) - session.startMs });
  }
  return sessions;
}

/** Durées des phases de la transition plein écran (`#ui-transition`), mesurées sur la timeline. */
function curtainPhases(timeline: { t: number; phase: string | null }[]): { phase: string; startMs: number; endMs: number; durationMs: number }[] {
  const out: { phase: string; startMs: number; endMs: number; durationMs: number }[] = [];
  let currentPhase: string | null = null;
  let currentStart = 0;
  for (const entry of timeline) {
    if (entry.phase === currentPhase) continue;
    if (currentPhase !== null) out.push({ phase: currentPhase, startMs: currentStart, endMs: entry.t, durationMs: entry.t - currentStart });
    currentPhase = entry.phase === "idle" ? null : entry.phase;
    currentStart = entry.t;
  }
  if (currentPhase !== null) {
    const end = timeline.at(-1)?.t ?? currentStart;
    out.push({ phase: currentPhase, startMs: currentStart, endMs: end, durationMs: end - currentStart });
  }
  return out.filter((entry) => entry.durationMs > 0 && entry.phase !== null);
}

/** Détecte les fondus (rampes de luminosité) et les cuts (sauts d'une image hors rampe). */
function analyzeFades(brightness: readonly number[], timeline: readonly { t: number }[]): {
  fades: { startFrame: number; endFrame: number; startMs: number; endMs: number; durationMs: number; delta: number; direction: "out" | "in" }[];
  cuts: { frame: number; ms: number; delta: number }[];
} {
  const fades: { startFrame: number; endFrame: number; startMs: number; endMs: number; durationMs: number; delta: number; direction: "out" | "in" }[] = [];
  const cuts: { frame: number; ms: number; delta: number }[] = [];
  const ms = (frame: number): number => timeline[Math.min(frame, timeline.length - 1)]?.t ?? 0;
  const STEP = 0.004; // variation minimale par image pour être une rampe
  let i = 1;
  while (i < brightness.length - 1) {
    const delta = brightness[i]! - brightness[i - 1]!;
    // Un « cut » est un saut isolé (l'image suivante ne poursuit pas la même tendance) ; un fondu
    // continue dans la même direction (éventuellement accéléré), il n'est pas compté.
    const nextStep = i + 1 < brightness.length ? brightness[i + 1]! - brightness[i]! : 0;
    if (Math.abs(delta) > 0.25 && Math.sign(nextStep) !== Math.sign(delta)) {
      cuts.push({ frame: i, ms: ms(i), delta: Math.abs(delta) });
      i++;
      continue;
    }
    if (Math.abs(delta) < STEP) {
      i++;
      continue;
    }
    const direction = delta > 0 ? "in" : "out";
    let j = i;
    let total = delta;
    while (j + 1 < brightness.length) {
      const step = brightness[j + 1]! - brightness[j]!;
      if (Math.sign(step) !== Math.sign(delta) || Math.abs(step) < STEP) break;
      total += step;
      j++;
    }
    if (Math.abs(total) >= 0.06) {
      fades.push({ startFrame: i, endFrame: j, startMs: ms(i), endMs: ms(j + 1), durationMs: ms(j + 1) - ms(i), delta: total, direction });
    }
    i = j + 1;
  }
  return { fades, cuts };
}

/**
 * Apparie les sessions d'animations aux durées nominales (`time=`) : la durée demandée à WAAPI doit
 * être exactement la durée du script ; la durée murale observée la respecte à ±1 image (~100 ms).
 */
function matchAnimationSessions(sessions: readonly AnimationSession[]): { nominalMs: number; measuredMs: number; wallMs: number | null; ratio: number; ok: boolean }[] {
  const long = sessions.filter((session) => session.duration >= 100);
  const out: { nominalMs: number; measuredMs: number; wallMs: number | null; ratio: number; ok: boolean }[] = [];
  const used = new Set<AnimationSession>();
  for (const nominalMs of NOMINAL_TRANSITIONS_MS) {
    let best: AnimationSession | null = null;
    let bestDiff = Infinity;
    for (const session of long) {
      if (used.has(session)) continue;
      const diff = Math.abs(session.duration - nominalMs);
      if (diff < bestDiff) { bestDiff = diff; best = session; }
    }
    if (!best) continue;
    used.add(best);
    const wall = best.startMs >= 0 && Math.abs(best.wallMs - best.duration) <= best.duration * FADE_TOLERANCE ? best.wallMs : null;
    out.push({ nominalMs, measuredMs: best.duration, wallMs: wall, ratio: best.duration / nominalMs, ok: best.duration === nominalMs });
  }
  return out;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  mkdirSync(cli.out, { recursive: true });
  console.log(`[visual] assets : ${cli.assets}`);
  console.log(`[visual] sortie : ${cli.out}`);
  const captureResult = await capture(cli);
  console.log(`[visual] capture : ${captureResult.timeline.length} images jusqu'à ${captureResult.scenePath}`);

  const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), assets: cli.assets, capture: { frames: captureResult.timeline.length, scene: captureResult.scenePath } };
  const referenceExists = cli.reference !== null && existsSync(cli.reference);
  if (!referenceExists) {
    console.warn(`[visual] frame de référence absente (${cli.reference}) — mesure sprite ignorée.`);
    report.warning = "frame de référence absente : mesure sprite non exécutée";
  }

  const fileServer = await startFileServer(cli.out);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(fileServer.url + "/");
    await page.addScriptTag({ content: ANALYSIS_JS });
    const frames = readdirSync(captureResult.framesDir).filter((f) => f.endsWith(".jpg")).sort();
    const frameUrls = frames.map((f) => `${fileServer.url}/frames/${f}`);
    let referenceUrl = "";
    if (referenceExists) {
      // Copie la référence dans le dossier servi (fichier local hors dépôt).
      const refCopy = join(cli.out, "reference.jpg");
      writeFileSync(refCopy, readFileSync(cli.reference!));
      referenceUrl = `${fileServer.url}/reference.jpg`;
    }
    const analysis = (await page.evaluate(`window.__mahoyoAnalyze(${JSON.stringify({ referenceUrl, sceneUrl: `${fileServer.url}/scene-big.png`, decor: DECOR_BOX, sprite: SPRITE_BOX, tie: TIE_POINT, frames: frameUrls })})`)) as AnalysisResult;

    // ── Mesures transitions (#316) : animations WAAPI (durée demandée = time=) + phases rideau ──
    const sessions = animationSessions(captureResult.timeline);
    const animationMatches = matchAnimationSessions(sessions);
    const phases = curtainPhases(captureResult.timeline);
    const { fades, cuts } = analyzeFades(analysis.brightness, captureResult.timeline);
    const matched = animationMatches.filter((m) => m.ok).length;
    const transitionsOk = matched >= 3 && cuts.length === 0;
    report.transitions = { sessions, animationMatches, curtain: phases, fades, cuts, ok: transitionsOk };
    console.log(`[visual] transitions : ${sessions.length} animation(s), ${phases.length} phase(s) de rideau, cuts francs : ${cuts.length}`);
    const byDuration = new Map<number, number>();
    for (const session of sessions) byDuration.set(session.duration, (byDuration.get(session.duration) ?? 0) + 1);
    console.log(`  durées demandées (ms) : ${[...byDuration.entries()].map(([d, n]) => `${d}×${n}`).join(", ")}`);
    for (const phase of phases) console.log(`  rideau ${phase.phase} : ${phase.durationMs} ms`);
    for (const match of animationMatches.filter((m) => m.ok)) {
      const wall = match.wallMs === null ? "n/a" : `${match.wallMs} ms (±1 image)`;
      console.log(`  time=${match.nominalMs} ms → demande ${match.measuredMs} ms, mesuré ${wall}`);
    }
    console.log(`  appariement time= : ${matched}/${animationMatches.length} durées exactes ; ${transitionsOk ? "aucun cut parasite" : "vérifier cuts"}`);

    // ── Mesure sprite ──
    if (referenceExists && analysis.tie && analysis.matches) {
      const tie = analysis.tie;
      const matches = analysis.matches;
      const aligned = tie.pct.x <= SPRITE_TOLERANCE_PCT && tie.pct.y <= SPRITE_TOLERANCE_PCT;
      report.sprite = { matches, tie, tolerancePct: SPRITE_TOLERANCE_PCT, ok: aligned };
      console.log(`[visual] sprite (#315) : décor score ${(matches.decor.score * 100).toFixed(1)} % (échelle ×${matches.decor.scale.toFixed(3)}), sprite score ${(matches.sprite.score * 100).toFixed(1)} %`);
      console.log(`  écart nœud vs décor : Δx=${tie.delta.x.toFixed(1)} px (${tie.pct.x.toFixed(2)} %), Δy=${tie.delta.y.toFixed(1)} px (${tie.pct.y.toFixed(2)} %) → ${aligned ? "OK" : "HORS TOLÉRANCE"}`);
    }

    const reportPath = join(cli.out, "rapport.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    console.log(`[visual] rapport : ${reportPath}`);
    const ok = transitionsOk && (referenceExists ? (report.sprite as { ok: boolean }).ok : true);
    if (!ok) {
      console.log("[visual] verdict : seuils NON respectés (voir rapport)");
      if (cli.strict) process.exitCode = 1;
    } else {
      console.log("[visual] verdict : seuils respectés");
    }
  } finally {
    await browser.close().catch(() => undefined);
    await fileServer.stop();
  }
}

await main();
