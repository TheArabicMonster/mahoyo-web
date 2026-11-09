/**
 * Table des effets d'ambiance du jeu (`data/others/envcolor.ksc`).
 *
 * Fichier de **données** du moteur (non commité, installé par le pipeline) : chaque nom d'effet
 * (`屋外深夜`, `mh屋内曇り`…) mappe un tableau TJS :
 *
 * ```
 * [rgamma, rfloor, rceil, ggamma, gfloor, gceil, bgamma, bfloor, bceil, grayscale,
 *  (r, g, b, alpha, layertype)…]
 * ```
 *
 * Les groupes de 5 à partir de l'indice 10 sont des **calques de couleur translucides** dessinés
 * sur l'image avec un mode de fusion (`layertype` = constante KiriKiri, voir
 * `src/renderer/appearance.ts`). `void` signifie « valeur par défaut » (gamma 1, floor 0,
 * ceil 255). Application de référence : `data/override/animationlayer.override.tjs`,
 * `applyColorCorrection_in_onPaint`.
 */

/** Un calque de couleur translucide d'un effet d'ambiance. */
export type EnvColorBlend = {
  /** Couleur du calque (0-255 par canal). */
  r: number;
  g: number;
  b: number;
  /** Opacité du calque (0-255). */
  alpha: number;
  /** Mode de fusion KiriKiri (même table que `type=`, ex. 2 = alpha, 5 = multiplier). */
  layerType: number;
};

/** Paramètres d'un effet d'ambiance, prêts à être appliqués par le renderer. */
export type EnvColorEffect = {
  /** Gamma par canal (1 = neutre) et bornes (floor/ceil, 0/255 = neutres). */
  rGamma: number;
  rFloor: number;
  rCeil: number;
  gGamma: number;
  gFloor: number;
  gCeil: number;
  bGamma: number;
  bFloor: number;
  bCeil: number;
  /** Niveaux de gris avant la correction gamma (comme `layer.doGrayScale()`). */
  grayscale: boolean;
  /** Calques de couleur appliqués dans l'ordre, après gamma. */
  blends: readonly EnvColorBlend[];
};

/** Table nom d'effet → paramètres. */
export type EnvColorTable = ReadonlyMap<string, EnvColorEffect>;

const DEFAULT_GAMMA = 1;
const DEFAULT_FLOOR = 0;
const DEFAULT_CEIL = 255;

/** Décode un fichier `.ksc` : UTF-16LE avec BOM (format du jeu), sinon UTF-8. */
export function decodeKscText(data: Uint8Array | string): string {
  if (typeof data === "string") return data.replace(/^\uFEFF/, "");
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(data.subarray(2));
  }
  return new TextDecoder("utf-8").decode(data);
}

/**
 * Convertit un littéral numérique TJS en nombre.
 * Gère `void`, les entiers/décimaux et les **flottants hexadécimaux** (`0x1.DC28F5C28F5C3p-1`).
 */
export function parseTjsNumber(token: string): number | undefined {
  const value = token.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (value === "" || value === "void") return undefined;
  const hex = /^([+-]?)0x([0-9a-f]+)(?:\.([0-9a-f]*))?p([+-]?\d+)$/i.exec(value);
  if (hex) {
    const sign = hex[1] === "-" ? -1 : 1;
    const intPart = parseInt(hex[2]!, 16);
    const frac = hex[3] ?? "";
    let fracValue = 0;
    for (let i = 0; i < frac.length; i++) {
      fracValue += parseInt(frac[i]!, 16) / 16 ** (i + 1);
    }
    return sign * (intPart + fracValue) * 2 ** parseInt(hex[4]!, 10);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Découpe le corps d'un tableau TJS en valeurs, en respectant commentaires/parenthèses. */
function splitValues(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "(" ) depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") out.push(current);
  return out;
}

function effectFromValues(values: readonly (number | undefined)[]): EnvColorEffect {
  const at = (i: number): number | undefined => values[i];
  const gamma = (v: number | undefined): number => (v === undefined || v <= 0 ? DEFAULT_GAMMA : v);
  const floor = (v: number | undefined): number => v ?? DEFAULT_FLOOR;
  const ceil = (v: number | undefined): number => v ?? DEFAULT_CEIL;
  const blends: EnvColorBlend[] = [];
  for (let i = 10; i + 4 < values.length; i += 5) {
    const r = at(i);
    const g = at(i + 1);
    const b = at(i + 2);
    const alpha = at(i + 3);
    const layerType = at(i + 4);
    if (r === undefined || g === undefined || b === undefined || alpha === undefined) continue;
    if (alpha <= 0) continue;
    blends.push({ r, g, b, alpha, layerType: layerType ?? 2 });
  }
  return {
    rGamma: gamma(at(0)),
    rFloor: floor(at(1)),
    rCeil: ceil(at(2)),
    gGamma: gamma(at(3)),
    gFloor: floor(at(4)),
    gCeil: ceil(at(5)),
    bGamma: gamma(at(6)),
    bFloor: floor(at(7)),
    bCeil: ceil(at(8)),
    grayscale: (at(9) ?? 0) !== 0,
    blends,
  };
}

/**
 * Parse la table des effets d'ambiance (`envcolor.ksc`). Retourne une table vide si le format
 * n'est pas reconnu (le player continue sans effets d'ambiance, avec un avertissement).
 */
export function parseEnvColor(data: Uint8Array | string): EnvColorTable {
  const text = decodeKscText(data);
  const table = new Map<string, EnvColorEffect>();
  // Entrées : "nom" => (const) [ … ] (les tableaux ne contiennent que des valeurs scalaires).
  const entryRe = /"((?:[^"\\]|\\.)*)"\s*=>\s*\(const\)\s*\[([\s\S]*?)\]/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(text)) !== null) {
    const name = match[1]!;
    const values = splitValues(match[2]!).map(parseTjsNumber);
    if (values.length < 10) continue;
    table.set(name, effectFromValues(values));
  }
  return table;
}
