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
};

export type TranslationIndex = {
  version: 1;
  language: string;
  label: string;
  credits: string;
  /** Scripts retenus (chemins relatifs scenario/<file>). */
  scripts: string[];
  /** Scripts strictement identiques au squelette. */
  strict: string[];
  /** Scripts ignorés avec la raison. */
  skipped: { file: string; reason: string }[];
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

/** Construit le squelette d'une instruction pour comparaison. */
function skeletonOf(instruction: Instruction): string {
  // Pour les commandes de flux, on inclut les arguments qui déterminent la suite.
  if (instruction.kind === "jump" || instruction.kind === "call") {
    return JSON.stringify({
      kind: instruction.kind,
      target: instruction.target,
      storage: instruction.storage,
      cond: instruction.cond,
    });
  }
  return instruction.kind;
}

/** true si l'instruction fait partie du squelette structurel (hors texte/break). */
function isStructural(instruction: Instruction): boolean {
  return instruction.kind !== "text" && instruction.kind !== "break";
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
    };
  }

  const originalLabels = labelMap(original);
  const translatedLabels = labelMap(translated);
  let matchingLabels = 0;

  for (const [name, pageIndex] of originalLabels) {
    if (translatedLabels.get(name) !== pageIndex) {
      return {
        file,
        level: "incompatible",
        installable: false,
        originalPages,
        translatedPages,
        matchingLabels,
        originalLabels: originalLabels.size,
        translatedLabels: translatedLabels.size,
        reason: `label "${name}" différent ou absent`,
      };
    }
    matchingLabels++;
  }

  if (originalLabels.size !== translatedLabels.size) {
    return {
      file,
      level: "incompatible",
      installable: false,
      originalPages,
      translatedPages,
      matchingLabels,
      originalLabels: originalLabels.size,
      translatedLabels: translatedLabels.size,
      reason: "labels supplémentaires dans la traduction",
    };
  }

  // Comparaison du squelette structurel (hors texte/break) page par page.
  let hasStructuralDiff = false;
  for (let i = 0; i < originalPages; i++) {
    const orig = original.pages[i]!;
    const tran = translated.pages[i]!;

    const origSkeleton = orig.instructions.filter(isStructural).map(skeletonOf);
    const tranSkeleton = tran.instructions.filter(isStructural).map(skeletonOf);

    if (origSkeleton.length !== tranSkeleton.length) {
      return {
        file,
        level: "incompatible",
        installable: false,
        originalPages,
        translatedPages,
        matchingLabels,
        originalLabels: originalLabels.size,
        translatedLabels: translatedLabels.size,
        reason: `page ${i} : nombre d'instructions structurelles différent`,
      };
    }

    for (let j = 0; j < origSkeleton.length; j++) {
      if (origSkeleton[j] !== tranSkeleton[j]) {
        return {
          file,
          level: "incompatible",
          installable: false,
          originalPages,
          translatedPages,
          matchingLabels,
          originalLabels: originalLabels.size,
          translatedLabels: translatedLabels.size,
          reason: `page ${i}, instruction structurelle ${j} : squelette différent`,
        };
      }
    }

    // Détecter une différence dans la partie texte/break pour différencier compatible/strict.
    const origFull = orig.instructions.map((inst) => inst.kind);
    const tranFull = tran.instructions.map((inst) => inst.kind);
    if (origFull.length !== tranFull.length || origFull.some((k, idx) => k !== tranFull[idx])) {
      hasStructuralDiff = true;
    }
  }

  if (hasStructuralDiff) {
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
  };
}

/** Installe une traduction à partir d'un mapping fichiers originaux ↔ textes traduits. */
export function installTranslation(
  originalTexts: Map<string, string>,
  translatedTexts: Map<string, string>,
  opts: InstallTranslationOptions,
): {
  index: TranslationIndex;
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
      installed.set(file, translatedText);
    } else {
      skipped.push({ file, reason: report.reason ?? "incompatible" });
    }
  }

  const index: TranslationIndex = {
    version: 1,
    language: opts.language,
    label: opts.label,
    credits: opts.credits,
    scripts,
    strict,
    skipped,
  };

  return { index, reports, installed };
}
