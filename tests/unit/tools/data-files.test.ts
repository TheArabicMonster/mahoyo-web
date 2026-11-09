/** Installation des fichiers de données du moteur par le pipeline (#260). */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE_DATA_FILES, installEngineDataFiles } from "../../../tools/data-files.js";

describe("installEngineDataFiles", () => {
  let input: string;
  let output: string;

  beforeEach(() => {
    input = mkdtempSync(join(tmpdir(), "mh-data-in-"));
    output = mkdtempSync(join(tmpdir(), "mh-data-out-"));
  });

  afterEach(() => {
    rmSync(input, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  });

  it("copie les données du moteur en conservant leur chemin (hors manifeste)", async () => {
    const rel = ENGINE_DATA_FILES[0]!;
    mkdirSync(join(input, "data", "others"), { recursive: true });
    writeFileSync(join(input, rel), "données");
    const report = await installEngineDataFiles(input, output, { dryRun: false });
    expect(report.installed).toEqual([rel]);
    expect(report.missing).toEqual([]);
    expect(readFileSync(join(output, rel), "utf-8")).toBe("données");
  });

  it("signale les données absentes de l'entrée sans échouer", async () => {
    const report = await installEngineDataFiles(input, output, { dryRun: false });
    expect(report.installed).toEqual([]);
    expect(report.missing).toEqual([...ENGINE_DATA_FILES]);
    for (const rel of ENGINE_DATA_FILES) expect(existsSync(join(output, rel))).toBe(false);
  });

  it("dry-run : aucun fichier écrit mais rapport identique", async () => {
    const rel = ENGINE_DATA_FILES[0]!;
    mkdirSync(join(input, "data", "others"), { recursive: true });
    writeFileSync(join(input, rel), "données");
    const report = await installEngineDataFiles(input, output, { dryRun: true });
    expect(report.installed).toEqual([rel]);
    expect(existsSync(join(output, rel))).toBe(false);
  });
});
