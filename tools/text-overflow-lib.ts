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
      // `[l]` = attente de fin de ligne : la page continue, on ajoute un saut de ligne pour que la
      // mesure reflète la ligne supplémentaire à l'écran. Les autres clics terminent la page.
      if (step.stop.style === "line") runs.push({ text: "\n" });
      else finalize();
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
  verdicts: PageVerdict[];
  summary: OverflowSummary;
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
  /** Formule et valeurs recommandées (dérivées des mesures de l'original, aucune constante par scène). */
  recommended: {
    /** Police nominale recommandée (rem) : `FRAME_TEXT_REM × ratio de glyphe mesuré`. */
    nominalRem: number;
    /** Taille écran correspondante (px). */
    nominalScreenPx: number;
    /** Marge gauche recommandée (fraction de la scène). */
    leftFraction: number;
    /** Conversion des tailles de script (px repère 1280 → px CSS stage). */
    scriptSizeFactor: number;
  };
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
    const s = browser.summary;
    lines.push(`- Pages mesurées : **${s.pages}**`);
    lines.push(`- Pages en débordement à la taille nominale : **${s.overflowing}** (${(s.overflowRatio * 100).toFixed(2)} %)`);
    lines.push(`- Causes : hauteur ${s.byCause.hauteur}, largeur ${s.byCause.largeur}, les deux ${s.byCause["les-deux"]}`);
    lines.push(`- p95 du taux de remplissage : ${(s.p95FillRatio * 100).toFixed(1)} % ; marge minimale : ${s.worstSafetyPx.toFixed(1)} px (stage)`);
    lines.push("");
    if (s.worstPages.length > 0) {
      lines.push("| Script | Page | Caractères | Remplissage | Marge (px stage) | Cause |");
      lines.push("|---|---|---|---|---|---|");
      for (const v of s.worstPages) {
        lines.push(
          `| ${mdCell(v.page.script)} | ${v.page.page} | ${v.page.nonSpaceChars} | ${(v.fillRatio * 100).toFixed(1)} % | ` +
            `${v.safetyPx.toFixed(1)} | ${v.cause} |`,
        );
      }
      lines.push("");
    }
  }
  lines.push("## Taille nominale : formule de conversion");
  lines.push("");
  lines.push("Repères : le moteur du jeu travaille en **1024×576** (docs/KAG_MAHOYO_SEMANTICS.md §1) et le");
  lines.push("stage du port reprend ce repère, agrandi ×1,25 vers le viewport 1280×720. Une taille");
  lines.push("`@font size=` écrite dans un script est donc déjà en px du repère 1024 : la taille CSS");
  lines.push("du stage est la taille du script (identité), et la taille écran vaut ×1,25. L'hypothèse");
  lines.push("alternative (repère 1280) donnerait ×0,8 ; elle n'est pas retenue pour le corpus actuel.");
  lines.push("");
  lines.push("Sur les pages narratives mesurées, **aucun `@font size=` n'est utilisé** : la seule taille");
  lines.push("est la constante nominale `FRAME_TEXT_REM` (1,7 rem) du port. Le tableau ci-dessous compare");
  lines.push("donc cette constante au ratio de glyphe mesuré sur l'original par le propriétaire (#314).");
  lines.push("");
  lines.push("| Script | Page | taille script (px) | attendu écran (px) | actuel écran (px) | ratio actuel | proposé écran (px) |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const scene of report.nominal) {
    for (const c of scene.comparisons) {
      lines.push(
        `| ${mdCell(scene.script)} | ${scene.page} | ${c.scriptPx} | ${c.expectedScreenPx.toFixed(1)} | ` +
          `${c.currentScreenPx.toFixed(1)} | ×${c.currentRatio.toFixed(3)} | ${c.proposedScreenPx.toFixed(1)} |`,
      );
    }
  }
  lines.push("");
  lines.push(
    `La constante actuelle est ${FRAME_TEXT_REM} rem ≈ ${stageToScreenPx(FRAME_TEXT_REM * 16).toFixed(1)} px écran ; le ratio de glyphe du`,
  );
  lines.push("propriétaire (#314, port 22 px vs original 18,5 px) la recommande à ~1,43 rem (≈ 28,6 px écran).");
  lines.push("Cette conversion est **globale** (aucune constante par scène) ; elle reste à valider par une");
  lines.push("capture comparée de l'original avant correction du runtime (#314).");
  lines.push("");
  if (report.recommended) {
    lines.push(
      `Recommandation : police nominale **${report.recommended.nominalRem.toFixed(2)} rem** ` +
        `(${report.recommended.nominalScreenPx.toFixed(1)} px écran, facteur ×${(report.recommended.nominalRem / FRAME_TEXT_REM).toFixed(3)}), ` +
        `marge gauche **${(report.recommended.leftFraction * 100).toFixed(2)} %** (mesure vidéo 114/1708), ` +
        `conversion des tailles de script ×${report.recommended.scriptSizeFactor.toFixed(2)} si le repère du script est 1280.`,
    );
    lines.push("");
  }
  if (report.glyphProbes.length > 0) {
    lines.push("### Glyphes mesurés (mêmes caractères, tailles comparées)");
    lines.push("");
    lines.push("| Navigateur | Police résolue | Police CSS (stage px) | Écran (px) | Caractère | Hauteur mesurée (écran px) |");
    lines.push("|---|---|---|---|---|---|");
    for (const probe of report.glyphProbes) {
      for (const entry of probe.entries) {
        const h = (entry.ascentPx + entry.descentPx) * STAGE_SCALE;
        lines.push(
          `| ${mdCell(probe.browser)} | ${mdCell(probe.fontFamily)} | ${probe.stageFontPx.toFixed(1)} | ` +
            `${probe.screenFontPx.toFixed(1)} | ${mdCell(entry.char)} | ${h.toFixed(1)} |`,
        );
      }
    }
    lines.push("");
  }
  lines.push("## Marge gauche");
  lines.push("");
  lines.push(
    `` +
      `Le port place le texte à ${(FRAME_TEXT_AREA.left * 100).toFixed(2)} % de la largeur du stage. La mesure vidéo de l'original ` +
      `(#319) donne ~${report.originalMarginScreenPx.toFixed(1)} px écran (114/1708×1280), soit ` +
      `${((report.originalMarginScreenPx / ORIGINAL_SIZE.width) * 100).toFixed(2)} % : la zone du port réduit la largeur ` +
      `utile et provoque des retours à la ligne supplémentaires.`,
  );
  lines.push("");
  lines.push("## Aucun texte du jeu");
  lines.push("");
  lines.push("Ce rapport ne contient aucun extrait de texte : uniquement des noms de scripts, des positions,");
  lines.push("des tailles et des métriques de mise en page.");
  lines.push("");
  return lines.join("\n");
}
