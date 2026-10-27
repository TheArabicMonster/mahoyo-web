import { existsSync } from "fs";
import { join } from "path";

const MANIFEST_PATH = join(import.meta.dirname, "../../public/assets/asset-manifest.json");

/** True si les vrais assets (générés par le pipeline) sont présents. */
export const hasAssets = existsSync(MANIFEST_PATH);
