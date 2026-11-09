// Tests d'avance #282 — parser des actions/effets de scène (TDD, implémentation à venir).
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import type { Instruction } from "@/kag/types.js";

const first = (source: string): Instruction => parse(lex(source)).pages[0]!.instructions[0]!;

describe("parse — @action (#282)", () => {
  it("module réel LayerNormalMoveModule (args de wik_k.ks)", () => {
    expect(
      first(
        "@action page=fore id=pb1 module=LayerNormalMoveModule startx=335 x=94 starty=81 y=81 time=700 accel=-2 nonstop=1",
      ),
    ).toMatchObject({
      kind: "action",
      page: "fore",
      id: "pb1",
      module: "LayerNormalMoveModule",
      startx: 335,
      x: 94,
      starty: 81,
      y: 81,
      time: 700,
      accel: -2,
      nonstop: true,
    });
  });

  it("module par défaut = LayerNormalMoveModule, time requis (0 par défaut)", () => {
    expect(first("@action id=pb1 x=10 y=20")).toMatchObject({
      kind: "action",
      id: "pb1",
      module: "LayerNormalMoveModule",
      time: 0,
    });
  });
});

describe("parse — @removeaction / @pauseaction / @resumeaction (#282)", () => {
  it("@removeaction (args réels de wik_z-3.ks, y compris la coquille pege= ignorée)", () => {
    expect(first("@removeaction pege=fore storage=異空間の雲a")).toMatchObject({
      kind: "removeaction",
      storage: "異空間の雲a",
    });
    expect(first("@removeaction page=back id=pb1")).toMatchObject({
      kind: "removeaction",
      page: "back",
      id: "pb1",
    });
  });

  it("@pauseaction : `all=` et cible ; @resumeaction : cible", () => {
    expect(first("@pauseaction all=1")).toMatchObject({ kind: "pauseaction", all: true });
    expect(first("@pauseaction page=back id=pb1")).toMatchObject({
      kind: "pauseaction",
      all: false,
      page: "back",
      id: "pb1",
    });
    expect(first("@resumeaction page=back id=pb1")).toMatchObject({
      kind: "resumeaction",
      page: "back",
      id: "pb1",
    });
  });
});

describe("parse — @pauseploy / @resumeploy (#282)", () => {
  it("commandes sans argument (nz6.ks)", () => {
    expect(first("@pauseploy")).toEqual({ kind: "pauseploy" });
    expect(first("@resumeploy")).toEqual({ kind: "resumeploy" });
  });
});

describe("parse — @beginfallnote / @fallnoteopt / @endfallnote (#282, approximation)", () => {
  it("begin/end sans argument, opt rate= (wik_g-a.ks)", () => {
    expect(first("@beginfallnote")).toMatchObject({ kind: "beginfallnote" });
    expect(first("@fallnoteopt rate=0.10")).toMatchObject({ kind: "fallnoteopt", rate: 0.1 });
    expect(first("@endfallnote")).toMatchObject({ kind: "endfallnote" });
    // `index=`/`page=` reconnus pour begin (ignorés dans l'approximation, mais parsés).
    expect(first("@beginfallnote index=20000 page=fore")).toMatchObject({
      kind: "beginfallnote",
      index: 20000,
      page: "fore",
    });
  });
});
