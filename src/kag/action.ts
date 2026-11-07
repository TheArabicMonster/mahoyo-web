/**
 * Parser des keyframes `@fgact` / `@bgact` de KAG Mahoyo.
 *
 * Format des `keys=` :
 *   keys=(t0,accel0,interp0,p0,p1,...)(t1,accel1,interp1,p0,p1,...)...
 *
 * - Colonne 0 : temps **absolu** en ms (pas relatif).
 * - Colonne 1 : accel (nombre, accélération de l'interp).
 * - Colonne 2 : interp — "l"=linear, "n"=steps(1,end) palier, "~"=warning.
 * - Colonnes 3.. : valeurs des propriétés listées dans `props=`, dans l'ordre,
 *   avec un offset de +3 (la 1ʳᵉ prop = colonne 3).
 *
 * `props=` : liste séparée par `,`. Préfixe `-` = propriété discrète
 * (chaîne/bool, appliquée instantanément, jamais interpolée).
 * Ex. : props=-storage,center,vcenter,opacity,-visible
 *
 * Cellule vide = reprise (carry) de la valeur précédente non-vide.
 * `~` = warning (propriété non supportée, on carry la précédente).
 * `absolute` = z-index.
 * `loop=1` = boucle l'animation.
 *
 * Les noms de storage peuvent contenir des parenthèses (ex. `im12宇宙の果て01(中心無し)`),
 * donc on ne peut pas splitter bêtement sur `(` ou `,` : il faut un scanner
 * à parenthèses équilibrées.
 */
import type { AnimKeyframe } from "./types";

/** En-tête de propriété : nom + nature (discrète ou continue). */
type PropHeader = { name: string; discrete: boolean };

/** Résultat du parsing d'un bloc `keys=`/`props=`. */
export type ParsedAction = {
  keyframes: AnimKeyframe[];
  loop: boolean;
};

/**
 * Découpe `keys=(...)(...)...` en cellules intérieures par keyframe,
 * en gérant les parenthèses imbriquées (noms de storage avec `(中心無し)`).
 */
export function splitKeyframes(keysStr: string): string[][] {
  const frames: string[][] = [];
  let depth = 0;
  let frameStart = -1;
  for (let i = 0; i < keysStr.length; i++) {
    const c = keysStr[i];
    if (c === "(") {
      if (depth === 0) frameStart = i;
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0 && frameStart >= 0) {
        const interior = keysStr.slice(frameStart + 1, i);
        frames.push(splitCells(interior));
        frameStart = -1;
      }
    }
  }
  return frames;
}

/** Sépare les cellules d'une keyframe sur les `,` au niveau 0 (hors sous-parenthèses). */
function splitCells(content: string): string[] {
  const cells: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= content.length; i++) {
    const c = content[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      cells.push(content.slice(start, i));
      start = i + 1;
    } else if (c === undefined) {
      cells.push(content.slice(start, i));
    }
  }
  return cells;
}

/** Parse `props=-storage,center,vcenter,opacity,-visible` en en-têtes. */
export function parsePropHeaders(propsStr: string | undefined): PropHeader[] {
  if (!propsStr) return [];
  return propsStr
    .split(",")
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const discrete = raw.startsWith("-");
      const name = discrete ? raw.slice(1) : raw;
      return { name, discrete };
    });
}

function parseInterp(raw: string | undefined): AnimKeyframe["interp"] {
  const v = (raw ?? "").trim();
  if (v === "n") return "n";
  if (v === "~") return "~";
  return "l"; // "l" ou vide (carry géré plus tard) → défaut linear
}

/** Mappe un nom de prop → valeur typée depuis une cellule brute. */
function coerceProp(
  name: string,
  discrete: boolean,
  raw: string
): { value: string | number | boolean; field: keyof AnimKeyframe } | null {
  if (discrete) {
    switch (name) {
      case "storage":
        return { value: raw, field: "storage" };
      case "visible":
        return { value: raw === "1" || raw === "true", field: "visible" };
      case "type":
        return { value: raw, field: "type" };
      case "effect":
        return { value: raw, field: "effect" };
      case "contrast": {
        // -contrast : discret mais numérique (appliqué instantanément, pas interpolé).
        const n = parseInt(raw, 10);
        return Number.isNaN(n) ? null : { value: n, field: "contrast" };
      }
      default:
        return null; // prop discrète inconnue : ignorée
    }
  }
  switch (name) {
    case "center":
    case "vcenter":
    case "absolute":
    case "contrast": {
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? null : { value: n, field: name as keyof AnimKeyframe };
    }
    case "opacity": {
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? null : { value: n / 255, field: "opacity" };
    }
    case "zoomx":
    case "zoomy": {
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? null : { value: n / 100, field: name as keyof AnimKeyframe };
    }
    case "rotate": {
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : { value: n, field: "rotate" };
    }
    case "left":
    case "top":
    case "srcleft":
    case "srctop": {
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : { value: n, field: name as keyof AnimKeyframe };
    }
    case "srczoomx":
    case "srczoomy": {
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? null : { value: n, field: name as keyof AnimKeyframe };
    }
    default:
      return null; // prop continue inconnue : ignorée
  }
}

/**
 * Parse un bloc `keys=`/`props=` en keyframes résolues (carry appliqué).
 *
 * @param keysStr  contenu de `keys=`
 * @param propsStr contenu de `props=`
 * @returns keyframes + flag loop (loop se passe via l'arg `loop=`, mais on
 *          garde l'API pour le retourner si besoin — ici juste keyframes).
 */
export function parseActionKeys(keysStr: string | undefined, propsStr: string | undefined): AnimKeyframe[] {
  if (!keysStr) return [];
  const rawFrames = splitKeyframes(keysStr);
  if (rawFrames.length === 0) return [];

  const headers = parsePropHeaders(propsStr);

  const keyframes: AnimKeyframe[] = [];
  // Carry des valeurs par index de prop (colonne).
  const carry: Array<string | number | boolean | undefined> = headers.map(() => undefined);
  // Carry de l'interp (vide = reprise).
  let lastInterp: AnimKeyframe["interp"] = "l";
  let lastAccel = 0;
  let prevTime = 0;

  for (let fi = 0; fi < rawFrames.length; fi++) {
    const cells = rawFrames[fi];
    if (!cells || cells.length === 0) continue;

    const rawTime = (cells[0] ?? "").trim();
    const rawAccel = (cells[1] ?? "").trim();
    const rawInterp = (cells[2] ?? "").trim();

    // Temps absolu. Vide = carry (rare) → on garde prevTime.
    const time = rawTime === "" || rawTime === "~" ? prevTime : parseInt(rawTime, 10) || 0;

    // accel : vide = carry.
    if (rawAccel !== "" && rawAccel !== "~") lastAccel = parseInt(rawAccel, 10) || 0;

    // interp : vide = carry. "~" = warning (on carry + flag).
    if (rawInterp !== "") {
      const parsed = parseInterp(rawInterp);
      if (parsed !== "~") lastInterp = parsed;
      // "~" → on garde lastInterp mais on le signale via le field interp final.
    }
    const interp: AnimKeyframe["interp"] = rawInterp === "~" ? "~" : lastInterp;

    const duration = fi === 0 ? 0 : Math.max(0, time - prevTime);

    const kf: AnimKeyframe = {
      time,
      duration,
      interp,
      easing: interp === "n" ? "steps" : interp === "~" ? "warn" : "linear",
      accel: lastAccel,
    };

    // Props : colonnes 3.. mappées sur headers[0..].
    for (let pi = 0; pi < headers.length; pi++) {
      const header = headers[pi];
      if (!header) continue;
      const raw = (cells[3 + pi] ?? "").trim();
      if (raw === "" || raw === "~") {
        // Carry : appliquer la valeur résolue précédente à la keyframe courante.
        const carried = carry[pi];
        if (carried !== undefined) {
          (kf as Record<string, unknown>)[header.name] = carried;
        }
        continue;
      }
      const coerced = coerceProp(header.name, header.discrete, raw);
      if (!coerced) continue;
      // Stocker la valeur résolue (0..1 pour opacity, 1.0 pour zoom, etc.)
      // dans carry ET sur la keyframe.
      carry[pi] = coerced.value;
      (kf as Record<string, unknown>)[coerced.field] = coerced.value;
    }

    keyframes.push(kf);
    prevTime = time;
  }

  return keyframes;
}

/**
 * Oracle : un échantillon réel de `@fgact` du prologue Mahoyo (ligne 1-0.ks:20)
 * et son parsing attendu. Sert de garde-fou pour la régression du parser.
 */
export const SAMPLE_FGACT = {
  source:
    "@fgact textoff=0 page=back props=-storage,center,vcenter,opacity,-visible " +
    "keys=(0,0,n,im空絵b,512,288,0,1)(450,,l,,,,,)(600,,n,,,,255,)(1050,,l,,,,,)(1200,,n,,,,0,)(1800,,,,,,,) " +
    "loop=1 storage=im空絵b",
  propsStr: "-storage,center,vcenter,opacity,-visible",
  keysStr:
    "(0,0,n,im空絵b,512,288,0,1)(450,,l,,,,,)(600,,n,,,,255,)(1050,,l,,,,,)(1200,,n,,,,0,)(1800,,,,,,,)",
  // Attendu : 6 keyframes, temps absolus, opacity en 0..1, storage carry.
  expected: [
    { time: 0, duration: 0, interp: "n", storage: "im空絵b", center: 512, vcenter: 288, opacity: 0, visible: true },
    { time: 450, duration: 450, interp: "l", storage: "im空絵b", center: 512, vcenter: 288, opacity: 0, visible: true },
    { time: 600, duration: 150, interp: "n", storage: "im空絵b", center: 512, vcenter: 288, opacity: 1, visible: true },
    { time: 1050, duration: 450, interp: "l", storage: "im空絵b", center: 512, vcenter: 288, opacity: 1, visible: true },
    { time: 1200, duration: 150, interp: "n", storage: "im空絵b", center: 512, vcenter: 288, opacity: 0, visible: true },
    { time: 1800, duration: 600, interp: "n", storage: "im空絵b", center: 512, vcenter: 288, opacity: 0, visible: true },
  ] as Array<{ time: number; duration: number; interp: "l" | "n"; storage: string; center: number; vcenter: number; opacity: number; visible: boolean }>,
};

/**
 * Échantillon réel avec parenthèses imbriquées dans le storage
 * (`im12宇宙の果て01(中心無し)`) + prop `absolute` (z-index) + `~` (warning).
 * Ligne 1-0.ks (wik_g-a.ks nearby /宇宙の果て). Garde-fou tokenizer.
 */
export const SAMPLE_FGACT_NESTED_PAREN = {
  keysStr:
    "(0,0,l,im12宇宙の果て01(中心無し),512,288,0,13,,,,nega,62,1)(2500,0,,,,,255,,,5,5,,,)(4600,,,,~,~,,,~,~,~,,,)(5000,,,,,,0,,150,100,100,,,)",
  propsStr:
    "-storage,center,vcenter,opacity,-type,rotate,zoomx,zoomy,-effect,-contrast,-visible",
  // On vérifie surtout : 4 keyframes, storage = "im12宇宙の果て01(中心無し)" intact,
  // temps absolus 0/2500/4600/5000, et la 3e frame interp "~" (warning).
  expectedFrameCount: 4,
  expectedStorage: "im12宇宙の果て01(中心無し)",
};
