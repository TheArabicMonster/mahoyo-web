import { describe, it, expect } from "vitest";
import { parseStoryChain, resolveNext, type StoryChain } from "@/core/story-chain.js";

function chain(next: StoryChain["next"]): StoryChain {
  return { version: 1, first: "a.ks", next };
}

describe("parseStoryChain", () => {
  it("accepte une table valide", () => {
    const data = { version: 1, first: "a.ks", next: { "a.ks": [{ to: "b.ks", then: ["c.ks"], choice: "Aller" }] } };
    expect(parseStoryChain(data)).toEqual(data);
  });

  it("refuse une table de forme inattendue", () => {
    expect(parseStoryChain(null)).toBeNull();
    expect(parseStoryChain({ version: 2, first: "a.ks", next: {} })).toBeNull();
    expect(parseStoryChain({ version: 1, next: {} })).toBeNull();
    expect(parseStoryChain({ version: 1, first: "a.ks", next: { "a.ks": [{ to: "" }] } })).toBeNull();
    expect(parseStoryChain({ version: 1, first: "a.ks", next: { "a.ks": [{ to: "b.ks", then: [3] }] } })).toBeNull();
    expect(parseStoryChain({ version: 1, first: "a.ks", next: { "a.ks": "b.ks" } })).toBeNull();
  });
});

describe("parseStoryChain — chapitres", () => {
  const base = { version: 1, first: "a.ks", next: { "a.ks": [] } };
  const chapter = { id: "1-0", label: "Un", file: "1-0.ks", arc: "Un" };

  it("conserve les chapitres valides", () => {
    expect(parseStoryChain({ ...base, chapters: [chapter] })?.chapters).toEqual([chapter]);
  });

  it("accepte une table sans chapitres (générée avant leur ajout)", () => {
    expect(parseStoryChain(base)?.chapters).toBeUndefined();
  });

  it("refuse des chapitres mal formés", () => {
    expect(parseStoryChain({ ...base, chapters: "x" })).toBeNull();
    expect(parseStoryChain({ ...base, chapters: [{ ...chapter, label: "" }] })).toBeNull();
    expect(parseStoryChain({ ...base, chapters: [{ id: "a", file: "a.ks" }] })).toBeNull();
  });
});

describe("resolveNext", () => {
  it("fin de l'histoire pour un script sans suite ou inconnu", () => {
    const c = chain({ "a.ks": [] });
    expect(resolveNext(c, "a.ks")).toEqual({ kind: "end" });
    expect(resolveNext(c, "inconnu.ks")).toEqual({ kind: "end" });
  });

  it("une seule suite", () => {
    expect(resolveNext(chain({ "a.ks": [{ to: "b.ks" }] }), "a.ks")).toEqual({
      kind: "script",
      file: "b.ks",
      then: [],
    });
  });

  it("ignore la casse du nom de script", () => {
    expect(resolveNext(chain({ "A.ks": [{ to: "b.ks" }] }), "a.KS")).toMatchObject({ file: "b.ks" });
  });

  it("transmet les scripts d'interlude à jouer ensuite", () => {
    const c = chain({ "a.ks": [{ to: "tea.ks", then: ["b.ks"] }] });
    expect(resolveNext(c, "a.ks")).toEqual({ kind: "script", file: "tea.ks", then: ["b.ks"] });
  });

  it("dédoublonne les routes identiques", () => {
    const c = chain({ "a.ks": [{ to: "b.ks" }, { to: "b.ks" }] });
    expect(resolveNext(c, "a.ks")).toMatchObject({ kind: "script", file: "b.ks" });
  });

  it("une condition vraie l'emporte sur la route sans condition", () => {
    const c = chain({ "a.ks": [{ to: "x.ks", condition: "ok" }, { to: "y.ks" }] });
    expect(resolveNext(c, "a.ks", () => true)).toMatchObject({ file: "x.ks" });
  });

  it("sans condition vraie, on garde les routes sans condition", () => {
    const c = chain({ "a.ks": [{ to: "x.ks", condition: "ok" }, { to: "y.ks" }] });
    expect(resolveNext(c, "a.ks", () => false)).toMatchObject({ file: "y.ks" });
  });

  it("sans évaluateur, les routes conditionnelles sont ignorées", () => {
    const c = chain({ "a.ks": [{ to: "x.ks", condition: "ok" }, { to: "y.ks" }] });
    expect(resolveNext(c, "a.ks")).toMatchObject({ file: "y.ks" });
  });

  it("plusieurs suites libellées : menu de choix", () => {
    const c = chain({ "a.ks": [{ to: "b.ks", choice: "B" }, { to: "c.ks", choice: "C", then: ["d.ks"] }] });
    expect(resolveNext(c, "a.ks")).toEqual({
      kind: "choice",
      options: [
        { label: "B", file: "b.ks", then: [] },
        { label: "C", file: "c.ks", then: ["d.ks"] },
      ],
    });
  });

  it("plusieurs suites sans libellé : la première du graphe", () => {
    const c = chain({ "a.ks": [{ to: "b.ks" }, { to: "c.ks" }] });
    expect(resolveNext(c, "a.ks")).toMatchObject({ kind: "script", file: "b.ks" });
  });

  it("une route conditionnelle fausse seule donne la fin", () => {
    const c = chain({ "a.ks": [{ to: "x.ks", condition: "ok" }] });
    expect(resolveNext(c, "a.ks", () => false)).toEqual({ kind: "end" });
  });

  describe("menu avec options conditionnelles", () => {
    const c = chain({
      "a.ks": [
        { to: "x.ks", choice: "Option 1" },
        { to: "x.ks", choice: "Option 2" },
        { to: "z.ks", choice: "Option cachée", condition: "flag>0" },
      ],
    });

    it("masque une option dont la condition est fausse, mais garde le menu", () => {
      const step = resolveNext(c, "a.ks", () => false);
      expect(step).toEqual({
        kind: "choice",
        options: [
          { label: "Option 1", file: "x.ks", then: [] },
          { label: "Option 2", file: "x.ks", then: [] },
        ],
      });
    });

    it("affiche l'option quand sa condition est vraie", () => {
      const step = resolveNext(c, "a.ks", () => true);
      expect(step.kind).toBe("choice");
      if (step.kind === "choice") expect(step.options.map((o) => o.label)).toEqual(["Option 1", "Option 2", "Option cachée"]);
    });

    it("sans évaluateur, une option conditionnelle est masquée", () => {
      const step = resolveNext(c, "a.ks");
      expect(step.kind).toBe("choice");
      if (step.kind === "choice") expect(step.options).toHaveLength(2);
    });

    it("une seule option visible : on l'enchaîne sans menu", () => {
      const one = chain({ "a.ks": [{ to: "x.ks", choice: "Seule" }, { to: "z.ks", choice: "Autre", condition: "ok" }] });
      expect(resolveNext(one, "a.ks", () => false)).toEqual({ kind: "script", file: "x.ks", then: [] });
    });

    it("aucune option visible : fin", () => {
      const none = chain({ "a.ks": [{ to: "x.ks", choice: "A", condition: "a" }, { to: "y.ks", choice: "B", condition: "b" }] });
      expect(resolveNext(none, "a.ks", () => false)).toEqual({ kind: "end" });
    });
  });
});
