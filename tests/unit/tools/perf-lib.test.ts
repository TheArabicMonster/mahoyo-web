import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  checkBudgets,
  collectBundleMetrics,
  collectManifestMetrics,
  formatBytes,
  formatMs,
  gzipSize,
  percentile,
  type PerfBudgets,
  type PerfMetrics,
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
