export type Token =
  | { type: "command"; name: string; args: Record<string, string> }
  | { type: "tag"; name: string; args: Record<string, string> }
  | { type: "label"; name: string }
  | { type: "text"; content: string }
  | { type: "comment"; content: string }
  | { type: "linebreak" };

/** Segment de texte avec annotation ruby optionnelle */
export type TextSegment =
  | { text: string; ruby?: undefined }
  | { text: string; ruby: string }
  | { pause: true };

export type Layer = {
  storage: string;
  center: number;
  vcenter: number;
  index: number;
  opacity: number;
};

export type PageLayer = "fore" | "back";

/** Une keyframe d'animation (propriétés interpolables) */
export type AnimKeyframe = {
  time: number;       // ms depuis le début
  duration: number;   // ms pour atteindre cette keyframe
  easing: string;     // "l" = linear, "n" = ease-in-out
  center?: number;
  vcenter?: number;
  opacity?: number;
  zoomx?: number;
  zoomy?: number;
  rotate?: number;
};

export type AnimationDef = {
  storage: string;
  page?: PageLayer;
  keyframes: AnimKeyframe[];
  loop?: boolean;
  id?: string;
};

export type Instruction =
  | { kind: "bg"; storage: string; time: number; rule?: string; page?: PageLayer; left?: number; top?: number }
  | { kind: "fg"; storage: string; center: number; vcenter: number; index: number; opacity?: number; page?: PageLayer }
  | { kind: "animate"; def: AnimationDef }
  | { kind: "clall"; page?: PageLayer }
  | { kind: "clfg"; storage?: string; index?: number; page?: PageLayer }
  | { kind: "backlay"; storage?: string }
  | { kind: "trans"; rule?: string; time: number }
  | { kind: "play"; storage: string; volume?: number }
  | { kind: "playstop" }
  | { kind: "fadebgm"; time: number }
  | { kind: "se"; storage: string; volume?: number }
  | { kind: "sestop"; storage?: string; time?: number }
  | { kind: "fadese"; storage?: string; time: number; volume: number }
  | { kind: "quake"; vmax: number; hmax: number; time: number; interval: number }
  | { kind: "stopquake" }
  | { kind: "textoff"; time: number }
  | { kind: "texton" }
  | { kind: "position"; visible?: boolean }
  | { kind: "invisibleframe" }
  | { kind: "visibleframe" }
  | { kind: "noise"; opacity: number; monocro?: boolean; page?: PageLayer }
  | { kind: "haze"; power: number; delta: number; omega: number; page?: PageLayer }
  | { kind: "stophaze"; page?: PageLayer }
  | { kind: "beginploy" }
  | { kind: "staffrollinit"; face?: string }
  | { kind: "staffrolltext"; text: string; y: number; size: number; face?: string; cmx?: number }
  | { kind: "staffrollstart"; height: number; time: number }
  | { kind: "iscript" }
  | { kind: "endscript" }
  | { kind: "wait"; time: number }
  | { kind: "text"; segments: TextSegment[] }
  | { kind: "break" }
  | { kind: "jump"; target?: string; storage?: string }
  | { kind: "call"; target?: string; storage?: string }
  | { kind: "return" }
  | { kind: "eval"; expression: string }
  | { kind: "raw"; command: string; args: Record<string, string> };

export type Page = {
  label?: string;
  instructions: Instruction[];
};

export type ParsedScript = {
  pages: Page[];
  labels: Record<string, number>;
};
