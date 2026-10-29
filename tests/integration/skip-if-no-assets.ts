import { existsSync } from "fs";
import { join } from "path";

const PUBLIC_ASSETS_DIR = join(import.meta.dirname, "../../public/assets");

function resolveAssetsDir(): string | null {
  const envDir = process.env.MAHOYO_ASSETS_DIR;
  if (envDir && existsSync(join(envDir, "asset-manifest.json"))) {
    return envDir;
  }
  if (existsSync(join(PUBLIC_ASSETS_DIR, "asset-manifest.json"))) {
    return PUBLIC_ASSETS_DIR;
  }
  return null;
}

/**
 * Répertoire d'assets local (vrais assets ou pipeline généré).
 * Null si aucun asset n'est disponible.
 */
export const assetsDir: string | null = resolveAssetsDir();

/** True si les vrais assets (générés par le pipeline) sont présents. */
export const hasAssets = assetsDir !== null;

/** Chemin du manifest si les assets sont présents. */
export const manifestPath: string = hasAssets ? join(assetsDir!, "asset-manifest.json") : "";

/** Chemin du répertoire scenario si les assets sont présents. */
export const scenarioDir: string = hasAssets ? join(assetsDir!, "scenario") : "";
