import { describe, it, expect } from "vitest";
import { planTasks, summarizeResults, type PlanContext } from "../../../tools/plan.js";
import type { InventoryEntry } from "../../../tools/inventory.js";
import type { TaskResult } from "../../../tools/plan.js";

function makeEntry(
  relPath: string,
  kind: string,
  ext: string,
  key: string,
): InventoryEntry {
  return {
    source: `/input/${relPath}`,
    relPath,
    kind: kind as any,
    ext,
    key,
    webPath: `${kind}/${key}${ext}`,
    webExt: ext,
  };
}

const baseCtx: PlanContext = {
  outputDir: "/output",
  copyWavIfNoEncoder: true,
};

describe("planTasks", () => {
  it("planifie la conversion .tlg → .webp avec convertisseur", () => {
    const entries = [makeEntry("bg/night.tlg", "bg", ".tlg", "night")];
    const tasks = planTasks(entries, { ...baseCtx, tlgCommand: "tlg2png {in} {out}" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe("convert-image");
    expect(tasks[0].outputExt).toBe(".webp");
    expect(tasks[0].commandTemplate).toBe("tlg2png {in} {out}");
    expect(tasks[0].internal).toBe(false);
  });

  it("planifie le décodeur TLG intégré (sortie .png) sans convertisseur externe", () => {
    const entries = [makeEntry("bg/night.tlg", "bg", ".tlg", "night")];
    const tasks = planTasks(entries, baseCtx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe("convert-image");
    expect(tasks[0].commandTemplate).toBeUndefined();
    expect(tasks[0].outputExt).toBe(".png");
    expect(tasks[0].internal).toBe(true);
  });

  it("planifie la copie .png telle quelle", () => {
    const entries = [makeEntry("fg/aoko.png", "image", ".png", "aoko")];
    const tasks = planTasks(entries, baseCtx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe("copy");
    expect(tasks[0].outputExt).toBe(".png");
    expect(tasks[0].internal).toBe(true);
  });

  it("planifie la copie .ogg telle quelle", () => {
    const entries = [makeEntry("bgm/m01.ogg", "bgm", ".ogg", "m01")];
    const tasks = planTasks(entries, baseCtx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe("copy");
    expect(tasks[0].outputExt).toBe(".ogg");
  });

  it("planifie la conversion .wav → .ogg avec encodeur", () => {
    const entries = [makeEntry("sound/se01.wav", "se", ".wav", "se01")];
    const tasks = planTasks(entries, { ...baseCtx, audioCommand: "ffmpeg -i {in} {out}" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe("convert-audio");
    expect(tasks[0].outputExt).toBe(".ogg");
    expect(tasks[0].commandTemplate).toBe("ffmpeg -i {in} {out}");
  });

  it("planifie la copie .wav sans encodeur (copyWavIfNoEncoder)", () => {
    const entries = [makeEntry("sound/se01.wav", "se", ".wav", "se01")];
    const tasks = planTasks(entries, baseCtx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe("copy");
    expect(tasks[0].outputExt).toBe(".wav");
  });

  it("planifie le transcodage .ks", () => {
    const entries = [makeEntry("data/scenario/1-0.ks", "scenario", ".ks", "1-0")];
    const tasks = planTasks(entries, baseCtx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe("transcode-ks");
    expect(tasks[0].outputExt).toBe(".ks");
    expect(tasks[0].internal).toBe(true);
  });

  it("rules en .tlg → .png (pas .webp)", () => {
    const entries = [makeEntry("rule/crossfade.tlg", "rule", ".tlg", "crossfade")];
    const tasks = planTasks(entries, { ...baseCtx, tlgCommand: "tlg2png {in} {out}" });
    expect(tasks[0].outputExt).toBe(".png");
  });

  it("construit le bon chemin de sortie", () => {
    const entries = [makeEntry("bg/night.tlg", "bg", ".tlg", "night")];
    const tasks = planTasks(entries, { ...baseCtx, tlgCommand: "x {in} {out}" });
    expect(tasks[0].outputPath).toBe("/output/bg/night.webp");
  });
});

describe("summarizeResults", () => {
  it("compte les résultats par statut", () => {
    const tasks = planTasks(
      [makeEntry("bg/a.tlg", "bg", ".tlg", "a"), makeEntry("bg/b.png", "bg", ".png", "b")],
      baseCtx,
    );
    const results: TaskResult[] = [
      { task: tasks[0], status: "failed", error: "no converter" },
      { task: tasks[1], status: "ok", actualOutputPath: "/output/bg/b.png" },
    ];
    const summary = summarizeResults(results);
    expect(summary.ok).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.byAction.copy.ok).toBe(1);
    expect(summary.byAction["convert-image"].failed).toBe(1);
  });
});
