import { describe, it, expect } from "vitest";
import { classifyAsset } from "../../../tools/inventory.js";
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
    kind: kind as InventoryEntry["kind"],
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
  it("ne transcode pas les médias de data/scenario en .ks (#111)", () => {
    const entries = [
      makeEntry("data/scenario/1-0.ks", classifyAsset("data/scenario/1-0.ks"), ".ks", "1-0"),
      makeEntry("data/scenario/note0.tlg", classifyAsset("data/scenario/note0.tlg"), ".tlg", "note0"),
      makeEntry("data/scenario/se083.wav", classifyAsset("data/scenario/se083.wav"), ".wav", "se083"),
      makeEntry("data/scenario/archivemenu.tjs", classifyAsset("data/scenario/archivemenu.tjs"), ".tjs", "archivemenu"),
    ];
    const tasks = planTasks(entries, baseCtx);

    expect(tasks.filter((t) => t.action === "transcode-ks")).toHaveLength(1);
    expect(tasks.filter((t) => t.action === "convert-image")).toHaveLength(1);
    expect(tasks.filter((t) => t.action === "copy" && t.outputExt === ".wav")).toHaveLength(1);
    // Le .tjs n'est pas un asset à produire.
    expect(tasks).toHaveLength(3);
  });

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

  it("planifie la conversion .wav → Opus .ogg par ffmpeg détecté (#387)", () => {
    const entries = [makeEntry("sound/se01.wav", "se", ".wav", "se01")];
    const tasks = planTasks(entries, {
      ...baseCtx,
      audio: { ffmpegPath: "ffmpeg", format: "opus" },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe("convert-audio");
    expect(tasks[0].outputExt).toBe(".ogg");
    expect(tasks[0].commandTemplate).toBeUndefined();
    expect(tasks[0].audio).toEqual({ ffmpegPath: "ffmpeg", format: "opus" });
  });

  it("planifie le repli Safari .m4a AAC (#387)", () => {
    const entries = [makeEntry("sound/se01.wav", "se", ".wav", "se01")];
    const tasks = planTasks(entries, {
      ...baseCtx,
      audio: { ffmpegPath: "ffmpeg", format: "aac" },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe("convert-audio");
    expect(tasks[0].outputExt).toBe(".m4a");
    expect(tasks[0].audio?.format).toBe("aac");
  });

  it("le gabarit --audio-cmd reste prioritaire sur la conversion interne (#387)", () => {
    const entries = [makeEntry("sound/se01.wav", "se", ".wav", "se01")];
    const tasks = planTasks(entries, {
      ...baseCtx,
      audioCommand: "mon-encodeur {in} {out}",
      audio: { ffmpegPath: "ffmpeg", format: "aac" },
    });
    expect(tasks[0].outputExt).toBe(".ogg");
    expect(tasks[0].commandTemplate).toBe("mon-encodeur {in} {out}");
    expect(tasks[0].audio).toBeUndefined();
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

describe("planTasks — WebP (#374)", () => {
  const webpCtx: PlanContext = {
    ...baseCtx,
    webp: { encoder: "cwebp", lossyCategories: [], quality: 90 },
  };

  it("convertit les TLG intégrés en WebP sans perte par défaut", () => {
    const tasks = planTasks([makeEntry("bg/night.tlg", "bg", ".tlg", "night")], webpCtx);
    expect(tasks[0]).toMatchObject({
      action: "convert-image",
      outputExt: ".webp",
      internal: true,
      webp: { lossless: true, quality: 90, encoder: "cwebp" },
    });
    expect(tasks[0]!.outputPath).toBe("/output/bg/night.webp");
  });

  it("convertit les PNG en WebP sans perte, règles exclues", () => {
    const tasks = planTasks(
      [
        makeEntry("bg/night.png", "bg", ".png", "night"),
        makeEntry("fg/aoko.png", "image", ".png", "aoko"),
        makeEntry("rule/crossfade.png", "rule", ".png", "crossfade"),
      ],
      webpCtx,
    );
    expect(tasks.map((task) => task.outputExt)).toEqual([".webp", ".webp", ".png"]);
    expect(tasks[2]!.action).toBe("copy");
  });

  it("option avec perte réservée aux catégories bg/ev", () => {
    const tasks = planTasks(
      [
        makeEntry("bg/night.tlg", "bg", ".tlg", "night"),
        makeEntry("fg/ev1301.png", "image", ".png", "ev1301"),
        makeEntry("fg/aoko.png", "image", ".png", "aoko"),
      ],
      { ...webpCtx, webp: { encoder: "cwebp", lossyCategories: ["bg", "ev"], quality: 92 } },
    );
    expect(tasks[0]).toMatchObject({ outputExt: ".webp", webp: { lossless: false, quality: 92 } });
    expect(tasks[1]).toMatchObject({ outputExt: ".webp", webp: { lossless: false } });
    expect(tasks[2]).toMatchObject({ outputExt: ".webp", webp: { lossless: true } });
  });

  it("sans encodeur WebP, repli PNG (compatibilité)", () => {
    const tasks = planTasks([makeEntry("bg/night.tlg", "bg", ".tlg", "night")], { ...baseCtx, webp: null });
    expect(tasks[0]!.outputExt).toBe(".png");
  });
});
