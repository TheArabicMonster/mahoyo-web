/**
 * Helpers purs du lanceur `npm run review` (#400) : options, URL de revue et résumé.
 * Séparés du lanceur pour être testés sans navigateur ni serveur.
 */
import { resolve } from "path";

export type ReviewBrowser = "chromium" | "firefox";

export type ReviewLauncherOptions = {
  /** URL existante à tester (`--url`) ; sinon un serveur local est lancé. */
  url: string | null;
  /** Port du serveur local (`--port`) ; null = port libre. */
  port: number | null;
  browser: ReviewBrowser;
  /** Dossier `publicDir` contenant `assets/` pour le build (assets réels locaux). */
  assets: string;
  /** Réutilise `dist/` existant au lieu de rebuild. */
  noBuild: boolean;
  /** Journalise console/pageerror/HTTP ≥ 400 dans `reports/review-console.log`. */
  consoleLog: boolean;
  /** Dossier des rapports (défaut : `reports/`). */
  outDir: string;
};

export function parseReviewArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ReviewLauncherOptions {
  const root = resolve(import.meta.dirname, "..");
  const options: ReviewLauncherOptions = {
    url: null,
    port: null,
    browser: "chromium",
    assets: env.MAHOYO_E2E_ASSETS?.trim() || resolve(root, "public"),
    noBuild: false,
    consoleLog: true,
    outDir: resolve(root, "reports"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") options.url = argv[++i] ?? options.url;
    else if (arg === "--port") options.port = Number.parseInt(argv[++i] ?? "", 10) || null;
    else if (arg === "--browser") options.browser = argv[++i] === "firefox" ? "firefox" : "chromium";
    else if (arg === "--assets") options.assets = resolve(argv[++i] ?? options.assets);
    else if (arg === "--no-build") options.noBuild = true;
    else if (arg === "--no-console-log") options.consoleLog = false;
    else if (arg === "--out") options.outDir = resolve(argv[++i] ?? options.outDir);
    else if (arg === "--help") {
      console.log(
        "Usage : npm run review -- [--url <url>] [--port N] [--browser chromium|firefox] [--assets <public>] [--no-build] [--no-console-log] [--out <dir>]",
      );
      process.exit(0);
    } else console.warn(`[review] argument ignoré : ${arg}`);
  }
  return options;
}

/** Ajoute `review=1` à une URL (base locale ou déploiement existant) sans perdre les paramètres. */
export function buildReviewUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("review", "1");
  return url.toString();
}

/** Nom de fichier de capture d'un flag (sans chemin). */
export function reviewShotName(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`;
}

/** Ligne de résumé d'une session exportée (helper pur, testé). */
export function summarizeReviewSession(session: {
  flags: readonly { category: string; script?: { scriptName?: string | null } | null }[];
}): string {
  if (session.flags.length === 0) return "Aucun flag posé pendant la session.";
  const byCategory = new Map<string, number>();
  const scripts = new Set<string>();
  for (const flag of session.flags) {
    byCategory.set(flag.category, (byCategory.get(flag.category) ?? 0) + 1);
    const script = flag.script?.scriptName;
    if (script) scripts.add(script);
  }
  const categories = [...byCategory.entries()].map(([category, count]) => `${category}=${count}`).join(", ");
  return `${session.flags.length} flag(s) — ${categories} — script(s) : ${[...scripts].join(", ") || "n/a"}`;
}
