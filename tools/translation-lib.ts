/**
 * Logique d'installation d'une traduction fan de scripts KAG.
 *
 * Ce module ne connaît pas le réseau ni le système de fichiers directement :
 * il reçoit des buffers/textes et produit des rapports. Le CLI
 * (`tools/translation.ts`) s'occupe des I/O et du téléchargement.
 */
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { decodeKs } from "./ks-encoding.js";
import { normalizeScriptText } from "./normalize-ks.js";
import type { Instruction, ParsedScript, Token } from "@/kag/types.js";
import type { LanguageIndex } from "@/core/language.js";

export type CompatibilityLevel = "compatible" | "strict" | "incompatible";

export type CompatibilityReport = {
  file: string;
  level: CompatibilityLevel;
  /** true si le script peut être installé (compatible ou strict). */
  installable: boolean;
  /** Nombre de pages du script original. */
  originalPages: number;
  /** Nombre de pages du script traduit. */
  translatedPages: number;
  /** Nombre de labels identiques (même nom, même index de page). */
  matchingLabels: number;
  /** Nombre total de labels dans l'original. */
  originalLabels: number;
  /** Nombre total de labels dans la traduction. */
  translatedLabels: number;
  /** Description de la première divergence, ou null. */
  reason: string | null;
  /** Labels présents dans l'original mais absents ou mal placés dans la traduction. */
  missingLabels: string[];
  /** Labels présents dans la traduction mais absents dans l'original. */
  extraLabels: string[];
};

export type InstallTranslationOptions = {
  language: string;
  label: string;
  credits: string;
};

export type DecodedScript = {
  file: string;
  text: string;
  encoding: string;
};

/** Décode un buffer .ks et le normalise comme les scripts japonais du pipeline. */
export function decodeTranslationScript(buffer: Buffer): { text: string; encoding: string } {
  const decoded = decodeKs(buffer);
  const text = normalizeScriptText(decoded.text);
  return { text, encoding: decoded.encoding };
}

/** Parse un texte KAG en script exécutable. */
export function parseTranslationScript(text: string): ParsedScript {
  return parse(lex(text));
}

/** Kinds d'instructions qui pilotent le flux du script. */
const FLOW_KINDS = new Set<string>([
  "jump",
  "call",
  "return",
  "conditional",
  "macrodef",
]);

/** Commandes @raw qui participent au flux ou aux choix du joueur. */
const FLOW_RAW_COMMANDS = new Set<string>([
  "s",
  "link",
  "endlink",
  "button",
  "select",
  "waittrig",
  "waitclick",
  "cancelautomode",
  "cancelskip",
  "resetwait",
]);

/** true si l'instruction fait partie du squelette de flux. */
function isFlow(instruction: Instruction): boolean {
  if (FLOW_KINDS.has(instruction.kind)) return true;
  if (instruction.kind === "raw" && FLOW_RAW_COMMANDS.has(instruction.command)) return true;
  return false;
}

/** Représentation comparable d'une instruction de flux. */
function flowKey(instruction: Instruction): string {
  if (instruction.kind === "jump" || instruction.kind === "call") {
    return JSON.stringify({
      kind: instruction.kind,
      target: instruction.target,
      storage: instruction.storage,
      cond: instruction.cond,
    });
  }
  if (instruction.kind === "raw") {
    // Pour les commandes de flux raw, les arguments (target, exp, etc.) comptent.
    const entries = Object.entries(instruction.args).sort((a, b) => a[0].localeCompare(b[0]));
    return JSON.stringify({ kind: "raw", command: instruction.command, args: entries });
  }
  if (instruction.kind === "conditional") {
    // On ne compare pas le contenu des branches, juste le fait qu'il y ait
    // une alternative : l'instruction elle-même est le point de flux.
    return "conditional";
  }
  if (instruction.kind === "macrodef") {
    return JSON.stringify({ kind: "macrodef", name: instruction.name });
  }
  return instruction.kind;
}

/**
 * Labels visés par un saut ou un appel (`@jump`/`@call target=`, y compris dans les
 * branches `@if` et dans les commandes brutes qui portent un `target`). Seuls ces
 * labels comptent pour le déroulement ; les autres ne servent qu'à nommer les pages.
 */
function flowTargets(script: ParsedScript): Set<string> {
  const out = new Set<string>();
  const clean = (t: string): string => t.replace(/^\*/, "").replace(/\|.*$/, "");
  const walk = (instructions: readonly Instruction[]): void => {
    for (const ins of instructions) {
      if ((ins.kind === "jump" || ins.kind === "call") && ins.target) out.add(clean(ins.target));
      else if (ins.kind === "raw" && ins.args.target) out.add(clean(ins.args.target));
      else if (ins.kind === "conditional") for (const branch of ins.branches) walk(branch.instructions);
    }
  };
  for (const page of script.pages) walk(page.instructions);
  return out;
}

/** Extrait la liste des labels d'un script sous forme comparable. */
function labelMap(script: ParsedScript): Map<string, number> {
  const map = new Map<string, number>();
  for (const [name, pageIndex] of Object.entries(script.labels)) {
    map.set(name, pageIndex);
  }
  return map;
}

/** Compare deux scripts et retourne un rapport de compatibilité. */
export function compareScripts(
  original: ParsedScript,
  translated: ParsedScript,
  file: string,
): CompatibilityReport {
  const originalPages = original.pages.length;
  const translatedPages = translated.pages.length;

  if (originalPages !== translatedPages) {
    return {
      file,
      level: "incompatible",
      installable: false,
      originalPages,
      translatedPages,
      matchingLabels: 0,
      originalLabels: Object.keys(original.labels).length,
      translatedLabels: Object.keys(translated.labels).length,
      reason: `nombre de pages différent (${translatedPages} vs ${originalPages})`,
      missingLabels: [],
      extraLabels: [],
    };
  }

  const originalLabels = labelMap(original);
  const translatedLabels = labelMap(translated);
  let matchingLabels = 0;
  const missingLabels: string[] = [];
  const extraLabels: string[] = [];

  for (const [name, pageIndex] of originalLabels) {
    if (translatedLabels.get(name) !== pageIndex) {
      missingLabels.push(name);
    } else {
      matchingLabels++;
    }
  }

  for (const [name] of translatedLabels) {
    if (!originalLabels.has(name)) {
      extraLabels.push(name);
    }
  }

  // Un label en trop ne peut casser aucun saut : tous ceux de l'original existent encore, à la
  // même page. Il est signalé (extraLabels) mais n'empêche pas l'installation.
  // Un label manquant (ou à une autre page) ne bloque que s'il est la cible d'un saut ou d'un
  // appel : la traduction numérote parfois ses pages autrement (`page0` au lieu de `page1`),
  // ce qui est sans effet tant que rien ne s'y réfère.
  const referenced = new Set([...flowTargets(original), ...flowTargets(translated)]);
  const blockingLabels = missingLabels.filter((name) => referenced.has(name));
  if (blockingLabels.length > 0) {
    const parts: string[] = [`labels visés par un saut, manquants ou déplacés : ${blockingLabels.join(", ")}`];
    if (extraLabels.length > 0) parts.push(`labels en trop : ${extraLabels.join(", ")}`);
    return {
      file,
      level: "incompatible",
      installable: false,
      originalPages,
      translatedPages,
      matchingLabels,
      originalLabels: originalLabels.size,
      translatedLabels: translatedLabels.size,
      reason: parts.join(" ; "),
      missingLabels,
      extraLabels,
    };
  }

  // Comparaison du squelette de flux page par page.
  for (let i = 0; i < originalPages; i++) {
    const orig = original.pages[i]!;
    const tran = translated.pages[i]!;

    const origFlow = orig.instructions.filter(isFlow).map(flowKey);
    const tranFlow = tran.instructions.filter(isFlow).map(flowKey);

    if (origFlow.length !== tranFlow.length) {
      return {
        file,
        level: "incompatible",
        installable: false,
        originalPages,
        translatedPages,
        matchingLabels,
        originalLabels: originalLabels.size,
        translatedLabels: translatedLabels.size,
        reason: `page ${i} : nombre d'instructions de flux différent`,
        missingLabels,
        extraLabels,
      };
    }

    for (let j = 0; j < origFlow.length; j++) {
      if (origFlow[j] !== tranFlow[j]) {
        return {
          file,
          level: "incompatible",
          installable: false,
          originalPages,
          translatedPages,
          matchingLabels,
          originalLabels: originalLabels.size,
          translatedLabels: translatedLabels.size,
          reason: `page ${i}, instruction de flux ${j} : squelette différent`,
          missingLabels,
          extraLabels,
        };
      }
    }
  }

  // Détecter une différence dans la partie non-flux pour différencier compatible/strict.
  let hasNonFlowDiff = false;
  for (let i = 0; i < originalPages; i++) {
    const orig = original.pages[i]!;
    const tran = translated.pages[i]!;

    const origFull = orig.instructions.map((inst) => inst.kind);
    const tranFull = tran.instructions.map((inst) => inst.kind);
    if (origFull.length !== tranFull.length || origFull.some((k, idx) => k !== tranFull[idx])) {
      hasNonFlowDiff = true;
      break;
    }
  }

  if (hasNonFlowDiff) {
    return {
      file,
      level: "compatible",
      installable: true,
      originalPages,
      translatedPages,
      matchingLabels,
      originalLabels: originalLabels.size,
      translatedLabels: translatedLabels.size,
      reason: null,
      missingLabels,
      extraLabels,
    };
  }

  return {
    file,
    level: "strict",
    installable: true,
    originalPages,
    translatedPages,
    matchingLabels,
    originalLabels: originalLabels.size,
    translatedLabels: translatedLabels.size,
    reason: null,
    missingLabels,
    extraLabels,
  };
}

// ── Pauses `[l]` vides (#141) ──

/** Une pause de ligne repérée dans le script, avec sa position dans le texte source. */
type PauseSite = {
  /** Du texte lisible précède la pause depuis le clic précédent. */
  hasText: boolean;
  /** Pause `[l]` ou `@l` : seule celle-ci peut être retirée (pas `@p`). */
  removable: boolean;
  /** Numéro de ligne (0-based) dans le texte source. */
  line: number;
  /** Rang du tag `[...]` dans la ligne (pour `[l]`), -1 pour la commande `@l`. */
  tagIndex: number;
};

/**
 * Relève les pauses de ligne de chaque page d'un script, au niveau des tokens, avec leur
 * emplacement dans le texte. Le bloc `@if` et les macros sont opaques : tout texte qu'ils
 * contiennent (ou qu'une macro appelée pourrait émettre) compte comme lisible, pour ne jamais
 * conclure à tort qu'une pause est vide.
 */
function collectPauseSites(text: string): PauseSite[][] {
  const tokens: Token[] = lex(text);
  const macroNames = new Set<string>();
  for (const t of tokens) {
    if (t.type === "command" && t.name === "macro" && t.args.name) macroNames.add(t.args.name);
  }

  const pages: PauseSite[][] = [[]];
  let hasText = false;
  let line = 0;
  let tagIndex = 0;
  let blockDepth = 0;

  const isBlockOpen = (n: string): boolean => n === "if" || n === "macro";
  const isBlockClose = (n: string): boolean => n === "endif" || n === "endmacro";

  for (const t of tokens) {
    if (t.type === "linebreak") {
      line++;
      tagIndex = 0;
      continue;
    }
    if (t.type === "tag") {
      const idx = tagIndex++;
      if (blockDepth > 0) continue;
      if (t.name === "p") {
        pages.push([]);
        hasText = false;
      } else if (t.name === "l") {
        pages[pages.length - 1]!.push({ hasText, removable: true, line, tagIndex: idx });
        hasText = false;
      } else if (macroNames.has(t.name)) {
        hasText = true;
      }
      continue;
    }
    if (t.type === "command") {
      if (isBlockClose(t.name)) {
        if (blockDepth > 0) blockDepth--;
        continue;
      }
      if (isBlockOpen(t.name)) {
        blockDepth++;
        // Un bloc conditionnel peut émettre du texte : on reste prudent.
        if (t.name === "if") hasText = true;
        continue;
      }
      if (blockDepth > 0) continue;
      if (t.name === "pg") {
        pages.push([]);
        hasText = false;
      } else if (t.name === "l") {
        pages[pages.length - 1]!.push({ hasText, removable: true, line, tagIndex: -1 });
        hasText = false;
      } else if (t.name === "p") {
        pages[pages.length - 1]!.push({ hasText, removable: false, line, tagIndex: -1 });
        hasText = false;
      } else if (macroNames.has(t.name)) {
        hasText = true;
      }
      continue;
    }
    if (t.type === "text" && t.content.trim().length > 0) hasText = true;
  }
  return pages;
}

/**
 * Alignement (plus longue sous-suite commune) des pauses d'une page entre l'original et la
 * traduction, sur la présence de texte avant chaque pause. Retourne les indices des pauses
 * de la traduction sans correspondance dans l'original.
 */
function unmatchedTranslatedPauses(original: boolean[], translated: boolean[]): Set<number> {
  const n = original.length;
  const m = translated.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        original[i] === translated[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const matched = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (original[i] === translated[j]) {
      matched.add(j);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  const unmatched = new Set<number>();
  for (let k = 0; k < m; k++) if (!matched.has(k)) unmatched.add(k);
  return unmatched;
}

/**
 * Neutralise les pauses `[l]` vides de la traduction : une ligne traduite sans aucun texte
 * lisible qui n'a pas de pause vide correspondante dans l'original (là où le japonais a du
 * texte, le joueur devait cliquer sur du vide). Seul le `[l]` (ou la ligne `@l`) est retiré ;
 * aucun texte, aucune autre commande n'est touché ni lu.
 *
 * La comparaison est structurelle, page par page. Si les deux scripts n'ont pas le même
 * nombre de pages au niveau des tokens, rien n'est modifié.
 */
export function neutralizeEmptyPauses(
  originalText: string,
  translatedText: string,
): { text: string; removed: number } {
  const original = collectPauseSites(originalText);
  const translated = collectPauseSites(translatedText);
  if (original.length !== translated.length) return { text: translatedText, removed: 0 };

  // Pauses à retirer, par ligne : rangs de tags `[...]`, ou -1 pour la ligne `@l` entière.
  const toRemove = new Map<number, Set<number>>();
  let removed = 0;
  for (let p = 0; p < translated.length; p++) {
    const tr = translated[p]!;
    const unmatched = unmatchedTranslatedPauses(
      original[p]!.map((s) => s.hasText),
      tr.map((s) => s.hasText),
    );
    for (const k of unmatched) {
      const site = tr[k]!;
      if (site.hasText || !site.removable) continue;
      let set = toRemove.get(site.line);
      if (!set) toRemove.set(site.line, (set = new Set<number>()));
      set.add(site.tagIndex);
      removed++;
    }
  }
  if (removed === 0) return { text: translatedText, removed: 0 };

  // Réécriture ligne par ligne, séparateurs de ligne conservés.
  const parts = translatedText.split(/(\r?\n)/);
  for (const [lineNo, ranks] of toRemove) {
    const idx = lineNo * 2;
    const raw = parts[idx];
    if (raw === undefined) continue;
    if (ranks.has(-1)) {
      parts[idx] = "";
      continue;
    }
    let tag = 0;
    parts[idx] = raw.replace(/\[([^\]]+)\]/g, (whole) => (ranks.has(tag++) ? "" : whole));
  }
  return { text: parts.join(""), removed };
}

/** Installe une traduction à partir d'un mapping fichiers originaux ↔ textes traduits. */
export function installTranslation(
  originalTexts: Map<string, string>,
  translatedTexts: Map<string, string>,
  opts: InstallTranslationOptions,
): {
  index: LanguageIndex;
  reports: CompatibilityReport[];
  installed: Map<string, string>;
  /** Nombre de pauses `[l]` vides retirées, par script (uniquement ceux qui en ont). */
  neutralized: Map<string, number>;
} {
  const scripts: string[] = [];
  const strict: string[] = [];
  const skipped: { file: string; reason: string }[] = [];
  const reports: CompatibilityReport[] = [];
  const installed = new Map<string, string>();
  const neutralized = new Map<string, number>();

  for (const [file, translatedText] of translatedTexts) {
    const originalText = originalTexts.get(file);
    let report: CompatibilityReport;

    if (originalText === undefined) {
      report = {
        file,
        level: "incompatible",
        installable: false,
        originalPages: 0,
        translatedPages: 0,
        matchingLabels: 0,
        originalLabels: 0,
        translatedLabels: 0,
        reason: "script original introuvable",
        missingLabels: [],
        extraLabels: [],
      };
    } else {
      let original: ParsedScript;
      let translated: ParsedScript;
      try {
        original = parseTranslationScript(originalText);
        translated = parseTranslationScript(translatedText);
      } catch (err) {
        report = {
          file,
          level: "incompatible",
          installable: false,
          originalPages: 0,
          translatedPages: 0,
          matchingLabels: 0,
          originalLabels: 0,
          translatedLabels: 0,
          reason: `erreur de parsing : ${err instanceof Error ? err.message : String(err)}`,
          missingLabels: [],
          extraLabels: [],
        };
        reports.push(report);
        skipped.push({ file, reason: report.reason ?? "incompatible" });
        continue;
      }
      report = compareScripts(original, translated, file);
    }

    reports.push(report);

    if (report.installable) {
      scripts.push(file);
      if (report.level === "strict") {
        strict.push(file);
      }
      const fixed = neutralizeEmptyPauses(originalTexts.get(file)!, translatedText);
      if (fixed.removed > 0) neutralized.set(file, fixed.removed);
      installed.set(file, fixed.text);
    } else {
      skipped.push({ file, reason: report.reason ?? "incompatible" });
    }
  }

  const index: LanguageIndex = {
    version: 1,
    language: opts.language,
    label: opts.label,
    credits: opts.credits,
    scripts,
    strict,
    skipped,
    extraAssets: {},
  };

  return { index, reports, installed, neutralized };
}
