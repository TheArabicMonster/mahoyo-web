import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  checkBudgets,
  checkSceneBudgets,
  collectBundleMetrics,
  collectManifestMetrics,
  formatBytes,
  formatMs,
  gzipSize,
  percentile,
  type PerfBudgets,
  type PerfMetrics,
  type SceneBudgets,
  type SceneRunSummary,
} from "../../../tools/perf-lib.js";

const dirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mahoyo-perf-lib-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const budgets: PerfBudgets = {
  jsGzipBytes: 1000,
  cssGzipBytes: 500,
  buildMs: 10_000,
  firstRenderMs: 1000,
  startupRequests: 20,
  heapUsedBytes: 1000,
  transitionFpsMin: 50,
  transitionP95FrameMs: 25,
};

function metrics(overrides: Partial<PerfMetrics> = {}): PerfMetrics {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    node: "v22",
    platform: "test",
    buildMs: 5000,
    bundle: { files: [], js: { rawBytes: 0, gzipBytes: 600 }, css: { rawBytes: 0, gzipBytes: 100 }, total: { rawBytes: 0, gzipBytes: 700 } },
    manifest: null,
    browser: {
      firstRenderMs: 500,
      domContentLoadedMs: 400,
      loadEventMs: 450,
      firstContentfulPaintMs: 420,
      startupRequests: 10,
      startupTransferBytes: 1000,
      heapUsedBytes: 800,
      transitionFps: 60,
      transitionP95FrameMs: 17,
      transitionMaxFrameMs: 20,
    },
    ...overrides,
  };
}

describe("formatBytes / formatMs", () => {
  it("formate les octets en o / Ko / Mo et refuse les valeurs invalides", () => {
    expect(formatBytes(512)).toBe("512 o");
    expect(formatBytes(2048)).toBe("2.0 Ko");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 Mo");
    expect(formatBytes(-1)).toBe("n/a");
    expect(formatBytes(Number.NaN)).toBe("n/a");
  });

  it("formate les durées avec une décimale sous 10 ms", () => {
    expect(formatMs(1.5)).toBe("1.5 ms");
    expect(formatMs(150.4)).toBe("150 ms");
  });
});

describe("gzipSize / collectBundleMetrics", () => {
  it("mesure la taille brute et compressée d'un fichier", () => {
    const dir = tmpDir();
    const path = join(dir, "repetitif.txt");
    writeFileSync(path, "a".repeat(4096));
    const size = gzipSize(path);
    expect(size.rawBytes).toBe(4096);
    expect(size.gzipBytes).toBeGreaterThan(0);
    expect(size.gzipBytes).toBeLessThan(size.rawBytes);
  });

  it("agrège JS/CSS gzip du build, ignore les sourcemaps et les dossiers d'assets", () => {
    const dist = tmpDir();
    const assets = join(dist, "assets");
    mkdirSync(assets);
    mkdirSync(join(assets, "bg"));
    writeFileSync(join(assets, "index-abc.js"), "const x = 1;\n".repeat(100));
    writeFileSync(join(assets, "index-abc.js.map"), "{}");
    writeFileSync(join(assets, "index-def.css"), ".a { color: red; }\n".repeat(50));
    writeFileSync(join(assets, "bg", "black.png"), "png");

    const m = collectBundleMetrics(dist);
    expect(m.files.map((f) => f.name)).toEqual(["index-abc.js", "index-def.css"]);
    expect(m.js.rawBytes).toBeGreaterThan(0);
    expect(m.js.gzipBytes).toBeGreaterThan(0);
    expect(m.css.gzipBytes).toBeGreaterThan(0);
    expect(m.total.rawBytes).toBe(m.js.rawBytes + m.css.rawBytes);
    expect(m.total.gzipBytes).toBe(m.js.gzipBytes + m.css.gzipBytes);
  });

  it("renvoie des totaux nuls si le build est absent", () => {
    const m = collectBundleMetrics(join(tmpDir(), "absent"));
    expect(m.files).toEqual([]);
    expect(m.js.gzipBytes).toBe(0);
    expect(m.total.gzipBytes).toBe(0);
  });
});

describe("collectManifestMetrics", () => {
  it("compte les clés et mesure le manifest, dossier ou fichier", () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, "asset-manifest.json"),
      JSON.stringify({ images: { a: {}, b: {} }, audio: { c: {} }, scenarios: { "1-0": {} } }),
    );
    const fromDir = collectManifestMetrics(dir)!;
    expect(fromDir).toMatchObject({ images: 2, audio: 1, scenarios: 1 });
    expect(fromDir.rawBytes).toBeGreaterThan(0);
    expect(fromDir.gzipBytes).toBeGreaterThan(0);
    expect(collectManifestMetrics(join(dir, "asset-manifest.json"))?.images).toBe(2);
  });

  it("renvoie null sans manifest (checkout nu) ou si le JSON est illisible", () => {
    expect(collectManifestMetrics(null)).toBeNull();
    expect(collectManifestMetrics(tmpDir())).toBeNull();
    const dir = tmpDir();
    writeFileSync(join(dir, "asset-manifest.json"), "pas du json");
    expect(collectManifestMetrics(dir)).toBeNull();
  });
});

describe("checkBudgets", () => {
  it("valide toutes les mesures sous les budgets, avec les marges", () => {
    const checks = checkBudgets(metrics(), budgets);
    expect(checks.every((c) => c.ok && !c.skipped)).toBe(true);
    const js = checks.find((c) => c.id === "jsGzipBytes")!;
    expect(js.margin).toBeCloseTo(0.4, 5); // 600 / 1000 → 40 % de marge
    // Les budgets « plancher » (images/s) sont validés au-dessus du seuil.
    expect(checks.find((c) => c.id === "transitionFpsMin")!.ok).toBe(true);
  });

  it("signale un dépassement de plafond et un plancher non atteint", () => {
    const over = metrics({
      buildMs: 20_000,
      bundle: { files: [], js: { rawBytes: 0, gzipBytes: 2000 }, css: { rawBytes: 0, gzipBytes: 100 }, total: { rawBytes: 0, gzipBytes: 2100 } },
      browser: { ...metrics().browser!, startupRequests: 30, transitionFps: 30, transitionP95FrameMs: 40 },
    });
    const checks = checkBudgets(over, budgets);
    expect(checks.find((c) => c.id === "jsGzipBytes")!.ok).toBe(false);
    expect(checks.find((c) => c.id === "buildMs")!.ok).toBe(false);
    expect(checks.find((c) => c.id === "startupRequests")!.ok).toBe(false);
    expect(checks.find((c) => c.id === "transitionFpsMin")!.ok).toBe(false);
    expect(checks.find((c) => c.id === "transitionP95FrameMs")!.ok).toBe(false);
  });

  it("marque « skipped » les mesures indisponibles (mode statique, build réutilisé)", () => {
    const staticMetrics = metrics({ buildMs: null, browser: null });
    const checks = checkBudgets(staticMetrics, budgets);
    for (const id of ["buildMs", "firstRenderMs", "startupRequests", "heapUsedBytes", "transitionFpsMin"]) {
      const check = checks.find((c) => c.id === id)!;
      expect(check.skipped, id).toBe(true);
      expect(check.ok, id).toBe(true);
      expect(check.measured, id).toBeNull();
    }
    // Les tailles de bundle restent mesurées.
    expect(checks.find((c) => c.id === "jsGzipBytes")!.skipped).toBe(false);
  });
});

describe("percentile", () => {
  it("interpole linéairement et gère les listes vides", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10, 20], 0)).toBe(10);
    expect(percentile([10, 20], 1)).toBe(20);
  });
});

const sceneBudgets: SceneBudgets = {
  coldP95Ms: { desktop: 100, mobile: 250 },
  preloadedP95Ms: { desktop: 16, mobile: 33 },
  longTasksOver50: { desktop: 0, mobile: 1 },
  inpMs: { desktop: 100, mobile: 200 },
  decodedCacheBytes: { desktop: 192 * 1024 * 1024, mobile: 64 * 1024 * 1024 },
};

function sceneRun(overrides: Partial<SceneRunSummary> = {}): SceneRunSummary {
  return {
    profile: "desktop",
    pass: "cold",
    sceneReadyP50: 40,
    sceneReadyP95: 60,
    lookaheadRatio: 0,
    imageReuseRatio: 0,
    cacheHitRatio: 0,
    longTasksOver50: 0,
    inpMs: 40,
    heapUsedMB: 6,
    decodedCacheMB: 40,
    ...overrides,
  };
}

describe("budgets scene-ready (#375)", () => {
  it("valide les passes conformes aux seuils du plan", () => {
    const runs: SceneRunSummary[] = [
      sceneRun(),
      sceneRun({ profile: "mobile", sceneReadyP95: 200 }),
      sceneRun({ pass: "warm", sceneReadyP95: 12, lookaheadRatio: 1 }),
      sceneRun({ profile: "mobile", pass: "warm", sceneReadyP95: 30, lookaheadRatio: 1 }),
    ];
    const checks = checkSceneBudgets(runs, sceneBudgets);
    expect(checks).toHaveLength(10);
    expect(checks.every((check) => check.ok && !check.skipped)).toBe(true);
    expect(checks.find((check) => check.id === "scene-ready:cold:desktop")!.measured).toBe(60);
    expect(checks.find((check) => check.id === "scene-ready:preloaded:mobile")!.measured).toBe(30);
  });

  it("signale un dépassement de p95 au premier affichage (desktop et mobile)", () => {
    const runs = [sceneRun({ sceneReadyP95: 150 }), sceneRun({ profile: "mobile", sceneReadyP95: 300 })];
    const checks = checkSceneBudgets(runs, sceneBudgets);
    expect(checks.find((check) => check.id === "scene-ready:cold:desktop")!.ok).toBe(false);
    expect(checks.find((check) => check.id === "scene-ready:cold:mobile")!.ok).toBe(false);
    expect(checks.find((check) => check.id === "scene-ready:cold:desktop")!.margin).toBeCloseTo(-0.5, 5);
  });

  it("n'évalue le seuil préchargé que si le lookahead/réutilisation est effectif", () => {
    const skipped = checkSceneBudgets([sceneRun({ pass: "warm", sceneReadyP95: 60 })], sceneBudgets);
    const preloaded = skipped.find((check) => check.id === "scene-ready:preloaded:desktop")!;
    expect(preloaded.skipped).toBe(true);
    expect(preloaded.note).toContain("préchargement insuffisant");
    // Avec préchargement effectif (≥ 50 %), le même p95 devient un échec (60 > 16).
    const evaluated = checkSceneBudgets([sceneRun({ pass: "warm", sceneReadyP95: 60, lookaheadRatio: 1 })], sceneBudgets);
    expect(evaluated.find((check) => check.id === "scene-ready:preloaded:desktop")!.ok).toBe(false);
    expect(evaluated.find((check) => check.id === "scene-ready:preloaded:desktop")!.skipped).toBe(false);
  });

  it("marque les passes absentes comme skippées, sans échec", () => {
    const checks = checkSceneBudgets([sceneRun()], sceneBudgets);
    expect(checks.filter((check) => check.id.startsWith("scene-ready:") && check.profile === "mobile").every((check) => check.skipped)).toBe(true);
    expect(checks.find((check) => check.id === "longtasks" && check.profile === "mobile")!.skipped).toBe(true);
    expect(checks.filter((check) => !check.skipped).map((check) => check.id)).toEqual([
      "scene-ready:cold:desktop",
      "longtasks",
      "inp",
      "decoded-cache",
    ]);
  });

  it("contrôle les blocages > 50 ms, l'INP et le cache décodé (pire passe par profil)", () => {
    const runs = [
      sceneRun({ longTasksOver50: 1, inpMs: 150, decodedCacheMB: 200 }),
      sceneRun({ pass: "warm", longTasksOver50: 0, inpMs: 90, decodedCacheMB: 180, lookaheadRatio: 1 }),
      sceneRun({ profile: "mobile", longTasksOver50: 1, inpMs: 180, decodedCacheMB: 60 }),
      sceneRun({ profile: "mobile", pass: "warm", longTasksOver50: 2, inpMs: 210, decodedCacheMB: 70, lookaheadRatio: 1 }),
    ];
    const checks = checkSceneBudgets(runs, sceneBudgets);
    expect(checks.find((check) => check.id === "longtasks" && check.profile === "desktop")!.ok).toBe(false);
    expect(checks.find((check) => check.id === "longtasks" && check.profile === "mobile")!.ok).toBe(false);
    expect(checks.find((check) => check.id === "inp" && check.profile === "desktop")!.ok).toBe(false);
    expect(checks.find((check) => check.id === "inp" && check.profile === "mobile")!.ok).toBe(false);
    expect(checks.find((check) => check.id === "decoded-cache" && check.profile === "desktop")!.ok).toBe(false);
    expect(checks.find((check) => check.id === "decoded-cache" && check.profile === "mobile")!.ok).toBe(false);
  });

  it("expose les seuils du plan et formate les mesures", () => {
    const checks = checkSceneBudgets([sceneRun()], sceneBudgets);
    const cold = checks.find((check) => check.id === "scene-ready:cold:desktop")!;
    expect(cold.unit).toBe("ms");
    expect(cold.budget).toBe(100);
    expect(formatMs(cold.measured!)).toBe("60 ms");
    const cache = checks.find((check) => check.id === "decoded-cache" && check.profile === "desktop")!;
    expect(cache.budget).toBe(192 * 1024 * 1024);
    expect(formatBytes(cache.measured!)).toBe("40.00 Mo");
    expect(sceneBudgets.preloadedP95Ms).toEqual({ desktop: 16, mobile: 33 });
  });
});
