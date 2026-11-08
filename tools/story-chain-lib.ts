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
import type { ChainChapter, ChainRoute, StoryChain } from "../src/core/story-chain.js";

// ── Lecture du format ──

export type TjsValue = string | number | boolean | null | TjsValue[] | { [key: string]: TjsValue };

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
    // Littéraux écrits par Scripts.eval : « (const) %[ … ] ».
    if (t.startsWith("(const)", this.i)) {
      this.i += 7;
      this.skipSpace();
    }
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
    // Nombres nus (littéraux Scripts.eval) : « 576 », « -3 », « 0.5 ».
    if (t[this.i] === "-" || (t[this.i]! >= "0" && t[this.i]! <= "9")) return this.number();
    const word = /[A-Za-z]+/y;
    word.lastIndex = this.i;
    const w = word.exec(t)?.[0];
    if (w === "void" || w === "null") { this.i += 4; return null; }
    if (w === "true") { this.i += 4; return true; }
    if (w === "false") { this.i += 5; return false; }
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

  const chapters = buildChapters(graph, blocks, isInterlude, scriptsOf, routesOf);

  const firstId = typeof graph.first === "number" ? graph.first : undefined;
  const first = firstId === undefined ? undefined : entries(firstId, new Set())[0]?.files[0];
  if (!first) throw new Error("main.gc : premier script introuvable");

  return {
    chain: { version: 1, first, next, ...(chapters.length > 0 ? { chapters } : {}) },
    blocks: blocks.size,
    scriptedBlocks,
    sharedScripts: [...shared].sort(),
    danglingRoutes,
  };
}

/** Au-delà de ce nombre d'entrées, une page n'est plus considérée comme un chapitre linéaire. */
const MAX_CHAPTER_ENTRIES = 5;

/**
 * Chapitres de l'écran titre : une page du graphe = un chapitre.
 *
 * Le script d'entrée d'une page est celui qu'aucun script de la même page ne précède
 * (les interludes partagés et les blocs sans script ne comptent pas comme
 * prédécesseurs). Une page à plusieurs entrées (bonus) en donne plusieurs : celle que
 * précède un interlude est l'entrée de l'histoire et passe en premier, les autres
 * portent le nom de leur script.
 */
function buildChapters(
  graph: TjsValue,
  blocks: Map<number, { [key: string]: TjsValue }>,
  isInterlude: (scripts: string[]) => boolean,
  scriptsOf: (block: { [key: string]: TjsValue }) => string[],
  routesOf: (block: { [key: string]: TjsValue }) => { [key: string]: TjsValue }[],
): ChainChapter[] {
  if (!isDict(graph) || !Array.isArray(graph.pages)) return [];

  const pageOf = new Map<number, number>();
  graph.pages.forEach((page, index) => {
    if (!isDict(page) || !Array.isArray(page.blocks)) return;
    for (const b of page.blocks) if (isDict(b) && typeof b.id === "number") pageOf.set(b.id, index);
  });

  const incoming = new Map<number, number[]>();
  for (const [id, block] of blocks) {
    for (const route of routesOf(block)) {
      if (typeof route.arrival === "number") incoming.set(route.arrival, [...(incoming.get(route.arrival) ?? []), id]);
    }
  }

  const real = (id: number): boolean => {
    const b = blocks.get(id);
    if (!b) return false;
    const s = scriptsOf(b);
    return s.length > 0 && !isInterlude(s);
  };

  const chapters: ChainChapter[] = [];
  const seen = new Set<string>();
  graph.pages.forEach((page, index) => {
    if (!isDict(page) || !Array.isArray(page.blocks)) return;
    const title = asString(page.title);
    const entries = page.blocks
      .filter((b): b is { [key: string]: TjsValue } => isDict(b) && typeof b.id === "number")
      .filter((b) => real(b.id as number))
      .filter((b) => !(incoming.get(b.id as number) ?? []).some((p) => real(p) && pageOf.get(p) === index));
    // L'entrée de l'histoire (précédée d'un interlude) d'abord, puis par position sur la page.
    const afterInterlude = (b: { [key: string]: TjsValue }): boolean =>
      (incoming.get(b.id as number) ?? []).some((p) => {
        const pb = blocks.get(p);
        return pb !== undefined && isInterlude(scriptsOf(pb));
      });
    entries.sort(
      (x, y) =>
        Number(afterInterlude(y)) - Number(afterInterlude(x)) ||
        (typeof x.top === "number" ? x.top : 0) - (typeof y.top === "number" ? y.top : 0),
    );
    // Une page à beaucoup d'entrées est un graphe d'embranchements, pas un chapitre linéaire :
    // on n'en garde que la première (ex. la page des scripts « wik_* »).
    const kept = entries.length > MAX_CHAPTER_ENTRIES ? entries.slice(0, 1) : entries;
    kept.forEach((b, i) => {
      const file = scriptsOf(b)[0]!;
      const key = file.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const base = file.replace(/\.ks$/i, "");
      chapters.push({
        id: key.replace(/\.ks$/, ""),
        label: i === 0 && title ? title : title ? `${title} (${base})` : base,
        file,
        arc: title ?? `page ${index}`,
      });
    });
  });
  return chapters;
}

/** Lit `main.gc` (contenu binaire) et construit la table. */
export function buildStoryChainFromGc(buffer: Buffer): ChainBuild {
  return buildStoryChain(parseTjs(decodeGc(buffer)));
}

// ── Rattachement des scripts aux chapitres (pour le graphe de scénario) ──

/** Page (arc) et chapitre auxquels appartient un script. */
export type ScriptPlacement = { chapter?: string; arc: string };

/**
 * Pour chaque script, la page du graphe d'origine qui le porte (`arc`, son titre) et le
 * chapitre principal de cette page (`chapter`, le premier de `chapters` portant le même arc).
 *
 * Un script qui figure sur plusieurs pages (interlude partagé : `teatime.ks`) n'appartient
 * à aucune : il est absent du résultat. Les clés sont des identifiants de nœud (nom sans `.ks`, en minuscules).
 */
export function scriptPlacements(graph: TjsValue, chapters: ChainChapter[] = []): Map<string, ScriptPlacement> {
  const pagesOf = new Map<string, Set<number>>();
  const arcOf: string[] = [];
  if (isDict(graph) && Array.isArray(graph.pages)) {
    graph.pages.forEach((page, index) => {
      if (!isDict(page) || !Array.isArray(page.blocks)) return;
      arcOf[index] = asString(page.title) ?? `page ${index}`;
      for (const b of page.blocks) {
        if (!isDict(b)) continue;
        for (const s of scriptsOf(b)) {
          const key = s.toLowerCase();
          pagesOf.set(key, (pagesOf.get(key) ?? new Set()).add(index));
        }
      }
    });
  }

  const out = new Map<string, ScriptPlacement>();
  for (const [script, pages] of pagesOf) {
    if (pages.size !== 1) continue;
    const id = script.replace(/\.ks$/, "");
    const arc = arcOf[[...pages][0]!]!;
    const chapter = chapters.find((c) => c.arc === arc)?.id;
    out.set(id, chapter === undefined ? { arc } : { chapter, arc });
  }
  return out;
}
