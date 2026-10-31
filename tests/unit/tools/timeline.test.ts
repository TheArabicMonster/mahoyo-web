/**
 * Extraction des timelines embarquées dans les scripts. Les données sont inventées,
 * au format observé : littéral TJS dans Scripts.eval, lignes [instant, 4 indicateurs, valeurs…].
 */
import { describe, it, expect } from "vitest";
import { buildTimelineScenes, buildTimelines, extractTla, TIME_UNIT_MS } from "../../../tools/timeline-lib.js";

/** Ligne de keyframe : instant, 4 indicateurs, puis les valeurs des propriétés. */
const row = (at: number, ...values: unknown[]): string =>
  `[${[at, "null", "null", "null", "null", ...values.map((v) => (v === null ? "null" : typeof v === "string" && v !== "~" ? `"${v}"` : v === "~" ? '"~"' : v))].join(",")}]`;

/** Ligne de keyframe avec l'indicateur d'interpolation (2e indicateur) : 1, 0 ou null (inchangé). */
const rowI = (at: number, interp: number | null, ...values: unknown[]): string =>
  `[${[at, "null", interp === null ? "null" : interp, "null", "null", ...values.map((v) => (v === null ? "null" : typeof v === "string" ? `"${v}"` : v))].join(",")}]`;

const obj = (className: string, name: string, props: string[], rows: string[], end: number, children = "", extra: Record<string, number> = {}): string =>
  `%[ "className" => "${className}", "name" => "${name}", "uuid" => 1, ${children ? `"children" => [ ${children} ], ` : ""}` +
  Object.entries(extra).map(([k, v]) => `"${k}" => ${v}, `).join("") +
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
  const scenesOf = (...roots: string[]) => buildTimelineScenes(extractTla(ks(`4, ${scene(roots, "A")}`))!.graph)["4"]!;

  it("extrait les fonds en ms ; une position non répétée est héritée de la ligne précédente", () => {
    const bg = obj("BGObject", "blue", ["storage", "left", "top"], [
      row(0, "black", -48, -48),
      row(80, "img1", -140, null),
      row(164, "img2", -10, -20),
    ], 200);
    expect(scenesOf(bg)).toEqual({
      name: "A",
      duration: 200 * TIME_UNIT_MS,
      bg: [
        { at: 0, storage: "black", left: -48, top: -48, fade: 0 },
        { at: 80 * TIME_UNIT_MS, storage: "img1", left: -140, top: -48, fade: 0 },
        { at: 164 * TIME_UNIT_MS, storage: "img2", left: -10, top: -20, fade: 0 },
      ],
      moves: [],
      audio: [],
    });
  });

  it("sans position dans les données, le fond reste centré et ne bouge pas", () => {
    const s = scenesOf(obj("BGObject", "blue", ["storage"], [row(0, "black"), row(40, "img")], 50));
    expect(s.bg).toEqual([{ at: 0, storage: "black", fade: 0 }, { at: 40 * TIME_UNIT_MS, storage: "img", fade: 0 }]);
    expect(s.moves).toEqual([]);
  });

  it("panoramique : interpolation linéaire tant que l'indicateur d'interpolation est actif", () => {
    const s = scenesOf(obj("BGObject", "blue", ["storage", "left", "top"], [
      rowI(0, 0, "black", -48, -48),
      rowI(20, 1, "pano", -99, null),
      rowI(120, 0, null, -167.75, null),
      rowI(200, null, null, -10, null),
    ], 300));
    expect(s.bg.map((b) => [b.at, b.storage, b.left, b.top])).toEqual([[0, "black", -48, -48], [1000, "pano", -99, -48]]);
    // Interpolé de 20 à 120 ; à 200, l'interpolation est coupée : saut immédiat.
    expect(s.moves).toEqual([
      { at: 1000, left: -167.75, top: -48, time: 5000 },
      { at: 10000, left: -10, top: -48, time: 0 },
    ]);
  });

  it("l'indicateur d'interpolation reste actif sur les lignes qui ne le précisent pas", () => {
    const s = scenesOf(obj("BGObject", "blue", ["storage", "left", "top"], [
      rowI(0, 1, "img", 0, 0),
      rowI(10, null, null, -50, null),
      rowI(20, null, null, -100, null),
    ], 30));
    // Deux segments alignés (même vitesse) : un seul panoramique.
    expect(s.moves).toEqual([{ at: 0, left: -100, top: 0, time: 20 * TIME_UNIT_MS }]);
  });

  /** Page visible : 0 jusqu'à 20, fondu vers 1 de 20 à 60, fondu vers 0 de 100 à 140. */
  const pageObj = obj("PageObject", "page", ["page", "progress"], [
    rowI(0, 0, 0, null),
    rowI(20, 1, null, null),
    rowI(60, 0, 1, null),
    rowI(100, 1, null, null),
    rowI(140, null, 0, null),
  ], 200);

  it("le PageObject choisit la page visible : ordre du film, fondu de la durée du changement de page", () => {
    const blue = obj("BGObject", "blue", ["storage", "left", "top"], [row(0, "black", -48, -48), row(30, "b1"), row(150, "b-coupe")], 200, "", { page: 0 });
    const white = obj("BGObject", "white", ["storage", "left", "top"], [row(0, "black", -48, -48), row(20, "w1"), row(120, "w-cache")], 200, "", { page: 1 });
    // b1 est préparé sur la page cachée (à 30) mais montré à 100 ; w-cache n'est jamais
    // visible ; b-coupe change l'image de la page visible : coupe franche.
    expect(scenesOf(pageObj, blue, white).bg).toEqual([
      { at: 0, storage: "black", left: -48, top: -48, fade: 0 },
      { at: 1000, storage: "w1", left: -48, top: -48, fade: 2000 },
      { at: 5000, storage: "b1", left: -48, top: -48, fade: 2000 },
      { at: 7500, storage: "b-coupe", left: -48, top: -48, fade: 0 },
    ]);
  });

  it("une image posée pendant le fondu est celle qu'on montre", () => {
    const blue = obj("BGObject", "blue", ["storage"], [row(0, "black"), row(100, "b-avant"), row(101, "b-après")], 200, "", { page: 0 });
    const white = obj("BGObject", "white", ["storage"], [row(0, "black"), row(20, "w1")], 200, "", { page: 1 });
    expect(scenesOf(pageObj, blue, white).bg.map((b) => b.storage)).toEqual(["black", "w1", "b-après"]);
  });

  it("un plan qui commence en plein panoramique part de la position interpolée et termine le mouvement", () => {
    const blue = obj("BGObject", "blue", ["storage", "left", "top"], [
      rowI(0, 0, "black", -48, -48),
      rowI(60, 1, "b1", -100, 0),
      rowI(160, 0, null, -200, null),
    ], 200, "", { page: 0 });
    const white = obj("BGObject", "white", ["storage", "left", "top"], [row(0, "black", -48, -48), row(20, "w1")], 200, "", { page: 1 });
    const s = scenesOf(pageObj, blue, white);
    expect(s.bg[2]).toEqual({ at: 5000, storage: "b1", left: -140, top: 0, fade: 2000 });
    expect(s.moves).toEqual([{ at: 5000, left: -200, top: 0, time: 3000 }]);
  });

  it("sans PageObject, seule la page du premier fond est montrée", () => {
    const a = obj("BGObject", "blue", ["storage"], [row(0, "black"), row(80, "b1")], 100);
    const b = obj("BGObject", "white", ["storage"], [row(20, "w1"), row(40, "w2")], 100);
    expect(scenesOf(a, b).bg.map((x) => x.storage)).toEqual(["black", "b1"]);
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
