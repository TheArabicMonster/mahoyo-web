import { generatePlaceholderAssets } from "./placeholders.js";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export default function globalSetup() {
  const assetsDir = process.env.MAHOYO_E2E_ASSETS ?? mkdtempSync(join(tmpdir(), "mahoyo-e2e-assets-"));
  generatePlaceholderAssets(assetsDir);
  process.env.MAHOYO_E2E_ASSETS = assetsDir;
  console.log("[e2e] placeholders generated in", assetsDir);
}
