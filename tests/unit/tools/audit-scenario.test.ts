/**
 * Tests unitaires pour l'outil d'audit headless du corpus KAG.
 *
 * Utilise des scripts .ks synthétiques (aucun asset réel).
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterAll } from "vitest";
import { auditScript, formatMarkdownReport } from "../../../tools/audit-scenario.js";
import type { AuditReport } from "../../../tools/audit-scenario.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// ── Helpers ──

const TMP_DIR = join(import.meta.dirname, "../../../.tmp-audit-test");

function writeTmpKs(name: string, content: string): string {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = join(TMP_DIR, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

function makeScriptCache(files: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(files));
}

const NO_MANIFEST = null;
const TEST_MAX_STEPS = 200;

// ── Tests ──

describe("auditScript", () => {
  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("parcourt un script simple sans erreur", async () => {
    const path = writeTmpKs("simple.ks", `
*start
Hello world.[l]
This is line 2.[p]
@bg storage=bg01 page=fore
`);
    const cache = makeScriptCache({ "simple.ks": "" });
    const result = await auditScript(path, "simple.ks", NO_MANIFEST, cache, TEST_MAX_STEPS);

    expect(result.file).toBe("simple.ks");
    expect(result.errors).toEqual([]);
    expect(result.steps).toBeGreaterThan(0);
    expect(result.rawCount).toBe(0);
    expect(result.unknownCommands).toEqual({});
  });

  it("détecte les commandes inconnues", async () => {
    const path = writeTmpKs("unknown.ks", `
*start
@ploysay storage=ploy01
@seact storage=se01
@playtimeline storage=tl01
`);
    const cache = makeScriptCache({});
    const result = await auditScript(path, "unknown.ks", NO_MANIFEST, cache, TEST_MAX_STEPS);

    expect(result.rawCount).toBe(3);
    expect(result.unknownCommands["ploysay"]).toBe(1);
    expect(result.unknownCommands["seact"]).toBe(1);
    expect(result.unknownCommands["playtimeline"]).toBe(1);
  });

  it("détecte les commandes inconnues répétées", async () => {
    const path = writeTmpKs("repeat.ks", `
*start
@ploysay storage=p1
@ploysay storage=p2
@ploysay storage=p3
`);
    const cache = makeScriptCache({});
    const result = await auditScript(path, "repeat.ks", NO_MANIFEST, cache, TEST_MAX_STEPS);

    expect(result.unknownCommands["ploysay"]).toBe(3);
  });

  it("suit un @call vers un autre script", async () => {
    const mainKs = `
*start
Hello.[l]
@call storage=sub.ks target=*sub_entry
Back in main.[p]
`;
    const subKs = `
*sub_entry
Inside sub.[l]
@return
`;
    const path = writeTmpKs("main.ks", mainKs);
    const cache = makeScriptCache({ "sub.ks": subKs, "main.ks": mainKs });

    const result = await auditScript(path, "main.ks", NO_MANIFEST, cache, TEST_MAX_STEPS);

    expect(result.errors).toEqual([]);
    expect(result.steps).toBeGreaterThan(3);
  });

  it("gère un jump vers un label inexistant (warning)", async () => {
    const path = writeTmpKs("warn.ks", `
*start
@jump target=*nonexistent
`);
    const cache = makeScriptCache({});
    const result = await auditScript(path, "warn.ks", NO_MANIFEST, cache, TEST_MAX_STEPS);

    expect(result.steps).toBeGreaterThan(0);
    const warnKeys = Object.keys(result.warnings);
    expect(warnKeys.length).toBeGreaterThan(0);
  });

  it("détecte les assets manquants avec manifest", async () => {
    // @bg page=fore émet un événement scene ; @play émet un événement audio.
    const path = writeTmpKs("assets.ks", `
*start
@bg storage=missing_bg page=fore
@play storage=missing_bgm
`);
    const cache = makeScriptCache({});
    const manifest = { images: {}, audio: {} } as any;
    const result = await auditScript(path, "assets.ks", manifest, cache, TEST_MAX_STEPS);

    expect(result.missingAssets).toContain("image:missing_bg");
    expect(result.missingAssets).toContain("audio:missing_bgm");
  });

  it("ne crash pas sur un script qui atteint maxSteps", async () => {
    // Script avec un @jump conditionnel toujours vrai — chaque step
    // contient un [l] donc step() revient au caller.
    const path = writeTmpKs("loop.ks", `
*start
Loop text.[l]
@jump target=*start
`);
    const cache = makeScriptCache({});
    const result = await auditScript(path, "loop.ks", NO_MANIFEST, cache, 50);

    expect(result.steps).toBeLessThanOrEqual(50);
    expect(result.steps).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
    expect(result.hitMaxSteps).toBe(true);
  });
});

describe("formatMarkdownReport", () => {
  it("formate un rapport avec des commandes inconnues", () => {
    const report: AuditReport = {
      timestamp: "2026-10-29T12:00:00.000Z",
      totalScriptsFound: 4,
      skippedSystem: 2,
      totalScripts: 2,
      scriptsWithErrors: 0,
      scriptsWithMaxSteps: 0,
      totalDurationMs: 500,
      scripts: [
        {
          file: "a.ks",
          steps: 100,
          unknownCommands: { ploysay: 10, seact: 5 },
          warnings: {},
          missingAssets: [],
          errors: [],
          rawCount: 15,
          durationMs: 300,
          hitMaxSteps: false,
        },
        {
          file: "b.ks",
          steps: 200,
          unknownCommands: { ploysay: 20 },
          warnings: { "label not found": 2 },
          missingAssets: ["image:bg01"],
          errors: [],
          rawCount: 20,
          durationMs: 200,
          hitMaxSteps: false,
        },
      ],
      unknownCommandsGlobal: { ploysay: 30, seact: 5 },
      warningsGlobal: { "label not found": 2 },
      missingAssetsGlobal: { "image:bg01": 1 },
    };

    const md = formatMarkdownReport(report);

    expect(md).toContain("Commandes inconnues");
    expect(md).toContain("@ploysay");
    expect(md).toContain("30");
    expect(md).toContain("@seact");
    expect(md).toContain("5");
    expect(md).toContain("Assets manquants");
    expect(md).toContain("image:bg01");
    expect(md).toContain("Détail par script");
    expect(md).toContain("a.ks");
    expect(md).toContain("b.ks");
  });

  it("gère un rapport vide", () => {
    const report: AuditReport = {
      timestamp: "2026-10-29T12:00:00.000Z",
      totalScriptsFound: 0,
      skippedSystem: 0,
      totalScripts: 0,
      scriptsWithErrors: 0,
      scriptsWithMaxSteps: 0,
      totalDurationMs: 0,
      scripts: [],
      unknownCommandsGlobal: {},
      warningsGlobal: {},
      missingAssetsGlobal: {},
    };

    const md = formatMarkdownReport(report);

    expect(md).toContain("Aucune commande inconnue");
    expect(md).toContain("Aucun warning");
    expect(md).toContain("Aucun asset manquant");
  });

  it("affiche les scripts en erreur", () => {
    const report: AuditReport = {
      timestamp: "2026-10-29T12:00:00.000Z",
      totalScriptsFound: 1,
      skippedSystem: 0,
      totalScripts: 1,
      scriptsWithErrors: 1,
      scriptsWithMaxSteps: 0,
      totalDurationMs: 10,
      scripts: [
        {
          file: "bad.ks",
          steps: 0,
          unknownCommands: {},
          warnings: {},
          missingAssets: [],
          errors: ["Cannot read property of undefined"],
          rawCount: 0,
          durationMs: 10,
          hitMaxSteps: false,
        },
      ],
      unknownCommandsGlobal: {},
      warningsGlobal: {},
      missingAssetsGlobal: {},
    };

    const md = formatMarkdownReport(report);

    expect(md).toContain("Scripts en erreur fatale");
    expect(md).toContain("bad.ks");
    expect(md).toContain("Cannot read property of undefined");
  });
});
