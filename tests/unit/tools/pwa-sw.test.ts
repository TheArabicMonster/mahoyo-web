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
  ensureShellFilesInDist,
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
function makeDist(options: { omit?: string | string[] } = {}): string {
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
  const omitted = options.omit === undefined ? [] : Array.isArray(options.omit) ? options.omit : [options.omit];
  for (const file of files) {
    if (omitted.includes(file)) continue;
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

  it("échoue clairement si un fichier de coquille manque partout", () => {
    const dist = makeDist({ omit: "icon-512.png" });
    // Source canonique volontairement vide : ni le build ni public/ ne fournissent l'icône.
    expect(() => collectPwaPrecache(dist, { repoPublicDir: join(dist, "public-absent") })).toThrow(
      /Fichiers de coquille manquants.*icon-512\.png/,
    );
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

describe("publicDir externe — coquille copiée depuis public/ (#336)", () => {
  /** Source canonique factice (public/ du dépôt). */
  function makeRepoPublic(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "mahoyo-pwa-public-"));
    tempDirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), content, "utf-8");
    }
    return dir;
  }

  it("copie manifeste et icônes absents de dist (build avec MAHOYO_E2E_ASSETS)", () => {
    // Build avec publicDir externe : dist n'a que index.html et les bundles.
    const dist = makeDist({ omit: ["manifest.json", "icon-192.png", "icon-512.png"] });
    const repoPublic = makeRepoPublic({
      "manifest.json": "manifeste-public",
      "icon-192.png": "icone-192-publique",
      "icon-512.png": "icone-512-publique",
    });

    const copied = ensureShellFilesInDist(dist, repoPublic);
    expect(copied.sort()).toEqual(["/icon-192.png", "/icon-512.png", "/manifest.json"].sort());
    expect(readFileSync(join(dist, "manifest.json"), "utf-8")).toBe("manifeste-public");
    expect(readFileSync(join(dist, "icon-512.png"), "utf-8")).toBe("icone-512-publique");

    // La liste précachée contient bien toute la coquille.
    const precache = collectPwaPrecache(dist, { repoPublicDir: repoPublic });
    for (const url of STATIC_PRECACHE) expect(precache).toContain(url);

    // Et le service worker est généré (pas d'échec du build placeholders).
    const { serviceWorkerPath } = writePwaServiceWorker(dist, { repoPublicDir: repoPublic });
    const source = readFileSync(serviceWorkerPath, "utf-8");
    expect(source).toContain('"/manifest.json"');
    expect(source).toContain('"/icon-192.png"');
  });

  it("ne modifie pas les fichiers déjà présents (build normal inchangé)", () => {
    const dist = makeDist();
    const repoPublic = makeRepoPublic({
      "manifest.json": "manifeste-public",
      "icon-192.png": "icone-publique",
      "icon-512.png": "icone-publique",
    });
    const before = readFileSync(join(dist, "manifest.json"), "utf-8");

    const copied = ensureShellFilesInDist(dist, repoPublic);
    expect(copied).toEqual([]);
    expect(readFileSync(join(dist, "manifest.json"), "utf-8")).toBe(before);
    expect(collectPwaPrecache(dist, { repoPublicDir: repoPublic })).toContain("/manifest.json");
  });
});
