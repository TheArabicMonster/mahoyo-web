/**
 * Cache décodé LRU borné en octets (PERF-05 / #368) : ordre LRU, éviction au plafond, coût
 * w×h×4, repli quand la taille est inconnue, statistiques hits/misses/evictions.
 */
import { describe, expect, it } from "vitest";
import {
  BYTES_PER_PIXEL,
  DESKTOP_CACHE_BYTES,
  FALLBACK_IMAGE_BYTES,
  MOBILE_CACHE_BYTES,
  DecodedImageCache,
  decodedCacheLimitBytes,
} from "@/renderer/image-cache.js";

const img = (id: string) => ({ id });

describe("decodedCacheLimitBytes", () => {
  it("192 Mo desktop par défaut, 64 Mo mobile", () => {
    expect(decodedCacheLimitBytes({ isIos: false })).toBe(DESKTOP_CACHE_BYTES);
    expect(decodedCacheLimitBytes({ isIos: true })).toBe(MOBILE_CACHE_BYTES);
    expect(decodedCacheLimitBytes({ deviceMemory: 4 })).toBe(MOBILE_CACHE_BYTES);
    expect(decodedCacheLimitBytes({ deviceMemory: 8 })).toBe(DESKTOP_CACHE_BYTES);
  });
});

describe("DecodedImageCache — LRU et plafond", () => {
  it("get réordonne la LRU et l'éviction retire la plus ancienne", () => {
    const cache = new DecodedImageCache({ limitBytes: 3000 });
    cache.set("a", img("a"), 1000);
    cache.set("b", img("b"), 1000);
    cache.set("c", img("c"), 1000);
    expect(cache.keys()).toEqual(["a", "b", "c"]);
    expect(cache.get("a")).toEqual({ id: "a" }); // a devient la plus récente
    expect(cache.keys()).toEqual(["b", "c", "a"]);
    cache.set("d", img("d"), 1000); // évince b, pas a
    expect(cache.keys()).toEqual(["c", "a", "d"]);
    expect(cache.has("b")).toBe(false);
    expect(cache.stats()).toMatchObject({ entries: 3, bytes: 3000, evictions: 1, hits: 1 });
  });

  it("respecte le plafond en octets, même avec des tailles différentes", () => {
    const cache = new DecodedImageCache({ limitBytes: 2500 });
    cache.set("a", img("a"), 1000);
    cache.set("b", img("b"), 1000);
    const s = cache.stats();
    expect(s.bytes).toBe(2000);
    cache.set("c", img("c"), 1200); // 2000 + 1200 > 2500 → évince a (1000), il reste b + c
    expect(cache.keys()).toEqual(["b", "c"]);
    expect(cache.stats().bytes).toBe(2200);
    expect(cache.stats().evictions).toBe(1);
  });

  it("ne conserve pas une image plus grosse que le plafond", () => {
    const cache = new DecodedImageCache({ limitBytes: 1000 });
    cache.set("big", img("big"), 4000);
    expect(cache.has("big")).toBe(false);
    expect(cache.stats().entries).toBe(0);
  });
});

describe("DecodedImageCache — dimensions et statistiques", () => {
  it("noteDimensions calcule w×h×4 et met à jour le coût d'une entrée", () => {
    const cache = new DecodedImageCache({ limitBytes: 10_000_000 });
    cache.noteDimensions("bg/a.png", 1024, 576);
    cache.set("bg/a.png", img("a")); // coût enregistré
    expect(cache.stats().bytes).toBe(1024 * 576 * BYTES_PER_PIXEL);
    cache.noteDimensions("bg/a.png", 2048, 1152);
    expect(cache.stats().bytes).toBe(2048 * 1152 * BYTES_PER_PIXEL);
  });

  it("dimensions inconnues : estimation de repli, puis corrigée", () => {
    const cache = new DecodedImageCache({ limitBytes: 10_000_000 });
    cache.set("unknown.png", img("u"));
    expect(cache.stats().bytes).toBe(FALLBACK_IMAGE_BYTES);
    expect(cache.stats().bytes).toBe(1024 * 576 * 4);
    cache.noteDimensions("unknown.png", 512, 288);
    expect(cache.stats().bytes).toBe(512 * 288 * 4);
  });

  it("compte les hits/misses et permet peek sans effet de bord", () => {
    const cache = new DecodedImageCache({ limitBytes: 10_000_000 });
    expect(cache.get("absent")).toBeUndefined(); // miss
    cache.set("a", img("a"));
    expect(cache.peek("a")).toEqual({ id: "a" }); // pas un hit
    expect(cache.get("a")).toEqual({ id: "a" }); // hit
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it("reste borné en octets sur 200 changements de scène (mémoire stable)", () => {
    const limitBytes = 64 * 1024 * 1024;
    const cache = new DecodedImageCache({ limitBytes });
    const cost = 3 * 1024 * 1024; // ~3 Mo par fond
    for (let i = 0; i < 200; i++) {
      const url = `bg/scene-${i % 120}.png`; // réutilisation cyclique comme en lecture réelle
      cache.set(url, img(url), cost);
      cache.get(url);
      expect(cache.stats().bytes).toBeLessThanOrEqual(limitBytes);
    }
    const stats = cache.stats();
    expect(stats.bytes).toBeLessThanOrEqual(limitBytes);
    expect(stats.evictions).toBeGreaterThan(0);
    expect(stats.entries).toBeLessThanOrEqual(Math.floor(limitBytes / cost));
  });

  it("clear libère les entrées et remet les octets à zéro", () => {
    const cache = new DecodedImageCache({ limitBytes: 10_000_000 });
    cache.set("a", img("a"), 100);
    cache.clear();
    expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
    expect(cache.size).toBe(0);
  });
});
