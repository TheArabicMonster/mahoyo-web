/**
 * CLI d'installation d'une traduction fan de scripts KAG.
 *
 * Usage:
 *   npm run translation -- <langue> <dossier source> [dossier d'assets] [--fetch]
 *
 * Le dossier source contient les scripts .ks traduits (par ex. Texte/Complete).
 * Avec --fetch, ils sont d'abord téléchargés depuis le dépôt public
 * IDerr/mahoyo-french.
 */
import { readFileSync, writeFileSync } from "fs";
import { mkdir, readdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { decodeTranslationScript, installTranslation } from "./translation-lib.js";
import { listFiles } from "./pipeline-utils.js";
import { auditScript } from "./audit-lib.js";
import type { AssetManifest } from "@/core/asset-manifest.js";

const GITHUB_TREE_URL = "https://api.github.com/repos/IDerr/mahoyo-french/git/trees/master?recursive=1";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/IDerr/mahoyo-french/master";

const CREDITS =
  "Moon-Trad : traduction Naoyrig, relecture Naoyrig et Caster, technique IDerr, portage Steam RequinDr et loicfr. Dépôt : https://github.com/IDerr/mahoyo-french";

function toFileName(storage: string): string {
  const base = storage.replace(/\\/g, "/").split("/").pop() ?? storage;
  return base.toLowerCase().endsWith(".ks") ? base : `${base}.ks`;
}

async function fetchTree(timeoutMs: number): Promise<{ path: string }[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GITHUB_TREE_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { tree: { path: string }[] };
    return data.tree;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRaw(path: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${GITHUB_RAW_BASE}/${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadTranslations(sourceDir: string): Promise<void> {
  console.log(`Téléchargement de l'index depuis ${GITHUB_TREE_URL}...`);
  const tree = await fetchTree(60_000);
  const files = tree
    .map((e) => e.path)
    .filter((p) => p.startsWith("Texte/Complete/") && p.endsWith(".ks"));

  console.log(`${files.length} script(s) trouvé(s) dans Texte/Complete.`);

  let i = 0;
  for (const path of files) {
    i++;
    const fileName = toFileName(path);
    const outPath = join(sourceDir, fileName);
    process.stdout.write(`[${i}/${files.length}] ${fileName}... `);
    try {
      const buffer = await fetchRaw(path, 60_000);
      await mkdir(dirname(outPath), { recursive: true });
      writeFileSync(outPath, buffer);
      console.log("OK");
    } catch (err) {
      console.log(`ERREUR : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function parseArgs(argv: string[]): {
  language: string;
  sourceDir: string;
  assetsDir: string;
  fetch: boolean;
} {
  const args = argv.slice(2);
  const fetch = args.includes("--fetch");
  const positional = args.filter((a) => a !== "--fetch");

  if (positional.length < 2) {
    console.error(
      "Usage: npm run translation -- <langue> <dossier source> [dossier d'assets] [--fetch]",
    );
    process.exit(1);
  }

  const [language, sourceDir, explicitAssetsDir] = positional;
  const assetsDir = explicitAssetsDir ?? process.env.MAHOYO_ASSETS_DIR ?? "public/assets";
  return { language: language!, sourceDir: sourceDir!, assetsDir, fetch };
}

async function main(): Promise<void> {
  const { language, sourceDir, assetsDir, fetch: shouldFetch } = parseArgs(process.argv);

  if (shouldFetch) {
    await downloadTranslations(sourceDir);
  }

  const sourceFiles = listFiles(sourceDir, (p) => p.toLowerCase().endsWith(".ks"));
  if (sourceFiles.length === 0) {
    console.error(`Aucun script .ks trouvé dans ${sourceDir}`);
    process.exit(1);
  }

  const originalDir = join(assetsDir, "scenario");
  const originalTexts = new Map<string, string>();
  const translatedTexts = new Map<string, string>();

  for (const path of sourceFiles) {
    const fileName = toFileName(path);
    const originalPath = join(originalDir, fileName);
    try {
      const buffer = readFileSync(originalPath);
      const { text } = decodeTranslationScript(buffer);
      originalTexts.set(fileName, text);
    } catch {
      // Script original absent : il sera ignoré par installTranslation.
    }

    try {
      const buffer = readFileSync(path);
      const { text } = decodeTranslationScript(buffer);
      translatedTexts.set(fileName, text);
    } catch (err) {
      console.error(`Impossible de lire ${path} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const { index, reports, installed, neutralized } = installTranslation(originalTexts, translatedTexts, {
    language,
    label: `Traduction ${language}`,
    credits: CREDITS,
  });

  const outDir = join(assetsDir, "lang", language);
  await mkdir(join(outDir, "scenario"), { recursive: true });

  for (const [file, text] of installed) {
    await writeFile(join(outDir, "scenario", file), text, "utf-8");
  }

  // Chargement du manifest d'assets pour détecter les ressources supplémentaires
  // référencées par la traduction mais absentes du manifest.
  let manifest: AssetManifest | null = null;
  try {
    manifest = JSON.parse(readFileSync(join(assetsDir, "asset-manifest.json"), "utf-8")) as AssetManifest;
  } catch {
    // Pas de manifest : on continue sans extra assets.
  }

  const originalScriptTexts = new Map<string, string>(originalTexts);
  const translatedScriptTexts = new Map<string, string>(originalTexts);
  for (const [file, text] of installed) {
    translatedScriptTexts.set(file, text);
  }

  const extraAssets: Record<string, string[]> = {};
  const extraFrequency: Map<string, number> = new Map();

  if (manifest) {
    for (const file of index.scripts) {
      const originalResult = await auditScript("/dev/null/original.ks", file, manifest, originalScriptTexts, 2_000);
      const translatedResult = await auditScript("/dev/null/translated.ks", file, manifest, translatedScriptTexts, 2_000);

      const originalSet = new Set(originalResult.missingAssets);
      const extra = translatedResult.missingAssets.filter((a) => !originalSet.has(a));
      if (extra.length > 0) {
        extraAssets[file] = extra;
        for (const a of extra) {
          extraFrequency.set(a, (extraFrequency.get(a) ?? 0) + 1);
        }
      }
    }
  }

  index.extraAssets = extraAssets;

  await writeFile(join(outDir, "index.json"), JSON.stringify(index, null, 2), "utf-8");

  console.log(`\nRapport d'installation de la traduction ${language} :`);
  console.log(`  Scripts source : ${sourceFiles.length}`);
  console.log(`  Scripts originaux correspondants : ${originalTexts.size}`);
  console.log(`  Scripts installés : ${index.scripts.length}`);
  console.log(`  Scripts stricts : ${index.strict.length}`);
  console.log(`  Scripts ignorés : ${index.skipped.length}`);
  let neutralizedTotal = 0;
  for (const n of neutralized.values()) neutralizedTotal += n;
  console.log(
    `  Pauses [l] vides retirées : ${neutralizedTotal} (dans ${neutralized.size} script(s))`,
  );

  if (index.skipped.length > 0) {
    console.log("\nScripts ignorés :");
    for (const { file, reason } of index.skipped) {
      console.log(`  - ${file} : ${reason}`);
    }
  }

  const totalExtra = [...extraFrequency.values()].reduce((a, b) => a + b, 0);
  if (totalExtra > 0) {
    const top10 = [...extraFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    console.log(`\nRessources absentes du manifest mais référencées par la traduction : ${totalExtra}`);
    console.log("Top 10 :");
    for (const [asset, count] of top10) {
      console.log(`  - ${asset} (${count} script${count > 1 ? "s" : ""})`);
    }
  } else {
    console.log("\nAucune ressource supplémentaire absente du manifest n'a été détectée.");
  }

  const firstError = reports.find((r) => !r.installable);
  if (firstError) {
    process.exitCode = 0; // Les scripts installés le sont, les autres sont ignorés.
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
