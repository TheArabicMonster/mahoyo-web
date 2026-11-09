/**
 * Tests unitaires pour l'outil d'audit headless du corpus KAG.
 *
 * Utilise des scripts .ks synthétiques (aucun asset réel).
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterAll } from "vitest";
import { auditScript, formatMarkdownReport, isEncrypted } from "../../../tools/audit-scenario.js";
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
@commandefictive1 storage=a
@commandefictive2 storage=b
@commandefictive3 storage=c
`);
    const cache = makeScriptCache({});
    const result = await auditScript(path, "unknown.ks", NO_MANIFEST, cache, TEST_MAX_STEPS);

    expect(result.rawCount).toBe(3);
    expect(result.unknownCommands["commandefictive1"]).toBe(1);
    expect(result.unknownCommands["commandefictive2"]).toBe(1);
    expect(result.unknownCommands["commandefictive3"]).toBe(1);
  });

  it("détecte les commandes inconnues répétées", async () => {
    const path = writeTmpKs("repeat.ks", `
*start
@commandefictive storage=p1
@commandefictive storage=p2
@commandefictive storage=p3
`);
    const cache = makeScriptCache({});
    const result = await auditScript(path, "repeat.ks", NO_MANIFEST, cache, TEST_MAX_STEPS);

    expect(result.unknownCommands["commandefictive"]).toBe(3);
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

describe("isEncrypted", () => {
  it("accepte un script KAG normal", () => {
    expect(isEncrypted("; Comment\n*start\nHello.[l]\n@bg storage=test\n")).toBe(false);
  });

  it("accepte un script avec du japonais", () => {
    expect(isEncrypted("*start\nこんにちは世界。[l]\n@fg storage=テスト\n")).toBe(false);
  });

  it("accepte un script avec ponctuation pleine chasse", () => {
    // La ponctuation pleine chasse (！？（）) et l'alphanumérique pleine chasse (ＡＢＣ０１２)
    // sont dans la plage U+FF01–U+FF5E, PAS dans U+FF61–U+FF9F (katakana demi-chasse)
    expect(isEncrypted("*start\n「えっ！？」[l]\n「ＭＡＨＯＹＯ！」[p]\n")).toBe(false);
  });

  it("rejette un script chiffré (caractères de contrôle)", () => {
    // Simule un script chiffré avec beaucoup de bytes de contrôle
    const encrypted = String.fromCharCode(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08)
      + String.fromCharCode(0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15)
      + "some text";
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it("rejette un script avec du binaire aléatoire", () => {
    // 100 bytes de contrôle sur ~200 = 50% > 10% seuil
    let binary = "";
    for (let i = 0; i < 100; i++) binary += String.fromCharCode(i & 0x1f);
    binary += "aaaa".repeat(25);
    expect(isEncrypted(binary)).toBe(true);
  });

  it("rejette un script avec caractères de remplacement U+FFFD", () => {
    // U+FFFD = caractère de remplacement, signal fiable de binaire lu en UTF-8
    let text = "*start\n";
    for (let i = 0; i < 60; i++) text += "\uFFFD";
    text += "normal text here";
    expect(isEncrypted(text)).toBe(true);
  });

  it("rejette un script avec katakana demi-chasse (audio Shift-JIS)", () => {
    // U+FF61–FF9F = katakana demi-chasse, rares dans Mahoyo,
    // typiques d'un décodage Shift-JIS de données audio binaires
    let text = "*start\n";
    for (let i = 0; i < 60; i++) text += String.fromCharCode(0xff61 + (i % 0x3f));
    text += "some ascii padding";
    expect(isEncrypted(text)).toBe(true);
  });

  it("rejette un fichier PNG déguisé en .ks (UTF-8 direct)", () => {
    const png = "\u0089PNG\r\n\u001a\nIHDR...rest of image data";
    expect(isEncrypted(png)).toBe(true);
  });

  it("rejette un fichier PNG déguisé en .ks (Shift-JIS décodé)", () => {
    // Après décodage Shift-JIS, 0x89→臼 (U+81FC), puis "NG" intact
    const png = "臼NG\n\u001c\n\nIHDR...rest of image data";
    expect(isEncrypted(png)).toBe(true);
  });

  it("rejette un fichier RIFF/WAVE déguisé en .ks", () => {
    const wav = "RIFF\x00\x00\x00\x00WAVEfmt ...rest of audio data";
    expect(isEncrypted(wav)).toBe(true);
  });

  it("accepte un script vide", () => {
    expect(isEncrypted("")).toBe(false);
  });
});

describe("formatMarkdownReport", () => {
  it("formate un rapport avec des commandes inconnues", () => {
    const report: AuditReport = {
      timestamp: "2026-10-29T12:00:00.000Z",
      totalScriptsFound: 6,
      skippedSystem: 2,
      skippedEncrypted: 1,
      totalScripts: 3,
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
      resolvedVariantRefsGlobal: 12,
      emptyAssetRefsGlobal: 3,
      unresolvedVariantRefsGlobal: 2,
      unresolvedVariantsGlobal: { "image:bg01|e": 1, "image:bg01|b": 1 },
    };

    const md = formatMarkdownReport(report);

    expect(md).toContain("Commandes inconnues");
    expect(md).toContain("@ploysay");
    expect(md).toContain("30");
    expect(md).toContain("@seact");
    expect(md).toContain("5");
    expect(md).toContain("Assets manquants");
    expect(md).toContain("image:bg01");
    expect(md).toContain("Assets de base absents (images/sons) : 1");
    expect(md).toContain("Variantes non résolues (asset de base absent) : 2 référence(s), 2 variante(s) distincte(s)");
    expect(md).toContain("### Variantes non résolues (base absente)");
    // Les `|` sont échappés dans les cellules Markdown.
    expect(md).toContain("image:bg01\\|e");
    expect(md).toContain("Règle de résolution");
    expect(md).toContain("Détail par script");
    expect(md).toContain("a.ks");
    expect(md).toContain("b.ks");
    expect(md).toContain("Fichiers binaires ignorés");
    expect(md).toContain("1");
  });

  it("gère un rapport vide", () => {
    const report: AuditReport = {
      timestamp: "2026-10-29T12:00:00.000Z",
      totalScriptsFound: 0,
      skippedSystem: 0,
      skippedEncrypted: 0,
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
    expect(md).toContain("Aucun asset de base manquant");
  });

  it("affiche les scripts en erreur", () => {
    const report: AuditReport = {
      timestamp: "2026-10-29T12:00:00.000Z",
      totalScriptsFound: 1,
      skippedSystem: 0,
      skippedEncrypted: 0,
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
