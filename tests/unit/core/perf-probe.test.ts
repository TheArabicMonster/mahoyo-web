/**
 * Sonde scene-ready (PERF-01 / #360) : inactive sauf `?perf=1`, tampon alimenté et classement
 * préchargée / cache chaud-froid quand elle est active. Aucun observer installé sans le flag.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LONG_FRAME_MS,
  createPerfProbe,
  perfEnabled,
  type PerfGlobal,
} from "@/core/perf-probe.js";

const globals = () => (window as unknown as { __mhPerf?: PerfGlobal }).__mhPerf;

function clock(start = 1000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

afterEach(() => {
  delete (window as unknown as { __mhPerf?: PerfGlobal }).__mhPerf;
  window.sessionStorage?.clear(); // le flag ?perf=1 est persisté (#391) : ne pas fuiter entre tests
  vi.restoreAllMocks();
});

describe("perfEnabled", () => {
  it("reconnaît uniquement ?perf=1", () => {
    expect(perfEnabled("?perf=1")).toBe(true);
    expect(perfEnabled("?foo=1&perf=1")).toBe(true);
    expect(perfEnabled("")).toBe(false);
    expect(perfEnabled("?perf=0")).toBe(false);
    expect(perfEnabled("?perf=true")).toBe(false);
  });
});

describe("sonde inactive (sans ?perf=1)", () => {
  it("ne pose aucun marqueur, aucun window.__mhPerf et retourne un no-op partagé", () => {
    const before = performance.getEntriesByName("mh:img:request").length;
    const a = createPerfProbe({ search: "", storage: null });
    const b = createPerfProbe({ search: "?perf=0", storage: null });
    expect(a.enabled).toBe(false);
    expect(b.enabled).toBe(false);
    expect(a).toBe(b); // objet no-op partagé : coût nul
    a.markRequest("x.png");
    a.trackImage("x.png");
    expect(performance.getEntriesByName("mh:img:request").length).toBe(before);
    expect(globals()).toBeUndefined();
    expect(a.summary().enabled).toBe(false);
    a.setImageCacheStats(() => ({ entries: 1, bytes: 1, limitBytes: 1, hits: 0, misses: 0, evictions: 0 }));
    expect(a.summary().imageCache).toBeNull(); // no-op sans ?perf=1
    a.markBoot("load-start");
    a.markTransitionWait(1000, "timeout");
    a.markAudio("se", "request");
    expect(a.summary().boot).toEqual({});
    expect(a.summary().transitionWait.count).toBe(0);
    expect(a.summary().audio).toEqual({ bgm: { request: 0, fetched: 0, played: 0, rejected: 0 }, se: { request: 0, fetched: 0, played: 0, rejected: 0 } });
    expect(performance.getEntriesByName("mh:boot:load-start").length).toBe(0);
  });
});

describe("sonde active (?perf=1)", () => {
  it("alimente le tampon : les 4 marqueurs et scene-ready", () => {
    const c = clock();
    const probe = createPerfProbe({ search: "?perf=1", now: c.now, nextFrame: (fn) => fn() });
    expect(probe.enabled).toBe(true);

    probe.markRequest("bg/a.png");
    c.advance(12);
    probe.markFetched("bg/a.png");
    c.advance(8);
    probe.markDecoded("bg/a.png");
    c.advance(4);
    probe.markPainted("bg/a.png");

    const record = globals()!.images.find((r) => r.url === "bg/a.png")!;
    expect(record.request).toBe(1000);
    expect(record.fetched).toBe(1012);
    expect(record.decoded).toBe(1020);
    expect(record.painted).toBe(1024);
    expect(record.sceneReady).toBe(24);
    const names = ["mh:img:request", "mh:img:fetched", "mh:img:decoded", "mh:img:painted"];
    for (const name of names) {
      expect(performance.getEntriesByName(name).length).toBeGreaterThan(0);
    }
    expect(globals()!.summary().sceneReady).toMatchObject({ count: 1, p50: 24, p95: 24, max: 24 });
  });

  it("classe préchargée / cache chaud-froid depuis Resource Timing", () => {
    const probe = createPerfProbe({
      search: "?perf=1",
      nextFrame: (fn) => fn(),
      resourceEntry: (url) => (url.includes("cached") ? { transferSize: 0, workerStart: 0 } : { transferSize: 2048, workerStart: 0 }),
    });
    const cases: Array<[string, boolean]> = [
      ["bg/preloaded-cached.png", true],
      ["bg/preloaded.png", true], // préchargée mais transfert réseau → "preloaded"
      ["bg/cached.png", false],
      ["bg/plain.png", false],
    ];
    for (const [url, preloaded] of cases) {
      if (preloaded) probe.markPreloaded(url);
      probe.markRequest(url);
      probe.markFetched(url);
      probe.markPainted(url);
    }
    const byUrl = (suffix: string) => globals()!.images.find((r) => r.url === `bg/${suffix}`)!;
    expect(byUrl("preloaded-cached.png")).toMatchObject({ cached: true, preloaded: true, kind: "preloaded-cache" });
    expect(byUrl("preloaded.png")).toMatchObject({ cached: false, preloaded: true, kind: "preloaded" });
    expect(byUrl("cached.png")).toMatchObject({ cached: true, preloaded: false, kind: "cold-cache" });
    expect(byUrl("plain.png")).toMatchObject({ cached: false, preloaded: false, kind: "cold" });
    expect(globals()!.summary().kinds).toEqual({
      "preloaded-cache": 1,
      preloaded: 1,
      "cold-cache": 1,
      cold: 1,
    });
  });

  it("dedupe une même requête et borne le tampon circulaire", () => {
    const probe = createPerfProbe({ search: "?perf=1", limit: 2, nextFrame: (fn) => fn() });
    const before = performance.getEntriesByName("mh:img:request").length;
    for (const url of ["a.png", "b.png", "c.png"]) {
      probe.markRequest(url);
      probe.markRequest(url); // doublon ignoré
      probe.markFetched(url);
      probe.markPainted(url);
    }
    expect(globals()!.images.length).toBe(2);
    expect(globals()!.images.map((r) => r.url)).toEqual(["b.png", "c.png"]);
    // Un marqueur par image (3), indépendamment des marqueurs des tests précédents.
    expect(performance.getEntriesByName("mh:img:request").length - before).toBe(3);
  });

  it("note les dimensions (estimation mémoire w×h×4) et le résumé", () => {
    const probe = createPerfProbe({ search: "?perf=1", nextFrame: (fn) => fn() });
    probe.markRequest("a.png");
    probe.noteDimensions("a.png", 1024, 576);
    probe.markFetched("a.png");
    probe.markPainted("a.png");
    const record = globals()!.images[0]!;
    expect(record.bytes).toBe(1024 * 576 * 4);
    expect(globals()!.summary().images).toBe(1);
  });

  it("trackImage suit un <img> existant puis 2 rAF (ici synchrone)", async () => {
    const probe = createPerfProbe({ search: "?perf=1", nextFrame: (fn) => fn() });
    const fake = {
      complete: true,
      naturalWidth: 100,
      decode: () => Promise.resolve(),
      addEventListener: () => {},
    } as unknown as HTMLImageElement;
    probe.trackImage("sprite.png", fake);
    await Promise.resolve();
    const record = globals()!.images.find((r) => r.url === "sprite.png")!;
    expect(record.request).not.toBeNull();
    expect(record.decoded).not.toBeNull();
    expect(record.painted).not.toBeNull();
  });

  it("expose les stats du cache décodé (#368) dans summary()", () => {
    const probe = createPerfProbe({ search: "?perf=1", nextFrame: (fn) => fn() });
    expect(globals()!.summary().imageCache).toBeNull();
    const stats = { entries: 2, bytes: 4096, limitBytes: 192 * 1024 * 1024, hits: 3, misses: 1, evictions: 0 };
    probe.setImageCacheStats(() => stats);
    expect(globals()!.summary().imageCache).toEqual(stats);
  });

  it("activation robuste : flag après le hash (#391)", () => {
    const probe = createPerfProbe({ search: "", hash: "#/title?perf=1", nextFrame: (fn) => fn() });
    expect(probe.enabled).toBe(true);
    probe.markBoot("load-start");
    expect(globals()!.summary().boot["load-start"]).toBeGreaterThan(0);
  });

  it("perf=0 désactive et nettoie la persistance (#391)", () => {
    window.sessionStorage.setItem("mh:perf", "1");
    const probe = createPerfProbe({ search: "?perf=0", storage: window.sessionStorage });
    expect(probe.enabled).toBe(false);
    expect(window.sessionStorage.getItem("mh:perf")).toBeNull();
    expect(globals()).toBeUndefined();
  });

  it("marqueurs boot (#385) : summary.boot alimenté, idempotent", () => {
    const c = clock(500);
    const probe = createPerfProbe({ search: "?perf=1", now: c.now, nextFrame: (fn) => fn() });
    probe.markBoot("load-start");
    c.advance(10);
    probe.markBoot("manifest-fetched");
    c.advance(20);
    probe.markBoot("title-painted");
    probe.markBoot("title-painted"); // idempotent
    expect(globals()!.summary().boot).toEqual({
      "load-start": 500,
      "manifest-fetched": 510,
      "title-painted": 530,
    });
    expect(performance.getEntriesByName("mh:boot:title-painted").length).toBeGreaterThan(0);
  });

  it("attentes de transition (#385) : durée, issue et résumé", () => {
    const probe = createPerfProbe({ search: "?perf=1", nextFrame: (fn) => fn() });
    probe.markTransitionWait(12, "ready");
    probe.markTransitionWait(340, "waiting");
    probe.markTransitionWait(1000, "timeout");
    const summary = globals()!.summary().transitionWait;
    expect(summary).toMatchObject({ count: 3, ready: 1, waiting: 1, timeout: 1, max: 1000, last: { duration: 1000, outcome: "timeout" } });
    expect(globals()!.transitionWaits).toHaveLength(3);
    expect(performance.getEntriesByName("mh:transition:wait").length).toBeGreaterThanOrEqual(3);
  });

  it("audio (#385) : compteurs par type et phase", () => {
    const probe = createPerfProbe({ search: "?perf=1", nextFrame: (fn) => fn() });
    probe.markAudio("bgm", "request", { url: "/a.ogg" });
    probe.markAudio("bgm", "fetched");
    probe.markAudio("bgm", "played");
    probe.markAudio("se", "request");
    probe.markAudio("se", "rejected");
    expect(globals()!.summary().audio).toEqual({
      bgm: { request: 1, fetched: 1, played: 1, rejected: 0 },
      se: { request: 1, fetched: 0, played: 0, rejected: 1 },
    });
    for (const phase of ["request", "fetched", "played", "rejected"]) {
      expect(performance.getEntriesByName(`mh:audio:${phase}`).length).toBeGreaterThan(0);
    }
  });

  it("le seuil des blocages vaut 50 ms (plan §1)", () => {
    expect(LONG_FRAME_MS).toBe(50);
  });
});
