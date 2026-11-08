/** Suivi de la progression par scène. Tables et identifiants ci-dessous : exemples inventés. */
import { describe, it, expect } from "vitest";
import type { StoryChain } from "@/core/story-chain.js";
import { ProgressTracker, reachableEndings, scriptIdOf } from "@/player/progress-tracker.js";
import { createMemorySettingsStore, type SettingsStore } from "@/player/settings-store.js";
import { emptyStoryProgress } from "@/player/story-progress.js";
import type { StoryProgress } from "@/ui/types.js";
import { buildStoryGraph } from "../../../tools/story-graph-lib.js";

const chain: StoryChain = {
  version: 1,
  first: "a-1.ks",
  next: {
    "a-1.ks": [{ to: "a-2.ks" }],
    "a-2.ks": [{ to: "a-3.ks" }],
    "a-3.ks": [
      { to: "b-1.ks", choice: "Option B" },
      { to: "c-1.ks", choice: "Option C" },
    ],
    "b-1.ks": [{ to: "tea.ks", then: ["d-1.ks"] }],
    "c-1.ks": [{ to: "tea.ks", then: ["e-1.ks"] }],
    "d-1.ks": [{ to: "d-2.ks", condition: "flag>0" }, { to: "d-3.ks" }],
    "d-2.ks": [],
    "d-3.ks": [],
    "e-1.ks": [],
    "z-1.ks": [],
  },
};

describe("scriptIdOf", () => {
  it("retire l'extension et passe en minuscules", () => {
    expect(scriptIdOf("A-1.KS")).toBe("a-1");
    expect(scriptIdOf("tea.ks")).toBe("tea");
    expect(scriptIdOf("tea")).toBe("tea");
  });
});

describe("reachableEndings", () => {
  it("ne garde que les extrémités atteignables depuis le début (pas les bonus isolés)", () => {
    expect([...reachableEndings(chain)].sort()).toEqual(["d-2", "d-3", "e-1"]);
  });

  it("donne le même résultat que le graphe de scénario", () => {
    const graph = buildStoryGraph(chain);
    const successors = new Map<string, string[]>();
    for (const e of graph.edges) successors.set(e.from, [...(successors.get(e.from) ?? []), e.to]);
    const reached = new Set<string>();
    const stack = [graph.first];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      stack.push(...(successors.get(id) ?? []));
    }
    const fromGraph = graph.nodes.filter((n) => n.kind === "end" && reached.has(n.id)).map((n) => n.id);
    expect([...reachableEndings(chain)].sort()).toEqual(fromGraph.sort());
  });

  it("table sans aucune suite : le premier script est lui-même une fin", () => {
    expect([...reachableEndings({ version: 1, first: "x.ks", next: {} })]).toEqual(["x"]);
  });
});

/** Magasin dont les écritures peuvent échouer ou être retardées, et qui les enregistre. */
function probeStore(opts: { failSaves?: boolean } = {}) {
  const inner = createMemorySettingsStore();
  const saved: StoryProgress[] = [];
  let failing = opts.failSaves ?? false;
  let gate: Promise<void> | null = null;
  const store: SettingsStore = {
    ...inner,
    async saveStoryProgress(p) {
      if (gate) await gate;
      if (failing) throw new DOMException("quota", "QuotaExceededError");
      saved.push(p);
      await inner.saveStoryProgress(p);
    },
  };
  return {
    store,
    inner,
    saved,
    setFailing: (v: boolean) => {
      failing = v;
    },
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((r) => {
        release = r;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

describe("ProgressTracker", () => {
  it("enchaînement avec un choix : visited, choices, finished et endings", async () => {
    const probe = probeStore();
    const t = new ProgressTracker(probe.store, () => {});
    t.setEndings(reachableEndings(chain));
    await t.load();

    for (const f of ["a-1.ks", "a-2.ks", "a-3.ks"]) {
      t.enter(scriptIdOf(f));
      t.finish(scriptIdOf(f));
    }
    t.choose("a-3", "c-1");
    for (const f of ["c-1.ks", "tea.ks", "e-1.ks"]) t.enter(scriptIdOf(f));
    t.finish("c-1");
    await t.flush();

    expect(t.snapshot).toEqual({
      visited: ["a-1", "a-2", "a-3", "c-1", "tea", "e-1"],
      finished: ["a-1", "a-2", "a-3", "c-1"],
      choices: [{ from: "a-3", to: "c-1" }],
      endings: ["e-1"],
    });
    expect(await probe.inner.loadStoryProgress()).toEqual(t.snapshot);
  });

  it("un script terminal isolé ou sans table n'est pas une fin", () => {
    const t = new ProgressTracker(createMemorySettingsStore(), () => {});
    t.setEndings(reachableEndings(chain));
    t.enter("z-1");
    expect(t.snapshot.endings).toEqual([]);
    expect(t.snapshot.visited).toEqual(["z-1"]);

    const noChain = new ProgressTracker(createMemorySettingsStore(), () => {});
    noChain.enter("e-1");
    expect(noChain.snapshot.endings).toEqual([]);
  });

  it("ne réécrit pas le stockage quand rien ne change", async () => {
    const probe = probeStore();
    const t = new ProgressTracker(probe.store, () => {});
    await t.load();
    t.enter("a-1");
    await t.flush();
    t.enter("a-1");
    t.choose("", "x");
    await t.flush();
    expect(probe.saved).toHaveLength(1);
  });

  it("fusionne avec la progression stockée au chargement et n'écrit rien avant", async () => {
    const probe = probeStore();
    await probe.inner.saveStoryProgress({ visited: ["old"], finished: ["old"], choices: [{ from: "p", to: "q" }], endings: ["end"] });

    const t = new ProgressTracker(probe.store, () => {});
    t.enter("a-1"); // avant la fin du chargement
    expect(probe.saved).toHaveLength(0);
    await t.load();
    await t.flush();

    expect(t.snapshot.visited).toEqual(["old", "a-1"]);
    expect(t.snapshot.endings).toEqual(["end"]);
    expect(t.snapshot.choices).toEqual([{ from: "p", to: "q" }]);
    expect(await probe.inner.loadStoryProgress()).toEqual(t.snapshot);
  });

  it("regroupe les modifications faites pendant une écriture : la dernière écriture contient tout", async () => {
    const probe = probeStore();
    const t = new ProgressTracker(probe.store, () => {});
    await t.load();
    const release = probe.hold();
    t.enter("a-1");
    t.enter("a-2");
    t.enter("a-3");
    release();
    await t.flush();
    expect(probe.saved.length).toBeLessThanOrEqual(2);
    expect((await probe.inner.loadStoryProgress()).visited).toEqual(["a-1", "a-2", "a-3"]);
    expect(probe.saved.at(-1)).toEqual(t.snapshot);
  });

  it("quota dépassé : ne lève pas, garde la progression en mémoire, avertit une fois, réessaie ensuite", async () => {
    const probe = probeStore({ failSaves: true });
    const warnings: string[] = [];
    const t = new ProgressTracker(probe.store, (m) => warnings.push(m));
    await t.load();

    t.enter("a-1");
    await expect(t.flush()).resolves.toBeUndefined();
    t.enter("a-2");
    await t.flush();
    expect(t.snapshot.visited).toEqual(["a-1", "a-2"]);
    expect(warnings).toHaveLength(1);
    expect((await probe.inner.loadStoryProgress()).visited).toEqual([]);

    probe.setFailing(false);
    t.enter("a-3");
    await t.flush();
    expect((await probe.inner.loadStoryProgress()).visited).toEqual(["a-1", "a-2", "a-3"]);
  });

  it("un stockage illisible au chargement démarre à vide sans lever", async () => {
    const store: SettingsStore = {
      ...createMemorySettingsStore(),
      loadStoryProgress: () => Promise.reject(new Error("boom")),
    };
    const t = new ProgressTracker(store, () => {});
    await expect(t.load()).resolves.toBeUndefined();
    expect(t.snapshot).toEqual(emptyStoryProgress());
  });

  it("absorbChoices ajoute sans jamais retirer", async () => {
    const t = new ProgressTracker(createMemorySettingsStore(), () => {});
    await t.load();
    t.choose("a", "b");
    t.absorbChoices([
      { from: "a", to: "b" },
      { from: "c", to: "d" },
    ]);
    expect(t.snapshot.choices).toEqual([
      { from: "a", to: "b" },
      { from: "c", to: "d" },
    ]);
    t.absorbChoices([]);
    expect(t.snapshot.choices).toHaveLength(2);
  });
});
