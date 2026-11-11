/**
 * Mesure de performance du player : helpers purs et lecture du build (#100).
 *
 * Ce module est volontairement séparé du CLI (`perf-measure.ts`) pour être testable sans navigateur :
 * tailles de bundle (gzip calculé ici), manifest d'assets, et comparaison aux budgets chiffrés
 * (`perf-budgets.ts`). Aucun asset ni texte du jeu n'est lu : seuls des fichiers de build et un
 * manifest dont on compte les clés.
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { extname, join } from "path";
import { gzipSync } from "zlib";

/** Un fichier du bundle (entrée ou chunk). */
export type BundleFile = {
  name: string;
  kind: "js" | "css" | "other";
  rawBytes: number;
  gzipBytes: number;
};

export type SizeTotals = { rawBytes: number; gzipBytes: number };

export type BundleMetrics = {
  files: BundleFile[];
  js: SizeTotals;
  css: SizeTotals;
  /** Tous les fichiers du dossier `assets/` du build (hors sourcemaps). */
  total: SizeTotals;
};

/** Metrics du manifest d'assets : null si aucun manifest n'est disponible (checkout nu). */
export type ManifestMetrics = {
  path: string;
  rawBytes: number;
  gzipBytes: number;
  images: number;
  audio: number;
  scenarios: number;
};

export type BrowserMetrics = {
  /** Titre affiché, chronométré depuis le début de la navigation (ms). */
  firstRenderMs: number;
  domContentLoadedMs: number;
  loadEventMs: number;
  firstContentfulPaintMs: number | null;
  /** Requêtes HTTP émises jusqu'à l'affichage du titre. */
  startupRequests: number;
  /** Somme des `transferSize` des ressources du démarrage (octets). */
  startupTransferBytes: number;
  /** Mémoire JS utilisée après le premier rendu (Chromium), null si indisponible. */
  heapUsedBytes: number | null;
  /** Images par seconde moyennes pendant la transition titre → jeu. */
  transitionFps: number | null;
  /** 95ᵉ centile des intervalles entre images pendant la transition (ms). */
  transitionP95FrameMs: number | null;
  transitionMaxFrameMs: number | null;
};

export type PerfMetrics = {
  generatedAt: string;
  node: string;
  platform: string;
  /** Durée du build complet (`tsc && vite build`), null si non mesuré. */
  buildMs: number | null;
  bundle: BundleMetrics;
  manifest: ManifestMetrics | null;
  browser: BrowserMetrics | null;
};

/** Budgets chiffrés : chaque valeur est un plafond (sauf `transitionFpsMin`, un plancher). */
export type PerfBudgets = {
  jsGzipBytes: number;
  cssGzipBytes: number;
  buildMs: number;
  firstRenderMs: number;
  startupRequests: number;
  heapUsedBytes: number;
  transitionFpsMin: number;
  transitionP95FrameMs: number;
};

export type BudgetUnit = "bytes" | "ms" | "count" | "fps";

export type BudgetCheck = {
  id: keyof PerfBudgets;
  label: string;
  unit: BudgetUnit;
  budget: number;
  measured: number | null;
  /** true si la mesure respecte le budget (ou est absente : voir `skipped`). */
  ok: boolean;
  /** true si la mesure n'est pas disponible (ex. navigateur absent, mode statique). */
  skipped: boolean;
  /** Marge relative à la mesure : (budget - mesuré) / budget ; null si non mesuré. */
  margin: number | null;
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "n/a";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

export function formatMs(ms: number): string {
  return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
}

/** Taille brute + gzip (niveau par défaut) d'un fichier. */
export function gzipSize(path: string): SizeTotals {
  const raw = readFileSync(path);
  return { rawBytes: raw.byteLength, gzipBytes: gzipSync(raw).byteLength };
}

/** Agrège les tailles des fichiers JS/CSS du build (`dist/assets/`, hors `.map`). */
export function collectBundleMetrics(distDir: string): BundleMetrics {
  const assetsDir = join(distDir, "assets");
  const files: BundleFile[] = [];
  const totals: SizeTotals = { rawBytes: 0, gzipBytes: 0 };
  if (existsSync(assetsDir)) {
    // Le publicDir (placeholders) peut copier des dossiers d'assets à côté des bundles : ne garder
    // que les fichiers, et ignorer les sourcemaps.
    const entries = readdirSync(assetsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.endsWith(".map"))
      .map((entry) => entry.name)
      .sort();
    for (const name of entries) {
      const { rawBytes, gzipBytes } = gzipSize(join(assetsDir, name));
      const ext = extname(name);
      const kind: BundleFile["kind"] = ext === ".js" ? "js" : ext === ".css" ? "css" : "other";
      files.push({ name, kind, rawBytes, gzipBytes });
      // Sommes JS/CSS calculées ensuite : `total` couvre tous les fichiers.
      totals.rawBytes += rawBytes;
      totals.gzipBytes += gzipBytes;
    }
  }
  const sum = (kind: BundleFile["kind"]): SizeTotals => ({
    rawBytes: files.filter((f) => f.kind === kind).reduce((a, f) => a + f.rawBytes, 0),
    gzipBytes: files.filter((f) => f.kind === kind).reduce((a, f) => a + f.gzipBytes, 0),
  });
  return { files, js: sum("js"), css: sum("css"), total: totals };
}

/**
 * Metrics du manifest d'assets. Accepte le dossier d'assets (`public/assets`, dossier du corpus)
 * ou directement le fichier. Retourne null si absent ou illisible (checkout nu, mode placeholders).
 */
export function collectManifestMetrics(assetsOrManifestPath: string | null): ManifestMetrics | null {
  if (!assetsOrManifestPath) return null;
  const path = assetsOrManifestPath.endsWith(".json")
    ? assetsOrManifestPath
    : join(assetsOrManifestPath, "asset-manifest.json");
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as {
      images?: Record<string, unknown>;
      audio?: Record<string, unknown>;
      scenarios?: Record<string, unknown>;
    };
    const { byteLength: rawBytes } = Buffer.from(raw, "utf-8");
    return {
      path,
      rawBytes,
      gzipBytes: gzipSync(Buffer.from(raw, "utf-8")).byteLength,
      images: Object.keys(parsed.images ?? {}).length,
      audio: Object.keys(parsed.audio ?? {}).length,
      scenarios: Object.keys(parsed.scenarios ?? {}).length,
    };
  } catch {
    return null;
  }
}

/** Une mesure absente est « skipped » ; un plafond est dépassé si mesuré > budget, un plancher si mesuré < budget. */
function check(
  id: keyof PerfBudgets,
  label: string,
  unit: BudgetUnit,
  budget: number,
  measured: number | null,
  lowerBound = false,
): BudgetCheck {
  if (measured === null || !Number.isFinite(measured)) {
    return { id, label, unit, budget, measured: null, ok: true, skipped: true, margin: null };
  }
  const ok = lowerBound ? measured >= budget : measured <= budget;
  const margin = lowerBound ? (measured - budget) / budget : (budget - measured) / budget;
  return { id, label, unit, budget, measured, ok, skipped: false, margin };
}

/** Compare les mesures aux budgets ; les mesures absentes sont des contrôles « skippés » (ok). */
export function checkBudgets(metrics: PerfMetrics, budgets: PerfBudgets): BudgetCheck[] {
  const browser = metrics.browser;
  return [
    check("jsGzipBytes", "JS gzip (bundle initial)", "bytes", budgets.jsGzipBytes, metrics.bundle.js.gzipBytes),
    check("cssGzipBytes", "CSS gzip", "bytes", budgets.cssGzipBytes, metrics.bundle.css.gzipBytes),
    check("buildMs", "Durée du build", "ms", budgets.buildMs, metrics.buildMs),
    check("firstRenderMs", "Premier rendu (titre visible)", "ms", budgets.firstRenderMs, browser?.firstRenderMs ?? null),
    check("startupRequests", "Requêtes au démarrage", "count", budgets.startupRequests, browser?.startupRequests ?? null),
    check("heapUsedBytes", "Mémoire JS après premier rendu", "bytes", budgets.heapUsedBytes, browser?.heapUsedBytes ?? null),
    check(
      "transitionFpsMin",
      "Images/s pendant la transition",
      "fps",
      budgets.transitionFpsMin,
      browser?.transitionFps ?? null,
      true,
    ),
    check(
      "transitionP95FrameMs",
      "p95 des intervalles entre images",
      "ms",
      budgets.transitionP95FrameMs,
      browser?.transitionP95FrameMs ?? null,
    ),
  ];
}

// ── Budgets `scene-ready` (#375, PERF-09) ────────────────────────────────────

export type SceneProfile = "desktop" | "mobile";
export type ScenePass = "cold" | "warm";

/** Résumé d'une passe du banc `npm run perf:scenes` (sous-ensemble de `reports/perf-scenes.json`). */
export type SceneRunSummary = {
  profile: SceneProfile;
  pass: ScenePass;
  sceneReadyP50: number;
  sceneReadyP95: number;
  lookaheadRatio: number;
  imageReuseRatio?: number;
  cacheHitRatio: number;
  longTasksOver50: number;
  inpMs: number | null;
  heapUsedMB: number | null;
  decodedCacheMB: number;
};

/** Seuils `scene-ready` du plan (plafonds), par profil. */
export type SceneBudgets = {
  /** p95 `scene-ready` au premier affichage, assets locaux, sans préchargement. */
  coldP95Ms: { desktop: number; mobile: number };
  /** p95 `scene-ready` avec image préchargée par le lookahead + cache chaud. */
  preloadedP95Ms: { desktop: number; mobile: number };
  /** Blocages > 50 ms pendant une transition. */
  longTasksOver50: { desktop: number; mobile: number };
  /** INP au clic/touche d'avance. */
  inpMs: { desktop: number; mobile: number };
  /** Cache décodé estimé (octets). */
  decodedCacheBytes: { desktop: number; mobile: number };
};

export type SceneBudgetCheck = {
  id: string;
  label: string;
  profile: SceneProfile;
  pass: ScenePass | "any";
  unit: BudgetUnit;
  budget: number;
  measured: number | null;
  ok: boolean;
  skipped: boolean;
  margin: number | null;
  /** Raison du contrôle « skippé » (passe absente, lookahead inexistant…). */
  note: string | null;
};

function sceneCheck(
  id: string,
  label: string,
  profile: SceneProfile,
  pass: ScenePass | "any",
  unit: BudgetUnit,
  budget: number,
  measured: number | null,
  note: string | null = null,
): SceneBudgetCheck {
  if (measured === null || !Number.isFinite(measured)) {
    return { id, label, profile, pass, unit, budget, measured: null, ok: true, skipped: true, margin: null, note };
  }
  return {
    id,
    label,
    profile,
    pass,
    unit,
    budget,
    measured,
    ok: measured <= budget,
    skipped: false,
    // Budget 0 (blocages desktop) : marge définie seulement à 0 mesure (sinon -1), pas de NaN.
    margin: budget > 0 ? (budget - measured) / budget : measured === 0 ? 0 : -1,
    note,
  };
}

/**
 * Compare les passes du banc `perf:scenes` aux budgets `scene-ready` : premier affichage (passe
 * froide), préchargé+cache chaud (passe chaude, seulement si le lookahead est effectif), blocages,
 * INP et cache décodé (pire passe par profil). Les passes absentes ou non mesurables sont
 * « skippées » avec une note explicite, jamais considérées comme un échec.
 */
export function checkSceneBudgets(runs: readonly SceneRunSummary[], budgets: SceneBudgets): SceneBudgetCheck[] {
  const byKey = new Map<string, SceneRunSummary>();
  for (const run of runs) byKey.set(`${run.profile}:${run.pass}`, run);
  const checks: SceneBudgetCheck[] = [];
  const profiles: SceneProfile[] = ["desktop", "mobile"];
  for (const profile of profiles) {
    const cold = byKey.get(`${profile}:cold`) ?? null;
    checks.push(
      sceneCheck(
        `scene-ready:cold:${profile}`,
        `scene-ready p95 au premier affichage (${profile})`,
        profile,
        "cold",
        "ms",
        budgets.coldP95Ms[profile],
        cold?.sceneReadyP95 ?? null,
        cold ? null : "passe froide absente : lancer npm run perf:scenes avec --passes cold",
      ),
    );
    const warm = byKey.get(`${profile}:warm`) ?? null;
    // Le seuil « préchargé + cache chaud » n'est évaluable que si le lookahead est réellement actif
    // (≥ 50 % des scènes de la passe chaude) ; un simple reliquat ne suffit pas.
    const preloadedApplicable = warm !== null && warm.lookaheadRatio >= 0.5;
    checks.push(
      sceneCheck(
        `scene-ready:preloaded:${profile}`,
        `scene-ready p95 préchargé + cache chaud (${profile})`,
        profile,
        "warm",
        "ms",
        budgets.preloadedP95Ms[profile],
        preloadedApplicable ? warm.sceneReadyP95 : null,
        !warm
          ? "passe chaude absente : lancer npm run perf:scenes avec --passes warm"
          : preloadedApplicable
            ? null
            : `préchargement insuffisant (${Math.round(warm.lookaheadRatio * 100)} % de lookahead) : seuil préchargé non évaluable sur cette passe`,
      ),
    );
    const runsForProfile = [byKey.get(`${profile}:cold`), byKey.get(`${profile}:warm`)].filter((run): run is SceneRunSummary => run !== undefined);
    const worstLongTasks = runsForProfile.length > 0 ? Math.max(...runsForProfile.map((run) => run.longTasksOver50)) : null;
    checks.push(
      sceneCheck("longtasks", `Blocages > 50 ms pendant les transitions (${profile})`, profile, "any", "count", budgets.longTasksOver50[profile], worstLongTasks),
    );
    const inps = runsForProfile.map((run) => run.inpMs).filter((value): value is number => value !== null);
    checks.push(sceneCheck("inp", `INP au clic d'avance (${profile})`, profile, "any", "ms", budgets.inpMs[profile], inps.length > 0 ? Math.max(...inps) : null));
    checks.push(
      sceneCheck(
        "decoded-cache",
        `Cache décodé estimé (${profile})`,
        profile,
        "any",
        "bytes",
        budgets.decodedCacheBytes[profile],
        runsForProfile.length > 0 ? Math.max(...runsForProfile.map((run) => run.decodedCacheMB)) * 1024 * 1024 : null,
      ),
    );
  }
  return checks;
}

/** Percentile (interpolation linéaire) d'une liste de nombres ; 0 si vide. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - index) + sorted[hi]! * (index - lo);
}
