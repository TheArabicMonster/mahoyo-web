/**
 * Tests de la source du service worker généré (issue #96).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  MAX_RUNTIME_ENTRIES,
  RUNTIME_CACHE,
  SHELL_CACHE_PREFIX,
  renderServiceWorker,
} from "../../../src/pwa/sw-source.js";

const OPTIONS = {
  precache: ["/index.html", "/assets/index-abc.js", "/assets/index-abc.css", "/manifest.json"],
  version: "0123456789ab",
};

describe("renderServiceWorker", () => {
  const source = renderServiceWorker(OPTIONS);

  it("précache la coquille et versionne le cache de coquille", () => {
    expect(source).toContain(`const VERSION = "0123456789ab";`);
    expect(source).toContain(JSON.stringify(SHELL_CACHE_PREFIX));
    expect(source).toContain("const SHELL_CACHE = SHELL_CACHE_PREFIX + VERSION;");
    for (const url of OPTIONS.precache) {
      expect(source).toContain(JSON.stringify(url));
    }
    expect(source).toContain("cache.addAll(PRECACHE)");
  });

  it("adapte la stratégie : navigation network-first, assets runtime cache-first borné", () => {
    expect(source).toContain('request.mode === "navigate"');
    expect(source).toContain("networkFirstNavigation");
    expect(source).toContain("PRECACHE_SET.has(url.pathname)");
    expect(source).toContain('url.pathname.startsWith("/assets/")');
    expect(source).toContain("cacheFirstBounded");
    expect(source).toContain(`const MAX_RUNTIME_ENTRIES = ${MAX_RUNTIME_ENTRIES};`);
    expect(source).toContain(`const RUNTIME_CACHE = ${JSON.stringify(RUNTIME_CACHE)};`);
    // Jamais de précache des assets du jeu (potentiellement plusieurs Go).
    expect(source).not.toContain("/assets/bg/");
  });

  it("ne met pas en cache les requêtes non GET, Range, cross-origin ni /api/", () => {
    expect(source).toContain('request.method !== "GET"');
    expect(source).toContain('request.headers.has("range")');
    expect(source).toContain("url.origin !== self.location.origin");
    expect(source).toContain('url.pathname.startsWith("/api/")');
  });

  it("gère la mise à jour : skipWaiting sur message, activation et nettoyage des anciens caches", () => {
    expect(source).toContain('event.data.type === "SKIP_WAITING"');
    expect(source).toContain("self.skipWaiting()");
    expect(source).toContain("key !== SHELL_CACHE");
    expect(source).toContain("self.clients.claim()");
    expect(source).not.toContain("self.skipWaiting();\n});\n\nself.addEventListener(\"activate\"");
  });

  it("est déterministe", () => {
    expect(renderServiceWorker(OPTIONS)).toBe(source);
  });
});
