/**
 * Tests de la source du service worker généré (#96, cache d'assets versionné #372).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  ASSETS_CACHE_PREFIX,
  DEFAULT_ASSETS_VERSION,
  MAX_ASSETS_ENTRIES,
  META_CACHE,
  META_VERSION_KEY,
  SHELL_CACHE_PREFIX,
  SWR_ASSET_PATHS,
  TRIM_EVERY,
  renderServiceWorker,
} from "../../../src/pwa/sw-source.js";

const OPTIONS = {
  precache: ["/index.html", "/assets/index-abc.js", "/assets/index-abc.css", "/manifest.json"],
  version: "0123456789ab",
};

describe("renderServiceWorker", () => {
  const source = renderServiceWorker(OPTIONS);

  it("est du JavaScript syntaxiquement valide", () => {
    expect(() => new Function(source)).not.toThrow();
  });

  it("précache la coquille et versionne le cache de coquille", () => {
    expect(source).toContain(`const VERSION = "0123456789ab";`);
    expect(source).toContain(JSON.stringify(SHELL_CACHE_PREFIX));
    expect(source).toContain("const SHELL_CACHE = SHELL_CACHE_PREFIX + VERSION;");
    for (const url of OPTIONS.precache) {
      expect(source).toContain(JSON.stringify(url));
    }
    expect(source).toContain("cache.addAll(PRECACHE)");
  });

  it("nomme le cache d'assets avec la version lue dans le manifeste (#372)", () => {
    expect(source).toContain(JSON.stringify(ASSETS_CACHE_PREFIX));
    expect(source).toContain("async function assetsCacheName()");
    expect(source).toContain("ASSETS_CACHE_PREFIX + (await readAssetsVersion())");
    expect(source).toContain('fetch("/assets/asset-manifest.json", { cache: "no-store" })');
    expect(source).toContain("manifest.assetsVersion");
    expect(source).toContain(JSON.stringify(META_CACHE));
    expect(source).toContain(JSON.stringify(META_VERSION_KEY));
    expect(source).toContain(JSON.stringify(DEFAULT_ASSETS_VERSION));
    // La version fraîche est relue à chaque installation (nouveau build → nouvelle version).
    expect(source).toContain("readAssetsVersion({ fresh: true })");
    expect(source).toContain("DEFAULT_ASSETS_VERSION");
    expect(source).toContain("sanitizeAssetsVersion");
  });

  it("purge les anciens caches d'assets à l'activation, pas pendant les fetches", () => {
    const activate = source.slice(source.indexOf('self.addEventListener("activate"'), source.indexOf('self.addEventListener("fetch"'));
    expect(activate).toContain("key.startsWith(ASSETS_CACHE_PREFIX) && key !== currentAssets");
    expect(activate).toContain("key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE");
    expect(activate).toContain("caches.delete");
    // Aucune purge d'assets dans le handler de fetch : pas de vidage/remplissage en boucle.
    const fetchHandler = source.slice(source.indexOf('self.addEventListener("fetch"'), source.indexOf("function respond("));
    expect(fetchHandler).not.toContain("caches.delete");
    expect(fetchHandler).not.toContain("ASSETS_CACHE_PREFIX");
  });

  it("sert les assets en cache-first et seulement manifeste/dimensions en SWR", () => {
    expect(source).toContain("handleAssetRequest");
    expect(source).toContain("SWR_ASSET_PATHS");
    expect(source).toContain("cacheFirstAssets");
    expect(source).toContain("staleWhileRevalidate");
    for (const path of SWR_ASSET_PATHS) expect(source).toContain(JSON.stringify(path));
    const handleAsset = source.slice(source.indexOf("async function handleAssetRequest"), source.indexOf("async function networkFirstNavigation"));
    expect(handleAsset).toContain("SWR_ASSET_PATHS.has(pathname)");
    expect(handleAsset).toContain("cacheFirstAssets(cacheName, request)");
  });

  it("borne le cache d'assets et diffère le trim (pas de cache.keys() à chaque put)", () => {
    expect(source).toContain(`const MAX_ASSETS_ENTRIES = ${MAX_ASSETS_ENTRIES};`);
    expect(source).toContain(`const TRIM_EVERY = ${TRIM_EVERY};`);
    expect(source).toContain("if (assetsPutCount % TRIM_EVERY === 0) await trimCache(cache, MAX_ASSETS_ENTRIES)");
    const cacheFirstAssets = source.slice(source.indexOf("async function cacheFirstAssets"), source.indexOf("async function staleWhileRevalidate"));
    expect(cacheFirstAssets).not.toContain("cache.keys()");
    const trim = source.slice(source.indexOf("async function trimCache"), source.indexOf("async function fetchOrOffline"));
    expect(trim).toContain("cache.keys()");
  });

  it("ne met pas en cache les requêtes non GET, Range, cross-origin ni /api/", () => {
    expect(source).toContain('request.method !== "GET"');
    expect(source).toContain('request.headers.has("range")');
    expect(source).toContain("url.origin !== self.location.origin");
    expect(source).toContain('url.pathname.startsWith("/api/")');
    // Jamais de précache des assets du jeu (potentiellement plusieurs Go).
    expect(source).not.toContain("/assets/bg/");
  });

  it("gère la mise à jour : skipWaiting sur message et pas de skipWaiting automatique", () => {
    expect(source).toContain('event.data.type === "SKIP_WAITING"');
    expect(source).toContain("self.skipWaiting()");
    expect(source).toContain("self.clients.claim()");
  });

  it("est déterministe", () => {
    expect(renderServiceWorker(OPTIONS)).toBe(source);
  });
});
