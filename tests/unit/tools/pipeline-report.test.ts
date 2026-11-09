/**
 * Tests du rapport d'exécution du pipeline et du garde-fou « sortie ignorée
 * par git » (issue #95).
 *
 * @vitest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildRunReport,
  collectFailures,
  exitCodeFor,
  formatRunSummary,
  gitIgnoreStatus,
  unignoredOutputError,
} from "../../../tools/pipeline-report.js";
import type { Task, TaskResult } from "../../../tools/plan.js";

const OUTSIDE = mkdtempSync(join(tmpdir(), "mahoyo-report-"));

afterAll(() => {
  rmSync(OUTSIDE, { recursive: true, force: true });
});

function task(relPath: string, action: Task["action"] = "copy"): Task {
  return {
    entry: { relPath, source: `/input/${relPath}`, kind: "bg", ext: ".png", key: relPath, webPath: relPath, webExt: ".png" },
    action,
    outputPath: `/output/${relPath}`,
    outputExt: ".png",
    internal: true,
  } as Task;
}

function result(relPath: string, status: TaskResult["status"], error?: string): TaskResult {
  return { task: task(relPath), status, ...(error === undefined ? {} : { error }) };
}

function reportWith(failures: number, missingStorages = 0, dryRun = false) {
  return buildRunReport({
    inputDir: "/input",
    outputDir: "/output",
    workDir: "/work",
    dryRun,
    plan: { copy: 3 },
    totals: { tasks: 3, ok: 3 - failures, failed: failures, skipped: 0 },
    failures: Array.from({ length: failures }, (_, i) => ({
      source: `bg/broken${i}.tlg`,
      action: "convert-image",
      output: `/output/bg/broken${i}.png`,
      error: "signature TLG inconnue",
    })),
    verification: {
      missingStorages,
      emptyStorageRefs: 0,
      macroStorageRefs: 0,
      evalSyntaxErrors: 0,
    },
  });
}

describe("collectFailures", () => {
  it("ne garde que les échecs, avec source/action/erreur", () => {
    const failures = collectFailures([
      result("bg/ok.png", "ok"),
      result("bg/broken.tlg", "failed", "signature TLG inconnue"),
      result("bg/skip.png", "skipped"),
    ]);

    expect(failures).toEqual([
      {
        source: "bg/broken.tlg",
        action: "copy",
        output: "/output/bg/broken.tlg",
        error: "signature TLG inconnue",
      },
    ]);
  });
});

describe("exitCodeFor", () => {
  it("retourne 1 dès qu'un fichier n'a pas été produit", () => {
    expect(exitCodeFor(reportWith(1), false)).toBe(1);
  });

  it("retourne 1 en --strict si des storages manquent", () => {
    expect(exitCodeFor(reportWith(0, 2), true)).toBe(1);
    expect(exitCodeFor(reportWith(0, 2), false)).toBe(0);
  });

  it("retourne 0 quand tout est produit", () => {
    expect(exitCodeFor(reportWith(0), true)).toBe(0);
  });
});

describe("formatRunSummary", () => {
  it("liste les fichiers non convertis et le rapport", () => {
    const summary = formatRunSummary(reportWith(2), "/work/pipeline-report.json");

    expect(summary).toContain("=== Résumé du pipeline ===");
    expect(summary).toContain("Tâches : 3 (1 OK, 2 échec(s), 0 ignorée(s))");
    expect(summary).toContain("Fichiers non convertis (2)");
    expect(summary).toContain("bg/broken0.tlg");
    expect(summary).toContain("signature TLG inconnue");
    expect(summary).toContain("/work/pipeline-report.json");
  });

  it("indique un dry-run sans écriture", () => {
    const summary = formatRunSummary(reportWith(0, 0, true), "/work/pipeline-report.json");
    expect(summary).toContain("Dry-run : aucune écriture");
  });

  it("tronque la liste au-delà de 20 échecs", () => {
    const summary = formatRunSummary(reportWith(25), "/work/pipeline-report.json");
    expect(summary).toContain("… 5 autre(s), voir le rapport JSON");
  });
});

describe("gitIgnoreStatus", () => {
  it("reconnaît les sorties ignorées du dépôt", () => {
    const status = gitIgnoreStatus("public/assets");
    if (status === "unknown") return; // pas de dépôt git dans cet environnement
    expect(status).toBe("ignored");
  });

  it("accepte le dossier de travail par défaut même s'il n'existe pas encore (#264)", () => {
    // Régression : la règle `.pipeline-work/` (barre finale) ne matchait pas le
    // chemin absolu d'un dossier inexistant ; le premier lancement était refusé.
    const status = gitIgnoreStatus(".pipeline-work");
    if (status === "unknown") return;
    expect(status).toBe("ignored");
    expect(unignoredOutputError("travail", ".pipeline-work")).toBeNull();
  });

  it("accepte le dossier de travail par défaut en chemin absolu (#264)", () => {
    const status = gitIgnoreStatus(join(process.cwd(), ".pipeline-work"));
    if (status === "unknown") return;
    expect(status).toBe("ignored");
  });

  it("reconnaît un dossier inexistant couvert par une règle à barre finale (`tmp-*/`)", () => {
    const status = gitIgnoreStatus(`tmp-mh264-inexistant-${process.pid}`);
    if (status === "unknown") return;
    expect(status).toBe("ignored");
  });

  it("détecte un dossier du dépôt non ignoré", () => {
    const status = gitIgnoreStatus("__mh-dossier-non-ignore-test");
    if (status === "unknown") return;
    expect(status).toBe("not-ignored");
  });

  it("détecte un dossier hors du dépôt", () => {
    const status = gitIgnoreStatus(OUTSIDE);
    if (status === "unknown") return;
    expect(status).toBe("outside-repo");
  });

  it("gère un symlink : ignoré via son dossier parent, non ignoré sinon", () => {
    const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    const ignoredDir = join(process.cwd(), `tmp-mh264-link-${suffix}`);
    const bareLink = join(process.cwd(), `mh264-lien-non-ignore-${suffix}`);
    try {
      mkdirSync(ignoredDir, { recursive: true });
      symlinkSync(OUTSIDE, join(ignoredDir, "lien"), "dir");
      symlinkSync(OUTSIDE, bareLink, "dir");

      const ignored = gitIgnoreStatus(join(ignoredDir, "lien"));
      if (ignored !== "unknown") expect(ignored).toBe("ignored");

      const notIgnored = gitIgnoreStatus(bareLink);
      if (notIgnored !== "unknown") expect(notIgnored).toBe("not-ignored");
    } finally {
      rmSync(ignoredDir, { recursive: true, force: true });
      rmSync(bareLink, { force: true });
    }
  });
});
