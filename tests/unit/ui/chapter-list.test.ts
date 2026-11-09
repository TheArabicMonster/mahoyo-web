import { describe, it, expect } from "vitest";
import { chaptersToScripts, DEFAULT_CHAPTERS, unlockedChapterIds } from "@/ui/chapter-list.js";
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

describe("unlockedChapterIds (règle de déverrouillage de l'Archive, HUD-08)", () => {
  const list = chaptersToScripts(
    chain([
      { id: "1-0", label: "A", file: "1-0.ks", arc: "X" },
      { id: "1-1", label: "B", file: "1-1.ks", arc: "X" },
      { id: "2-0", label: "C", file: "2-0.ks", arc: "Y" },
    ]),
  );

  it("sans progression ni autosave : rien n'est déverrouillé", () => {
    expect(unlockedChapterIds(list, { visited: [] })).toEqual([]);
  });

  it("un chapitre est déverrouillé quand son script d'entrée a été ouvert, lu jusqu'au bout ou terminé", () => {
    expect(unlockedChapterIds(list, { visited: ["1-1"] })).toEqual(["1-1"]);
    expect(unlockedChapterIds(list, { visited: [], finished: ["2-0"] })).toEqual(["2-0"]);
    expect(unlockedChapterIds(list, { visited: [], completed: ["1-0"] })).toEqual(["1-0"]);
  });

  it("garde l'ordre des chapitres, ignore les scripts qui ne sont pas des chapitres", () => {
    expect(unlockedChapterIds(list, { visited: ["2-0", "intermede", "1-0"] })).toEqual(["1-0", "2-0"]);
  });

  it("aucun chapitre suivant n'est offert d'office (anti-spoiler)", () => {
    expect(unlockedChapterIds(list, { visited: ["1-0"], completed: ["1-0"] })).toEqual(["1-0"]);
  });

  it("une autosave déverrouille le premier chapitre, sans doublon", () => {
    expect(unlockedChapterIds(list, { visited: [], hasContinue: true })).toEqual(["1-0"]);
    expect(unlockedChapterIds(list, { visited: ["1-0"], hasContinue: true })).toEqual(["1-0"]);
    expect(unlockedChapterIds(list, { visited: ["2-0"], hasContinue: true })).toEqual(["1-0", "2-0"]);
  });

  it("sans chapitre, rien à déverrouiller", () => {
    expect(unlockedChapterIds([], { visited: ["x"], hasContinue: true })).toEqual([]);
  });
});
