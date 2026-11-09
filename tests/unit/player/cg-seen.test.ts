import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "@/ui/i18n.js";
import { buildCgCatalog, createCgMode } from "@/ui/cg-mode.js";
import type { CgImage } from "@/ui/cg-mode.js";
import {
  CG_SEEN_DEBOUNCE_MS,
  createCgProgress,
  trackCgImages,
  type CgSeenStore,
} from "@/player/cg-seen.js";

/**
 * HUD-15 (#208) : suivi des CG vues. Déverrouillage testé de bout en bout : une image demandée par
 * le rendu (via le résolveur enveloppé) est persistée, puis la galerie l'affiche au lieu du libellé
 * « image non affichée ». Écritures groupées vérifiées avec une horloge simulée.
 */
function memoryStore(initial: readonly string[] = []): CgSeenStore & {
  saved: Set<string>[];
  loadSeenCg: ReturnType<typeof vi.fn>;
  saveSeenCg: ReturnType<typeof vi.fn>;
} {
  let stored = new Set(initial);
  const saved: Set<string>[] = [];
  return {
    saved,
    loadSeenCg: vi.fn(async () => new Set(stored)),
    saveSeenCg: vi.fn(async (seen: ReadonlySet<string>) => {
      stored = new Set(seen);
      saved.push(new Set(seen));
    }),
  } as never;
}

describe("suivi des CG vues (HUD-15)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setUiLanguage("fr");
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
    setUiLanguage("fr");
    document.body.innerHTML = "";
  });

  it("charge la progression persistée, une seule fois", async () => {
    const store = memoryStore(["cg01"]);
    const progress = createCgProgress(store);
    expect(progress.seen().size).toBe(0);
    await progress.load();
    expect(progress.seen()).toEqual(new Set(["cg01"]));
    await progress.load();
    expect(store.loadSeenCg).toHaveBeenCalledTimes(1);
  });

  it("marque une clé normalisée (référence KAG brute) et regroupe l'écriture", async () => {
    const store = memoryStore();
    const progress = createCgProgress(store);
    progress.mark("image/CG01.tlg|suffix");
    expect(progress.seen()).toEqual(new Set(["cg01"]));
    expect(store.saveSeenCg).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CG_SEEN_DEBOUNCE_MS - 1);
    expect(store.saveSeenCg).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.saveSeenCg).toHaveBeenCalledTimes(1);
    expect(store.saved[0]).toEqual(new Set(["cg01"]));
  });

  it("ne réécrit pas une clé déjà vue ; flush() force l'écriture immédiate", async () => {
    const store = memoryStore();
    const progress = createCgProgress(store);
    progress.mark("cg01");
    progress.mark("cg01");
    progress.mark("cg02");
    await progress.flush();
    expect(store.saveSeenCg).toHaveBeenCalledTimes(1);
    expect(store.saved[0]).toEqual(new Set(["cg01", "cg02"]));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("une écriture en échec ne casse pas la lecture (avertissement seulement)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore();
    store.saveSeenCg.mockRejectedValueOnce(new Error("quota"));
    const progress = createCgProgress(store);
    progress.mark("cg01");
    await expect(progress.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("dispose() annule l'écriture planifiée", () => {
    const store = memoryStore();
    const progress = createCgProgress(store);
    progress.mark("cg01");
    progress.dispose();
    vi.advanceTimersByTime(CG_SEEN_DEBOUNCE_MS * 4);
    expect(store.saveSeenCg).not.toHaveBeenCalled();
  });

  it("les marques faites avant la fin du chargement sont conservées et fusionnées", async () => {
    const store = memoryStore(["a"]);
    const progress = createCgProgress(store);
    progress.mark("b");
    await progress.load();
    await progress.flush();
    expect(progress.seen()).toEqual(new Set(["a", "b"]));
    expect(store.saved.at(-1)).toEqual(new Set(["a", "b"]));
  });

  it("trackCgImages marque chaque image réellement demandée, sans changer la résolution", () => {
    const resolver = {
      background: vi.fn((storage: string) => `/assets/bg/${storage}.webp`),
      image: vi.fn((storage: string) => `/assets/image/${storage}.webp`),
      rule: vi.fn(() => "/assets/rule/r.png"),
    };
    const progress = createCgProgress(memoryStore());
    const tracked = trackCgImages(resolver, progress);
    expect(tracked.background("bg/night")).toBe("/assets/bg/bg/night.webp");
    expect(tracked.image("image/CG01")).toBe("/assets/image/image/CG01.webp");
    expect(resolver.background).toHaveBeenCalledTimes(1);
    expect(resolver.image).toHaveBeenCalledTimes(1);
    expect(progress.seen()).toEqual(new Set(["night", "cg01"]));
  });

  it("déverrouillage : une CG « vue » par le rendu est affichée, les autres restent verrouillées", async () => {
    const images: CgImage[] = [
      { key: "cg01", url: "/assets/image/cg01.webp", kind: "image", source: "image/cg01.tlg" },
      { key: "cg02", url: "/assets/image/cg02.webp", kind: "image", source: "image/cg02.tlg" },
    ];
    const store = memoryStore();
    const progress = createCgProgress(store);
    // Le rendu demande cg01 : le résolveur enveloppé le marque comme vu.
    const resolver = trackCgImages(
      { background: (storage: string) => `/assets/${storage}`, image: (storage: string) => `/assets/${storage}` },
      progress,
    );
    resolver.background("image/cg01");
    await progress.flush();

    const host = document.createElement("div");
    document.body.appendChild(host);
    const mode = createCgMode({
      catalog: buildCgCatalog(images),
      seen: progress.seen(),
      onClose: () => {},
    });
    host.appendChild(mode.element);
    const tiles = [...host.querySelectorAll<HTMLButtonElement>(".mh-cg-tile")];
    expect(tiles.map((tile) => tile.dataset.locked)).toEqual(["false", "true"]);
    expect(tiles[0]!.querySelector("img")?.getAttribute("src")).toBe("/assets/image/cg01.webp");
    expect(tiles[1]!.querySelector(".mh-cg-tile-locked")!.textContent).toBe("image non affichée");
    mode.destroy();
  });
});
