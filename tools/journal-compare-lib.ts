/**
 * Comparaison de journaux d'exécution, **alignée par événement** (#318).
 *
 * Deux sources sont acceptées :
 * - un journal complet (`{ entries: RuntimeJournalEntry[] }`, sortie de `journal:capture`) ;
 * - une liste d'événements annotés (ex. relevés sur une vidéo originale) :
 *   `[{ command, occurrence, durationMs?, effectiveDurationMs?, displacement?: {x,y} }]`.
 *
 * L'alignement se fait sur le **n-ième événement de chaque commande** (`trans` n°1 ↔ `trans` n°1),
 * jamais sur des métriques « par seconde » (biaisées par le rythme de lecture/langue).
 * Aucune donnée de texte n'est lue ni produite.
 */
import type { RuntimeJournalEntry } from "@/kag/journal.js";

/** Événement normalisé, quelle que soit la source. */
export type JournalEvent = {
  command: string;
  occurrence: number;
  durationMs: number | null;
  effectiveDurationMs: number | null;
  /** Position d'un calque/fond (px du repère 1024×576) si connue. */
  displacement: { x: number; y: number } | null;
  source: "journal" | "annotation";
};

export type JournalSource = {
  entries?: readonly RuntimeJournalEntry[];
  speedFactor?: number;
};

const BG_COMMANDS = new Set(["trans", "bg", "bgact", "playtimeline", "infg", "outfg", "layopt"]);
const SPRITE_COMMANDS = new Set(["fg", "chgfg", "partbg", "animate", "action", "dispclock", "tickclock"]);

function layerAnchor(entry: RuntimeJournalEntry): { x: number; y: number } | null {
  const params = entry.params as Record<string, unknown>;
  const id = typeof params.id === "string" ? params.id : typeof params.storage === "string" ? params.storage : null;
  if (id !== null) {
    const layer = entry.fore.layers.find((candidate) => candidate.id === id);
    if (layer) return { x: layer.x, y: layer.y };
  }
  return null;
}

function bgAnchor(entry: RuntimeJournalEntry): { x: number; y: number } | null {
  const page = entry.page === "back" ? entry.back : entry.fore;
  if (page.bgLeft === undefined && page.bgTop === undefined) return null;
  return { x: page.bgLeft ?? 0, y: page.bgTop ?? 0 };
}

/** Convertit un journal en événements normalisés. */
export function eventsFromJournal(source: JournalSource): JournalEvent[] {
  const entries = source.entries ?? [];
  const speedFactor = source.speedFactor ?? 1;
  return entries.map((entry) => {
    const displacement = BG_COMMANDS.has(entry.command)
      ? bgAnchor(entry)
      : SPRITE_COMMANDS.has(entry.command)
        ? layerAnchor(entry)
        : null;
    const declared = entry.durationMs;
    const effective =
      entry.effectiveDurationMs ?? (declared === null ? null : speedFactor > 0 ? declared / speedFactor : declared);
    return {
      command: entry.command,
      occurrence: entry.occurrence,
      durationMs: declared,
      effectiveDurationMs: effective,
      displacement,
      source: "journal" as const,
    };
  });
}

/** Normalise une liste d'événements annotés (mineure : champs manquants tolérés). */
export function eventsFromAnnotations(
  annotations: readonly {
    command: string;
    occurrence?: number;
    durationMs?: number | null;
    effectiveDurationMs?: number | null;
    displacement?: { x: number; y: number } | null;
  }[],
): JournalEvent[] {
  const counters = new Map<string, number>();
  return annotations.map((annotation) => {
    const occurrence = annotation.occurrence ?? (counters.get(annotation.command) ?? 0) + 1;
    counters.set(annotation.command, occurrence);
    return {
      command: annotation.command,
      occurrence,
      durationMs: annotation.durationMs ?? null,
      effectiveDurationMs: annotation.effectiveDurationMs ?? annotation.durationMs ?? null,
      displacement: annotation.displacement ?? null,
      source: "annotation" as const,
    };
  });
}

/** Normalise une source JSON quelconque (journal complet ou liste annotée). */
export function eventsFromSource(raw: unknown, speedFactor = 1): JournalEvent[] {
  if (Array.isArray(raw)) return eventsFromAnnotations(raw as Parameters<typeof eventsFromAnnotations>[0]);
  if (raw !== null && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries)) {
    const source = raw as { entries: RuntimeJournalEntry[]; speedFactor?: number };
    return eventsFromJournal({ entries: source.entries, speedFactor: source.speedFactor ?? speedFactor });
  }
  throw new Error("source de journal invalide : { entries: [...] } ou tableau d'événements annotés attendu");
}

export type ComparisonRow = {
  command: string;
  occurrence: number;
  left: JournalEvent | null;
  right: JournalEvent | null;
  /** Δ durée déclarée (droite - gauche), ms. */
  durationDeltaMs: number | null;
  /** Δ durée effective (droite - gauche), ms. */
  effectiveDurationDeltaMs: number | null;
  /** Déplacement relatif entre les deux positions (px), ou null si non comparable. */
  displacementDelta: number | null;
  status: "matched" | "left-only" | "right-only";
};

export type ComparisonSummary = {
  matched: number;
  leftOnly: number;
  rightOnly: number;
  /** Médiane des |Δ durée effective| sur les événements appariés et minutés. */
  medianAbsEffectiveDurationDeltaMs: number | null;
  /** Plus grand déplacement relatif observé (px). */
  maxDisplacementDelta: number | null;
};

export type JournalComparison = {
  rows: ComparisonRow[];
  summary: ComparisonSummary;
  perCommand: Record<string, { matched: number; leftOnly: number; rightOnly: number }>;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Aligne deux jeux d'événements sur (commande, n-ième occurrence) et calcule les deltas. */
export function compareEvents(left: readonly JournalEvent[], right: readonly JournalEvent[]): JournalComparison {
  const key = (event: JournalEvent): string => `${event.command}#${event.occurrence}`;
  const leftMap = new Map(left.map((event) => [key(event), event]));
  const rightMap = new Map(right.map((event) => [key(event), event]));
  const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort((a, b) => {
    const [commandA, indexA] = a.split("#");
    const [commandB, indexB] = b.split("#");
    return commandA === commandB ? Number(indexA) - Number(indexB) : commandA!.localeCompare(commandB!);
  });

  const rows: ComparisonRow[] = [];
  const durationDeltas: number[] = [];
  const displacementDeltas: number[] = [];
  const perCommand: JournalComparison["perCommand"] = {};

  for (const eventKey of keys) {
    const leftEvent = leftMap.get(eventKey) ?? null;
    const rightEvent = rightMap.get(eventKey) ?? null;
    const command = (leftEvent ?? rightEvent)!.command;
    const occurrence = (leftEvent ?? rightEvent)!.occurrence;
    const stats = (perCommand[command] ??= { matched: 0, leftOnly: 0, rightOnly: 0 });
    let status: ComparisonRow["status"] = "matched";
    if (!rightEvent) {
      status = "left-only";
      stats.leftOnly++;
    } else if (!leftEvent) {
      status = "right-only";
      stats.rightOnly++;
    } else {
      stats.matched++;
    }
    const durationDeltaMs =
      leftEvent?.durationMs !== null && leftEvent?.durationMs !== undefined && rightEvent?.durationMs !== null && rightEvent?.durationMs !== undefined
        ? rightEvent.durationMs - leftEvent.durationMs
        : null;
    const effectiveDurationDeltaMs =
      leftEvent?.effectiveDurationMs !== null &&
      leftEvent?.effectiveDurationMs !== undefined &&
      rightEvent?.effectiveDurationMs !== null &&
      rightEvent?.effectiveDurationMs !== undefined
        ? rightEvent.effectiveDurationMs - leftEvent.effectiveDurationMs
        : null;
    if (effectiveDurationDeltaMs !== null) durationDeltas.push(Math.abs(effectiveDurationDeltaMs));
    const displacementDelta =
      leftEvent?.displacement && rightEvent?.displacement
        ? Math.hypot(
            rightEvent.displacement.x - leftEvent.displacement.x,
            rightEvent.displacement.y - leftEvent.displacement.y,
          )
        : null;
    if (displacementDelta !== null) displacementDeltas.push(displacementDelta);
    rows.push({
      command,
      occurrence,
      left: leftEvent,
      right: rightEvent,
      durationDeltaMs,
      effectiveDurationDeltaMs,
      displacementDelta,
      status,
    });
  }

  return {
    rows,
    summary: {
      matched: rows.filter((row) => row.status === "matched").length,
      leftOnly: rows.filter((row) => row.status === "left-only").length,
      rightOnly: rows.filter((row) => row.status === "right-only").length,
      medianAbsEffectiveDurationDeltaMs: median(durationDeltas),
      maxDisplacementDelta: displacementDeltas.length > 0 ? Math.max(...displacementDeltas) : null,
    },
    perCommand,
  };
}

const fmt = (value: number | null, digits = 1): string =>
  value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(digits);

/** Rendu Markdown du rapport (aucun texte du jeu). */
export function renderComparisonMarkdown(
  comparison: JournalComparison,
  meta: { left: string; right: string; generatedAt: string; speedFactor?: number },
): string {
  const lines: string[] = [];
  lines.push("# Comparaison de journaux — alignement par événement (#318)");
  lines.push("");
  lines.push(`- **Gauche** : \`${meta.left}\``);
  lines.push(`- **Droite** : \`${meta.right}\``);
  lines.push(`- **Généré** : ${meta.generatedAt}${meta.speedFactor !== undefined ? ` — facteur de vitesse droit : ${meta.speedFactor}` : ""}`);
  lines.push("");
  lines.push("Alignement sur le **n-ième événement de chaque commande** (pas de métrique par seconde).");
  lines.push("");
  lines.push("## Résumé");
  lines.push("");
  lines.push("| Appariés | Gauche seule | Droite seule | Médiane \\|Δ durée effective\\| | Déplacement max |");
  lines.push("|---|---|---|---|---|");
  lines.push(
    `| ${comparison.summary.matched} | ${comparison.summary.leftOnly} | ${comparison.summary.rightOnly} | ${
      fmt(comparison.summary.medianAbsEffectiveDurationDeltaMs) === "—"
        ? "—"
        : `${fmt(comparison.summary.medianAbsEffectiveDurationDeltaMs)} ms`
    } | ${comparison.summary.maxDisplacementDelta === null ? "—" : `${fmt(comparison.summary.maxDisplacementDelta)} px`} |`,
  );
  lines.push("");
  lines.push("## Événements");
  lines.push("");
  lines.push("| Commande | n° | Gauche (ms) | Droite (ms) | Δ déclarée | Δ effective | Déplacement | Statut |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const row of comparison.rows.slice(0, 500)) {
    lines.push(
      `| \`@${row.command}\` | ${row.occurrence} | ${fmt(row.left?.durationMs ?? null)} | ${fmt(row.right?.durationMs ?? null)} | ${row.durationDeltaMs === null ? "—" : `${fmt(row.durationDeltaMs) > "0" ? "+" : ""}${fmt(row.durationDeltaMs)} ms`} | ${row.effectiveDurationDeltaMs === null ? "—" : `${fmt(row.effectiveDurationDeltaMs)} ms`} | ${row.displacementDelta === null ? "—" : `${fmt(row.displacementDelta)} px`} | ${row.status} |`,
    );
  }
  lines.push("");
  lines.push("## Par commande");
  lines.push("");
  lines.push("| Commande | Appariés | Gauche seule | Droite seule |");
  lines.push("|---|---|---|---|");
  for (const [command, stats] of Object.entries(comparison.perCommand)) {
    lines.push(`| \`@${command}\` | ${stats.matched} | ${stats.leftOnly} | ${stats.rightOnly} |`);
  }
  lines.push("");
  lines.push("> Aucun texte du jeu n'est reproduit : seuls commandes, durée et positions figurent ici.");
  return lines.join("\n");
}
