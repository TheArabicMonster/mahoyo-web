/** Lookahead de préchargement (#367) : parcours du programme sans changer l'état. */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";

const runtime = (src: string) => new Runtime(parse(lex(src)));

describe("Runtime.peekAssets (#367)", () => {
  it("collecte bg/image/fg et l'audio annoncé", () => {
    const peek = runtime(
      "@bg storage=bg01\n@fg storage=perso01 center=512 vcenter=288 index=1000\n@play storage=m01\n@se storage=se01\n@pg\n",
    ).peekAssets();
    expect(peek.assets).toEqual([
      { kind: "bg", storage: "bg01" },
      { kind: "image", storage: "perso01" },
    ]);
    expect(peek.audio).toEqual([
      { kind: "bgm", storage: "m01" },
      { kind: "se", storage: "se01" },
    ]);
    expect(peek.atEnd).toBe(true); // le programme d'une page est entièrement parcouru
  });

  it("suit les deux branches d'un @if aplati", () => {
    const peek = runtime(
      '@if exp="f.x"\n@bg storage=bgA\n@else\n@bg storage=bgB\n@endif\n@bg storage=bgC\n@pg\n',
    ).peekAssets(20);
    const storages = peek.assets.map((a) => a.storage);
    expect(storages).toContain("bga");
    expect(storages).toContain("bgb");
    expect(storages).toContain("bgc");
  });

  it("suit un @jump et un @call internes", () => {
    const jump = runtime("@bg storage=start\n@jump target=*cible\n@bg storage=killed\n@pg\n*cible\n@bg storage=after\n@pg\n");
    expect(jump.peekAssets(20).assets.map((a) => a.storage)).toEqual(["start", "after"]);

    const call = runtime("@bg storage=start\n@call target=*sub\n@bg storage=after\n@pg\n*sub\n@bg storage=sub\n@return\n@pg\n");
    const storages = call.peekAssets(20).assets.map((a) => a.storage);
    expect(storages).toContain("start");
    expect(storages).toContain("sub");
    expect(storages).toContain("after");
  });

  it("respecte le budget de commandes", () => {
    const peek = runtime("@bg storage=a\n@bg storage=b\n@bg storage=c\n@bg storage=d\n@pg\n").peekAssets(2);
    expect(peek.assets).toHaveLength(2);
  });

  it("en fin de fichier, continue dans le script suivant", () => {
    const current = runtime("@bg storage=last\n@pg\n");
    const next = parse(lex("@bg storage=nextA\n@bg storage=nextB\n@pg\n"));
    const peek = current.peekAssets(20, next);
    expect(peek.atEnd).toBe(true);
    expect(peek.assets.map((a) => a.storage)).toContain("nexta");
    expect(peek.assets.map((a) => a.storage)).toContain("nextb");
  });

  it("ne modifie pas la position du runtime", () => {
    const rt = runtime("@bg storage=a\n@bg storage=b\n@pg\n");
    const before = rt.getSaveData();
    rt.peekAssets();
    expect(rt.getSaveData()).toEqual(before);
  });
});
