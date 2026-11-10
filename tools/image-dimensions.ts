/**
 * Génère `image-dimensions.json` à côté de `asset-manifest.json` (#315).
 *
 * Le renderer a besoin des dimensions natives **avant décodage** pour placer les sprites en pixels
 * absolus (boîte réservée dès la première frame). Aucun asset n'est commité : le manifeste ne
 * contient que des clés logiques et des tailles.
 *
 * Usage :
 *   npm run assets:dimensions -- --assets public/assets
 *   (aussi appelé par les placeholders e2e)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AssetManifest } from "../src/core/asset-manifest.js";
import { readImageSize, type ImageDimensionsManifest } from "../src/core/image-dimensions.js";

/** Génère le manifeste des dimensions pour un dossier d'assets (manifest + fichiers). */
export function generateImageDimensions(assetsDir: string): ImageDimensionsManifest {
  const manifestPath = join(assetsDir, "asset-manifest.json");
  const dimensions: ImageDimensionsManifest["dimensions"] = {};
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as AssetManifest;
    for (const [key, entry] of Object.entries(manifest.images ?? {})) {
      const url = (entry as { url?: string }).url;
      if (!url) continue;
      const file = join(assetsDir, url.replace(/^\/?assets\//, ""));
      if (!existsSync(file)) continue;
      const size = readImageSize(readFileSync(file));
      if (size) dimensions[key] = size;
    }
  }
  const out: ImageDimensionsManifest = {
    version: 1,
    generatedAt: new Date(0).toISOString(),
    dimensions,
  };
  writeFileSync(join(assetsDir, "image-dimensions.json"), JSON.stringify(out, null, 2), "utf-8");
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  let assetsDir = process.env.MAHOYO_ASSETS_DIR ?? join(process.cwd(), "public", "assets");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--assets") assetsDir = argv[++i] ?? assetsDir;
  }
  const out = generateImageDimensions(resolve(assetsDir));
  console.log(`[assets:dimensions] ${Object.keys(out.dimensions).length} image(s) mesurée(s) → image-dimensions.json`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
