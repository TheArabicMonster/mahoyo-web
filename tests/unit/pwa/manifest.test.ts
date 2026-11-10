/**
 * Validation du manifeste PWA et des icônes (issue #96).
 *
 * Aucun asset du jeu : les icônes sont des créations originales du projet
 * (allowlist `tools/allowed-assets.txt`).
 *
 * @vitest-environment node
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const MANIFEST_PATH = join(REPO_ROOT, "public/manifest.json");

type PwaIcon = { src: string; sizes: string; type: string; purpose?: string };
type PwaManifest = {
  id?: string;
  name?: string;
  short_name?: string;
  description?: string;
  lang?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  background_color?: string;
  theme_color?: string;
  orientation?: string;
  categories?: string[];
  icons?: PwaIcon[];
};

/** Dimensions d'un PNG (IHDR), sans dépendance. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as PwaManifest;

describe("public/manifest.json", () => {
  it("contient les champs requis pour une PWA installable", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.description).toBeTruthy();
    expect(manifest.lang).toBe("fr");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("landscape");
    expect(manifest.id).toBe("/");
  });

  it("utilise le thème sombre du design system", () => {
    expect(manifest.theme_color).toBe("#1a1a2e");
    expect(manifest.background_color).toBe("#0a0a0a");
  });

  it("déclare les icônes 192 et 512, dont une maskable", () => {
    const icons = manifest.icons ?? [];
    expect(icons.some((icon) => icon.sizes === "192x192" && icon.type === "image/png")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512" && icon.type === "image/png")).toBe(true);
    expect(icons.some((icon) => icon.purpose?.includes("maskable"))).toBe(true);
  });

  it("les fichiers d'icônes existent et ont les bonnes dimensions", () => {
    for (const icon of manifest.icons ?? []) {
      const path = join(REPO_ROOT, "public", icon.src.replace(/^\//, ""));
      const { width, height } = pngSize(readFileSync(path));
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
  });

  it("est lié depuis index.html (manifeste + icône + thème)", () => {
    const html = readFileSync(join(REPO_ROOT, "index.html"), "utf-8");
    expect(html).toContain('<link rel="manifest" href="/manifest.json" />');
    expect(html).toContain('name="theme-color" content="#1a1a2e"');
    expect(html).toContain('rel="apple-touch-icon"');
    // L'enregistrement du SW vit dans src/pwa/register.ts, pas dans un script inline.
    expect(html).not.toContain("serviceWorker");
  });
});
