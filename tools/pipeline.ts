/**
 * Orchestrateur du pipeline d'assets.
 *
 * Usage:
 *   npm run pipeline -- --input <dir> --output <dir> [--dry-run]
 *
 * Étapes :
 *   1. extract-xp3  (optionnel, si extracteur fourni)
 *   2. convert-tlg  (optionnel, si convertisseur fourni)
 *   3. convert-audio
 *   4. normalize-ks
 */
import { mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { runConvertAudio } from "./convert-audio.js";
import { runConvertTlg } from "./convert-tlg.js";
import { runExtractXp3 } from "./extract-xp3.js";
import { runNormalizeKs } from "./normalize-ks.js";
import type { PipelineContext } from "./pipeline-utils.js";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const inputDir = args.input as string | undefined;
  const outputDir = args.output as string | undefined;
  const dryRun = args["dry-run"] === true;
  const xp3Extractor = (args["xp3-extractor"] as string) || undefined;
  const tlgConverter = (args["tlg-converter"] as string) || undefined;
  const audioEncoder = (args["audio-encoder"] as string) || undefined;

  if (!inputDir || !outputDir) {
    console.error("Usage: npm run pipeline -- --input <dir> --output <dir> [--dry-run]");
    console.error("  [--xp3-extractor <path>] [--tlg-converter <path>] [--audio-encoder <path>]");
    process.exit(1);
  }

  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
  }

  const context: PipelineContext = {
    inputDir,
    outputDir,
    dryRun,
    xp3Extractor,
    tlgConverter,
    audioEncoder,
  };

  console.log(`[pipeline] Input : ${inputDir}`);
  console.log(`[pipeline] Output: ${outputDir}`);
  console.log(`[pipeline] Dry-run: ${dryRun}`);

  await runExtractXp3(context);
  await runConvertTlg(context);
  await runConvertAudio(context);
  await runNormalizeKs(context);

  console.log("[pipeline] Terminé.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
