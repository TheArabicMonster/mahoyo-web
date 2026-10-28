import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";

const SAMPLE = `
*page0|
@bg time=100 rule=crossfade storage=black
　その子の影になったのは８年前の冬のこと。[l][r]
　彼女がはじめて命に[ruby text=ふ]触れた。
@pg
*page1|
@fg storage=青子 center=512 vcenter=288 index=1000
@play storage=m19
@pg
`;

describe("parse", () => {
  it("produces pages separated by labels and @pg", () => {
    const script = parse(lex(SAMPLE));
    expect(script.pages.length).toBeGreaterThanOrEqual(2);
  });

  it("indexes labels", () => {
    const script = parse(lex(SAMPLE));
    expect(script.labels["page0"]).toBe(0);
    expect(script.labels["page1"]).toBe(1);
  });

  it("parses @bg into bg instruction", () => {
    const script = parse(lex("@bg time=100 rule=crossfade storage=black"));
    const page = script.pages[0];
    expect(page).toBeDefined();
    const bg = page.instructions.find((i) => i.kind === "bg");
    expect(bg).toEqual({
      kind: "bg",
      storage: "black",
      time: 100,
      rule: "crossfade",
      left: undefined,
      top: undefined,
      page: undefined,
      noclear: false,
      nowait: false,
      canskip: true,
    });
  });

  it("parses text with ruby annotation", () => {
    const script = parse(lex("あいう[ruby text=え]お。"));
    const page = script.pages[0];
    const textInstr = page.instructions.find((i) => i.kind === "text");
    expect(textInstr).toBeDefined();
    if (textInstr && textInstr.kind === "text") {
      // Should have: "あいう" (plain), "お" (with ruby "え"), "。" (plain)
      expect(textInstr.segments).toEqual([
        { text: "あいう" },
        { text: "お", ruby: "え" },
        { text: "。" },
      ]);
    }
  });

  it("parses ruby with char count", () => {
    const script = parse(lex("[ruby char=2 text=ちゅうふく]中腹"));
    const page = script.pages[0];
    const textInstr = page.instructions.find((i) => i.kind === "text");
    expect(textInstr).toBeDefined();
    if (textInstr && textInstr.kind === "text") {
      expect(textInstr.segments).toEqual([
        { text: "中腹", ruby: "ちゅうふく" },
      ]);
    }
  });

  it("parses @fgact with keyframes as animate instruction", () => {
    const source = `@fgact page=back props=-storage,center,vcenter,opacity,-visible keys=(0,0,n,im森絵b,512,288,0,1)(450,,l,,,,,)(600,,n,,,,255,)(1050,,l,,,,,)(1200,,n,,,,0,) loop=1 storage=im森絵b`;
    const script = parse(lex(source));
    const page = script.pages[0];
    const anim = page.instructions.find((i) => i.kind === "animate");
    expect(anim).toBeDefined();
    if (anim && anim.kind === "animate") {
      expect(anim.def.storage).toBe("im森絵b");
      expect(anim.def.page).toBe("back");
      expect(anim.def.keyframes.length).toBeGreaterThanOrEqual(2);
      expect(anim.def.loop).toBe(true);
    }
  });

  it("parses @movefg with time as animate instruction", () => {
    const source = `@movefg storage=red time=3000 accel=0 center=512 vcenter=288 opacity=80`;
    const script = parse(lex(source));
    const page = script.pages[0];
    const anim = page.instructions.find((i) => i.kind === "animate");
    expect(anim).toBeDefined();
    if (anim && anim.kind === "animate") {
      expect(anim.def.storage).toBe("red");
      expect(anim.def.keyframes.length).toBe(2);
      const last = anim.def.keyframes[1];
      expect(last.center).toBe(512);
      expect(last.opacity).toBeCloseTo(80 / 255, 1);
    }
  });

  it("parses @partbgact as animate instruction with isPartbg flag", () => {
    // Échantillon réel simplifié : srcleft/srctop animés sur 30 000 ms.
    const source = `@partbgact storage=im02空(曇り) page=fore keys=(0,0,l,0,0,100,100)(30000,0,l,-542,0,100,100) props=srcleft,srctop,srczoomx,srczoomy`;
    const script = parse(lex(source));
    const page = script.pages[0];
    const anim = page.instructions.find((i) => i.kind === "animate");
    expect(anim).toBeDefined();
    if (anim && anim.kind === "animate") {
      expect(anim.def.storage).toBe("im02空(曇り)");
      expect(anim.def.isPartbg).toBe(true);
      expect(anim.def.keyframes.length).toBe(2);
      const last = anim.def.keyframes[1];
      expect(last.srcleft).toBe(-542);
      expect(last.srctop).toBe(0);
      expect(last.srczoomx).toBe(100);
      expect(last.srczoomy).toBe(100);
      // Durée absolue = 30000.
      expect(last.time).toBe(30000);
    }
  });

  it("parses @partbgact with float srctop (ex. -103.52)", () => {
    const source = `@partbgact storage=im02 keys=(0,0,l,0,-103.52,100,100)(1000,0,l,0,0,100,100) props=srcleft,srctop,srczoomx,srczoomy`;
    const script = parse(lex(source));
    const page = script.pages[0];
    const anim = page.instructions.find((i) => i.kind === "animate");
    expect(anim).toBeDefined();
    if (anim && anim.kind === "animate") {
      const first = anim.def.keyframes[0];
      expect(first.srctop).toBeCloseTo(-103.52, 2);
    }
  });

  it("parses @sestop with storage and time", () => {
    const script = parse(lex("@sestop storage=se01043 time=3000"));
    const page = script.pages[0];
    const instr = page.instructions.find((i) => i.kind === "sestop");
    expect(instr).toBeDefined();
    if (instr && instr.kind === "sestop") {
      expect(instr.storage).toBe("se01043");
      expect(instr.time).toBe(3000);
    }
  });

  it("parses @fadese", () => {
    const script = parse(lex("@fadese storage=se01003 time=2000 volume=40"));
    const page = script.pages[0];
    const instr = page.instructions.find((i) => i.kind === "fadese");
    expect(instr).toBeDefined();
    if (instr && instr.kind === "fadese") {
      expect(instr.storage).toBe("se01003");
      expect(instr.time).toBe(2000);
      expect(instr.volume).toBe(40);
    }
  });

  it("parses @playstop and @fadebgm", () => {
    const script = parse(lex("@playstop time=500\n@fadebgm time=2000 volume=50"));
    const page = script.pages[0];
    const stop = page.instructions.find((i) => i.kind === "playstop");
    const fade = page.instructions.find((i) => i.kind === "fadebgm");
    expect(stop).toBeDefined();
    expect(fade).toBeDefined();
    if (stop && stop.kind === "playstop") {
      expect(stop.time).toBe(500);
    }
    if (fade && fade.kind === "fadebgm") {
      expect(fade.time).toBe(2000);
      expect(fade.volume).toBe(50);
    }
  });

  it("parses @se with loop and delay", () => {
    const script = parse(lex("@se storage=se01 loop=true delay=300 volume=80"));
    const page = script.pages[0];
    const instr = page.instructions.find((i) => i.kind === "se");
    expect(instr).toBeDefined();
    if (instr && instr.kind === "se") {
      expect(instr.storage).toBe("se01");
      expect(instr.loop).toBe(true);
      expect(instr.delay).toBe(300);
      expect(instr.volume).toBe(80);
    }
  });
});
