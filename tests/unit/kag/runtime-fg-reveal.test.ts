import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";
import type { RenderEvent, SceneState } from "@/kag/events.js";

type SceneEvent = Extract<RenderEvent, { kind: "scene" }>;

/** Joue la première page du script ; retourne tous les événements de scène et le pas complet. */
function play(source: string) {
  const runtime = new Runtime(parse(lex(source)));
  const step = runtime.step();
  const scenes = step.events.filter((e): e is SceneEvent => e.kind === "scene");
  return { scenes, step, last: scenes[scenes.length - 1]?.scene as SceneState | undefined };
}

const FOND = "@bg storage=fond noclear=0";
const PANNEAU = "@partbg storage=cuisine srcleft=4 srctop=344 index=1000 width=723 height=576 center=401 bgstorage=black noclear=1 id=pb1";

/**
 * `@fg`/`@chgfg` avec `time>0` et sans `page=` font leur propre transition (comme `@bg`/`@partbg`).
 * Avant, le calque restait sur la page back et le personnage n'apparaissait qu'à la transition
 * suivante, voire jamais dans la page (scène de cuisine du chapitre 1.5).
 */
describe("Runtime — @fg / @chgfg avec time : le calque est montré tout de suite", () => {
  it("@fg time=300 rule=crossfade : une scène avec le personnage, fondu de 300 ms, bloquante", () => {
    const { scenes, step } = play(`
${PANNEAU}
@fg rule=crossfade time=300 storage=perso center=768 vcenter=305 index=2100 type=13
texte inventé
`);
    const withFg = scenes.filter((s) => s.scene.sprites.some((sp) => sp.id === "perso"));
    expect(withFg).toHaveLength(1);
    expect(withFg[0].transition).toEqual({ method: "crossfade", time: 300 });
    const sprite = withFg[0].scene.sprites.find((sp) => sp.id === "perso");
    expect(sprite).toMatchObject({ x: 768, y: 305, z: 2100 });
    // Le fondu bloque la suite jusqu'à sa fin (comme @bg).
    expect(step.stop).toMatchObject({ kind: "waitFor", what: "transition" });
  });

  it("nowait=1 : la scène part sans bloquer l'exécution", () => {
    const { scenes, step } = play(`
${FOND}
@fg time=300 nowait=1 storage=perso center=768 vcenter=305 index=2100
texte inventé
`);
    expect(scenes.some((s) => s.scene.sprites.some((sp) => sp.id === "perso"))).toBe(true);
    expect(step.stop).not.toMatchObject({ kind: "waitFor", what: "transition" });
  });

  it("@chgfg time=300 sans rule : crossfade, le visage change sur place avec la position gardée", () => {
    const { scenes } = play(`
${FOND}
@fg storage=perso center=768 vcenter=305 index=2100
@chgfg storage=perso2 id=perso time=300 nowait=1
texte inventé
`);
    const last = scenes[scenes.length - 1];
    expect(last.transition).toEqual({ method: "crossfade", time: 300 });
    expect(last.scene.sprites).toHaveLength(1);
    expect(last.scene.sprites[0]).toMatchObject({ id: "perso", storage: "perso2", x: 768, y: 305, z: 2100 });
  });

  it("@chgfg time=300 : le sprite posé plus haut sur back apparaît dans la scène émise", () => {
    const { last } = play(`
${FOND}
@fg storage=perso center=768 vcenter=305 index=2100
@chgfg storage=perso2 id=perso time=300 nowait=1
texte inventé
`);
    expect(last?.sprites.map((s) => s.id)).toEqual(["perso"]);
  });

  it("sans time : le calque reste sur back, aucune scène (la prochaine transition le montre)", () => {
    const { scenes } = play(`
${FOND}
@fg storage=perso center=768 vcenter=305 index=2100
texte inventé
`);
    expect(scenes.some((s) => s.scene.sprites.some((sp) => sp.id === "perso"))).toBe(false);
  });

  it("page=back explicite : pas de transition implicite, même avec time", () => {
    const { scenes } = play(`
${FOND}
@fg page=back time=300 storage=perso center=768 vcenter=305 index=2100
texte inventé
`);
    expect(scenes.some((s) => s.scene.sprites.some((sp) => sp.id === "perso"))).toBe(false);
  });

  it("time=0 : pas de transition implicite", () => {
    const { scenes } = play(`
${FOND}
@fg time=0 storage=perso center=768 vcenter=305 index=2100
texte inventé
`);
    expect(scenes.some((s) => s.scene.sprites.some((sp) => sp.id === "perso"))).toBe(false);
  });

  it("le panneau (partbg) et le zoom du personnage restent dans la scène du fondu", () => {
    const { last } = play(`
${PANNEAU}
@fg time=300 nowait=1 storage=perso center=768 vcenter=305 index=2100 zoom=90
texte inventé
`);
    const ids = last?.sprites.map((s) => s.id).sort();
    expect(ids).toEqual(["pb1", "perso"]);
    expect(last?.sprites.find((s) => s.id === "perso")).toMatchObject({ zoomx: 90, zoomy: 90 });
    expect(last?.sprites.find((s) => s.id === "pb1")).toMatchObject({ x: 401, y: 288 });
  });
});

describe("parser — time, rule, nowait et canskip de @fg / @chgfg", () => {
  it("@fg et @chgfg gardent leurs attributs de transition", () => {
    const fg = parse(lex("@fg rule=crossfade time=300 storage=a center=1 vcenter=2 nowait=1")).pages[0].instructions[0];
    expect(fg).toMatchObject({ kind: "fg", time: 300, rule: "crossfade", nowait: true, canskip: true });
    const chg = parse(lex("@chgfg storage=a time=300 canskip=0")).pages[0].instructions[0];
    expect(chg).toMatchObject({ kind: "chgfg", time: 300, nowait: false, canskip: false });
  });
});
