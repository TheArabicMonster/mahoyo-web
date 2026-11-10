/**
 * Mesure du débordement du texte sur le corpus KAG (#319) — helpers purs.
 *
 * Le port rend le texte dans un stage logique 1024×576 agrandi ×1,25 vers le viewport 1280×720
 * (`src/renderer/stage-renderer.ts`, `src/renderer/text-fit.ts`). Le jeu d'origine travaillait en
 * 1280×720 : les tailles `@font size=` du corpus sont donc exprimées dans le repère 1280×720 et
 * doivent être converties en px CSS du stage (×0,8) avant d'être posées telles quelles — le port les
 * utilise aujourd'hui directement, d'où un facteur ×1,25 à l'écran.
 *
 * Ce module ne dépend d'aucun DOM : extraction des pages de texte (runtime KAG), conversions
 * d'unités, verdict de débordement, agrégats et rendu du rapport Markdown (sans texte du jeu).
 */
import { parse } from "../src/kag/parser.js";
import { lex } from "../src/kag/lexer.js";
import { Runtime } from "../src/kag/runtime.js";
import type { RenderEvent } from "../src/kag/events.js";
import { FRAME_TEXT_AREA, FRAME_TEXT_LINE_HEIGHT, FRAME_TEXT_REM, frameTextAreaHeight } from "../src/renderer/text-fit.js";

/** Repère de référence du jeu d'origine (cf. docs/KAG_MAHOYO_SEMANTICS.md §1). */
export const ORIGINAL_SIZE = { width: 1280, height: 720 } as const;
/** Repère logique du stage du port, agrandi vers le viewport 1280×720. */
export const STAGE_SIZE = { width: 1024, height: 576 } as const;
/** Facteur d'agrandissement du stage vers le viewport (`STAGE_SCALE` du renderer). */
export const STAGE_SCALE = ORIGINAL_SIZE.width / STAGE_SIZE.width;

/** Pile de polices du texte de jeu : miroir de `--mh-font-text` (`src/ui/tokens.css`). */
export const GAME_TEXT_FONT_STACK =
  '"Hiragino Mincho ProN", "Yu Mincho", "Shippori Mincho", "Noto Serif JP", "EB Garamond", Georgia, serif';

/** Taille nominale du texte de jeu dans le stage (px CSS) : `FRAME_TEXT_REM` × 16 px. */
export const NOMINAL_STAGE_PX = FRAME_TEXT_REM * 16;
/** Taille nominale à l'écran (px) : 34 px attendus (docs/DESIGN.md §3). */
export const NOMINAL_SCREEN_PX = stageToScreenPx(NOMINAL_STAGE_PX);

/**
 * Constantes de mise en page **logiques** (repère 1024×576) retenues après l'arbitrage Opus 5.5
 * (#319) : marge horizontale 69 px, police 26 px, interligne 40,8 px, marge verticale 46,7 px.
 * Provenance détaillée dans `LAYOUT_PROVENANCE` ; aucune valeur en rem ni en pourcentage en dur.
 */
export const LAYOUT_LOGICAL = {
  horizontalMarginPx: 69,
  fontPx: 26,
  lineHeightPx: 40.8,
  verticalMarginPx: 46.7,
} as const;

export type ProvenanceStatus = "hypothèse" | "mesuré";

/**
 * Référence du modèle `config.tjs` du jeu (fichier local, **non commité**) : valeurs réellement lues,
 * avec l'empreinte du fichier utilisé. `defaultLineSpacing = 18` s'ajoute à `defaultFontSize = 26`
 * → interligne 44 px logiques ; `defaultPitch = 1` confirme un pas de glyphe d'un em.
 */
export const CONFIG_TJS_REFERENCE = {
  path: "…/mahoyo-web-poc/tools/output/decrypted/data/override/config.tjs",
  sha256: "82ea1af8b44663097027965ba4e868e3e402b487b853298a5c2df4b2e6006893",
  marginL: 142,
  marginR: 142,
  marginT: 69,
  marginB: 69,
  mw: 1024,
  mh: 576,
  defaultFontSize: 26,
  defaultLineSpacing: 18,
  defaultPitch: 1,
  frameGraphic: "txtwindow01",
} as const;

/** Interligne déduit de `config.tjs` : police 26 + line spacing 18 = 44 px logiques. */
export const CONFIG_LINE_HEIGHT_PX =
  CONFIG_TJS_REFERENCE.defaultFontSize + CONFIG_TJS_REFERENCE.defaultLineSpacing;

/**
 * Une entrée de provenance de mise en page : valeur **appliquée** (calibrée capture), valeur du
 * **modèle** `config.tjs`, source, mesure de capture, tolérance et divergence éventuelle.
 */
export type LayoutProvenanceEntry = {
  parameter: string;
  /** Valeur appliquée, calibrée sur la capture (oracle). */
  logicalPx: number;
  /** Valeur du modèle `config.tjs` (px logiques), quand elle existe. */
  configLogicalPx: number | null;
  screenPx: number;
  source: string;
  capture: string;
  tolerance: string;
  status: ProvenanceStatus;
  /** Explication de l'écart modèle/capture, ou "aucun écart". */
  divergence: string;
};

const CONFIG_SHA = `config.tjs local (sha256 ${CONFIG_TJS_REFERENCE.sha256.slice(0, 12)}…)`;
const OVERRIDE_HYPOTHESIS =
  "Écart **non tranché** : version localisée/override, `@position frame=…` ou graphique de cadre (`frameGraphic`) peuvent expliquer que la capture ne montre pas la valeur du modèle ; règle retenue : config = modèle, capture = oracle → valeur appliquée calibrée capture.";

/**
 * Provenance des valeurs de mise en page. Règle Opus 5.5 : **config = modèle, capture = oracle**.
 * Les valeurs appliquées restent calibrées sur la capture (statut `hypothèse`), la valeur du modèle
 * `config.tjs` est conservée en regard et la divergence est documentée, pas tranchée arbitrairement.
 * Aucune valeur n'est ajustée par scène.
 */
export const LAYOUT_PROVENANCE: LayoutProvenanceEntry[] = [
  {
    parameter: "marge horizontale (gauche et droite)",
    logicalPx: LAYOUT_LOGICAL.horizontalMarginPx,
    configLogicalPx: Math.max(CONFIG_TJS_REFERENCE.marginL, CONFIG_TJS_REFERENCE.marginR),
    screenPx: stageToScreenPx(LAYOUT_LOGICAL.horizontalMarginPx),
    source: `${CONFIG_SHA} : marginL = 142, marginR = 142 (ordre du fichier L, R, T, B — aucune inversion)`,
    capture: "marge gauche mesurée 85,4 px écran / 1,25 = 68,3 ≈ 69 px logiques",
    tolerance: "±2 %",
    status: "hypothèse",
    divergence: `Modèle 142 vs capture ≈69. ${OVERRIDE_HYPOTHESIS}`,
  },
  {
    parameter: "taille de police nominale",
    logicalPx: LAYOUT_LOGICAL.fontPx,
    configLogicalPx: CONFIG_TJS_REFERENCE.defaultFontSize,
    screenPx: stageToScreenPx(LAYOUT_LOGICAL.fontPx),
    source: `${CONFIG_SHA} : defaultFontSize = 26 (× STAGE_SCALE = 32,5 px écran)`,
    capture: "le pas des glyphes (≈ 1 em) et les caractères/ligne se déduisent de la taille em, pas de l'encre",
    tolerance: "±2 % sur le pas des glyphes",
    status: "hypothèse",
    divergence: "Aucun écart : modèle 26 = valeur appliquée 26.",
  },
  {
    parameter: "interligne",
    logicalPx: LAYOUT_LOGICAL.lineHeightPx,
    configLogicalPx: CONFIG_LINE_HEIGHT_PX,
    screenPx: stageToScreenPx(LAYOUT_LOGICAL.lineHeightPx),
    source: `${CONFIG_SHA} : defaultFontSize 26 + defaultLineSpacing 18 = 44`,
    capture: "capture #173 : interligne 51 px écran (77/1080) / 1,25 = 40,8 px logiques",
    tolerance: "±2 %",
    status: "hypothèse",
    divergence: `Modèle 44 vs capture 40,8. ${OVERRIDE_HYPOTHESIS}`,
  },
  {
    parameter: "marge verticale (haut et bas)",
    logicalPx: LAYOUT_LOGICAL.verticalMarginPx,
    configLogicalPx: Math.max(CONFIG_TJS_REFERENCE.marginT, CONFIG_TJS_REFERENCE.marginB),
    screenPx: stageToScreenPx(LAYOUT_LOGICAL.verticalMarginPx),
    source: `${CONFIG_SHA} : marginT = 69, marginB = 69`,
    capture: "capture #173 : haut de zone à 8,1 % × 576 = 46,7 px logiques",
    tolerance: "±2 %",
    status: "hypothèse",
    divergence: `Modèle 69 vs capture 46,7. ${OVERRIDE_HYPOTHESIS}`,
  },
];

/** Hauteur disponible pour le texte dans le cadre image (px du stage). */
export function textAreaHeightStagePx(stageHeight = STAGE_SIZE.height): number {
  return frameTextAreaHeight(stageHeight);
}

/** Ligne de base : `line-height` CSS (sans unité) × taille de police du stage. */
export function lineHeightStagePx(fontSizeStagePx = NOMINAL_STAGE_PX): number {
  return fontSizeStagePx * FRAME_TEXT_LINE_HEIGHT;
}

/** Convertit une longueur du repère du stage (1024×576) vers l'écran (viewport 1280×720). */
export function stageToScreenPx(stagePx: number): number {
  return stagePx * STAGE_SCALE;
}

/**
 * Conversion **proposée** d'une taille `@font size=` (px du repère 1280×720 d'origine) vers la
 * taille CSS à poser dans le stage : ×(1024/1280) = ×0,8. Aucune constante par scène.
 */
export function scriptFontSizeToStageCssPx(scriptPx: number): number {
  return (scriptPx * STAGE_SIZE.width) / ORIGINAL_SIZE.width;
}

/** Taille CSS actuellement posée par le port pour une taille `@font size=` (px du stage, non convertie). */
export function currentPortFontCssPx(scriptPx: number): number {
  return scriptPx;
}

/** Comparaison des trois tailles pour une taille de script donnée. */
export type FontSizeComparison = {
  /** Taille écrite dans le script (`@font size=`), px du repère 1280×720. */
  scriptPx: number;
  /** Taille écran attendue si le script est en 1280×720. */
  expectedScreenPx: number;
  /** Taille CSS actuelle du port dans le stage. */
  currentStageCssPx: number;
  /** Taille écran actuelle (CSS stage × 1,25). */
  currentScreenPx: number;
  /** Taille CSS proposée dans le stage (×0,8). */
  proposedStageCssPx: number;
  /** Taille écran proposée (×1,25 → identique à la taille du script). */
  proposedScreenPx: number;
  /** Écart relatif de la taille écran actuelle vs attendue (+25 % attendu). */
  currentRatio: number;
};

export function compareFontSize(scriptPx: number): FontSizeComparison {
  const expectedScreenPx = scriptPx;
  const currentStageCssPx = currentPortFontCssPx(scriptPx);
  const currentScreenPx = stageToScreenPx(currentStageCssPx);
  const proposedStageCssPx = scriptFontSizeToStageCssPx(scriptPx);
  const proposedScreenPx = stageToScreenPx(proposedStageCssPx);
  return {
    scriptPx,
    expectedScreenPx,
    currentStageCssPx,
    currentScreenPx,
    proposedStageCssPx,
    proposedScreenPx,
    currentRatio: currentScreenPx / expectedScreenPx,
  };
}

// ── Extraction des pages de texte ─────────────────────────────────────────────

/** Fragment de texte d'une page, avec la taille `@font size=` éventuelle (px du repère original). */
export type TextRun = { text: string; scriptSize?: number };

/** Une page de texte affichée au joueur (entre deux points de clic). */
export type TextPage = {
  script: string;
  /** Index de la page dans le script (0-based). */
  page: number;
  /** Index d'instruction dans la page. */
  instruction: number;
  /** Texte de la page, `\n` pour les sauts `[l]` (jamais inclus dans les rapports). */
  text: string;
  /** Fragments et tailles `@font size=` rencontrés, pour reconstruire la page à mesurer. */
  runs: TextRun[];
  /** Tailles `@font size=` rencontrées (px du repère original), dans l'ordre. */
  scriptSizes: number[];
  /** Nombre de caractères (hors espaces) — sert au tri des pages les plus denses. */
  nonSpaceChars: number;
};

/** Métadonnées d'une page **sans son texte**, seules autorisées dans un rapport (copyright). */
export type TextPageMeta = Pick<TextPage, "script" | "page" | "instruction" | "scriptSizes" | "nonSpaceChars">;

export function pageMeta(page: TextPage): TextPageMeta {
  return {
    script: page.script,
    page: page.page,
    instruction: page.instruction,
    scriptSizes: page.scriptSizes,
    nonSpaceChars: page.nonSpaceChars,
  };
}

/** Options d'extraction : borne le nombre de pages et les étapes par script. */
export type ExtractPagesOptions = {
  maxPagesPerScript?: number;
  maxSteps?: number;
};

/** Séquences d'échappement pour `textContent` (les pages sont mesurées en DOM, jamais rendues). */
function segmentText(segments: readonly import("../src/kag/types.js").TextSegment[]): string {
  let out = "";
  for (const segment of segments) {
    if ("text" in segment) out += segment.text;
    // Images inline et marqueurs emoji : un caractère de remplacement suffit à occuper la place.
    else if ("graph" in segment) out += "■";
  }
  return out;
}

/**
 * Rejoue un script en headless et renvoie ses pages de texte telles que le joueur les voit
 * (texte accumulé jusqu'au point d'arrêt, `\n` pour les sauts de ligne explicites).
 * Pur vis-à-vis du DOM ; ne conserve pas les assets.
 */
export function extractTextPages(
  scriptText: string,
  fileName: string,
  options: ExtractPagesOptions = {},
): TextPage[] {
  const maxPages = options.maxPagesPerScript ?? 10_000;
  const maxSteps = options.maxSteps ?? 20_000;
  const runtime = new Runtime(parse(lex(scriptText)), fileName);
  runtime.onWarning = () => undefined;
  runtime.scriptLoader = async () => null;

  const pages: TextPage[] = [];
  let runs: TextRun[] = [];
  let pageIndex = 0;
  let instruction = 0;

  const finalize = (): void => {
    const text = runs.map((r) => r.text).join("");
    if (text === "") return;
    pages.push({
      script: fileName,
      page: pageIndex++,
      instruction,
      text,
      runs,
      scriptSizes: runs.filter((r) => r.scriptSize !== undefined).map((r) => r.scriptSize!),
      nonSpaceChars: text.replace(/\s/g, "").length,
    });
    runs = [];
    if (pages.length >= maxPages) return;
  };

  for (let steps = 0; steps < maxSteps; steps++) {
    if (pages.length >= maxPages) break;
    const step = runtime.step();
    instruction = step.position.instruction;
    for (const event of step.events as readonly RenderEvent[]) {
      if (event.kind === "clearText") {
        finalize();
      } else if (event.kind === "text") {
        for (const segment of event.segments) {
          const text = segmentText([segment]);
          if (text === "") continue;
          runs.push({ text, scriptSize: "text" in segment ? segment.style?.size : undefined });
        }
      } else if (event.kind === "lineBreak") {
        runs.push({ text: "\n" });
      }
    }
    if (step.stop.kind === "click") {
      // `[l]` = attente en cours de page : le renderer continue le texte **sur la même ligne** (seul
      // l'événement `lineBreak`, produit par un saut de ligne du script ou `[r]`, ajoute un `\n`),
      // donc on ne termine pas la page et on n'ajoute pas de saut ici.
      if (step.stop.style !== "line") finalize();
    } else if (step.stop.kind === "choice") {
      finalize();
    }
    if (step.stop.kind === "end") {
      finalize();
      break;
    }
  }
  return pages;
}

// ── Verdict de débordement ────────────────────────────────────────────────────

/** Mesure rendue d'une page dans un navigateur (exprimée en px du stage, comme la boîte). */
export type PageMeasurement = {
  /** Hauteur du contenu à la taille nominale (px du stage). */
  nominalHeightPx: number;
  /** Hauteur de la zone de texte du cadre (px du stage). */
  areaHeightPx: number;
  /** Largeur du contenu > largeur de la zone (mot insécable, image…). */
  widthOverflow: boolean;
};

export type OverflowCause = "ok" | "hauteur" | "largeur" | "les-deux";

export type PageVerdict = PageMeasurement & {
  page: TextPage;
  /** Marge de sécurité en px du stage : positive = il reste de la place. */
  safetyPx: number;
  /** Ratio hauteur/zone (> 1 = déborde à la taille nominale). */
  fillRatio: number;
  overflow: boolean;
  cause: OverflowCause;
};

/** Classe une mesure de page : déborde si le contenu dépasse la zone (hauteur ou largeur). */
export function classifyMeasurement(page: TextPage, measurement: PageMeasurement): PageVerdict {
  const overflowHeight = measurement.nominalHeightPx > measurement.areaHeightPx + 0.5;
  const overflowWidth = measurement.widthOverflow;
  const cause: OverflowCause =
    overflowHeight && overflowWidth ? "les-deux" : overflowHeight ? "hauteur" : overflowWidth ? "largeur" : "ok";
  return {
    ...measurement,
    page,
    safetyPx: measurement.areaHeightPx - measurement.nominalHeightPx,
    fillRatio: measurement.areaHeightPx > 0 ? measurement.nominalHeightPx / measurement.areaHeightPx : 0,
    overflow: overflowHeight || overflowWidth,
    cause,
  };
}

export type OverflowSummary = {
  pages: number;
  overflowing: number;
  overflowRatio: number;
  byCause: Record<OverflowCause, number>;
  /** p95 du taux de remplissage (0 si aucune page). */
  p95FillRatio: number;
  /** Marge minimale observée (px du stage, peut être négative). */
  worstSafetyPx: number;
  /** 10 pages les plus remplies (sans texte du jeu dans le rapport). */
  worstPages: PageVerdict[];
};

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - index) + sorted[hi]! * (index - lo);
}

export function summarizeVerdicts(verdicts: readonly PageVerdict[], worstCount = 10): OverflowSummary {
  const byCause: Record<OverflowCause, number> = { ok: 0, hauteur: 0, largeur: 0, "les-deux": 0 };
  for (const verdict of verdicts) byCause[verdict.cause]++;
  const overflowing = verdicts.filter((v) => v.overflow).length;
  const worst = [...verdicts].sort((a, b) => b.fillRatio - a.fillRatio).slice(0, worstCount);
  return {
    pages: verdicts.length,
    overflowing,
    overflowRatio: verdicts.length > 0 ? overflowing / verdicts.length : 0,
    byCause,
    p95FillRatio: percentile(
      verdicts.map((v) => v.fillRatio),
      0.95,
    ),
    worstSafetyPx: verdicts.length > 0 ? Math.min(...verdicts.map((v) => v.safetyPx)) : 0,
    worstPages: worst,
  };
}

// ── Rapport (JSON + Markdown) ─────────────────────────────────────────────────

export type NominalSceneAnalysis = {
  script: string;
  page: number;
  /** Tailles `@font size=` du script sur la page (px du repère 1280×720). */
  scriptSizes: number[];
  comparisons: FontSizeComparison[];
  /** Mesures navigateur (px écran) pour les caractères de référence, si disponibles. */
  measured?: {
    char: string;
    /** Hauteur de capitale (M) ou hauteur d'x (x) mesurée à l'écran, taille port actuelle. */
    currentScreenPx: number;
    /** Même mesure avec la taille convertie proposée. */
    proposedScreenPx: number;
    /** Police effectivement résolue par le navigateur. */
    resolvedFontFamily: string;
  }[];
};

export type BrowserOverflowReport = {
  browser: string;
  /** Config actuelle du port (marge 14 %, police 1,7 rem). */
  verdicts: PageVerdict[];
  summary: OverflowSummary;
  /** Config logique proposée (marge 69 px, police 26 px), mesurée dans le même navigateur. */
  proposed: { verdicts: PageVerdict[]; summary: OverflowSummary } | null;
};

/** Mesure de glyphes de référence (M, x, あ) à une taille de police donnée. */
export type GlyphProbe = {
  browser: string;
  fontFamily: string;
  /** Taille CSS mesurée dans le stage (px du repère 1024×576). */
  stageFontPx: number;
  /** Taille à l'écran (px), stage × 1,25. */
  screenFontPx: number;
  entries: { char: string; ascentPx: number; descentPx: number; widthPx: number }[];
};

/** Mesures de validation de la mise en page logique (pas des glyphes, caractères/ligne, symétrie, lignes). */
export type LayoutValidation = {
  /** Pas des glyphes (1 em attendu = taille de police logique), mesuré à la police proposée. */
  glyphPitch: {
    fontLogicalPx: number;
    expectedStagePx: number;
    measuredStagePx: number;
    ratio: number;
    tolerance: number;
    ok: boolean;
  } | null;
  /** Caractères par ligne : port actuel, config proposée, attente d'après la largeur logique. */
  charsPerLine: {
    currentPort: number;
    proposed: number;
    expectedOriginal: number;
    widthCurrentStagePx: number;
    widthProposedStagePx: number;
  };
  /** Symétrie des marges : x_min et W − x_max doivent être égaux. */
  marginSymmetry: {
    leftStagePx: number;
    rightStagePx: number;
    deltaStagePx: number;
    ok: boolean;
  };
  /** Lignes par page (déduites de la hauteur mesurée / interligne logique). */
  linesPerPage: { currentP95: number; proposedP95: number };
  /** Écart d'encre (x-height/capitale) vs original : cosmétique, ne change pas la taille em. */
  inkRatio: number;
};

export type TextOverflowReport = {
  generatedAt: string;
  mode: "assets" | "placeholders";
  assetsDir: string | null;
  scenarioDir: string | null;
  scripts: number;
  pages: number;
  /** Nombre de pages par navigateur ayant servi à la mesure. */
  measuredPages: number;
  browsers: BrowserOverflowReport[];
  nominal: NominalSceneAnalysis[];
  /** Glyphes mesurés (mêmes caractères) à la police actuelle et à la police recommandée. */
  glyphProbes: GlyphProbe[];
  /** Constantes du port utilisées pour la mesure (px du stage). */
  box: { nominalFontPx: number; lineHeight: number; areaHeightPx: number; leftMarginStagePx: number };
  /** Ce que l'original laisse comme marge gauche (mesure vidéo du propriétaire, cf. #319). */
  originalMarginScreenPx: number;
  /** Écart de marge gauche du port vs original (px écran). */
  marginDeltaScreenPx: number;
  /** Mise en page logique proposée et sa provenance (aucune constante par scène). */
  layout: LayoutProvenanceEntry[];
  /** Mesures de validation de la mise en page proposée. */
  validation: LayoutValidation | null;
  /** Snapshot versionné des pages restant en débordement avec la config proposée (si écrit). */
  snapshot: { path: string; count: number } | null;
  warnings: string[];
};

/** Marge gauche actuelle du texte à l'écran (px), d'après `FRAME_TEXT_AREA.left`. */
export function currentLeftMarginScreenPx(): number {
  return stageToScreenPx(FRAME_TEXT_AREA.left * STAGE_SIZE.width);
}

/**
 * Marge gauche de l'original, d'après la mesure vidéo de #319 : 114 px sur une vidéo normalisée à
 * 1708 px de large, ramenée au viewport 1280×720. Référence de comparaison, pas une constante de rendu.
 */
export function originalLeftMarginScreenPx(reference = { left: 114, width: 1708 }): number {
  return (reference.left / reference.width) * ORIGINAL_SIZE.width;
}

/** Échappe un texte pour insertion dans un rapport Markdown (sans altérer le contenu). */
export function mdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Rend le rapport Markdown (aucun texte du jeu : noms de scripts, positions, métriques). */
export function buildMarkdownReport(report: TextOverflowReport): string {
  const lines: string[] = [];
  lines.push("# Débordement du texte sur le corpus — rapport de mesure");
  lines.push("");
  lines.push(`Généré par \`npm run text:overflow\` le ${report.generatedAt}.`);
  lines.push("");
  lines.push("## Contexte");
  lines.push("");
  lines.push(`- Mode : **${report.mode === "assets" ? "assets réels locaux" : "placeholders (rapport partiel)"}**`);
  lines.push(`- Corpus : ${report.scripts} script(s), ${report.pages} page(s) de texte, ${report.measuredPages} mesurée(s) au navigateur`);
  lines.push(
    `- Boîte mesurée : police nominale ${report.box.nominalFontPx.toFixed(1)} px (stage), interligne ` +
      `${report.box.lineHeight.toFixed(1)} px, hauteur de zone ${report.box.areaHeightPx.toFixed(1)} px (stage)`,
  );
  lines.push(
    `- Marge gauche du port : ${report.box.leftMarginStagePx.toFixed(1)} px (stage) = ` +
      `${stageToScreenPx(report.box.leftMarginStagePx).toFixed(1)} px écran ; original mesuré ~` +
      `${report.originalMarginScreenPx.toFixed(1)} px écran → écart ${report.marginDeltaScreenPx.toFixed(1)} px`,
  );
  lines.push(
    `- Mise en page logique proposée : marge horizontale **${LAYOUT_LOGICAL.horizontalMarginPx} px logiques** ` +
      `(${stageToScreenPx(LAYOUT_LOGICAL.horizontalMarginPx).toFixed(1)} px écran), police **${LAYOUT_LOGICAL.fontPx} px logiques** ` +
      `(${stageToScreenPx(LAYOUT_LOGICAL.fontPx).toFixed(1)} px écran), interligne ${LAYOUT_LOGICAL.lineHeightPx} px logiques, ` +
      `marge verticale ${LAYOUT_LOGICAL.verticalMarginPx} px logiques`,
  );
  lines.push("");
  if (report.warnings.length > 0) {
    lines.push("## Avertissements");
    lines.push("");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  for (const browser of report.browsers) {
    lines.push(`## Navigateur : ${browser.browser}`);
    lines.push("");
    const current = browser.summary;
    lines.push("### Config actuelle du port (marge 14 %, police 1,7 rem)");
    lines.push("");
    lines.push(`- Pages mesurées : **${current.pages}**`);
    lines.push(`- Pages en débordement à la taille nominale : **${current.overflowing}** (${(current.overflowRatio * 100).toFixed(2)} %)`);
    lines.push(`- Causes : hauteur ${current.byCause.hauteur}, largeur ${current.byCause.largeur}, les deux ${current.byCause["les-deux"]}`);
    lines.push(`- p95 du taux de remplissage : ${(current.p95FillRatio * 100).toFixed(1)} % ; marge minimale : ${current.worstSafetyPx.toFixed(1)} px (stage)`);
    lines.push("");
    if (current.worstPages.length > 0) {
      lines.push("| Script | Page | Caractères | Remplissage | Marge (px stage) | Cause |");
      lines.push("|---|---|---|---|---|---|");
      for (const v of current.worstPages) {
        lines.push(
          `| ${mdCell(v.page.script)} | ${v.page.page} | ${v.page.nonSpaceChars} | ${(v.fillRatio * 100).toFixed(1)} % | ` +
            `${v.safetyPx.toFixed(1)} | ${v.cause} |`,
        );
      }
      lines.push("");
    }
    if (browser.proposed) {
      const proposed = browser.proposed.summary;
      lines.push("### Config logique proposée (marge 69 px, police 26 px)");
      lines.push("");
      lines.push(`- Pages en débordement : **${proposed.overflowing}** (${(proposed.overflowRatio * 100).toFixed(2)} %)`);
      lines.push(`- p95 du taux de remplissage : ${(proposed.p95FillRatio * 100).toFixed(1)} % ; marge minimale : ${proposed.worstSafetyPx.toFixed(1)} px (stage)`);
      lines.push("");
      const remaining = browser.proposed.verdicts.filter((v) => v.overflow);
      if (remaining.length > 0) {
        lines.push("| Script | Page | Caractères | Remplissage | Marge (px stage) | Lignes |");
        lines.push("|---|---|---|---|---|---|");
        for (const v of remaining) {
          const linesCount = Math.max(1, Math.round(v.nominalHeightPx / 39));
          lines.push(
            `| ${mdCell(v.page.script)} | ${v.page.page} | ${v.page.nonSpaceChars} | ${(v.fillRatio * 100).toFixed(1)} % | ` +
              `${v.safetyPx.toFixed(1)} | ${linesCount} |`,
          );
        }
        lines.push("");
      }
    }
  }

  lines.push("## Mise en page logique proposée et provenance");
  lines.push("");
  lines.push("Aucune valeur en rem ni en pourcentage en dur : les marges et la police sont exprimées en");
  lines.push("**unités logiques** du stage (repère 1024×576), converties à l'écran par `STAGE_SCALE`.");
  lines.push("");
  lines.push(
    `Règle de provenance : **config = modèle, capture = oracle**. Le modèle est le \`config.tjs\` local ` +
      `(sha256 \`${CONFIG_TJS_REFERENCE.sha256}\`, non commité) : mw = ${CONFIG_TJS_REFERENCE.mw}, ` +
      `mh = ${CONFIG_TJS_REFERENCE.mh}, marginL/R = ${CONFIG_TJS_REFERENCE.marginL}/${CONFIG_TJS_REFERENCE.marginR}, ` +
      `marginT/B = ${CONFIG_TJS_REFERENCE.marginT}/${CONFIG_TJS_REFERENCE.marginB}, ` +
      `defaultFontSize = ${CONFIG_TJS_REFERENCE.defaultFontSize}, defaultLineSpacing = ${CONFIG_TJS_REFERENCE.defaultLineSpacing} ` +
      `(→ interligne ${CONFIG_LINE_HEIGHT_PX}), defaultPitch = ${CONFIG_TJS_REFERENCE.defaultPitch}, ` +
      `frameGraphic = "${CONFIG_TJS_REFERENCE.frameGraphic}". ` +
      "La capture contredit partiellement ce modèle : les valeurs **appliquées** restent calibrées sur la capture " +
      "(oracle), statut `hypothèse`, et la divergence est documentée, pas tranchée.",
  );
  lines.push("");
  lines.push("| Paramètre | Appliqué (capture, px logiques) | Config.tjs (modèle, px logiques) | Écran (px) | Tolérance | Divergence |");
  lines.push("|---|---|---|---|---|---|");
  for (const entry of report.layout) {
    lines.push(
      `| ${mdCell(entry.parameter)} | **${entry.logicalPx}** | ${entry.configLogicalPx ?? "n/a"} | ${entry.screenPx.toFixed(1)} | ` +
        `${mdCell(entry.tolerance)} | ${mdCell(entry.divergence)} |`,
    );
  }
  lines.push("");
  lines.push("Le détail de la source est dans `docs/TEXTE_DEBORDEMENT.md` ; aucune valeur n'est ajustée par scène.");
  lines.push("");
  if (report.validation) {
    const v = report.validation;
    lines.push("## Mesures de validation");
    lines.push("");
    lines.push("| Contrôle | Attendu | Mesuré | Verdict |");
    lines.push("|---|---|---|---|");
    if (v.glyphPitch) {
      lines.push(
        `| Pas des glyphes (1 em) à ${v.glyphPitch.fontLogicalPx} px logiques | ` +
          `${v.glyphPitch.expectedStagePx.toFixed(1)} px stage / ${stageToScreenPx(v.glyphPitch.expectedStagePx).toFixed(1)} px écran ±${(v.glyphPitch.tolerance * 100).toFixed(0)} % | ` +
          `${v.glyphPitch.measuredStagePx.toFixed(1)} px stage (×${v.glyphPitch.ratio.toFixed(3)}) | ${v.glyphPitch.ok ? "✓" : "✗"} |`,
      );
    }
    lines.push(
      `| Caractères par ligne | proposé ${v.charsPerLine.proposed} (attendu original ${v.charsPerLine.expectedOriginal}) | ` +
        `port actuel ${v.charsPerLine.currentPort} — largeurs ${v.charsPerLine.widthCurrentStagePx.toFixed(0)} / ` +
        `${v.charsPerLine.widthProposedStagePx.toFixed(0)} px stage | ${v.charsPerLine.proposed === v.charsPerLine.expectedOriginal ? "✓" : "≈"} |`,
    );
    lines.push(
      `| Symétrie des marges (x_min ≈ W − x_max) | ${v.marginSymmetry.leftStagePx.toFixed(1)} ≈ ${v.marginSymmetry.rightStagePx.toFixed(1)} px | ` +
        `écart ${v.marginSymmetry.deltaStagePx.toFixed(2)} px | ${v.marginSymmetry.ok ? "✓" : "✗"} |`,
    );
    lines.push(
      `| Lignes par page (p95) | config proposée | actuelle ${v.linesPerPage.currentP95.toFixed(1)} → proposée ${v.linesPerPage.proposedP95.toFixed(1)} | — |`,
    );
    lines.push(
      `| Pitch du modèle (\`defaultPitch\`) | ${CONFIG_TJS_REFERENCE.defaultPitch} (pas d'un em) | pas mesuré ×${v.glyphPitch ? v.glyphPitch.ratio.toFixed(3) : "n/a"} | ${v.glyphPitch?.ok ? "✓" : "—"} |`,
    );
    lines.push("");
    lines.push(
      `Écart d'encre (x-height/capitale) port/original mesuré par le propriétaire : **×${v.inkRatio.toFixed(3)}** — ` +
        "c'est un écart **cosmétique** (approximation `text-font-metrics`, `size-adjust` éventuel) ; il ne modifie ni la " +
        "taille em ni le pas des glyphes, donc il ne justifie **pas** de réduire la police.",
    );
    lines.push("");
  }

  lines.push("## Taille nominale : écart d'encre vs taille em");
  lines.push("");
  lines.push("Le moteur du jeu travaille en **1024×576** (docs/KAG_MAHOYO_SEMANTICS.md §1) ; le stage du port");
  lines.push("reprend ce repère, agrandi ×1,25. Une taille `@font size=` est donc en px logiques : la taille");
  lines.push("CSS du stage est la taille du script (identité), la taille écran vaut ×1,25. Le corpus narratif");
  lines.push("mesuré **n'utilise aucun `@font size=`** : la taille nominale est la constante du port");
  lines.push(`(\`FRAME_TEXT_REM\` = 1,7 rem = ${(FRAME_TEXT_REM * 16).toFixed(1)} px logiques = ${stageToScreenPx(FRAME_TEXT_REM * 16).toFixed(1)} px écran).`);
  lines.push("");
  lines.push("Le ratio d'encre de ×1,19 mesuré sur les vidéos (port 22 px vs original 18,5 px) porte sur la");
  lines.push("**hauteur d'encre** (x-height/capitale), pas sur la taille em : le pas des glyphes et les");
  lines.push("caractères par ligne restent déterminés par la taille em. Réduire la police à ~1,43 rem");
  lines.push("corrigerait l'encre mais **casserait le nombre de caractères par ligne** — piste écartée.");
  if (report.nominal.some((scene) => scene.comparisons.length > 0)) {
    lines.push("");
    lines.push("| Script | Page | taille script (px) | écran actuel (px) | ratio |");
    lines.push("|---|---|---|---|---|");
    for (const scene of report.nominal) {
      for (const c of scene.comparisons) {
        lines.push(
          `| ${mdCell(scene.script)} | ${scene.page} | ${c.scriptPx} | ${c.currentScreenPx.toFixed(1)} | ×${c.currentRatio.toFixed(3)} |`,
        );
      }
    }
  }
  lines.push("");
  lines.push("## Pagination (pas d'autoshrink)");
  lines.push("");
  lines.push("Les pages qui restent en débordement avec la mise en page logique doivent être **paginées**");
  lines.push("(découpage aux limites de phrase, comme `@cm`/pages du moteur d'origine), jamais rétrécies :");
  lines.push("la police reste constante et la zone de texte ne défile pas en cours de lecture.");
  if (report.snapshot) {
    lines.push("");
    lines.push(`Snapshot versionné des pages restantes : \`${report.snapshot.path}\` (${report.snapshot.count} page(s)).`);
  }
  lines.push("");
  lines.push("## Aucun texte du jeu");
  lines.push("");
  lines.push("Ce rapport ne contient aucun extrait de texte : uniquement des noms de scripts, des positions,");
  lines.push("des tailles et des métriques de mise en page.");
  lines.push("");
  return lines.join("\n");
}
