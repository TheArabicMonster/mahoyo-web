/**
 * Classification des commandes KAG et gestion de la baseline des inconnues (#275).
 *
 * Trois catégories (voir `tools/audit-lib.ts`) :
 * - **implémentée** : reconnue par le parser/runtime (aucun warning) ;
 * - **ignorée volontairement** : no-op déclaré dans `tools/ignored-commands.ts` ;
 * - **inconnue** : ni implémentée ni déclarée no-op. Les inconnues du corpus de
 *   référence sont figées dans `tools/audit-commands-baseline.json` : le nombre ne
 *   peut que baisser, toute résolution exige une mise à jour explicite dans la PR.
 */
import { readFileSync } from "fs";
import { join } from "path";

/** Nombre d'occurrences d'une commande (nom normalisé → occurrences). */
export type CommandCounts = Record<string, number>;

/** Contenu de `tools/audit-commands-baseline.json`. */
export interface CommandBaseline {
  /** Date de génération (ISO, jour). */
  generatedAt: string;
  /** Corpus/commande ayant produit la mesure (pour l'humain). */
  source: string;
  /** Rappel de la règle de décroissance. */
  note: string;
  /** Issue de triage des inconnues restantes. */
  triageIssue: string;
  /** Inconnues mesurées, nom → occurrences. */
  commands: CommandCounts;
}

/** Chemin de la baseline versionnée. */
export const BASELINE_PATH = join(import.meta.dirname, "audit-commands-baseline.json");

/** Normalise un nom de commande (`@`, espaces, casse) pour les comparaisons. */
export function normalizeCommandName(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/** Normalise un ensemble de compteurs de commandes. */
export function normalizeCommandCounts(counts: CommandCounts): CommandCounts {
  const out: CommandCounts = {};
  for (const [name, count] of Object.entries(counts)) {
    const key = normalizeCommandName(name);
    if (key === "") continue;
    out[key] = (out[key] ?? 0) + count;
  }
  return out;
}

/** Somme des occurrences d'un ensemble de compteurs. */
export function countOccurrences(counts: CommandCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

/**
 * Sépare des commandes non gérées entre « ignorées volontairement » (présentes
 * dans le registre) et « inconnues ».
 */
export function splitUnknownCommands(
  counts: CommandCounts,
  registryNames: ReadonlySet<string>,
): { ignored: CommandCounts; unknown: CommandCounts } {
  const ignored: CommandCounts = {};
  const unknown: CommandCounts = {};
  for (const [name, count] of Object.entries(normalizeCommandCounts(counts))) {
    if (registryNames.has(name)) ignored[name] = count;
    else unknown[name] = count;
  }
  return { ignored, unknown };
}

/**
 * Compteurs « implémentées » = total des commandes reconnues moins celles qui
 * ont produit un warning (inconnues ou ignorées). Les valeurs négatives sont
 * ramenées à 0 (garde-fou en cas d'écart de mesure).
 */
export function subtractCommandCounts(
  total: CommandCounts,
  ...excluded: readonly CommandCounts[]
): CommandCounts {
  const out: CommandCounts = {};
  for (const [name, count] of Object.entries(normalizeCommandCounts(total))) {
    const removed = excluded.reduce((sum, map) => sum + (normalizeCommandCounts(map)[name] ?? 0), 0);
    const remaining = count - removed;
    if (remaining > 0) out[name] = remaining;
  }
  return out;
}

/** Problèmes détectés en comparant les inconnues mesurées à la baseline. */
export interface BaselineComparison {
  /** Inconnues absentes de la baseline : nouvelles commandes à trier. */
  newCommands: string[];
  /** Commandes dont le nombre d'occurrences a augmenté. */
  increased: { name: string; measured: number; baseline: number }[];
  /** Commandes de la baseline devenues silencieuses (implémentées ou déclarées no-op). */
  resolved: string[];
}

/** Compare les inconnues mesurées à la baseline. */
export function compareWithBaseline(
  measured: CommandCounts,
  baseline: CommandCounts,
): BaselineComparison {
  const current = normalizeCommandCounts(measured);
  const expected = normalizeCommandCounts(baseline);
  const newCommands = Object.keys(current)
    .filter((name) => expected[name] === undefined)
    .sort();
  const increased = Object.entries(current)
    .filter(([name, count]) => expected[name] !== undefined && count > expected[name]!)
    .map(([name, count]) => ({ name, measured: count, baseline: expected[name]! }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const resolved = Object.keys(expected)
    .filter((name) => current[name] === undefined)
    .sort();
  return { newCommands, increased, resolved };
}

/** Valide la structure d'une baseline lue (JSON non fiable). */
export function parseBaseline(raw: unknown): CommandBaseline {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("baseline invalide : objet attendu");
  }
  const data = raw as Record<string, unknown>;
  const commands = data.commands;
  if (commands === null || typeof commands !== "object" || Array.isArray(commands)) {
    throw new Error("baseline invalide : champ « commands » (objet) manquant");
  }
  const cleanCommands: CommandCounts = {};
  for (const [name, value] of Object.entries(commands as Record<string, unknown>)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new Error(`baseline invalide : occurrence non entière/positive pour « ${name} »`);
    }
    cleanCommands[normalizeCommandName(name)] = value;
  }
  for (const field of ["generatedAt", "source", "note", "triageIssue"] as const) {
    if (typeof data[field] !== "string" || (data[field] as string).trim() === "") {
      throw new Error(`baseline invalide : champ « ${field} » (chaîne non vide) manquant`);
    }
  }
  return {
    generatedAt: data.generatedAt as string,
    source: data.source as string,
    note: data.note as string,
    triageIssue: data.triageIssue as string,
    commands: cleanCommands,
  };
}

/** Lit la baseline versionnée (ou une baseline explicite, pour les tests). */
export function loadBaseline(path: string = BASELINE_PATH): CommandBaseline {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(
      `Baseline illisible (${path}) : ${err instanceof Error ? err.message : String(err)}. Lancer « npm run audit:baseline » avec les assets réels.`,
    );
  }
  return parseBaseline(raw);
}

/** Construit un contenu de baseline sérialisé et trié (écriture déterministe). */
export function serializeBaseline(baseline: CommandBaseline): string {
  const commands = Object.fromEntries(
    Object.entries(normalizeCommandCounts(baseline.commands)).sort(([a], [b]) => a.localeCompare(b)),
  );
  const ordered: CommandBaseline = {
    generatedAt: baseline.generatedAt,
    source: baseline.source,
    note: baseline.note,
    triageIssue: baseline.triageIssue,
    commands,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
