/**
 * Lanceur du mode revue (#400) — `npm run review`.
 *
 * - build optionnel (`--no-build`), serveur local `vite preview` (ou `--url` pour un déploiement) ;
 * - **navigateur visible** (Playwright chromium/firefox) ouvert sur `?review=1` ;
 * - journal continu : `console` (warn/error), `pageerror`, réponses HTTP ≥ 400 →
 *   `reports/review-console.log` (désactivable avec `--no-console-log`) ;
 * - à la fermeture du navigateur : récupération des flags (poll `window.__mhReview.dump()`) →
 *   `reports/review-session.json` (captures inline) + `reports/review-shots/*.jpg` + résumé console.
 *
 * Aucun asset du jeu n'est commité : le build local lie `public/assets` dans `dist/assets`.
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "fs";
import { createServer as createNetServer } from "net";
import { join, resolve } from "path";
import { chromium, firefox, type Browser, type Page } from "playwright";
import { buildReviewUrl, parseReviewArgs, reviewShotName, summarizeReviewSession } from "./review-lib.js";

const ROOT = resolve(import.meta.dirname, "..");
const DIST_DIR = join(ROOT, "dist");

function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const server = createNetServer();
    server.once("error", ko);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => ok(port));
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // serveur pas prêt
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`serveur non disponible : ${url}`);
}

/** Lie les assets réels dans `dist/assets` (évite de copier plusieurs Go). */
function linkRealAssets(assetsDir: string): void {
  const target = join(DIST_DIR, "assets");
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(assetsDir)) {
    const destination = join(target, name);
    if (existsSync(destination) || lstatSync(destination, { throwIfNoEntry: false })) continue;
    symlinkSync(join(assetsDir, name), destination, "junction");
  }
}

function build(): void {
  console.log("[review] build vite…");
  const result = spawnSyncVite();
  if (result !== 0) throw new Error("échec du build vite (voir les logs ci-dessus)");
}

function spawnSyncVite(): number {
  const result = spawnSync(join(ROOT, "node_modules", ".bin", "vite"), ["build", "--logLevel", "warn"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

async function startPreview(port: number | null): Promise<{ url: string; stop: () => Promise<void> }> {
  const chosen = port ?? (await freePort());
  const child = spawn(join(ROOT, "node_modules", ".bin", "vite"), ["preview", "--host", "127.0.0.1", "--port", String(chosen), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${chosen}/`;
  try {
    await waitForHttp(url);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return { url, stop: () => new Promise<void>((done) => { child.kill("SIGTERM"); child.once("exit", () => done()); }) };
}

type SessionDump = {
  flags: { id: string; capture?: string | null; category: string; script?: { scriptName?: string | null } | null; createdAt?: string }[];
};

async function main(): Promise<void> {
  const options = parseReviewArgs(process.argv.slice(2));
  mkdirSync(options.outDir, { recursive: true });
  const consoleLogPath = join(options.outDir, "review-console.log");
  const shotsDir = join(options.outDir, "review-shots");
  mkdirSync(shotsDir, { recursive: true });

  let baseUrl = options.url;
  let server: { url: string; stop: () => Promise<void> } | null = null;
  if (!baseUrl) {
    if (!options.noBuild) {
      build();
      linkRealAssets(join(options.assets, "assets"));
    } else if (!existsSync(join(DIST_DIR, "index.html"))) {
      throw new Error("dist/ absent : lancer sans --no-build");
    }
    server = await startPreview(options.port);
    baseUrl = server.url;
  }
  const url = buildReviewUrl(baseUrl);
  console.log(`[review] URL : ${url}`);
  console.log("[review] F2 = poser un flag · F3 = exporter · F4 = copier · fermer le navigateur pour terminer la session.");

  const lines: string[] = [];
  const logLine = (text: string): void => {
    lines.push(text);
    console.log(text);
    if (options.consoleLog) {
      try {
        writeFileSync(consoleLogPath, `${lines.join("\n")}\n`, "utf-8");
      } catch {
        // ignore
      }
    }
  };
  logLine(`[review] session ${new Date().toISOString()} — ${url}`);

  const browserType = options.browser === "firefox" ? firefox : chromium;
  let browser: Browser | null = null;
  let latest: SessionDump | null = null;
  let page: Page | null = null;
  // Fermer proprement le navigateur sur SIGINT/SIGTERM pour que la session soit quand même écrite.
  const closeOnSignal = (): void => {
    void browser?.close().catch(() => undefined);
  };
  process.once("SIGINT", closeOnSignal);
  process.once("SIGTERM", closeOnSignal);
  try {
    browser = await browserType.launch({ headless: false });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") logLine(`[console:${message.type()}] ${message.text().slice(0, 500)}`);
    });
    page.on("pageerror", (error) => logLine(`[pageerror] ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 400) logLine(`[http ${response.status()}] ${response.url().slice(0, 300)}`);
    });

    const poll = setInterval(() => {
      void page
        ?.evaluate("window.__mhReview ? window.__mhReview.dump() : null")
        .then((dump: unknown) => {
          if (dump) latest = dump as SessionDump;
        })
        .catch(() => undefined);
    }, 400);

    const disconnected = new Promise<void>((done) => browser!.once("disconnected", () => done()));
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch((error) => logLine(`[review] navigation : ${String(error)}`));
    // Donne le focus à la page pour que F2/F3/F4 fonctionnent sans clic préalable de l'utilisateur.
    await page.bringToFront().catch(() => undefined);
    await page.mouse.click(6, 6).catch(() => undefined);
    logLine("[review] focus page donné (si aucune touche ne répond : cliquez une fois dans la page)");
    await Promise.race([disconnected, page.waitForEvent("close").catch(() => undefined)]);
    clearInterval(poll);
  } finally {
    process.removeListener("SIGINT", closeOnSignal);
    process.removeListener("SIGTERM", closeOnSignal);
    await browser?.close().catch(() => undefined);
    await server?.stop();
  }

  const session = latest as SessionDump | null;
  const flags = session?.flags ?? [];
  let shots = 0;
  for (const flag of flags) {
    if (!flag.capture || !flag.capture.startsWith("data:image/")) continue;
    const data = flag.capture.split(",")[1] ?? "";
    try {
      writeFileSync(join(shotsDir, reviewShotName(flag.id)), Buffer.from(data, "base64"));
      shots++;
    } catch (error) {
      logLine(`[review] capture non écrite (${flag.id}) : ${String(error)}`);
    }
  }
  const report = {
    kind: "mahoyo-review-session",
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "tools/review.ts",
    url,
    browser: options.browser,
    consoleLog: options.consoleLog ? consoleLogPath : null,
    flags,
  };
  writeFileSync(join(options.outDir, "review-session.json"), JSON.stringify(report, null, 2), "utf-8");
  logLine(`[review] session terminée : ${summarizeReviewSession({ flags })}`);
  if (flags.length === 0) {
    logLine("[review] AUCUN FLAG — aide :");
    logLine("  1. démarrez une partie (Start) ou chargez une sauvegarde ;");
    logLine("  2. cliquez une fois dans la page si les touches ne répondent pas (focus fenêtre) ;");
    logLine("  3. F2 → catégorie (1-7) → note → Entrée ; F3 exporte, F4 copie ;");
    logLine("  4. fermez le navigateur pour terminer la session et récupérer les flags.");
  }
  logLine(`[review] ${join(options.outDir, "review-session.json")} (+ ${shots} capture(s) dans ${shotsDir})`);
  logLine(`[review] journal : ${options.consoleLog ? consoleLogPath : "désactivé"}`);
}

await main();
