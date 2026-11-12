/**
 * Détection robuste de la sonde (#391) : search, flag après le hash, persistance sessionStorage,
 * désactivation `perf=0`, et absence totale d'effet sans flag.
 */
import { afterEach, describe, expect, it } from "vitest";
import { PERF_STORAGE_KEY, hashQuery, isPerfRequested, type PerfStorageLike } from "@/core/perf-probe.js";

function memoryStorage(initial: Record<string, string> = {}): PerfStorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

afterEach(() => window.sessionStorage?.clear());

describe("hashQuery", () => {
  it("extrait la requête après le hash sans toucher la route", () => {
    expect(hashQuery("#/title?perf=1")).toBe("perf=1");
    expect(hashQuery("#/title")).toBeNull();
    expect(hashQuery("")).toBeNull();
  });
});

describe("isPerfRequested (#391)", () => {
  it("détecte ?perf=1 dans search et persiste en sessionStorage", () => {
    const storage = memoryStorage();
    expect(isPerfRequested({ search: "?perf=1", hash: "", storage })).toBe(true);
    expect(storage.data.get(PERF_STORAGE_KEY)).toBe("1");
  });

  it("détecte le flag après le hash (#/title?perf=1), sans casser la route", () => {
    const storage = memoryStorage();
    expect(isPerfRequested({ search: "", hash: "#/title?perf=1", storage })).toBe(true);
    expect(hashQuery("#/title?perf=1")).toBe("perf=1");
  });

  it("reste actif après redirect/reload même si l'URL perd le paramètre", () => {
    const storage = memoryStorage({ [PERF_STORAGE_KEY]: "1" });
    expect(isPerfRequested({ search: "", hash: "#/title", storage })).toBe(true);
  });

  it("?perf=0 désactive et nettoie la persistance", () => {
    const storage = memoryStorage({ [PERF_STORAGE_KEY]: "1" });
    expect(isPerfRequested({ search: "?perf=0", hash: "#/title", storage })).toBe(false);
    expect(storage.data.has(PERF_STORAGE_KEY)).toBe(false);
    // Le reload suivant, sans paramètre, reste désactivé (aucune trace).
    expect(isPerfRequested({ search: "", hash: "", storage })).toBe(false);
  });

  it("hash ?perf=0 et mh:perf=0 nettoient aussi", () => {
    const fromHash = memoryStorage({ [PERF_STORAGE_KEY]: "1" });
    expect(isPerfRequested({ search: "", hash: "#/title?perf=0", storage: fromHash })).toBe(false);
    expect(fromHash.data.has(PERF_STORAGE_KEY)).toBe(false);
    const fromStorage = memoryStorage({ [PERF_STORAGE_KEY]: "0" });
    expect(isPerfRequested({ search: "", hash: "", storage: fromStorage })).toBe(false);
    expect(fromStorage.data.has(PERF_STORAGE_KEY)).toBe(false);
  });

  it("absence de flag : false et aucune écriture", () => {
    const storage = memoryStorage();
    expect(isPerfRequested({ search: "", hash: "#/title", storage })).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it("stockage indisponible (null) : aucun crash", () => {
    expect(isPerfRequested({ search: "?perf=1", hash: "", storage: null })).toBe(true);
    expect(isPerfRequested({ search: "", hash: "", storage: null })).toBe(false);
  });
});
