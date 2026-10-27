import type { Position, Step, StopReason } from "@/kag/events.js";
import type { RuntimeSaveData } from "@/kag/runtime.js";
import type { ParsedScript } from "@/kag/types.js";

/**
 * Runtime factice pour tester le Player indépendamment du vrai moteur KAG.
 */
export class FakeRuntime {
  scriptLoader: ((storage: string) => Promise<ParsedScript | null>) | null = null;
  onWarning: (message: string) => void = console.warn;

  private steps: Step[] = [];
  private index = 0;
  private loadedScripts: ParsedScript[] = [];

  constructor(steps: Step[] = []) {
    this.steps = steps;
  }

  queue(steps: Step[]) {
    this.steps.push(...steps);
  }

  step(): Step {
    if (this.index >= this.steps.length) {
      return {
        position: this.makePosition(),
        events: [],
        stop: { kind: "end" },
      };
    }
    return this.steps[this.index++];
  }

  async loadScript(_storage: string, _label?: string, _pushCallStack?: boolean): Promise<boolean> {
    if (!this.scriptLoader) return false;
    const script = await this.scriptLoader(_storage);
    if (!script) return false;
    this.loadedScripts.push(script);
    return true;
  }

  jump(_label: string): boolean {
    return false;
  }

  getSaveData(): RuntimeSaveData {
    return {
      scriptName: "fake.ks",
      pc: this.index,
      instructionIndex: 0,
      segmentIndex: 0,
      state: {
        fore: { background: "", layers: [] },
        back: { background: "", layers: [] },
        bgm: null,
        se: null,
        variables: {},
        effect: null,
      },
      callStack: [],
    };
  }

  async loadSaveData(_data: RuntimeSaveData, _scripts: Map<string, ParsedScript>): Promise<boolean> {
    return false;
  }

  private makePosition(): Position {
    return {
      scriptName: "fake.ks",
      page: this.index,
      instruction: 0,
    };
  }
}
