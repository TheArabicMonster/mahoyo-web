/**
 * Extraction des timelines embarquées dans les scripts. Les données sont inventées,
 * au format observé : littéral TJS dans Scripts.eval, lignes [instant, 4 indicateurs, valeurs…].
 */
import { describe, it, expect } from "vitest";
import { buildTimelineScenes, buildTimelines, extractTla, TIME_UNIT_MS } from "../../../tools/timeline-lib.js";

/** Ligne de keyframe : instant, 4 indicateurs, puis les valeurs des propriétés. */
const row = (at: number, ...values: unknown[]): string =>
  `[${[at, "null", "null", "null", "null", ...values.map((v) => (v === null ? "null" : typeof v === "string" && v !== "~" ? `"${v}"` : v === "~" ? '"~"' : v))].join(",")}]`;

const obj = (className: string, name: string, props: string[], rows: string[], end: number, children = ""): string =>
  `%[ "className" => "${className}", "name" => "${name}", "uuid" => 1, ${children ? `"children" => [ ${children} ], ` : ""}` +
  `"timeline" => [ [${props.map((p) => `"${p}"`).join(",")}], [ ${rows.join(", ")} ], ${end} ] ]`;

const scene = (roots: string[], name = "scène"): string => `[ [ ${roots.join(", ")} ], void, 20, 0, "${name}", void ]`;

function ks(scenes: string, tlaName = "demo"): string {
  const literal = `(const) %[ "baseWidth" => 1024, "scenes" => [ ${scenes} ] ]`;
  return `@call target=*tladata\n*tladata\n@iscript\nglobal.__tmp_tla = Scripts.eval('${literal.replace(/"/g, '\\"')}');\nglobal.__tla_name = "${tlaName}";\n@endscript\n@return\n`;
}

describe("extractTla", () => {
  it("lit le nom et le graphe d'un script", () => {
    const tla = extractTla(ks(`4, ${scene([])}`, "opening"));
    expect(tla?.name).toBe("opening");
    expect(tla?.graph).toMatchObject({ baseWidth: 1024 });
  });

  it("renvoie null pour un script sans timeline", () => {
    expect(extractTla("@return\n")).toBeNull();
  });
});

describe("buildTimelineScenes", () => {
  it("extrait les fonds, converti en ms, avec leur position quand elle est complète", () => {
    const bg = obj("BGObject", "blue", ["storage", "left", "top"], [
      row(0, "black", -48, -48),
      row(80, "img1", -140, null),
      row(164, "img2", -10, -20),
    ], 200);
    const scenes = buildTimelineScenes(extractTla(ks(`4, ${scene([bg], "A")}`))!.graph);
    expect(scenes["4"]).toEqual({
      name: "A",
      duration: 200 * TIME_UNIT_MS,
      bg: [
        { at: 0, storage: "black", left: -48, top: -48 },
        { at: 80 * TIME_UNIT_MS, storage: "img1" },
        { at: 164 * TIME_UNIT_MS, storage: "img2", left: -10, top: -20 },
      ],
      audio: [],
    });
  });

  it("fusionne les fonds de plusieurs pages et les trie par instant", () => {
    const a = obj("BGObject", "blue", ["storage"], [row(0, "black"), row(80, "b1")], 100);
    const b = obj("BGObject", "white", ["storage"], [row(20, "w1"), row(40, "w2")], 100);
    const scenes = buildTimelineScenes(extractTla(ks(`4, ${scene([a, b])}`))!.graph);
    expect(scenes["4"]!.bg.map((x) => x.storage)).toEqual(["black", "w1", "w2", "b1"]);
  });

  it("ignore les lignes sans image, 'void' et le marqueur ~", () => {
    const bg = obj("BGObject", "blue", ["storage"], [row(0, "black"), row(10, null), row(20, "~"), row(30, "void"), row(40, "img")], 50);
    const scenes = buildTimelineScenes(extractTla(ks(`4, ${scene([bg])}`))!.graph);
    expect(scenes["4"]!.bg.map((x) => x.storage)).toEqual(["black", "img"]);
  });

  it("extrait les pistes audio : lecture, boucle, volume, puis changement de volume", () => {
    const bgm = obj("BGMObject", "BGM", ["storage", "state", "loop", "volume"], [row(0, null, null, 0, 1), row(20, "m01", "play", 0, 100)], 21);
    const se = obj("SEObject", "SE", ["storage", "state", "loop", "volume"], [
      row(3750, "rain", "play", 1, 0),
      row(3800, "void", "continuous", 0, 50),
    ], 3801);
    const scenes = buildTimelineScenes(extractTla(ks(`4, ${scene([bgm, se])}`))!.graph);
    expect(scenes["4"]!.audio).toEqual([
      { at: 1000, channel: "bgm", storage: "m01", loop: false, volume: 1, action: "play" },
      { at: 187500, channel: "se", storage: "rain", loop: true, volume: 0, action: "play" },
      { at: 190000, channel: "se", loop: false, volume: 0.5, action: "volume" },
    ]);
  });

  it("parcourt les objets enfants", () => {
    const child = obj("BGObject", "enfant", ["storage"], [row(10, "deep")], 20);
    const parent = obj("PageObject", "page", [], [], 20, child);
    const scenes = buildTimelineScenes(extractTla(ks(`4, ${scene([parent])}`))!.graph);
    expect(scenes["4"]!.bg.map((x) => x.storage)).toEqual(["deep"]);
  });

  it("lit plusieurs scènes (liste plate identifiant, scène)", () => {
    const bg = obj("BGObject", "blue", ["storage"], [row(0, "black")], 10);
    const scenes = buildTimelineScenes(extractTla(ks(`4, ${scene([bg], "avec")}, 7, ${scene([bg], "sans")}`))!.graph);
    expect(Object.keys(scenes)).toEqual(["4", "7"]);
    expect(scenes["7"]!.name).toBe("sans");
  });

  it("échoue clairement sans liste de scènes", () => {
    expect(() => buildTimelineScenes({ baseWidth: 1 })).toThrow(/scènes/);
  });
});

describe("buildTimelines", () => {
  it("ne garde que les scripts qui contiennent une timeline", () => {
    const bg = obj("BGObject", "blue", ["storage"], [row(0, "black")], 10);
    const files = new Map([
      ["opening.ks", ks(`4, ${scene([bg])}`, "opening")],
      ["1-0.ks", "@return\n"],
    ]);
    const { data, failures } = buildTimelines(files);
    expect(Object.keys(data.scripts)).toEqual(["opening.ks"]);
    expect(failures).toEqual([]);
  });

  it("rapporte un script illisible sans arrêter les autres", () => {
    const bg = obj("BGObject", "blue", ["storage"], [row(0, "black")], 10);
    const bad = "@iscript\nglobal.__tmp_tla = Scripts.eval('(const) %[ \\\"scenes\\\" => ??? ]');\nglobal.__tla_name = \"bad\";\n@endscript\n";
    const { data, failures } = buildTimelines(new Map([["bad.ks", bad], ["ok.ks", ks(`4, ${scene([bg])}`)]]));
    expect(Object.keys(data.scripts)).toEqual(["ok.ks"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("bad.ks");
  });
});
