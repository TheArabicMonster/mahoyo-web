export type Token =
  | { type: "command"; name: string; args: Record<string, string> }
  | { type: "tag"; name: string; args: Record<string, string> }
  | { type: "label"; name: string }
  | { type: "text"; content: string }
  | { type: "comment"; content: string }
  | { type: "linebreak" };

/**
 * Style du texte posé par @font (sous-ensemble de la balise [font] de KAG3).
 * Seuls les champs renseignés modifient le style courant.
 */
export type TextStyle = {
  face?: string;
  size?: number;
  /** Couleur au format `#rrggbb`. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  edge?: boolean;
  /** Couleur du contour au format `#rrggbb`. */
  edgeColor?: string;
  shadow?: boolean;
  shadowColor?: string;
};

/** Segment de texte avec annotation ruby et style optionnels */
export type TextSegment =
  | { text: string; ruby?: undefined; style?: TextStyle }
  | { text: string; ruby: string; style?: TextStyle }
  | { pause: true };

/** Métadonnées de crop pour un calque partbg (@partbg). */
export type CropSpec = {
  /** Largeur du viewport de crop (px, repère 1024×576). */
  width: number;
  /** Hauteur du viewport de crop (px). */
  height: number;
  /** Offset source horizontal (px) — l'image est translatée de -srcLeft. */
  srcLeft: number;
  /** Offset source vertical (px). */
  srcTop: number;
  /** Zoom source X (100 = 1.0). */
  srcZoomX: number;
  /** Zoom source Y (100 = 1.0). */
  srcZoomY: number;
  /** Fond derrière le crop (storage). */
  bgStorage?: string;
};

export type Layer = {
  /** Identité stable du calque : id= explicite, sinon storage. Jamais parseInt. */
  id: string;
  storage: string;
  center: number;
  vcenter: number;
  /** z-index (= index= / absolute=). */
  index: number;
  opacity: number;
  /** Si défini, ce calque est un partbg (crop viewport @partbg). */
  crop?: CropSpec;
  /** Pour @fg/@fgact partbgid= : id du partbg parent (clipage). */
  partbgId?: string;
  /**
   * Zoom en % (100 = taille d'origine, négatif = miroir) et rotation en degrés (sens horaire),
   * autour du centre de l'image. Absents = neutres (100 %, 0°) ; un calque neutre n'en porte pas.
   */
  zoomx?: number;
  zoomy?: number;
  rotate?: number;
};

export type PageLayer = "fore" | "back";

/** Une keyframe d'animation (propriétés interpolables) */
export type AnimKeyframe = {
  time: number;       // ms absolu depuis le début de l'animation
  duration: number;   // delta ms depuis la keyframe précédente
  /** Lettre interp brute : "l"=linear, "n"=steps(palier), "~"=warning. */
  interp: "l" | "n" | "~";
  easing: string;     // "linear" | "steps" | "warn" (dérivé de interp)
  accel: number;      // accélération (col 2)
  // Props continues :
  center?: number;
  vcenter?: number;
  /** Position du fond (`@bgact`), repère 1024×576 : coin haut gauche de l'image. */
  left?: number;
  top?: number;
  opacity?: number;   // 0..1
  zoomx?: number;     // 1.0 = 100%
  zoomy?: number;
  rotate?: number;    // degrés
  absolute?: number;  // z-index
  // Props continues spécifiques aux partbg (crop interne) :
  srcleft?: number;
  srctop?: number;
  srczoomx?: number;
  srczoomy?: number;
  // Props discrètes (appliquées instantanément, pas interpolées) :
  storage?: string;
  visible?: boolean;
  type?: string;
  effect?: string;
  contrast?: number;
};

export type AnimationDef = {
  storage: string;
  page?: PageLayer;
  keyframes: AnimKeyframe[];
  loop?: boolean;
  id?: string;
  /** Pour @fgact sur un partbg : identifiant du calque partbg ciblé. */
  partbgid?: string;
  /** Si true, l'animation cible un partbg (ex. @partbgact). */
  isPartbg?: boolean;
  /** Si true, c'est un @movefg/@movepartbg (cible fore, écrit aussi sur back). */
  isMove?: boolean;
};

/** Zoom (%) et rotation (degrés) lus sur un `@bg`, `@fg` ou `@chgfg` ; absents = non précisés. */
export type TransformArgs = { zoomx?: number; zoomy?: number; rotate?: number };

export type Instruction =
  | ({ kind: "bg"; storage: string; time: number; rule?: string; page?: PageLayer; left?: number; top?: number; noclear?: boolean; nowait?: boolean; canskip?: boolean } & TransformArgs)
  | ({ kind: "bgact"; storage: string; page?: PageLayer; keyframes: AnimKeyframe[] })
  | ({ kind: "fg"; storage: string; center: number; vcenter: number; index: number; opacity?: number; page?: PageLayer; id?: string; partbgId?: string; time?: number; rule?: string; nowait?: boolean; canskip?: boolean } & TransformArgs)
  | ({ kind: "chgfg"; storage: string; id?: string; index?: number; page?: PageLayer; time?: number; rule?: string; nowait?: boolean; canskip?: boolean } & TransformArgs)
  | { kind: "partbg"; storage: string; center: number; vcenter: number; index: number; opacity?: number; page?: PageLayer; id?: string; noclear?: boolean; bgstorage?: string; time?: number; rule?: string; nowait?: boolean; canskip?: boolean; crop: CropSpec }
  | { kind: "animate"; def: AnimationDef }
  | { kind: "clall"; page?: PageLayer }
  | { kind: "clfg"; storage?: string; index?: number; id?: string; page?: PageLayer }
  | { kind: "backlay"; storage?: string }
  | { kind: "trans"; rule?: string; time: number; nowait?: boolean; canskip?: boolean; cond?: string }
  | { kind: "play"; storage: string; volume?: number }
  | { kind: "playstop"; time?: number }
  | { kind: "playpause"; time: number; storage?: string }
  | { kind: "playresume"; time: number; volume: number; storage?: string }
  | { kind: "fadebgm"; time: number; volume?: number }
  | { kind: "se"; storage: string; volume?: number; loop?: boolean; delay?: number }
  | { kind: "seact"; storage: string; delay: number; fadeIn: number; volume: number; loop: boolean; cond?: string }
  | { kind: "playtimeline"; scene: number; next?: number }
  | { kind: "sestop"; storage?: string; time?: number }
  | { kind: "fadese"; storage?: string; time: number; volume: number }
  | { kind: "quake"; vmax: number; hmax: number; time: number; interval: number }
  | { kind: "stopquake" }
  | { kind: "lockquickmenu" }
  | { kind: "unlockquickmenu" }
  | { kind: "pauseautomode" }
  | { kind: "resumeautomode" }
  | { kind: "textoff"; time: number }
  | { kind: "texton" }
  | { kind: "position"; visible?: boolean }
  | { kind: "invisibleframe" }
  | { kind: "visibleframe" }
  | { kind: "noise"; opacity: number; monocro?: boolean; page?: PageLayer }
  | { kind: "stopnoise" }
  | { kind: "stopaction" }
  | { kind: "stoptrans" }
  | { kind: "haze"; power: number; delta: number; omega: number; page?: PageLayer }
  | { kind: "stophaze"; page?: PageLayer }
  | { kind: "beginploy" }
  | { kind: "endploy" }
  | { kind: "ploysay"; mode: string; ox: number; oy: number }
  | { kind: "font"; style: TextStyle }
  | { kind: "resetfont" }
  | { kind: "staffrollinit"; face?: string }
  | { kind: "staffrolltext"; text: string; y: number; size: number; face?: string; cmx?: number }
  | { kind: "staffrollstart"; height: number; time: number }
  | { kind: "iscript" }
  | { kind: "endscript" }
  | { kind: "wait"; time: number; skippable?: boolean }
  | { kind: "waitfor"; what: "transition" | "animation" | "quake"; skippable?: boolean }
  | { kind: "text"; segments: TextSegment[] }
  | { kind: "break" }
  | { kind: "jump"; target?: string; storage?: string; cond?: string }
  | { kind: "call"; target?: string; storage?: string; cond?: string }
  | { kind: "return" }
  | { kind: "eval"; expression: string; cond?: string }
  | { kind: "raw"; command: string; args: Record<string, string> }
  | { kind: "conditional"; branches: Array<{ cond?: string; instructions: Instruction[] }> }
  | { kind: "macrodef"; name: string; rawTokens: Token[] };

export type Page = {
  label?: string;
  instructions: Instruction[];
};

export type ParsedScript = {
  pages: Page[];
  labels: Record<string, number>;
  /**
   * Instruction index within the target page for each label. Required now
   * that labels are no longer page boundaries.
   */
  labelInstructionIndex: Record<string, number>;
};
