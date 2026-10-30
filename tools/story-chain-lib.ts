/**
 * Génération de la table d'enchaînement des scripts à partir de `main.gc`.
 *
 * `main.gc` est le graphe du jeu d'origine : un dictionnaire TJS sérialisé
 * (`%[ "clé" => valeur ]`), compressé en zlib puis encodé en UTF-16LE. Chaque
 * bloc porte un ou plusieurs scripts et des routes vers les blocs suivants.
 *
 * Logique pure (sans disque ni réseau) : voir `story-chain.ts` pour l'I/O.
 */
import { inflateSync } from "zlib";
import type { ChainRoute, StoryChain } from "../src/core/story-chain.js";

// ── Lecture du format ──

export type TjsValue = string | number | null | TjsValue[] | { [key: string]: TjsValue };

/** En-tête des fichiers texte KiriKiri compressés : FE FE 02 FF FE (mode 2, UTF-16LE). */
const GC_MAGIC = [0xfe, 0xfe, 0x02, 0xff, 0xfe];
/** Magic (5) + taille compressée (8) + taille décompressée (8). */
const GC_HEADER_SIZE = 21;

/** Décompresse le contenu de `main.gc` en texte. */
export function decodeGc(buffer: Buffer): string {
  if (buffer.length <= GC_HEADER_SIZE || !GC_MAGIC.every((b, i) => buffer[i] === b)) {
    throw new Error("main.gc : en-tête inattendu (attendu FE FE 02 FF FE)");
  }
  const raw = inflateSync(buffer.subarray(GC_HEADER_SIZE));
  return raw.toString("utf16le").replace(/^﻿/, "").replace(/\r/g, "");
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

class TjsReader {
  private i = 0;
  constructor(private readonly text: string) {}

  private fail(message: string): never {
    throw new Error(`TJS : ${message} (position ${this.i})`);
  }

  private skipSpace(): void {
    while (this.i < this.text.length && " \n\t".includes(this.text[this.i]!)) this.i++;
  }

  private quoted(): string {
    if (this.text[this.i] !== '"') this.fail("chaîne attendue");
    let out = "";
    this.i++;
    while (this.i < this.text.length && this.text[this.i] !== '"') {
      let c = this.text[this.i]!;
      if (c === "\\") {
        this.i++;
        c = this.text[this.i] ?? "";
        out += ESCAPES[c] ?? c;
      } else {
        out += c;
      }
      this.i++;
    }
    if (this.text[this.i] !== '"') this.fail("chaîne non terminée");
    this.i++;
    return out;
  }

  private number(): number {
    const m = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    m.lastIndex = this.i;
    const match = m.exec(this.text);
    if (!match) this.fail("nombre attendu");
    this.i = m.lastIndex;
    return Number(match[0]);
  }

  value(): TjsValue {
    this.skipSpace();
    const t = this.text;
    if (t.startsWith("%[", this.i)) {
      this.i += 2;
      const dict: { [key: string]: TjsValue } = {};
      for (;;) {
        this.skipSpace();
        if (t[this.i] === "]") { this.i++; return dict; }
        if (t[this.i] === ",") { this.i++; continue; }
        const key = this.quoted();
        this.skipSpace();
        if (!t.startsWith("=>", this.i)) this.fail("« => » attendu");
        this.i += 2;
        dict[key] = this.value();
      }
    }
    if (t[this.i] === "[") {
      this.i++;
      const list: TjsValue[] = [];
      for (;;) {
        this.skipSpace();
        if (t[this.i] === "]") { this.i++; return list; }
        if (t[this.i] === ",") { this.i++; continue; }
        list.push(this.value());
      }
    }
    if (t[this.i] === '"') return this.quoted();
    const word = /[a-z]+/y;
    word.lastIndex = this.i;
    const w = word.exec(t)?.[0];
    if (w === "void") { this.i += 4; return null; }
    if (w === "string") { this.i += 6; this.skipSpace(); return this.quoted(); }
    if (w === "int" || w === "real") { this.i += w.length; this.skipSpace(); return this.number(); }
    return this.fail(`valeur inattendue « ${t.slice(this.i, this.i + 12)} »`);
  }
}

/** Analyse un dictionnaire TJS sérialisé. */
export function parseTjs(text: string): TjsValue {
  return new TjsReader(text).value();
}

// ── Construction de la table ──

function isDict(v: TjsValue | undefined): v is { [key: string]: TjsValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: TjsValue | undefined): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Scripts d'un bloc : une chaîne, ou une liste jouée à la suite. */
function scriptsOf(block: { [key: string]: TjsValue }): string[] {
  const s = block.script;
  if (Array.isArray(s)) return s.map(asString).filter((x): x is string => x !== undefined);
  const one = asString(s);
  return one ? [one] : [];
}

/** Libellé d'une route : `alternative` est `{ text: ... }` pour un choix, `""` sinon. */
function choiceOf(alternative: TjsValue | undefined): string | undefined {
  if (isDict(alternative)) return asString(alternative.text);
  return undefined;
}

export type ChainBuild = {
  chain: StoryChain;
  /** Nombre de blocs lus / de blocs portant au moins un script. */
  blocks: number;
  scriptedBlocks: number;
  /**
   * Scripts présents dans plusieurs blocs : ce sont des interludes dont la
   * suite dépend du contexte, représentés par `then` plutôt que par une entrée propre.
   */
  sharedScripts: string[];
  /** Routes ignorées (bloc d'arrivée introuvable). */
  danglingRoutes: number;
};

type Entry = { files: string[]; condition?: string; choice?: string };

/** Combine deux conditions en ET (une route et le bloc qui la suit peuvent en porter chacun une). */
function andCondition(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined || a === b) return a;
  return `(${a})&&(${b})`;
}

/**
 * Construit la table à partir du graphe analysé.
 *
 * - Les blocs sans script (en-têtes de chapitre) sont traversés.
 * - Un bloc à plusieurs scripts les enchaîne dans l'ordre.
 * - Un script partagé par plusieurs blocs (interlude) n'a pas d'entrée propre :
 *   la route qui y mène porte aussi ce qui le suit (`then`).
 * - Les expressions `operate` (variables posées à l'entrée d'un bloc) ne sont
 *   pas reprises.
 */
export function buildStoryChain(graph: TjsValue): ChainBuild {
  if (!isDict(graph) || !Array.isArray(graph.pages)) throw new Error("main.gc : graphe sans pages");

  const blocks = new Map<number, { [key: string]: TjsValue }>();
  for (const page of graph.pages) {
    if (!isDict(page) || !Array.isArray(page.blocks)) continue;
    for (const b of page.blocks) {
      if (isDict(b) && typeof b.id === "number") blocks.set(b.id, b);
    }
  }

  // Scripts partagés = interludes.
  const occurrences = new Map<string, number>();
  for (const block of blocks.values()) {
    for (const s of scriptsOf(block)) occurrences.set(s, (occurrences.get(s) ?? 0) + 1);
  }
  const shared = new Set([...occurrences].filter(([, n]) => n > 1).map(([s]) => s));
  const isInterlude = (scripts: string[]): boolean => scripts.some((s) => shared.has(s));

  let danglingRoutes = 0;
  const routesOf = (block: { [key: string]: TjsValue }): { [key: string]: TjsValue }[] =>
    Array.isArray(block.routes) ? block.routes.filter(isDict) : [];

  /** Suites d'une route : scripts à jouer à partir du bloc d'arrivée. */
  function entries(blockId: number, seen: Set<number>): Entry[] {
    const block = blocks.get(blockId);
    if (!block || seen.has(blockId)) return [];
    const scripts = scriptsOf(block);
    const visited = new Set(seen).add(blockId);

    if (scripts.length > 0 && !isInterlude(scripts)) return [{ files: [scripts[0]!] }];

    const out: Entry[] = [];
    let followed = false;
    for (const route of routesOf(block)) {
      if (typeof route.arrival !== "number" || !blocks.has(route.arrival)) { danglingRoutes++; continue; }
      followed = true;
      const condition = asString(route.condition);
      const choice = choiceOf(route.alternative);
      for (const e of entries(route.arrival, visited)) {
        out.push({ files: [...scripts, ...e.files], condition: andCondition(condition, e.condition), choice: choice ?? e.choice });
      }
    }
    // Interlude sans suite : il se joue seul.
    if (!followed && scripts.length > 0) out.push({ files: scripts });
    return out;
  }

  const next: Record<string, ChainRoute[]> = {};
  const add = (from: string, route: ChainRoute): void => {
    const list = (next[from] ??= []);
    const key = (r: ChainRoute): string => [r.to, ...(r.then ?? []), r.condition, r.choice].join("\u0000");
    if (!list.some((r) => key(r) === key(route))) list.push(route);
  };

  let scriptedBlocks = 0;
  for (const block of blocks.values()) {
    const scripts = scriptsOf(block);
    if (scripts.length === 0) continue;
    scriptedBlocks++;
    if (isInterlude(scripts)) continue;

    for (let i = 0; i + 1 < scripts.length; i++) add(scripts[i]!, { to: scripts[i + 1]! });

    const last = scripts[scripts.length - 1]!;
    next[last] ??= [];
    for (const route of routesOf(block)) {
      if (typeof route.arrival !== "number" || !blocks.has(route.arrival)) { danglingRoutes++; continue; }
      const condition = asString(route.condition);
      const choice = choiceOf(route.alternative);
      const seen = new Set<number>(typeof block.id === "number" ? [block.id] : []);
      for (const e of entries(route.arrival, seen)) {
        const merged: ChainRoute = { to: e.files[0]! };
        if (e.files.length > 1) merged.then = e.files.slice(1);
        const cond = andCondition(condition, e.condition);
        const ch = choice ?? e.choice;
        if (cond !== undefined) merged.condition = cond;
        if (ch !== undefined) merged.choice = ch;
        add(last, merged);
      }
    }
  }

  const firstId = typeof graph.first === "number" ? graph.first : undefined;
  const first = firstId === undefined ? undefined : entries(firstId, new Set())[0]?.files[0];
  if (!first) throw new Error("main.gc : premier script introuvable");

  return {
    chain: { version: 1, first, next },
    blocks: blocks.size,
    scriptedBlocks,
    sharedScripts: [...shared].sort(),
    danglingRoutes,
  };
}

/** Lit `main.gc` (contenu binaire) et construit la table. */
export function buildStoryChainFromGc(buffer: Buffer): ChainBuild {
  return buildStoryChain(parseTjs(decodeGc(buffer)));
}
