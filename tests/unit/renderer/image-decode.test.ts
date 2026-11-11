/** Attente de décodage d'image (#362). */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ensureDecoded, DECODED_CACHE_LIMIT, type DecodableImage } from "@/renderer/image-decode.js";
import { DecodedImageCache } from "@/renderer/image-cache.js";

class FakeImage implements DecodableImage {
  src = "";
  decoding?: string;
  fetchPriority?: string;
  complete = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode?: () => Promise<void>;
  constructor(impl?: () => Promise<void>) {
    if (impl) this.decode = impl;
  }
}

afterEach(() => vi.useRealTimers());

describe("ensureDecoded (#362)", () => {
  it("résout quand decode() réussit et applique priorité/decoding", async () => {
    const img = new FakeImage(() => Promise.resolve());
    const done = vi.fn();
    void ensureDecoded("/assets/bg/a.webp", undefined, { createImage: () => img }).then(done);
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(1);
    expect(img.fetchPriority).toBe("high");
    expect(img.decoding).toBe("async");
    expect(img.src).toBe("/assets/bg/a.webp");
  });

  it("repli onload quand decode() rejette (jsdom/Safari)", async () => {
    const img = new FakeImage(() => Promise.reject(new Error("EncodingError")));
    let done = false;
    const promise = ensureDecoded("/assets/bg/b.webp", undefined, { createImage: () => img }).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    img.onload?.();
    await promise;
    expect(done).toBe(true);
  });

  it("repli onload quand decode() est absent", async () => {
    const img = new FakeImage();
    let done = false;
    const promise = ensureDecoded("/assets/bg/c.webp", undefined, { createImage: () => img }).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    img.onload?.();
    await promise;
    expect(done).toBe(true);
  });

  it("timeout de 1 s : résout sans bloquer", async () => {
    vi.useFakeTimers();
    const img = new FakeImage(() => new Promise<void>(() => {}));
    let done = false;
    const promise = ensureDecoded("/assets/bg/slow.webp", undefined, { createImage: () => img }).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(done).toBe(true);
  });

  it("abort résout immédiatement", async () => {
    const img = new FakeImage(() => new Promise<void>(() => {}));
    const controller = new AbortController();
    let done = false;
    const promise = ensureDecoded("/assets/bg/d.webp", controller.signal, { createImage: () => img }).then(() => (done = true));
    controller.abort();
    await promise;
    expect(done).toBe(true);
  });

  it("ne recrée pas une image déjà dans le cache et borne la Map", async () => {
    const cache = new Map<string, DecodableImage>();
    const first = new FakeImage(() => Promise.resolve());
    await ensureDecoded("/assets/bg/e.webp", undefined, { createImage: () => first, cache });
    const createImage = vi.fn(() => new FakeImage(() => Promise.resolve()));
    await ensureDecoded("/assets/bg/e.webp", undefined, { createImage, cache });
    expect(createImage).not.toHaveBeenCalled();
    for (let i = 0; i < DECODED_CACHE_LIMIT + 2; i++) {
      await ensureDecoded(`/assets/bg/${i}.webp`, undefined, { createImage: () => new FakeImage(() => Promise.resolve()), cache });
    }
    expect(cache.size).toBe(DECODED_CACHE_LIMIT);
  });
});

describe("ensureDecoded + cache décodé LRU (#368)", () => {
  it("sert un hit sans recréer ni re-décoder l'image", async () => {
    const cache = new DecodedImageCache({ limitBytes: 64 * 1024 * 1024 });
    let created = 0;
    const factory = (): DecodableImage => {
      created += 1;
      const image: DecodableImage = {
        src: "",
        complete: false,
        onload: null,
        onerror: null,
        decode: () => Promise.resolve(),
        set srcValue(_v: string) {},
      } as unknown as DecodableImage;
      Object.defineProperty(image, "src", {
        get: () => "/assets/bg/cache.webp",
        set: () => {
          queueMicrotask(() => image.onload?.());
        },
      });
      return image;
    };
    await ensureDecoded("/assets/bg/cache.webp", undefined, { cache, createImage: factory });
    await ensureDecoded("/assets/bg/cache.webp", undefined, { cache, createImage: factory });
    expect(created).toBe(1); // deuxième appel = hit
    expect(cache.stats()).toMatchObject({ hits: 1, entries: 1 });
  });
});
