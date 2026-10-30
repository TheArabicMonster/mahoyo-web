import { describe, it, expect } from "vitest";
import { chaptersToScripts, DEFAULT_CHAPTERS } from "@/ui/chapter-list.js";
import type { StoryChain } from "@/core/story-chain.js";

const chain = (chapters?: StoryChain["chapters"]): StoryChain => ({ version: 1, first: "1-0.ks", next: {}, chapters });

describe("chaptersToScripts", () => {
  it("sans table ou sans chapitres : le prologue seul", () => {
    expect(chaptersToScripts(null)).toEqual(DEFAULT_CHAPTERS);
    expect(chaptersToScripts(chain())).toEqual(DEFAULT_CHAPTERS);
    expect(chaptersToScripts(chain([]))).toEqual(DEFAULT_CHAPTERS);
  });

  it("une entrée par chapitre, dans l'ordre, avec une position verticale croissante", () => {
    const list = chaptersToScripts(chain([
      { id: "1-0", label: "Un", file: "1-0.ks", arc: "A" },
      { id: "2-1", label: "Deux", file: "2-1.ks", arc: "B" },
    ]));
    expect(list.map((s) => s.file)).toEqual(["1-0.ks", "2-1.ks"]);
    expect(list.map((s) => s.label)).toEqual(["Un", "Deux"]);
    expect(list[1]!.y).toBeGreaterThan(list[0]!.y);
    expect(list[0]).toMatchObject({ id: "1-0", arc: "A" });
  });

  it("ne modifie pas la liste par défaut", () => {
    const a = chaptersToScripts(null);
    a.push({ id: "x", label: "x", file: "x.ks", arc: "x", x: 0, y: 0 });
    expect(DEFAULT_CHAPTERS).toHaveLength(1);
  });
});
