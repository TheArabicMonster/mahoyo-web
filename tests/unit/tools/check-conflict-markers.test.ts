/**
 * Tests du garde-fou anti-marqueurs de conflit Git (#342).
 *
 * @vitest-environment node
 */
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BINARY_SAMPLE_BYTES,
  checkConflictMarkers,
  findConflictMarkers,
  formatConflictMarkers,
  isIgnoredPath,
  looksBinary,
  parseTrackedPaths,
} from "../../../tools/check-conflict-markers-lib.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Dépôt jetable : `tracked` sont indexés, `untracked` restent non suivis. */
function makeRepo(
  tracked: Record<string, string>,
  options: { untracked?: Record<string, string>; forceTracked?: Record<string, string> } = {},
): string {
  const repo = makeTempDir("mahoyo-conflict-");
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, ".gitignore"), "public/assets/\n", "utf-8");
  const untracked = options.untracked ?? {};
  for (const [path, content] of Object.entries({ ...tracked, ...untracked, ...(options.forceTracked ?? {}) })) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content, "utf-8");
  }
  if (Object.keys(tracked).length > 0) git(repo, ["add", ...Object.keys(tracked)]);
  if (options.forceTracked && Object.keys(options.forceTracked).length > 0) {
    // Simule un fichier historiquement suivi malgré le .gitignore : il doit être ignoré.
    git(repo, ["add", "-f", ...Object.keys(options.forceTracked)]);
  }
  return repo;
}

describe("findConflictMarkers", () => {
  it("ne signale rien sur un fichier propre", () => {
    expect(findConflictMarkers("const a = 1;\n\n// commentaire\n")).toEqual([]);
  });

  it("signale un conflit au milieu d'un fichier (début, séparateur, fin)", () => {
    const content = ["const a = 1;", "<<<<<<< HEAD", "version main", "=======", "version branche", ">>>>>>> 33cff77 (feat)", "const b = 2;"].join(
      "\n",
    );
    const markers = findConflictMarkers(content, "src/x.ts");
    expect(markers.map((marker) => [marker.line, marker.kind])).toEqual([
      [2, "start"],
      [4, "separator"],
      [6, "end"],
    ]);
    expect(markers.every((marker) => marker.path === "src/x.ts")).toBe(true);
  });

  it("signale un marqueur en fin de fichier (marqueur orphelin)", () => {
    const content = "const a = 1;\n>>>>>>> 33cff77 (feat)";
    expect(findConflictMarkers(content, "src/x.css").map((marker) => marker.kind)).toEqual(["end"]);
  });

  it("ne confond pas un titre Markdown souligné par ======= avec un conflit", () => {
    const markdown = ["# Titre", "", "Sous-titre", "=======", "", "Texte."].join("\n");
    expect(findConflictMarkers(markdown, "docs/DOC.md")).toEqual([]);
  });

  it("ne signale pas ======= seul hors conflit, mais le signale dans un conflit", () => {
    expect(findConflictMarkers("a\n=======\nb\n")).toEqual([]);
    const markers = findConflictMarkers("<<<<<<< HEAD\na\n=======\n>>>>>>> deadbee\n");
    expect(markers.map((marker) => marker.kind)).toEqual(["start", "separator", "end"]);
  });

  it("tolère les fins de ligne CRLF", () => {
    const markers = findConflictMarkers("x\r\n<<<<<<< HEAD\r\na\r\n=======\r\nb\r\n>>>>>>> abc1234\r\n");
    expect(markers).toHaveLength(3);
    expect(markers.map((marker) => marker.line)).toEqual([2, 4, 6]);
  });
});

describe("helpers", () => {
  it("détecte les binaires (octet NUL dans l'échantillon)", () => {
    expect(looksBinary(Buffer.from("texte pur"))).toBe(false);
    expect(looksBinary(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(true);
    expect(BINARY_SAMPLE_BYTES).toBe(8000);
  });

  it("ignore les chemins de la liste (#342)", () => {
    for (const path of ["public/assets/bg/x.webp", "node_modules/pkg/index.js", "dist/sw.js", ".git/config"]) {
      expect(isIgnoredPath(path)).toBe(true);
    }
    for (const path of ["src/ui/ui-manager.css", "public/manifest.json", "docs/DOC.md"]) {
      expect(isIgnoredPath(path)).toBe(false);
    }
  });

  it("découpe git ls-files -z", () => {
    expect(parseTrackedPaths("a.ts\0b/c.css\0\0")).toEqual(["a.ts", "b/c.css"]);
  });

  it("formate les marqueurs en fichier:ligne", () => {
    const message = formatConflictMarkers(findConflictMarkers("<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> abc\n", "a.css"));
    expect(message).toContain("a.css:1");
    expect(message).toContain("a.css:3");
    expect(message).toContain("a.css:5");
    expect(message).toContain("Marqueurs de conflit Git détectés (3)");
  });
});

describe("checkConflictMarkers sur un dépôt jetable", () => {
  it("échoue sur un fichier suivi avec marqueur, ignore les fichiers non suivis/binaires", () => {
    const repo = makeRepo(
      {
        "src/clean.ts": "export const a = 1;\n",
        "src/conflict.css": ".a { color: red; }\n<<<<<<< HEAD\n.b { color: blue; }\n=======\n.b { color: green; }\n>>>>>>> 33cff77 (feat)\n",
        "docs/DOC.md": "Titre\n=======\n\ntexte\n",
      },
      {
        // Fichier suivi malgré public/assets/ ignoré : le garde-fou doit l'ignorer.
        forceTracked: { "public/assets/ignored.png": "<<<<<<< HEAD\nbinaire\n" },
        // Non suivi (ignoré par .gitignore) : jamais contrôlé non plus.
        untracked: { "public/assets/not-tracked.png": "<<<<<<< HEAD\nignoré\n" },
      },
    );
    writeFileSync(join(repo, "public/assets/binary.dat"), Buffer.from([0x00, 0x01, 0x00]));

    const result = checkConflictMarkers(repo);
    expect(result.filesScanned).toBe(3); // src/clean.ts, src/conflict.css, docs/DOC.md
    expect(result.violations).toHaveLength(3);
    expect(result.violations.every((marker) => marker.path === "src/conflict.css")).toBe(true);
    expect(result.violations.map((marker) => marker.line)).toEqual([2, 4, 6]);
  });

  it("réussit sur un dépôt propre", () => {
    const repo = makeRepo({ "src/clean.ts": "export const a = 1;\n", "docs/DOC.md": "Titre\n=======\n" });
    const result = checkConflictMarkers(repo);
    expect(result.violations).toEqual([]);
    expect(result.filesScanned).toBe(2);
  });
});
