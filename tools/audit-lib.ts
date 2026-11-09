/**
 * Logique partagée d'audit headless du corpus KAG.
 *
 * Exporte les fonctions et types utilisés par l'audit CLI (npm run audit)
 * et par le test d'intégration de lecture complète.
 */
import { readFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import { lookupAudio, lookupImage } from "@/core/asset-manifest.js";
import type { AssetManifest } from "@/core/asset-manifest.js";
import { isSolidColor, storageKey } from "@/core/storage-key.js";
import { IGNORED_COMMANDS_BY_NAME } from "./ignored-commands.js";
import { normalizeCommandName, subtractCommandCounts } from "./audit-commands.js";
import type { RenderEvent } from "@/kag/events.js";

/** Maximum de steps par script pour éviter les boucles infinies. */
export const DEFAULT_MAX_STEPS = 10_000;

/**
 * Seuil pour la détection de scripts chiffrés/binaires.
 * Si plus de ce ratio de bytes dans les 512 premiers octets sont des
 * caractères de contrôle (< 0x20, hors \t\n\r), des katakana demi-chasse
 * (U+FF61–FF9F, rares dans Mahoyo) ou le caractère de remplacement U+FFFD,
 * le script est considéré chiffré.
 */
export const ENCRYPTED_BYTE_THRESHOLD = 0.10;

/**
 * Scripts système à ignorer : menus, config, plugins, etc.
 * Ces scripts ne terminent pas normalement (boucles infinies, @s, @rclick)
 * et dépendent de commandes non gérées par le moteur.
 */
export const SKIP_SCRIPTS = new Set([
  "about.ks",
  "archive.ks",
  "autopathplugin.ks",
  "backlog.ks",
  "basicchoice.ks",
  "basicdecide.ks",
  "button-47.ks",
  "call.ks",
  "cgmode.ks",
  "config_system.ks",
  "fallnote.ks",
  "first.ks",
  "fontchange.ks",
  "gamemenu.ks",
  "loaderror.ks",
  "read.ks",
  "saveerror.ks",
  "startup.ks",
  "teatime.ks",
  "title.ks",
  "tracerplugin.ks",
]);

/** Nature d'un fichier `.ks` qui est en réalité un média binaire (issue #111). */
export type BinaryAssetKind = "image" | "audio" | "unknown";

/** Fichier `.ks` en réalité binaire, avec la nature et le format détectés. */
export interface BinaryAssetInfo {
  /** Nom du fichier `.ks` (relatif à scenario/). */
  file: string;
  /** Nature du média d'origine, ou `unknown` si la signature est illisible. */
  kind: BinaryAssetKind;
  /** Format d'origine détecté par signature (`png`, `wav`, `tlg`, `inconnu`). */
  format: string;
}

/**
 * Signatures des médias binaires qui portent l'extension `.ks` dans l'archive
 * KiriKiri. Ils viennent du dossier `data/scenario/` du jeu, qui contient aussi
 * des médias utilisés par les plugins moteur (sons de menus, images d'effets) :
 * ce ne sont pas des scripts (issue #111).
 *
 * Le texte est celui obtenu après décodage malheureux du binaire comme du texte :
 * - PNG lu en Shift-JIS : 0x89 0x50 0x4E 0x47 → « 臼NG » ;
 * - PNG lu en UTF-16LE : 0x89 0x50 0x4E 0x47 → « 傉䝎 » ;
 * - RIFF/WAV intact (ASCII) ou lu en UTF-16LE : « RIFF » → « 䥒䙆 » ;
 * - TLG intact (ASCII).
 */
const BINARY_SIGNATURES: { pattern: RegExp; kind: BinaryAssetKind; format: string }[] = [
  { pattern: /^\uFEFF?\u0089PNG/, kind: "image", format: "png" },
  { pattern: /^\uFEFF?臼NG/, kind: "image", format: "png" },
  { pattern: /^\uFEFF?傉䝎/, kind: "image", format: "png" },
  { pattern: /^\uFEFF?(?:RIFF|䥒䙆)/, kind: "audio", format: "wav" },
  { pattern: /^\uFEFF?TLG[056]\.0/, kind: "image", format: "tlg" },
];

/** Anciennes signatures exportées (compatibilité) : voir `BINARY_SIGNATURES`. */
export const BINARY_PATTERNS: RegExp[] = BINARY_SIGNATURES.map((s) => s.pattern);

/**
 * Ratio de caractères suspects au-delà duquel un fichier est considéré binaire
 * (sans signature connue : chiffré ou format non identifié).
 */
function looksBinaryText(text: string): boolean {
  const sample = text.slice(0, 512);
  if (sample.length === 0) return false;

  let badBytes = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // Caractères de contrôle (hors tab, LF, CR) = signal de chiffrage
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      badBytes++;
    }
    // Katakana demi-chasse (U+FF61–FF9F) : très rares dans Mahoyo,
    // typiques d'un décodage Shift-JIS de binaire audio.
    if (code >= 0xff61 && code <= 0xff9f) {
      badBytes++;
    }
    // Caractère de remplacement U+FFFD : signal fiable de binaire lu en UTF-8
    if (code === 0xfffd) {
      badBytes++;
    }
  }

  return badBytes / sample.length > ENCRYPTED_BYTE_THRESHOLD;
}

/**
 * Identifie la nature d'un fichier `.ks` en réalité binaire (image/son) ou
 * indéterminé. Retourne null pour un vrai script texte.
 */
export function detectBinaryAsset(text: string): { kind: BinaryAssetKind; format: string } | null {
  const head = text.slice(0, 32);
  if (head.length === 0) return null;
  for (const sig of BINARY_SIGNATURES) {
    if (sig.pattern.test(head)) return { kind: sig.kind, format: sig.format };
  }
  if (looksBinaryText(text)) {
    return { kind: "unknown", format: "inconnu (chiffré ou binaire)" };
  }
  return null;
}

/**
 * Détecte un script chiffré/binaire en examinant les premiers octets.
 *
 * Les scripts KAG normaux commencent par du texte ASCII/Japonais (commentaires
 * `;`, labels `*`, commandes `@`). Les fichiers binaires portent une signature
 * de média ou contiennent des bytes de contrôle/binaire brut.
 */
export function isEncrypted(text: string): boolean {
  return detectBinaryAsset(text) !== null;
}

// ── Types du rapport ──

export interface ScriptAuditResult {
  /** Nom du fichier .ks (relatif à scenario/). */
  file: string;
  /** Nombre de steps exécutés. */
  steps: number;
  /** Commandes inconnues rencontrées (ni implémentées ni déclarées no-op). */
  unknownCommands: Record<string, number>;
  /** Commandes ignorées volontairement (no-op déclarés dans le registre). */
  ignoredCommands?: Record<string, number>;
  /** Commandes reconnues par le parser/runtime (comptées dans le script). */
  implementedCommands?: Record<string, number>;
  /** Warnings collectés (groupés). */
  warnings: Record<string, number>;
  /**
   * Assets dont l'image/le son de base est absent du manifest (nom sans le
   * suffixe de variante `|x`).
   */
  missingAssets: string[];
  /** Références à variante (`nom|x`) résolues via leur asset de base. */
  resolvedVariantRefs?: number;
  /** Références à un asset de nom vide (ex. effacement d'un calque). */
  emptyAssetRefs?: number;
  /** Références `nom|x` dont l'asset de base est absent (occurrences). */
  unresolvedVariantRefs?: number;
  /** Références distinctes `kind:nom|x` dont l'asset de base est absent. */
  unresolvedVariants?: string[];
  /** Erreurs fatales (runtime crash). */
  errors: string[];
  /** Compteur rawCount du runtime. */
  rawCount: number;
  /** Temps d'exécution en ms. */
  durationMs: number;
  /** true si le script a atteint maxSteps sans terminer. */
  hitMaxSteps: boolean;
}

export interface AuditReport {
  /** Date de l'audit (ISO). */
  timestamp: string;
  /** Nombre total de scripts dans le répertoire. */
  totalScriptsFound: number;
  /** Nombre de scripts système ignorés. */
  skippedSystem: number;
  /** Nombre de fichiers `.ks` binaires ignorés (voir `skippedBinary`). */
  skippedEncrypted: number;
  /** Détail des fichiers `.ks` en réalité binaires (nature et format, issue #111). */
  skippedBinary?: BinaryAssetInfo[];
  /** Nombre de scripts audités. */
  totalScripts: number;
  /** Nombre de scripts avec au moins une erreur fatale. */
  scriptsWithErrors: number;
  /** Nombre de scripts ayant atteint maxSteps. */
  scriptsWithMaxSteps: number;
  /** Durée totale en ms. */
  totalDurationMs: number;
  /** Résultats par script. */
  scripts: ScriptAuditResult[];
  /** Synthèse : commandes inconnues triées par fréquence (tout corpus). */
  unknownCommandsGlobal: Record<string, number>;
  /** Synthèse : commandes ignorées volontairement (no-op déclarés). */
  ignoredCommandsGlobal?: Record<string, number>;
  /** Synthèse : commandes reconnues par le parser/runtime (occurrences). */
  implementedCommandsGlobal?: Record<string, number>;
  /** Synthèse : warnings triés par fréquence (tout corpus). */
  warningsGlobal: Record<string, number>;
  /** Synthèse : assets manquants triés par fréquence. */
  missingAssetsGlobal: Record<string, number>;
  /** Total des références à variante (`nom|x`) résolues. */
  resolvedVariantRefsGlobal?: number;
  /** Total des références d'asset de nom vide. */
  emptyAssetRefsGlobal?: number;
  /** Total des références à variante dont l'asset de base est absent. */
  unresolvedVariantRefsGlobal?: number;
  /** Synthèse : variantes non résolues (base absente) triées par fréquence. */
  unresolvedVariantsGlobal?: Record<string, number>;
}

// ── Logique d'audit d'un script ──

/**
 * Exécute un script .ks en mode headless et collecte les diagnostics.
 * Les pauses (click/wait/waitFor) sont franchies automatiquement.
 * Les références inter-scripts via loadScript sont suivies.
 */
export async function auditScript(
  ksPath: string,
  fileName: string,
  manifest: AssetManifest | null,
  scriptTexts: Map<string, string>,
  maxSteps: number = DEFAULT_MAX_STEPS,
): Promise<ScriptAuditResult> {
  const text = scriptTexts.get(fileName) ?? readFileSync(ksPath, "utf-8");
  const tokens = lex(text);
  const script = parse(tokens);

  // Toutes les commandes rencontrées (commandes @ et tags inline), pour la
  // catégorie « implémentée » : les seules qui produisent un warning sont les
  // inconnues et les no-ops déclarés (voir plus bas).
  const totalCommands: Record<string, number> = {};
  for (const token of tokens) {
    if (token.type === "command" || token.type === "tag") {
      const name = normalizeCommandName(token.name);
      if (name !== "") totalCommands[name] = (totalCommands[name] ?? 0) + 1;
    }
  }

  const runtime = new Runtime(script, fileName);

  const warnings: string[] = [];
  runtime.onWarning = (msg: string) => warnings.push(msg);

  // ScriptLoader qui lit les scripts référencés depuis le cache texte.
  runtime.scriptLoader = async (storage: string) => {
    try {
      const content = scriptTexts.get(storage);
      if (content === undefined) return null;
      return parse(lex(content));
    } catch {
      return null;
    }
  };

  const assets = createAssetCollection();
  const errors: string[] = [];
  let steps = 0;
  let hitMaxSteps = false;

  const start = performance.now();

  while (steps < maxSteps) {
    try {
      const step = runtime.step();
      steps++;

      // Collecter les assets référencés
      if (manifest) {
        collectAssets(step.events, manifest, assets);
      }

      if (step.stop.kind === "end") break;

      // Gérer les changements de script
      if (step.stop.kind === "loadScript") {
        const loaded = await runtime.loadScript(
          step.stop.file,
          step.stop.label,
          step.stop.pushCallStack ?? true,
        );
        if (!loaded) break;
      }

      // click / wait / waitFor → on avance automatiquement
      // (le prochain appel à step() reprend l'exécution)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      break;
    }
  }

  if (steps >= maxSteps) {
    hitMaxSteps = true;
  }

  const durationMs = Math.round(performance.now() - start);

  // Classer les commandes non gérées : no-op déclaré (registre) ou inconnue.
  const unknownCommands: Record<string, number> = {};
  const ignoredCommands: Record<string, number> = {};
  for (const w of warnings) {
    const match = w.match(/commande non gérée: @(\S+)/);
    if (!match) continue;
    const name = normalizeCommandName(match[1]);
    if (IGNORED_COMMANDS_BY_NAME.has(name)) {
      ignoredCommands[name] = (ignoredCommands[name] ?? 0) + 1;
    } else {
      unknownCommands[name] = (unknownCommands[name] ?? 0) + 1;
    }
  }
  // « Implémentée » = rencontrée et sans warning (le total inclut les compteurs
  // inconnus/ignorés, donc on les retranche par occurrence).
  const implementedCommands = subtractCommandCounts(totalCommands, unknownCommands, ignoredCommands);

  // Grouper les autres warnings (hors commandes inconnues)
  const otherWarnings: Record<string, number> = {};
  for (const w of warnings) {
    if (!w.includes("commande non gérée")) {
      // Ne pas simplifier les warnings de chargement de script :
      // le nom du fichier est l'information utile.
      const key = w.includes("failed to load script")
        ? w
        : w.replace(/:\s*\S+$/, "");
      otherWarnings[key] = (otherWarnings[key] ?? 0) + 1;
    }
  }

  return {
    file: fileName,
    steps,
    unknownCommands,
    ignoredCommands,
    implementedCommands,
    warnings: otherWarnings,
    missingAssets: Array.from(assets.missing).sort(),
    resolvedVariantRefs: assets.variantRefs,
    emptyAssetRefs: assets.emptyRefs,
    unresolvedVariantRefs: assets.unresolvedVariantRefs,
    unresolvedVariants: Array.from(assets.unresolvedVariants).sort(),
    errors,
    rawCount: runtime.rawCount,
    durationMs,
    hitMaxSteps,
  };
}

// ── Collecte d'assets ──

/** Résultat de la résolution des assets référencés par un script. */
export interface AssetCollection {
  /** `image:nom` / `audio:nom` dont l'asset de base est absent du manifest. */
  missing: Set<string>;
  /** Références `nom|x` résolues via l'asset de base `nom`. */
  variantRefs: number;
  /** Références de nom vide. */
  emptyRefs: number;
  /** Occurrences de références `nom|x` dont l'asset de base est absent. */
  unresolvedVariantRefs: number;
  /** Références distinctes `kind:nom|x` dont l'asset de base est absent. */
  unresolvedVariants: Set<string>;
}

export function createAssetCollection(): AssetCollection {
  return {
    missing: new Set<string>(),
    variantRefs: 0,
    emptyRefs: 0,
    unresolvedVariantRefs: 0,
    unresolvedVariants: new Set<string>(),
  };
}

export function collectAssets(
  events: readonly RenderEvent[],
  manifest: AssetManifest,
  assets: AssetCollection,
): void {
  for (const ev of events) {
    if (ev.kind === "scene") {
      if (ev.scene.bg) checkAsset("image", ev.scene.bg, manifest, assets);
      for (const sprite of ev.scene.sprites) {
        checkAsset("image", sprite.storage, manifest, assets);
      }
    } else if (ev.kind === "audio") {
      const e = ev.event;
      if (e.kind === "play" && e.storage) {
        checkAsset("audio", e.storage, manifest, assets);
      }
    }
  }
}

/**
 * Vérifie une référence comme le fait le resolver du player : clé normalisée
 * par `storageKey` (suffixe `|x` retiré, casse, dossier, extension), puis
 * recherche dans le manifest. Les couleurs solides n'ont pas de fichier.
 */
function checkAsset(
  kind: "image" | "audio",
  storage: string,
  manifest: AssetManifest,
  assets: AssetCollection,
): void {
  const key = storageKey(storage);
  if (key === "") {
    assets.emptyRefs++;
    return;
  }
  if (kind === "image" && isSolidColor(storage)) return;

  const url = kind === "image" ? lookupImage(manifest, key) : lookupAudio(manifest, key);
  if (url) {
    if (storage.includes("|")) assets.variantRefs++;
    return;
  }
  // On rapporte le nom de base : toutes les variantes d'un même asset absent
  // se regroupent en une seule entrée.
  const base = (storage.split("|")[0] ?? storage).trim();
  assets.missing.add(`${kind}:${base}`);
  // Une variante dont la base est absente est comptée à part : le rapport la
  // distingue d'une image de base absente (voir formatMarkdownReport).
  if (storage.includes("|")) {
    assets.unresolvedVariantRefs++;
    assets.unresolvedVariants.add(`${kind}:${storage.trim()}`);
  }
}

// ── Agrégation ──

export function aggregateGlobal(results: ScriptAuditResult[]): {
  unknownCommandsGlobal: Record<string, number>;
  ignoredCommandsGlobal: Record<string, number>;
  implementedCommandsGlobal: Record<string, number>;
  warningsGlobal: Record<string, number>;
  missingAssetsGlobal: Record<string, number>;
  resolvedVariantRefsGlobal: number;
  emptyAssetRefsGlobal: number;
  unresolvedVariantRefsGlobal: number;
  unresolvedVariantsGlobal: Record<string, number>;
} {
  const unknownCommandsGlobal: Record<string, number> = {};
  const ignoredCommandsGlobal: Record<string, number> = {};
  const implementedCommandsGlobal: Record<string, number> = {};
  const warningsGlobal: Record<string, number> = {};
  const missingAssetsGlobal: Record<string, number> = {};
  const unresolvedVariantsGlobal: Record<string, number> = {};
  let resolvedVariantRefsGlobal = 0;
  let emptyAssetRefsGlobal = 0;
  let unresolvedVariantRefsGlobal = 0;

  for (const r of results) {
    resolvedVariantRefsGlobal += r.resolvedVariantRefs ?? 0;
    emptyAssetRefsGlobal += r.emptyAssetRefs ?? 0;
    unresolvedVariantRefsGlobal += r.unresolvedVariantRefs ?? 0;
    for (const ref of r.unresolvedVariants ?? []) {
      unresolvedVariantsGlobal[ref] = (unresolvedVariantsGlobal[ref] ?? 0) + 1;
    }
    for (const [cmd, count] of Object.entries(r.unknownCommands)) {
      unknownCommandsGlobal[cmd] = (unknownCommandsGlobal[cmd] ?? 0) + count;
    }
    for (const [cmd, count] of Object.entries(r.ignoredCommands ?? {})) {
      ignoredCommandsGlobal[cmd] = (ignoredCommandsGlobal[cmd] ?? 0) + count;
    }
    for (const [cmd, count] of Object.entries(r.implementedCommands ?? {})) {
      implementedCommandsGlobal[cmd] = (implementedCommandsGlobal[cmd] ?? 0) + count;
    }
    for (const [w, count] of Object.entries(r.warnings)) {
      warningsGlobal[w] = (warningsGlobal[w] ?? 0) + count;
    }
    for (const a of r.missingAssets) {
      missingAssetsGlobal[a] = (missingAssetsGlobal[a] ?? 0) + 1;
    }
  }

  return {
    unknownCommandsGlobal,
    ignoredCommandsGlobal,
    implementedCommandsGlobal,
    warningsGlobal,
    missingAssetsGlobal,
    resolvedVariantRefsGlobal,
    emptyAssetRefsGlobal,
    unresolvedVariantRefsGlobal,
    unresolvedVariantsGlobal,
  };
}

// ── Formatage du rapport Markdown ──

/** Échappe les `|` pour les cellules de tableaux Markdown. */
function escapeMdPipe(s: string): string {
  return s.replace(/\|/g, "\\|");
}

export function formatMarkdownReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push("# Audit headless du corpus KAG");
  lines.push("");
  lines.push(`- **Date** : ${report.timestamp}`);
  lines.push(`- **Scripts trouvés** : ${report.totalScriptsFound}`);
  lines.push(`- **Scripts système ignorés** : ${report.skippedSystem}`);
  lines.push(`- **Fichiers binaires ignorés** : ${report.skippedEncrypted}`);
  lines.push(`- **Scripts audités** : ${report.totalScripts}`);
  lines.push(`- **Scripts en erreur** : ${report.scriptsWithErrors}`);
  lines.push(`- **Scripts maxSteps atteint** : ${report.scriptsWithMaxSteps}`);
  lines.push(`- **Durée totale** : ${(report.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push("");

  // Fichiers binaires ignorés (médias déguisés en .ks)
  const binaryFiles = report.skippedBinary ?? [];
  if (binaryFiles.length > 0) {
    const countByKind = { image: 0, audio: 0, unknown: 0 };
    for (const b of binaryFiles) countByKind[b.kind]++;
    lines.push("## Fichiers binaires ignorés (non-scripts)");
    lines.push("");
    lines.push(
      `Médias du dossier \`data/scenario/\` du jeu portant l'extension \`.ks\`, exclus du corpus narratif : ${countByKind.image} image(s), ${countByKind.audio} son(s), ${countByKind.unknown} indéterminé(s).`,
    );
    lines.push("");
    lines.push("| Fichier | Nature | Format |");
    lines.push("|---|---|---|");
    for (const b of binaryFiles) {
      const nature = b.kind === "image" ? "image" : b.kind === "audio" ? "son" : "indéterminé";
      lines.push(`| ${escapeMdPipe(b.file)} | ${nature} | ${b.format} |`);
    }
    lines.push("");
  }

  // Commandes KAG : classification implémentée / ignorée volontairement / inconnue (#275)
  lines.push("## Commandes KAG (classification)");
  lines.push("");
  const sortedImplemented = Object.entries(report.implementedCommandsGlobal ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const ignoredGlobal = report.ignoredCommandsGlobal ?? {};
  const sortedIgnored = Object.entries(ignoredGlobal).sort((a, b) => b[1] - a[1]);
  const sortedCmds = Object.entries(report.unknownCommandsGlobal).sort((a, b) => b[1] - a[1]);
  const sumOccurrences = (counts: ReadonlyArray<[string, number]>): number =>
    counts.reduce((total, [, count]) => total + count, 0);
  lines.push(
    `- Commandes implémentées : ${sortedImplemented.length} distinctes (${sumOccurrences(sortedImplemented)} occurrences)`,
  );
  lines.push(
    `- Commandes ignorées volontairement (no-op déclarés) : ${sortedIgnored.length} distinctes (${sumOccurrences(sortedIgnored)} occurrences)`,
  );
  lines.push(
    `- Commandes inconnues : ${sortedCmds.length} distinctes (${sumOccurrences(sortedCmds)} occurrences)`,
  );
  lines.push("");

  lines.push("### Commandes implémentées");
  lines.push("");
  if (sortedImplemented.length === 0) {
    lines.push("_Mesure non disponible (rapport sans classification)._");
  } else {
    lines.push("| Commande | Occurrences |");
    lines.push("|---|---|");
    for (const [cmd, count] of sortedImplemented) {
      lines.push(`| @${escapeMdPipe(cmd)} | ${count} |`);
    }
  }
  lines.push("");

  lines.push("### Commandes ignorées volontairement (no-op déclarés)");
  lines.push("");
  if (sortedIgnored.length === 0) {
    lines.push("_Aucune commande déclarée no-op dans le registre._");
  } else {
    lines.push("| Commande | Effet | Raison | Issue |");
    lines.push("|---|---|---|---|");
    for (const [cmd] of sortedIgnored) {
      const entry = IGNORED_COMMANDS_BY_NAME.get(cmd);
      lines.push(
        `| @${escapeMdPipe(cmd)} | ${escapeMdPipe(entry?.effet ?? "?")} | ${escapeMdPipe(entry?.raison ?? "?")} | ${escapeMdPipe(entry?.issue ?? "?")} |`,
      );
    }
  }
  lines.push("");

  lines.push("### Commandes inconnues (triées par fréquence)");
  lines.push("");
  if (sortedCmds.length === 0) {
    lines.push("_Aucune commande inconnue._");
  } else {
    lines.push("| Commande | Occurrences |");
    lines.push("|---|---|");
    for (const [cmd, count] of sortedCmds) {
      lines.push(`| @${escapeMdPipe(cmd)} | ${count} |`);
    }
  }
  lines.push("");

  // Warnings
  lines.push("## Warnings (triés par fréquence)");
  lines.push("");
  const sortedWarnings = Object.entries(report.warningsGlobal).sort((a, b) => b[1] - a[1]);
  if (sortedWarnings.length === 0) {
    lines.push("_Aucun warning._");
  } else {
    lines.push("| Warning | Occurrences |");
    lines.push("|---|---|");
    for (const [w, count] of sortedWarnings) {
      lines.push(`| ${escapeMdPipe(w)} | ${count} |`);
    }
  }
  lines.push("");

  // Assets manquants
  lines.push("## Assets manquants dans le manifest");
  lines.push("");
  const sortedAssets = Object.entries(report.missingAssetsGlobal).sort((a, b) => b[1] - a[1]);
  const sortedUnresolved = Object.entries(report.unresolvedVariantsGlobal ?? {}).sort((a, b) => b[1] - a[1]);
  lines.push(`- Assets de base absents (images/sons) : ${sortedAssets.length}`);
  lines.push(
    `- Variantes non résolues (asset de base absent) : ${report.unresolvedVariantRefsGlobal ?? 0} référence(s), ${sortedUnresolved.length} variante(s) distincte(s)`,
  );
  lines.push(
    `- Références à variante (\`nom|x\`) résolues via l'asset de base : ${report.resolvedVariantRefsGlobal ?? 0}`,
  );
  lines.push(`- Références d'asset de nom vide : ${report.emptyAssetRefsGlobal ?? 0}`);
  lines.push("");
  lines.push(
    "Règle de résolution (identique au player) : le suffixe de variante `|x` est retiré de la référence, puis la clé de base est normalisée (dossier, extension, casse, espaces de bordure) et cherchée dans le manifest (repli NFKC).",
  );
  lines.push("");
  lines.push("### Assets de base absents");
  lines.push("");
  if (sortedAssets.length === 0) {
    lines.push("_Aucun asset de base manquant._");
  } else {
    lines.push("| Asset de base | Scripts |");
    lines.push("|---|---|");
    for (const [a, count] of sortedAssets) {
      lines.push(`| ${escapeMdPipe(a)} | ${count} |`);
    }
  }
  lines.push("");
  if (sortedUnresolved.length > 0) {
    lines.push("### Variantes non résolues (base absente)");
    lines.push("");
    lines.push(
      "Une variante non résolue n'est pas un fichier supplémentaire : c'est une référence `nom|x` dont l'asset de base est listé ci-dessus.",
    );
    lines.push("");
    lines.push("| Variante | Scripts |");
    lines.push("|---|---|");
    for (const [variant, count] of sortedUnresolved) {
      lines.push(`| ${escapeMdPipe(variant)} | ${count} |`);
    }
    lines.push("");
  }

  // Scripts en erreur
  const errorScripts = report.scripts.filter((s) => s.errors.length > 0);
  if (errorScripts.length > 0) {
    lines.push("## Scripts en erreur fatale");
    lines.push("");
    for (const s of errorScripts) {
      lines.push(`### ${s.file}`);
      for (const e of s.errors) {
        lines.push(`- \`${e}\``);
      }
      lines.push("");
    }
  }

  // Scripts ayant atteint maxSteps
  const maxStepScripts = report.scripts.filter((s) => s.hitMaxSteps);
  if (maxStepScripts.length > 0) {
    lines.push("## Scripts ayant atteint maxSteps (boucle probable)");
    lines.push("");
    for (const s of maxStepScripts) {
      lines.push(`- ${s.file} (${s.steps} steps, ${s.rawCount} raw)`);
    }
    lines.push("");
  }

  // Détail par script (résumé)
  lines.push("## Détail par script");
  lines.push("");
  lines.push("| Fichier | Steps | rawCount | Inconnues | Warnings | Assets manquants | Durée |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const s of report.scripts) {
    const unknownCount = Object.values(s.unknownCommands).reduce((a, b) => a + b, 0);
    const warnCount = Object.values(s.warnings).reduce((a, b) => a + b, 0);
    const marker = s.errors.length > 0 ? " ❌" : s.hitMaxSteps ? " ⚠️" : "";
    lines.push(
      `| ${s.file}${marker} | ${s.steps} | ${s.rawCount} | ${unknownCount} | ${warnCount} | ${s.missingAssets.length} | ${s.durationMs}ms |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

// ── Helpers de listing / filtrage du corpus ──

export interface CorpusListing {
  allKsFiles: string[];
  systemScripts: string[];
  /** Fichiers `.ks` binaires (compatibilité : voir `binaryAssets`). */
  encryptedScripts: string[];
  /** Nature détectée de chaque fichier `.ks` binaire (issue #111). */
  binaryAssets: BinaryAssetInfo[];
  auditableScripts: string[];
  scriptTexts: Map<string, string>;
}

/**
 * Liste et filtre les scripts d'un répertoire scenario/.
 * Retourne la liste complète, les scripts système, les scripts chiffrés,
 * les scripts auditable, et un cache de leur contenu texte.
 */
export function listCorpus(scenarioDir: string): CorpusListing {
  const allKsFiles = readdirSync(scenarioDir)
    .filter((f) => extname(f) === ".ks")
    .sort();

  const scriptTexts = new Map<string, string>();
  for (const f of allKsFiles) {
    try {
      scriptTexts.set(f, readFileSync(join(scenarioDir, f), "utf-8"));
    } catch {
      // Ignorer les fichiers illisibles
    }
  }

  // Un fichier binaire n'est jamais un script, même si son nom figure dans la
  // liste système : le jeu place des médias dans data/scenario/ (issue #111).
  const binaryAssets: BinaryAssetInfo[] = [];
  const textScripts: string[] = [];
  for (const f of allKsFiles) {
    const content = scriptTexts.get(f);
    const info = content === undefined ? null : detectBinaryAsset(content);
    if (info) {
      binaryAssets.push({ file: f, ...info });
      scriptTexts.delete(f);
    } else {
      textScripts.push(f);
    }
  }

  const systemScripts = textScripts.filter((f) => SKIP_SCRIPTS.has(f));
  const auditableScripts = textScripts.filter((f) => !SKIP_SCRIPTS.has(f));

  return {
    allKsFiles,
    systemScripts,
    encryptedScripts: binaryAssets.map((b) => b.file),
    binaryAssets,
    auditableScripts,
    scriptTexts,
  };
}
