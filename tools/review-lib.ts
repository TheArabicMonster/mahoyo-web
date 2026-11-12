/**
 * Helpers purs du lanceur `npm run review` (#400) : options, URL de revue et résumé.
 * Séparés du lanceur pour être testés sans navigateur ni serveur.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

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
  /**
   * Mode manuel (`--manual` / `--no-open`) : ne lance pas Playwright ; sert l'app et affiche
   * l'URL à ouvrir dans le navigateur du propriétaire (F3 exporte le JSON), jusqu'à Ctrl+C.
   */
  manual: boolean;
  /**
   * Capture Playwright de secours (#415) en mode automatique : `review-shots/playwright-<id>.png`
   * à chaque nouveau flag (rendu navigateur complet, cadre compris) ; `--no-playwright-shots`
   * désactive.
   */
  playwrightShots: boolean;
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
    manual: false,
    playwrightShots: true,
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
    else if (arg === "--manual" || arg === "--no-open") options.manual = true;
    else if (arg === "--playwright-shots") options.playwrightShots = true;
    else if (arg === "--no-playwright-shots") options.playwrightShots = false;
    else if (arg === "--out") options.outDir = resolve(argv[++i] ?? options.outDir);
    else if (arg === "--help") {
      console.log(
        "Usage : npm run review -- [--manual|--no-open] [--url <url>] [--port N] [--browser chromium|firefox] [--assets <public>] [--no-build] [--no-console-log] [--no-playwright-shots] [--out <dir>]",
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

/** Nom de la capture Playwright de secours d'un flag (#415). */
export function playwrightShotName(id: string): string {
  return `playwright-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
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

// ── Session de revue, raison de fin et sauvegarde incrémentale (#405) ─────────

export type ReviewSessionFlag = {
  id: string;
  category: string;
  capture?: string | null;
  script?: { scriptName?: string | null } | null;
  createdAt?: string;
};

/** Raison de fin d'une session automatique (diagnostic #405). */
export type ReviewEndReason = "external-close" | "crash" | "disconnected" | "signal" | "unknown";

export type ReviewSession = {
  kind: "mahoyo-review-session";
  version: 1;
  generatedAt: string;
  source: "tools/review.ts";
  url: string;
  browser: string;
  consoleLog: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** Raison de fin (null en mode manuel, où il n'y a pas de fenêtre Playwright à surveiller). */
  endReason: ReviewEndReason | null;
  flags: ReviewSessionFlag[];
};

export function buildSessionPayload(input: {
  url: string;
  browser: string;
  consoleLog: string | null;
  flags: readonly ReviewSessionFlag[];
  startedAt: string;
  endedAt?: string;
  endReason?: ReviewEndReason | null;
}): ReviewSession {
  const endedAt = input.endedAt ?? new Date().toISOString();
  const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(input.startedAt).getTime());
  return {
    kind: "mahoyo-review-session",
    version: 1,
    generatedAt: endedAt,
    source: "tools/review.ts",
    url: input.url,
    browser: input.browser,
    consoleLog: input.consoleLog,
    startedAt: input.startedAt,
    endedAt,
    durationMs,
    endReason: input.endReason ?? null,
    flags: input.flags.map((flag) => ({ ...flag })),
  };
}

/** Message clair de fin de session (journaux + résumé console). */
export function endReasonMessage(reason: ReviewEndReason | null, flagsCount: number, durationMs: number): string {
  const saved = `${flagsCount} flag(s) sauvegardé(s)`;
  const seconds = Math.round(durationMs / 1000);
  switch (reason) {
    case "crash":
      return `fenêtre fermée (crash du navigateur) après ${seconds} s — ${saved} ; relancez avec \`npm run review -- --manual\` pour éviter la fenêtre Playwright.`;
    case "external-close":
      return `fenêtre fermée (fermeture externe : Cmd+W/Cmd+Q, croix, gestionnaire de fenêtres) après ${seconds} s — ${saved} ; si c'est vous qui avez fermé, relancez avec \`npm run review -- --manual\`.`;
    case "disconnected":
      return `navigateur déconnecté (fenêtre fermée ou processus terminé) après ${seconds} s — ${saved} ; relancez avec \`npm run review -- --manual\` si la fenêtre se ferme seule.`;
    case "signal":
      return `session interrompue par un signal (Ctrl+C) après ${seconds} s — ${saved} ; relancez avec le mode automatique ou --manual.`;
    case null:
      return `session terminée après ${seconds} s — ${saved}.`;
    default:
      return `session terminée (raison inconnue) après ${seconds} s — ${saved} ; relancez avec \`npm run review -- --manual\`.`;
  }
}

/**
 * Aide si aucun flag n'a été posé : hypothèses (focus, fermeture externe, crash) et suggestion du
 * mode manuel, en particulier pour une session courte (< 60 s, cas du propriétaire #405).
 */
export function zeroFlagHelpLines(flagsCount: number, durationMs: number): string[] {
  if (flagsCount > 0) return [];
  const lines = ["[review] AUCUN FLAG — hypothèses :"];
  lines.push("  1. focus fenêtre : cliquez une fois dans la page, puis F2 → catégorie (1-7) → Entrée ;");
  lines.push("  2. fermeture externe (Cmd+W/Cmd+Q, croix, gestionnaire) ou crash : voir la raison de fin ci-dessus ;");
  lines.push("  3. dans tous les cas, essayez le mode manuel (fenêtre Playwright non utilisée) :");
  lines.push("     npm run review -- --manual   (ouvrez l'URL affichée dans votre navigateur, F3 exporte le JSON)");
  if (durationMs < 60_000) {
    lines.push("  4. session courte (< 60 s) : la fenêtre s'est probablement fermée seule — le mode manuel est recommandé.");
  }
  lines.push("  5. vérifiez aussi que la partie est démarrée (Start) avant de marquer un passage.");
  return lines;
}

/** Écrit `review-session.json` + les captures JPEG ; utilisable à chaque flag (sauvegarde continue). */
export function writeSession(outDir: string, session: ReviewSession): { sessionPath: string; shotsDir: string; shots: number } {
  mkdirSync(outDir, { recursive: true });
  const shotsDir = join(outDir, "review-shots");
  mkdirSync(shotsDir, { recursive: true });
  let shots = 0;
  for (const flag of session.flags) {
    if (!flag.capture || !flag.capture.startsWith("data:image/")) continue;
    const data = flag.capture.split(",")[1] ?? "";
    writeFileSync(join(shotsDir, reviewShotName(flag.id)), Buffer.from(data, "base64"));
    shots++;
  }
  const sessionPath = join(outDir, "review-session.json");
  writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8");
  return { sessionPath, shotsDir, shots };
}

/** Nombre de flags d'un dump éventuel (`window.__mhReview.dump()`). */
export function dumpFlagCount(dump: unknown): number {
  if (!dump || typeof dump !== "object") return 0;
  const flags = (dump as { flags?: unknown }).flags;
  return Array.isArray(flags) ? flags.length : 0;
}

/** Convertit un dump du navigateur en flags de session (tolérant). */
export function dumpFlags(dump: unknown): ReviewSessionFlag[] {
  if (!dump || typeof dump !== "object") return [];
  const flags = (dump as { flags?: unknown }).flags;
  if (!Array.isArray(flags)) return [];
  return flags.filter((flag): flag is ReviewSessionFlag => Boolean(flag) && typeof (flag as ReviewSessionFlag).id === "string");
}
