/**
 * Lanceur du mode revue (#400) — `npm run review`.
 *
 * Deux modes (#405) :
 * - **automatique** (défaut) : build optionnel, `vite preview` (ou `--url`), navigateur **visible**
 *   Playwright (`chromium`/`firefox`) ouvert sur `?review=1` ; la session est sauvegardée **à chaque
 *   flag** dans `reports/review-session.json` (+ `reports/review-shots/`), la raison de fin est
 *   journalisée (`page.close`/`page.crash`/`browser.disconnected`) ;
 * - **manuel** (`--manual` / `--no-open`) : **pas de Playwright** ; sert l'app et affiche l'URL
 *   `?review=1` à ouvrir dans le navigateur du propriétaire, jusqu'à Ctrl+C. Le JSON est récupéré
 *   par **F3** (téléchargement) ; F4 copie le JSON.
 *
 * Journal continu (console warn/error, `pageerror`, HTTP ≥ 400) dans `reports/review-console.log`.
 * Aucun asset du jeu n'est commité : le build local lie `public/assets` dans `dist/assets`.
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "fs";
import { createServer as createNetServer } from "net";
import { join, resolve } from "path";
import { chromium, firefox, type Browser, type Page } from "playwright";
import {
  buildReviewUrl,
  buildSessionPayload,
  dumpFlagCount,
  dumpFlags,
  endReasonMessage,
  parseReviewArgs,
  playwrightShotName,
  summarizeReviewSession,
  writeSession,
  zeroFlagHelpLines,
  type ReviewEndReason,
  type ReviewSessionFlag,
} from "./review-lib.js";

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

function spawnSyncVite(): number {
  const result = spawnSync(join(ROOT, "node_modules", ".bin", "vite"), ["build", "--logLevel", "warn"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

function build(): void {
  console.log("[review] build vite…");
  const result = spawnSyncVite();
  if (result !== 0) throw new Error("échec du build vite (voir les logs ci-dessus)");
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
  return {
    url,
    stop: () =>
      new Promise<void>((done) => {
        child.kill("SIGTERM");
        child.once("exit", () => done());
      }),
  };
}

/** Attend Ctrl+C / SIGTERM (mode manuel) en gardant la boucle d'événements active. */
function waitForSignal(): Promise<void> {
  return new Promise((done) => {
    // Un listener de signal ne maintient pas la boucle : sans ce timer, Node sortirait aussitôt
    // (« unsettled top-level await ») et le serveur manuel ne resterait pas disponible.
    const keepAlive = setInterval(() => undefined, 1000);
    const finish = (): void => {
      clearInterval(keepAlive);
      process.removeListener("SIGINT", finish);
      process.removeListener("SIGTERM", finish);
      done();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

type SessionDump = { flags?: ReviewSessionFlag[] };

async function main(): Promise<void> {
  const options = parseReviewArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
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

  const lines: string[] = [];
  const logLine = (text: string): void => {
    lines.push(text);
    console.log(text);
    if (options.consoleLog) {
      try {
        writeFileSync(consoleLogPath, `${lines.join("\n")}\n`, "utf-8");
      } catch {
        // journal non bloquant
      }
    }
  };
  logLine(`[review] session ${startedAt} — ${url}`);

  // ── Mode manuel (#405) : aucun navigateur Playwright, l'utilisateur ouvre l'URL ────────────
  if (options.manual) {
    logLine("[review] MODE MANUEL : aucune fenêtre Playwright ne sera lancée.");
    logLine(`[review] Ouvrez cette URL dans votre navigateur : ${url}`);
    logLine("[review] F2 = marquer un passage · F3 = exporter review-session.json (téléchargement) · F4 = copier le JSON.");
    logLine("[review] Quand vous avez terminé, récupérez le JSON via F3 (ou F4), puis Ctrl+C ici pour arrêter le serveur.");
    logLine("[review] Le mode manuel est recommandé si la fenêtre automatique se ferme toute seule.");
    await waitForSignal();
    await server?.stop();
    logLine(`[review] serveur arrêté — session manuelle terminée (${new Date().toISOString()}).`);
    logLine("[review] Le JSON de session vient de F3 dans votre navigateur (dossier Téléchargements).");
    return;
  }

  console.log(`[review] URL : ${url}`);
  console.log("[review] F2 = poser un flag · F3 = exporter · F4 = copier · fermer le navigateur pour terminer la session.");

  const browserType = options.browser === "firefox" ? firefox : chromium;
  let browser: Browser | null = null;
  let latest: SessionDump | null = null;
  let page: Page | null = null;
  let endReason: ReviewEndReason | null = null;
  let endedAt: string | null = null;
  let savedFlagsCount = 0;
  let saving = false;

  const persist = (final: boolean): void => {
    if (saving) return;
    saving = true;
    try {
      const flags = dumpFlags(latest);
      const ended = endedAt ?? new Date().toISOString();
      const session = buildSessionPayload({
        url,
        browser: options.browser,
        consoleLog: options.consoleLog ? consoleLogPath : null,
        flags,
        startedAt,
        endedAt: ended,
        endReason: final ? endReason : null,
      });
      const written = writeSession(options.outDir, session);
      savedFlagsCount = flags.length;
      logLine(
        `[review] session sauvegardée${final ? " (finale)" : " (incrémentale)"} : ${flags.length} flag(s), ${written.shots} capture(s) → ${written.sessionPath}`,
      );
    } catch (error) {
      logLine(`[review] échec de sauvegarde de la session : ${String(error)}`);
    } finally {
      saving = false;
    }
  };

  const markEnd = (reason: ReviewEndReason, detail: string): void => {
    if (endReason !== null) return;
    endReason = reason;
    endedAt = new Date().toISOString();
    const flagsCount = dumpFlagCount(latest);
    logLine(`[review] ${endedAt} ${detail}`);
    logLine(`[review] raison de fin : ${endReasonMessage(reason, flagsCount, Date.now() - new Date(startedAt).getTime())}`);
  };

  // Fermer proprement le navigateur sur SIGINT/SIGTERM pour que la session soit écrite.
  const closeOnSignal = (): void => {
    markEnd("signal", "interruption par signal (Ctrl+C/SIGTERM)");
    void browser?.close().catch(() => undefined);
  };
  process.once("SIGINT", closeOnSignal);
  process.once("SIGTERM", closeOnSignal);
  try {
    browser = await browserType.launch({ headless: false });
    browser.on("disconnected", () => {
      if (page && !page.isClosed()) return;
      markEnd("disconnected", "navigateur déconnecté (fenêtre fermée ou processus terminé)");
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    page.on("crash", () => markEnd("crash", "page en crash (crash du renderer)"));
    page.on("close", () => markEnd("external-close", "page fermée (fermeture externe : Cmd+W/Cmd+Q, croix, gestionnaire de fenêtres)"));
    page.on("console", (message) => {
      if (message.type() === "warning" || message.type() === "error") logLine(`[console:${message.type()}] ${message.text().slice(0, 500)}`);
    });
    page.on("pageerror", (error) => logLine(`[pageerror] ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 400) logLine(`[http ${response.status()}] ${response.url().slice(0, 300)}`);
    });

    // Sauvegarde incrémentale : dès qu'un nouveau flag apparaît, on écrit la session (ne rien perdre
    // si la fenêtre se ferme ensuite). Le poll sert aussi de source pour la sauvegarde finale.
    const poll = setInterval(() => {
      void page
        ?.evaluate("window.__mhReview ? window.__mhReview.dump() : null")
        .then((dump: unknown) => {
          if (!dump) return;
          latest = dump as SessionDump;
          const count = dumpFlagCount(dump);
          if (count <= savedFlagsCount) return;
          const previousCount = savedFlagsCount;
          const fresh = dumpFlags(dump).slice(previousCount);
          persist(false);
          // Capture Playwright de secours (#415) : rendu navigateur complet (cadre compris),
          // utile si la capture html2canvas du jeu reste insuffisante.
          if (options.playwrightShots) {
            for (const flag of fresh) {
              const shotPath = join(shotsDir, playwrightShotName(flag.id));
              void page
                ?.screenshot({ path: shotPath, type: "png" })
                .then(() => logLine(`[review] capture Playwright : ${shotPath}`))
                .catch((error) => logLine(`[review] capture Playwright impossible (${flag.id}) : ${String(error)}`));
            }
          }
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

  const flags = dumpFlags(latest);
  const durationMs = Date.now() - new Date(startedAt).getTime();
  if (endReason === null) endReason = "disconnected";
  endedAt ??= new Date().toISOString();
  persist(true);

  logLine(`[review] session terminée : ${summarizeReviewSession({ flags })}`);
  logLine(`[review] raison de fin : ${endReasonMessage(endReason, flags.length, durationMs)}`);
  for (const line of zeroFlagHelpLines(flags.length, durationMs)) logLine(line);
  logLine(`[review] ${join(options.outDir, "review-session.json")} (${flags.length} flag(s), dossier captures : ${shotsDir})`);
  logLine(`[review] journal : ${options.consoleLog ? consoleLogPath : "désactivé"}`);
}

await main();
