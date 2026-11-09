/**
 * Vérifie que `.gitignore` ignore `node_modules` qu'il soit un **dossier** ou un
 * **lien symbolique** (worktrees d'agents) — issue #265.
 *
 * Même classe de bug que #239 pour `public/assets` : une règle `node_modules/`
 * (barre finale) n'ignore que le dossier, pas un lien symbolique. Les tests
 * utilisent des dépôts jetables (aucun réel `node_modules` n'est créé/committé).
 *
 * @vitest-environment node
 */
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

/** Chemin du vrai `.gitignore` (règle `node_modules` sans barre finale). */
const GITIGNORE_URL = new URL("../../../.gitignore", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): string {
  // stderr capturé : certains tests attendent volontairement un échec git.
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Dépôt jetable avec le `.gitignore` fourni (git init sans configuration globale). */
function makeRepo(gitignore: string): string {
  const repo = makeTempDir("mahoyo-node-modules-");
  writeFileSync(join(repo, ".gitignore"), gitignore, "utf-8");
  git(repo, ["init", "-q"]);
  return repo;
}

/** Lien symbolique `node_modules` vers un dossier temporaire (cas worktree). */
function makeSymlinkRepo(gitignore: string): string {
  const repo = makeRepo(gitignore);
  const target = makeTempDir("mahoyo-node-modules-target-");
  symlinkSync(target, join(repo, "node_modules"), "dir");
  return repo;
}

const REAL_GITIGNORE = readFileSync(GITIGNORE_URL, "utf-8");

describe("lien symbolique node_modules (worktree)", () => {
  it("est ignoré par le .gitignore réel et ne peut pas être ajouté par accident", () => {
    const repo = makeSymlinkRepo(REAL_GITIGNORE);

    expect(() => git(repo, ["check-ignore", "-q", "node_modules"])).not.toThrow();
    // `git add` refuse le lien ignoré : impossible de le commiter par accident.
    expect(() => git(repo, ["add", "node_modules"])).toThrow();
    expect(git(repo, ["ls-files"])).toBe("");
  });

  it("est encore listé comme non suivi si la règle garde une barre finale (bug #265)", () => {
    const repo = makeSymlinkRepo("node_modules/\n");

    // Preuve du bug d'origine : la règle « dossier » ne s'applique pas au lien.
    expect(() => git(repo, ["check-ignore", "-q", "node_modules"])).toThrow();
    expect(() => git(repo, ["add", "node_modules"])).not.toThrow();
    expect(git(repo, ["ls-files"])).toContain("node_modules");
  });
});

describe("dossier node_modules (npm ci, pas de régression)", () => {
  it("reste ignoré, y compris son contenu", () => {
    const repo = makeRepo(REAL_GITIGNORE);
    mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");

    expect(() => git(repo, ["check-ignore", "-q", "node_modules"])).not.toThrow();
    expect(() => git(repo, ["check-ignore", "-q", "node_modules/pkg/index.js"])).not.toThrow();
    expect(() => git(repo, ["add", "node_modules"])).toThrow();
    expect(git(repo, ["ls-files"])).toBe("");
  });
});

describe("dépôt réel", () => {
  it("ignore node_modules (dossier installé ou lien de worktree)", () => {
    // Dans la CI c'est un dossier (`npm ci`), en worktree local un lien : les deux cas
    // doivent être ignorés par le vrai `.gitignore`.
    expect(() => git(REPO_ROOT, ["check-ignore", "-q", "node_modules"])).not.toThrow();
    expect(() => git(REPO_ROOT, ["status", "--porcelain", "--", "node_modules"])).not.toThrow();
    expect(git(REPO_ROOT, ["status", "--porcelain", "--", "node_modules"]).trim()).toBe("");
  });
});
