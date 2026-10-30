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
import type { Instruction, ParsedScript } from "@/kag/types.js";
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

/** Installe une traduction à partir d'un mapping fichiers originaux ↔ textes traduits. */
export function installTranslation(
  originalTexts: Map<string, string>,
  translatedTexts: Map<string, string>,
  opts: InstallTranslationOptions,
): {
  index: LanguageIndex;
  reports: CompatibilityReport[];
  installed: Map<string, string>;
} {
  const scripts: string[] = [];
  const strict: string[] = [];
  const skipped: { file: string; reason: string }[] = [];
  const reports: CompatibilityReport[] = [];
  const installed = new Map<string, string>();

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
      installed.set(file, translatedTexts.get(file)!);
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

  return { index, reports, installed };
}
