/**
 * Tests de la génération du service worker après build (issue #96).
 *
 * Fixtures : faux dossier `dist` (aucun asset du jeu), manifeste Vite minimal.
 *
 * @vitest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  STATIC_PRECACHE,
  buildServiceWorkerSource,
  collectPwaPrecache,
  computeServiceWorkerVersion,
  writePwaServiceWorker,
} from "../../../tools/pwa-sw.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

const MANIFEST = {
  "index.html": {
    file: "assets/index-abc123.js",
    css: ["assets/index-abc123.css"],
    assets: ["assets/logo-def456.svg"],
    isEntry: true,
  },
};

/** Faux `dist/` complet : manifeste Vite + fichiers de coquille + un asset du jeu. */
function makeDist(options: { omit?: string } = {}): string {
  const dist = mkdtempSync(join(tmpdir(), "mahoyo-pwa-dist-"));
  tempDirs.push(dist);
  mkdirSync(join(dist, ".vite"), { recursive: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, ".vite", "manifest.json"), JSON.stringify(MANIFEST), "utf-8");
  const files = [
    "index.html",
    "manifest.json",
    "icon-192.png",
    "icon-512.png",
    "assets/index-abc123.js",
    "assets/index-abc123.css",
    "assets/logo-def456.svg",
  ];
  for (const file of files) {
    if (file === options.omit) continue;
    writeFileSync(join(dist, file), `contenu de ${file}`, "utf-8");
  }
  // Un asset du jeu (copié depuis public/assets) ne doit PAS être précaché.
  mkdirSync(join(dist, "assets", "bg"), { recursive: true });
  writeFileSync(join(dist, "assets", "bg", "night.webp"), "asset-du-jeu", "utf-8");
  return dist;
}

describe("collectPwaPrecache", () => {
  it("précache la coquille : fichiers statiques + bundles du manifeste Vite, triés", () => {
    const dist = makeDist();
    const precache = collectPwaPrecache(dist);

    expect(precache).toEqual(
      [...precache].sort(), // tri déterministe
    );
    for (const url of STATIC_PRECACHE) expect(precache).toContain(url);
    expect(precache).toContain("/assets/index-abc123.js");
    expect(precache).toContain("/assets/index-abc123.css");
    expect(precache).toContain("/assets/logo-def456.svg");
    // Les assets du jeu ne sont jamais précachés.
    expect(precache).not.toContain("/assets/bg/night.webp");
    expect(precache.some((url) => url.endsWith(".map"))).toBe(false);
  });

  it("échoue clairement si un fichier de coquille manque", () => {
    const dist = makeDist({ omit: "icon-512.png" });
    expect(() => collectPwaPrecache(dist)).toThrow(/Fichiers de coquille manquants.*icon-512\.png/);
  });

  it("échoue clairement si le manifeste de build est absent", () => {
    const dist = mkdtempSync(join(tmpdir(), "mahoyo-pwa-empty-"));
    tempDirs.push(dist);
    expect(() => collectPwaPrecache(dist)).toThrow(/Manifeste de build introuvable/);
  });
});

describe("computeServiceWorkerVersion", () => {
  it("est déterministe et dépend du contenu précaché", () => {
    const a = computeServiceWorkerVersion(["/index.html", "/assets/a.js"]);
    const b = computeServiceWorkerVersion(["/assets/a.js", "/index.html"]);
    const c = computeServiceWorkerVersion(["/index.html", "/assets/b.js"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).not.toBe(c);
  });
});

describe("buildServiceWorkerSource / writePwaServiceWorker", () => {
  it("génère et écrit un sw.js avec version, pré-cache et stratégies", () => {
    const dist = makeDist();
    const { version, precache, serviceWorkerPath } = writePwaServiceWorker(dist);

    expect(serviceWorkerPath).toBe(join(dist, "sw.js"));
    const source = readFileSync(serviceWorkerPath, "utf-8");
    expect(source).toContain(`const VERSION = ${JSON.stringify(version)};`);
    expect(source).toContain("mahoyo-shell-");
    expect(source).toContain("MAX_RUNTIME_ENTRIES");
    expect(precache).toContain("/index.html");
    expect(buildServiceWorkerSource(dist)).toBe(source);
  });
});
