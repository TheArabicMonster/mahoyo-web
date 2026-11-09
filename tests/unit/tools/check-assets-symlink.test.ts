/**
 * Tests unitaires et d'intégration de la détection d'un lien symbolique
 * `public/assets` suivi par git (issue #239).
 *
 * @vitest-environment node
 */
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ASSETS_DIR,
  SYMLINK_MODE,
  findTrackedAssetSymlinks,
  formatViolations,
  parseLsFilesStage,
} from "../../../tools/check-no-assets-lib.js";
import type { TrackedEntry } from "../../../tools/check-no-assets-lib.js";

const SHA = "a".repeat(40);

/** Chemin du vrai `.gitignore` (déjà corrigé : `public/assets` sans barre finale). */
const GITIGNORE_URL = new URL("../../../.gitignore", import.meta.url);

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Nettoie tous les dossiers jetables, même si un test a échoué. */
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): string {
  // stderr est capturé : certains tests attendent volontairement un échec git.
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Dépôt jetable avec le `.gitignore` donné, `public/` réel et un lien
 * symbolique `public/assets` vers un dossier temporaire vide (aucun asset réel).
 */
function makeDisposableRepo(gitignore: string): string {
  const repo = makeTempDir("mahoyo-check-assets-");
  writeFileSync(join(repo, ".gitignore"), gitignore, "utf-8");
  git(repo, ["init", "-q"]);
  mkdirSync(join(repo, "public"), { recursive: true });
  const target = makeTempDir("mahoyo-assets-target-");
  symlinkSync(target, join(repo, "public", "assets"), "dir");
  return repo;
}

function entry(path: string, mode = "100644"): TrackedEntry {
  return { path, mode };
}

describe("parseLsFilesStage", () => {
  it("lit le mode et le chemin, y compris non ASCII, espaces et retours à la ligne", () => {
    const raw =
      [
        `100644 ${SHA} 0\tsrc/main.ts`,
        `120000 ${SHA} 0\tpublic/assets`,
        `100644 ${SHA} 0\t背景.png`,
        `100644 ${SHA} 0\tdir/fichier avec espace.tlg`,
        `100644 ${SHA} 0\tligne\nsuivante.txt`,
      ].join("\0") + "\0";

    expect(parseLsFilesStage(raw)).toEqual([
      { mode: "100644", path: "src/main.ts" },
      { mode: "120000", path: "public/assets" },
      { mode: "100644", path: "背景.png" },
      { mode: "100644", path: "dir/fichier avec espace.tlg" },
      { mode: "100644", path: "ligne\nsuivante.txt" },
    ]);
  });

  it("ignore les entrées vides", () => {
    expect(parseLsFilesStage("")).toEqual([]);
    expect(parseLsFilesStage("\0\0")).toEqual([]);
  });
});

describe("findTrackedAssetSymlinks", () => {
  it("signale public/assets suivi en mode lien symbolique", () => {
    expect(findTrackedAssetSymlinks([entry(ASSETS_DIR, SYMLINK_MODE)])).toEqual([
      { path: "public/assets", extension: "", reason: "symlink" },
    ]);
  });

  it("ignore public/assets en mode fichier normal (100644)", () => {
    expect(findTrackedAssetSymlinks([entry(ASSETS_DIR, "100644")])).toEqual([]);
  });

  it("ignore un lien symbolique suivi ailleurs", () => {
    expect(findTrackedAssetSymlinks([entry("src/lien", SYMLINK_MODE)])).toEqual([]);
    expect(findTrackedAssetSymlinks([entry("public/assets-old", SYMLINK_MODE)])).toEqual([]);
  });

  it("signale aussi un lien symbolique imbriqué sous public/assets", () => {
    const entries = [entry("public/assets/sous-lien", SYMLINK_MODE), entry("public/assets/image.png", "100644")];
    expect(findTrackedAssetSymlinks(entries)).toEqual([
      { path: "public/assets/sous-lien", extension: "", reason: "symlink" },
    ]);
  });

  it("retourne [] sur une liste vide", () => {
    expect(findTrackedAssetSymlinks([])).toEqual([]);
  });
});

describe("formatViolations — liens symboliques", () => {
  it("affiche l'aide dédiée sans le bloc de l'allowlist quand seul un lien est en cause", () => {
    const msg = formatViolations([{ path: ASSETS_DIR, extension: "", reason: "symlink" }]);

    expect(msg).toContain("Fichiers interdits détectés (1)");
    expect(msg).toContain("public/assets (lien symbolique suivi par git)");
    expect(msg).toContain("lien symbolique");
    expect(msg).toContain("git rm --cached public/assets");
    expect(msg).not.toContain("--update");
    expect(msg).not.toContain("tools/allowed-assets.txt");
  });

  it("affiche les deux blocs d'aide pour un cas mixte (lien + asset .tlg)", () => {
    const msg = formatViolations([
      { path: ASSETS_DIR, extension: "", reason: "symlink" },
      { path: "fake-asset.tlg", extension: ".tlg" },
    ]);

    expect(msg).toContain("Fichiers interdits détectés (2)");
    expect(msg).toContain("git rm --cached public/assets");
    expect(msg).toContain("tools/allowed-assets.txt");
    expect(msg).toContain("--update");
    expect(msg).toContain("fake-asset.tlg (.tlg)");
  });
});

describe("intégration git — lien public/assets et .gitignore", () => {
  it("le .gitignore réel ignore le lien non suivi et empêche git add", () => {
    const repo = makeDisposableRepo(readFileSync(GITIGNORE_URL, "utf-8"));

    // Le lien non suivi est ignoré : c'est l'usage de dev autorisé.
    expect(() => git(repo, ["check-ignore", "-q", ASSETS_DIR])).not.toThrow();
    // On ne peut donc pas l'ajouter par accident.
    expect(() => git(repo, ["add", ASSETS_DIR])).toThrow();
    expect(parseLsFilesStage(git(repo, ["ls-files", "-s", "-z"]))).toEqual([]);
  });

  it("un lien forcé dans l'index est détecté comme lien symbolique suivi", () => {
    const repo = makeDisposableRepo(readFileSync(GITIGNORE_URL, "utf-8"));

    git(repo, ["add", "-f", ASSETS_DIR]);
    const entries = parseLsFilesStage(git(repo, ["ls-files", "-s", "-z"]));

    expect(entries).toContainEqual({ path: ASSETS_DIR, mode: SYMLINK_MODE });
    expect(findTrackedAssetSymlinks(entries)).toEqual([
      { path: "public/assets", extension: "", reason: "symlink" },
    ]);
  });

  it("l'ancienne règle « public/assets/ » n'ignorait pas le lien (bug d'origine)", () => {
    const repo = makeDisposableRepo("public/assets/\n");

    expect(() => git(repo, ["check-ignore", "-q", ASSETS_DIR])).toThrow();
    // Preuve du risque : sans la barre finale retirée, git add acceptait le lien.
    expect(() => git(repo, ["add", ASSETS_DIR])).not.toThrow();
    expect(parseLsFilesStage(git(repo, ["ls-files", "-s", "-z"]))).toContainEqual({
      path: ASSETS_DIR,
      mode: SYMLINK_MODE,
    });
  });
});
