import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  PLACEHOLDER_ASSETS_VERSION,
  assertPlaceholdersAllowed,
  generatePlaceholderAssets,
} from "../../../tests/e2e/placeholders.js";
import {
  backupAssets,
  readBackupMarker,
  restoreFromMarker,
  writeBackupMarker,
} from "../../../tests/e2e/assets-backup.js";
import { e2ePublicDir, prepareE2eAssets } from "../../../tests/e2e/prepare-assets.js";

const dirs: string[] = [];
function tmpPublic(): string {
  const dir = mkdtempSync(join(tmpdir(), "mahoyo-e2e-isolation-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeRealManifest(publicDir: string): string {
  const manifest = {
    version: 1,
    assetsVersion: "owner-real-v1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    images: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`img${i}`, { url: `bg/${i}.webp` }])),
    audio: Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`snd${i}`, { url: `audio/${i}.ogg` }])),
    scenarios: { "1-0": { url: "scenario/1-0.ks" } },
  };
  mkdirSync(join(publicDir, "assets"), { recursive: true });
  const path = join(publicDir, "assets", "asset-manifest.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
  return path;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("isolation des assets e2e (#417)", () => {
  it("refuse d'écraser un manifeste d'assets réels et le laisse intact", () => {
    const publicDir = tmpPublic();
    const manifest = writeRealManifest(publicDir);
    const before = sha256(manifest);
    expect(() => generatePlaceholderAssets(publicDir)).toThrow(/assets RÉELS|Refus/);
    expect(() => assertPlaceholdersAllowed(publicDir)).toThrow(/Refus/);
    expect(sha256(manifest)).toBe(before);
    expect(JSON.parse(readFileSync(manifest, "utf-8")).assetsVersion).toBe("owner-real-v1");
  });

  it("accepte un dossier de placeholders existant (idempotence)", () => {
    const publicDir = tmpPublic();
    generatePlaceholderAssets(publicDir);
    expect(() => generatePlaceholderAssets(publicDir)).not.toThrow();
    const manifest = JSON.parse(readFileSync(join(publicDir, "assets", "asset-manifest.json"), "utf-8"));
    expect(manifest.assetsVersion).toBe(PLACEHOLDER_ASSETS_VERSION);
  });

  it("n'écrase qu'avec --force explicite (variable refusée sans force)", () => {
    const publicDir = tmpPublic();
    const manifest = writeRealManifest(publicDir);
    const previous = process.env.MAHOYO_E2E_FORCE_PLACEHOLDERS;
    process.env.MAHOYO_E2E_FORCE_PLACEHOLDERS = "1";
    try {
      generatePlaceholderAssets(publicDir);
      expect(JSON.parse(readFileSync(manifest, "utf-8")).assetsVersion).toBe(PLACEHOLDER_ASSETS_VERSION);
    } finally {
      if (previous === undefined) delete process.env.MAHOYO_E2E_FORCE_PLACEHOLDERS;
      else process.env.MAHOYO_E2E_FORCE_PLACEHOLDERS = previous;
    }
  });

  it("sauvegarde puis restaure les fichiers écrasés (marqueur globalTeardown)", () => {
    const publicDir = tmpPublic();
    const manifest = writeRealManifest(publicDir);
    const before = sha256(manifest);
    const backup = backupAssets(publicDir, ["assets/asset-manifest.json", "assets/story-chain.json"]);
    writeBackupMarker(publicDir, backup);
    // Simule l'écrasement par les placeholders (dossier réel forcé).
    generatePlaceholderAssets(publicDir, { force: true });
    expect(sha256(manifest)).not.toBe(before);
    expect(readBackupMarker(publicDir)?.files).toContain("assets/asset-manifest.json");
    // Restauration après les tests (même en cas d'échec des tests).
    expect(restoreFromMarker(publicDir)).toBe(true);
    expect(sha256(manifest)).toBe(before);
    expect(readBackupMarker(publicDir)).toBeNull();
    expect(() => readFileSync(join(publicDir, ".e2e-assets-backup.json"))).toThrow();
  });

  it("un run e2e (prepareE2eAssets) ne modifie pas un manifeste réel — hash inchangé", () => {
    const publicDir = tmpPublic();
    const manifest = writeRealManifest(publicDir);
    mkdirSync(join(publicDir, "assets", "scenario"), { recursive: true });
    writeFileSync(join(publicDir, "assets", "scenario", "1-0.ks"), "@bg storage=black", "utf-8");
    const before = sha256(manifest);
    const previous = process.env.MAHOYO_E2E_ASSETS;
    process.env.MAHOYO_E2E_ASSETS = publicDir;
    try {
      expect(() => prepareE2eAssets()).toThrow(/assets RÉELS|Refus/);
    } finally {
      if (previous === undefined) delete process.env.MAHOYO_E2E_ASSETS;
      else process.env.MAHOYO_E2E_ASSETS = previous;
    }
    expect(sha256(manifest)).toBe(before);
    expect(JSON.parse(readFileSync(manifest, "utf-8")).assetsVersion).toBe("owner-real-v1");
  });

  it("le dossier par défaut est isolé hors du public/ du dépôt", () => {
    const repoPublic = resolve(process.cwd(), "public");
    const previous = process.env.MAHOYO_E2E_ASSETS;
    delete process.env.MAHOYO_E2E_ASSETS;
    try {
      const dir = e2ePublicDir();
      expect(dir).not.toBe(repoPublic);
      expect(dir.startsWith(tmpdir())).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.MAHOYO_E2E_ASSETS;
      else process.env.MAHOYO_E2E_ASSETS = previous;
    }
  });

  it("refuse explicitement le public/ du dépôt en mode placeholders", () => {
    const repoPublic = resolve(process.cwd(), "public");
    const previous = process.env.MAHOYO_E2E_ASSETS;
    const previousForce = process.env.MAHOYO_E2E_FORCE_PLACEHOLDERS;
    delete process.env.MAHOYO_E2E_FORCE_PLACEHOLDERS;
    process.env.MAHOYO_E2E_ASSETS = repoPublic;
    try {
      expect(() => prepareE2eAssets()).toThrow(/Isolation des assets/);
    } finally {
      if (previous === undefined) delete process.env.MAHOYO_E2E_ASSETS;
      else process.env.MAHOYO_E2E_ASSETS = previous;
      if (previousForce === undefined) delete process.env.MAHOYO_E2E_FORCE_PLACEHOLDERS;
      else process.env.MAHOYO_E2E_FORCE_PLACEHOLDERS = previousForce;
    }
  });
});
