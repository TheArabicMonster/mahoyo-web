/**
 * Tests de l'extraction `.xp3` par gabarit de commande (issue #95).
 *
 * L'extracteur est un faux script Node écrit dans un dossier temporaire : il
 * écrit un marqueur dans `{out}` (aucun asset du jeu n'est utilisé).
 *
 * @vitest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import { extractXp3WithCommand } from "../../../tools/extract-xp3.js";

const TMP = mkdtempSync(join(tmpdir(), "mahoyo-xp3-extract-"));
const EXTRACTOR_SCRIPT = join(TMP, "faux-extracteur.cjs");

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Faux extracteur : `node faux-extracteur.cjs {in} {out}` écrit `<out>/extracted.txt`. */
function writeFakeExtractor(exitCode = 0): void {
  writeFileSync(
    EXTRACTOR_SCRIPT,
    `const fs = require("fs");
const path = require("path");
const [, , archive, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
if (${exitCode} !== 0) {
  console.error("échec simulé");
  process.exit(${exitCode});
}
fs.writeFileSync(path.join(outDir, "extracted.txt"), "extrait de " + path.basename(archive));
`,
    "utf-8",
  );
}

/** Crée un dossier d'entrée avec deux fausses archives `.xp3`. */
function makeInput(): string {
  const input = join(TMP, `input-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(input, "archives"), { recursive: true });
  writeFileSync(join(input, "archives", "bg.xp3"), "faux-xp3-bg");
  writeFileSync(join(input, "archives", "sound.xp3"), "faux-xp3-sound");
  return input;
}

const command = (): string => `"${process.execPath}" "${EXTRACTOR_SCRIPT}" {in} {out}`;

describe("extractXp3WithCommand", () => {
  it("extrait chaque archive dans son propre sous-dossier", async () => {
    writeFakeExtractor();
    const input = makeInput();
    const output = join(TMP, "extracted-ok");

    const result = await extractXp3WithCommand({ inputDir: input, command: command(), outputDir: output });

    expect(result.archives).toHaveLength(2);
    expect(result.extracted).toBe(2);
    expect(result.failures).toEqual([]);
    // L'arborescence relative de l'entrée est conservée (archives/…).
    expect(readFileSync(join(output, "archives", "bg", "extracted.txt"), "utf-8")).toContain("bg.xp3");
    expect(readFileSync(join(output, "archives", "sound", "extracted.txt"), "utf-8")).toContain(
      "sound.xp3",
    );
  });

  it("collecte les échecs sans interrompre les autres archives", async () => {
    writeFakeExtractor(3);
    const input = makeInput();
    const output = join(TMP, "extracted-fail");

    const result = await extractXp3WithCommand({ inputDir: input, command: command(), outputDir: output });

    expect(result.extracted).toBe(0);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]?.archive).toContain(".xp3");
    expect(result.failures[0]?.error).toBeTruthy();
  });

  it("n'écrit rien en dry-run", async () => {
    writeFakeExtractor();
    const input = makeInput();
    const output = join(TMP, "extracted-dry");
    rmSync(output, { recursive: true, force: true });

    const result = await extractXp3WithCommand({
      inputDir: input,
      command: command(),
      outputDir: output,
      dryRun: true,
    });

    expect(result.archives).toHaveLength(2);
    expect(result.extracted).toBe(0);
    expect(() => readFileSync(join(output, "archives", "bg", "extracted.txt"))).toThrow();
  });
});
