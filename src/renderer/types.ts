import type { PendingAudioAction, PendingEffect, PendingFrame, PendingQuake, PendingTextbox, RuntimeSnapshot } from "@/kag/runtime.js";
import type { AnimationDef, Layer, TextSegment } from "@/kag/types.js";

export type RenderEvent =
  | { kind: "clearText" }
  | { kind: "appendText"; segments: TextSegment[] }
  | { kind: "lineBreak" }
  | { kind: "wait"; time: number }
  | { kind: "bg"; storage: string; transition: boolean; time: number }
  | { kind: "fg"; layer: Layer }
  | { kind: "clearFg"; storage?: string; index?: number }
  | { kind: "clearAllFg" }
  | { kind: "animate"; def: AnimationDef }
  | { kind: "audio"; action: PendingAudioAction }
  | { kind: "bgm"; storage: string }
  | { kind: "se"; storage: string }
  | { kind: "textbox"; visible: boolean; time: number }
  | { kind: "frame"; visible: boolean }
  | { kind: "quake"; quake: PendingQuake }
  | { kind: "stopquake" }
  | { kind: "effect"; effect: PendingEffect }
  | { kind: "staffroll"; state: NonNullable<RuntimeSnapshot["state"]["staffroll"]> }
  | { kind: "scriptLoad"; file: string };

export interface Renderer {
  render(snapshot: RuntimeSnapshot, events: RenderEvent[]): void;
  showMenu(): void;
  showGame(): void;
  showFlowchart(): void;
  hideFlowchart(): void;
  showToast(message: string): void;
  setEnabled(enabled: boolean): void;
  reset(): void;
}
