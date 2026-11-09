import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";

const SAMPLE = `
*page0|
@bg time=100 rule=crossfade storage=black
\u3000その子の影になったのは８年前の冬のこと。[l][r]
\u3000彼女がはじめて命に[ruby text=ふ]触れた。
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

  it("does not split pages on a label without @pg", () => {
    const script = parse(lex("*start|@bg storage=black"));
    expect(script.pages.length).toBe(1);
    expect(script.pages[0].label).toBe("start");
  });

  it("indexes labels on the current page", () => {
    const script = parse(lex("*start|@bg storage=black@pg"));
    expect(script.labels["start"]).toBe(0);
  });

  it("keeps a label before @pg in the same page", () => {
    const script = parse(lex(SAMPLE));
    expect(script.pages[0].label).toBe("page0");
    expect(script.pages[1].label).toBe("page1");
  });

  it("keeps the first label when multiple labels appear in the same page", () => {
    const script = parse(lex("*a|\n*b|\n@bg storage=black\n@pg"));
    expect(script.pages.length).toBe(1);
    expect(script.pages[0].label).toBe("a");
    expect(script.labels["a"]).toBe(0);
    expect(script.labels["b"]).toBe(0);
  });

  it("flushes pending text before a label", () => {
    const script = parse(lex("texte A\n*label\ntexte B\n@pg"));
    expect(script.pages[0].instructions.length).toBe(2);
    const textA = script.pages[0].instructions[0];
    const textB = script.pages[0].instructions[1];
    expect(textA.kind).toBe("text");
    expect(textB.kind).toBe("text");
    expect(script.labelInstructionIndex["label"]).toBe(1);
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

  it("parses @if...@endif as a single conditional instruction", () => {
    const script = parse(lex([
      `@if cond="1"`,
      `@eval exp="f.x = 1"`,
      `@endif`,
    ].join("\n")));
    const page = script.pages[0];
    const conditional = page.instructions.find((i) => i.kind === "conditional");
    expect(conditional).toBeDefined();
    if (conditional && conditional.kind === "conditional") {
      expect(conditional.branches.length).toBe(1);
      expect(conditional.branches[0].cond).toBe("1");
      expect(conditional.branches[0].instructions.length).toBe(1);
      expect(conditional.branches[0].instructions[0].kind).toBe("eval");
    }
  });

  it("parses @if...@else...@endif with two branches", () => {
    const script = parse(lex([
      `@if cond="0"`,
      `@eval exp="f.x = 1"`,
      `@else`,
      `@eval exp="f.x = 2"`,
      `@endif`,
    ].join("\n")));
    const page = script.pages[0];
    const conditional = page.instructions.find((i) => i.kind === "conditional");
    expect(conditional).toBeDefined();
    if (conditional && conditional.kind === "conditional") {
      expect(conditional.branches.length).toBe(2);
      expect(conditional.branches[0].cond).toBe("0");
      expect(conditional.branches[0].instructions[0].kind).toBe("eval");
      expect(conditional.branches[1].cond).toBeUndefined();
      expect(conditional.branches[1].instructions[0].kind).toBe("eval");
    }
  });

  it("parses nested @if blocks", () => {
    const script = parse(lex([
      `@if cond="1"`,
      `@if cond="2"`,
      `@eval exp="f.x = 1"`,
      `@endif`,
      `@endif`,
    ].join("\n")));
    const page = script.pages[0];
    const outer = page.instructions.find((i) => i.kind === "conditional");
    expect(outer).toBeDefined();
    if (outer && outer.kind === "conditional") {
      expect(outer.branches[0].instructions[0].kind).toBe("conditional");
    }
  });

  it("parses @macro...@endmacro as a macrodef instruction", () => {
    const script = parse(lex([
      `@macro name=toto`,
      `@eval exp="f.flag = 1"`,
      `@endmacro`,
    ].join("\n")));
    const page = script.pages[0];
    const macro = page.instructions.find((i) => i.kind === "macrodef");
    expect(macro).toBeDefined();
    if (macro && macro.kind === "macrodef") {
      expect(macro.name).toBe("toto");
      // rawTokens contains all tokens between @macro and @endmacro
      // (linebreaks, commands, etc.)
      expect(macro.rawTokens.length).toBeGreaterThanOrEqual(1);
      const evalToken = macro.rawTokens.find((t) => t.type === "command");
      expect(evalToken).toBeDefined();
      expect(evalToken?.type === "command" ? evalToken.name : undefined).toBe("eval");
    }
  });

  // ── Inline tags routed through parseCommand ──

  it("parses [chgfg ...] inline tag as chgfg instruction", () => {
    const script = parse(lex("texte[chgfg rule=crossfade time=300 storage=foo]suite"));
    const page = script.pages[0];
    const chgfg = page.instructions.find((i) => i.kind === "chgfg");
    expect(chgfg).toBeDefined();
    if (chgfg && chgfg.kind === "chgfg") {
      expect(chgfg.storage).toBe("foo");
    }
    // No raw instruction should be produced
    const raw = page.instructions.find((i) => i.kind === "raw");
    expect(raw).toBeUndefined();
  });

  it("parses [fg ...] inline tag as fg instruction", () => {
    const script = parse(lex("texte[fg storage=bar center=512 vcenter=288 index=1000]suite"));
    const page = script.pages[0];
    const fg = page.instructions.find((i) => i.kind === "fg");
    expect(fg).toBeDefined();
    if (fg && fg.kind === "fg") {
      expect(fg.storage).toBe("bar");
    }
    const raw = page.instructions.find((i) => i.kind === "raw");
    expect(raw).toBeUndefined();
  });

  it("parses [se ...] inline tag as se instruction", () => {
    const script = parse(lex("texte[se storage=se01 volume=80]suite"));
    const page = script.pages[0];
    const se = page.instructions.find((i) => i.kind === "se");
    expect(se).toBeDefined();
    if (se && se.kind === "se") {
      expect(se.storage).toBe("se01");
      expect(se.volume).toBe(80);
    }
    const raw = page.instructions.find((i) => i.kind === "raw");
    expect(raw).toBeUndefined();
  });

  it("parses @seact with delay, fadeIn, volume, and loop", () => {
    const source = `@seact textoff=0 keys=(300,play,se01025,0,,,0,,60,-70)`;
    const script = parse(lex(source));
    const page = script.pages[0];
    const seact = page.instructions.find((i) => i.kind === "seact");
    expect(seact).toBeDefined();
    if (seact && seact.kind === "seact") {
      expect(seact.storage).toBe("se01025");
      expect(seact.delay).toBe(300);
      expect(seact.fadeIn).toBe(0);
      expect(seact.volume).toBe(100); // valeur par défaut quand vide
      expect(seact.loop).toBe(false);
    }
  });

  it("parses @seact with fadeIn and volume", () => {
    const source = `@seact textoff=0 keys=(0,play,se01016,2000,100,,0,100,100,-30)`;
    const script = parse(lex(source));
    const page = script.pages[0];
    const seact = page.instructions.find((i) => i.kind === "seact");
    expect(seact).toBeDefined();
    if (seact && seact.kind === "seact") {
      expect(seact.storage).toBe("se01016");
      expect(seact.delay).toBe(0);
      expect(seact.fadeIn).toBe(2000);
      expect(seact.volume).toBe(100);
      expect(seact.loop).toBe(false);
    }
  });

  it("parses @seact with loop=1", () => {
    const source = `@seact textoff=0 keys=(0,play,se01024,4000,60,,1,-60,10,-100)`;
    const script = parse(lex(source));
    const page = script.pages[0];
    const seact = page.instructions.find((i) => i.kind === "seact");
    expect(seact).toBeDefined();
    if (seact && seact.kind === "seact") {
      expect(seact.storage).toBe("se01024");
      expect(seact.delay).toBe(0);
      expect(seact.fadeIn).toBe(4000);
      expect(seact.volume).toBe(60);
      expect(seact.loop).toBe(true);
    }
  });

  it("parses @seact with Japanese storage name", () => {
    const source = `@seact keys=(0,play,se12宇宙の果て01,1500,100,,0,-100,80,100)`;
    const script = parse(lex(source));
    const page = script.pages[0];
    const seact = page.instructions.find((i) => i.kind === "seact");
    expect(seact).toBeDefined();
    if (seact && seact.kind === "seact") {
      expect(seact.storage).toBe("se12宇宙の果て01");
    }
  });

  it("parses [wait ...] inline tag as wait instruction", () => {
    const script = parse(lex("texte[wait canskip=0 time=400]suite"));
    const page = script.pages[0];
    const wait = page.instructions.find((i) => i.kind === "wait");
    expect(wait).toBeDefined();
    if (wait && wait.kind === "wait") {
      expect(wait.time).toBe(400);
      expect(wait.skippable).toBe(false);
    }
    const raw = page.instructions.find((i) => i.kind === "raw");
    expect(raw).toBeUndefined();
  });

  it("parses unknown inline tag [foo ...] as raw instruction", () => {
    const script = parse(lex("texte[foo bar=baz]suite"));
    const page = script.pages[0];
    const raw = page.instructions.find((i) => i.kind === "raw");
    expect(raw).toBeDefined();
    if (raw && raw.kind === "raw") {
      expect(raw.command).toBe("foo");
    }
  });
});

describe("parse @movefg — center/vcenter absents (#65)", () => {
  function moveKeyframes(src: string) {
    const ins = parse(lex(src)).pages[0]?.instructions[0];
    if (!ins || ins.kind !== "animate") throw new Error("animate attendu");
    return ins.def.keyframes;
  }

  it("center et vcenter absents restent indéfinis (conserver la position)", () => {
    const kf = moveKeyframes("@movefg storage=red time=100 opacity=80");
    expect(kf[1]?.center).toBeUndefined();
    expect(kf[1]?.vcenter).toBeUndefined();
  });

  it("center=0 explicite reste 0 : absent et nul sont distingués", () => {
    const kf = moveKeyframes("@movefg storage=red time=100 center=0 vcenter=0");
    expect(kf[1]?.center).toBe(0);
    expect(kf[1]?.vcenter).toBe(0);
  });

  it("un seul des deux attributs fourni", () => {
    const kf = moveKeyframes("@movefg storage=red time=100 center=300");
    expect(kf[1]?.center).toBe(300);
    expect(kf[1]?.vcenter).toBeUndefined();
  });

  it("même comportement pour @movepartbg", () => {
    const kf = moveKeyframes("@movepartbg storage=im09 time=100 vcenter=200");
    expect(kf[1]?.center).toBeUndefined();
    expect(kf[1]?.vcenter).toBe(200);
  });
});

describe("parse — position par défaut des calques (#134)", () => {
  const first = (source: string) => parse(lex(source)).pages[0]!.instructions.find((i) => i.kind === "partbg" || i.kind === "fg");

  it("un @partbg sans vcenter est centré verticalement sur l'écran 1024×576", () => {
    // Forme du prologue : bande de 522×576 centrée en x=748, sans vcenter.
    const ins = first("@partbg storage=nuages srcleft=542 index=1000 width=522 height=576 center=748 id=pb1");
    expect(ins?.kind).toBe("partbg");
    if (ins?.kind === "partbg") {
      expect(ins.center).toBe(748);
      expect(ins.vcenter).toBe(288);
      // Une bande de 576 de haut centrée en 288 occupe tout l'écran, de 0 à 576.
      expect(ins.vcenter - ins.crop.height / 2).toBe(0);
    }
  });

  it("un @partbg sans center ni vcenter est centré sur l'écran", () => {
    const ins = first("@partbg storage=pano width=1024 height=576");
    expect(ins).toMatchObject({ kind: "partbg", center: 512, vcenter: 288 });
  });

  it("un @fg sans center ni vcenter est centré sur l'écran, un axe donné est respecté", () => {
    expect(first("@fg storage=a index=10")).toMatchObject({ kind: "fg", center: 512, vcenter: 288 });
    expect(first("@fg storage=a center=285 index=10")).toMatchObject({ center: 285, vcenter: 288 });
    expect(first("@fg storage=a vcenter=-570 index=10")).toMatchObject({ center: 512, vcenter: -570 });
  });

  it("un centre explicite à 0 reste à 0", () => {
    expect(first("@fg storage=a center=0 vcenter=0")).toMatchObject({ center: 0, vcenter: 0 });
  });
});

describe("parse — apparence des calques (#252)", () => {
  const first = (source: string) => parse(lex(source)).pages[0]!.instructions[0]!;

  it("@fg : type, effect, flou, luminosité, contraste sont lus", () => {
    const ins = first("@fg storage=ev01 center=512 vcenter=288 index=1000 type=16 effect=monoff1313 blur=6 brightness=-35 contrast=80");
    expect(ins).toMatchObject({
      kind: "fg",
      type: 16,
      effect: "monoff1313",
      blurx: 6,
      blury: 6,
      brightness: -35,
      contrast: 80,
    });
  });

  it("@bg : mêmes attributs (flou du décor de 1-1)", () => {
    const ins = first("@bg storage=im01オープニング02c time=600 rule=crossfade blur=8 contrast=-26");
    expect(ins).toMatchObject({ kind: "bg", blurx: 8, blury: 8, contrast: -26 });
  });

  it("@partbg et @chgfg : mêmes attributs", () => {
    const partbg = first("@partbg storage=pane width=420 height=576 type=19 effect=nega brightness=-18");
    expect(partbg).toMatchObject({ kind: "partbg", type: 19, effect: "nega", brightness: -18 });
    const chgfg = first("@chgfg storage=p1a|b time=300 effect=monocro blur=2");
    expect(chgfg).toMatchObject({ kind: "chgfg", effect: "monocro", blurx: 2, blury: 2 });
  });

  it("effect=none ou vide = aucun effet ; flou par axe (xblur/yblur)", () => {
    expect(first("@fg storage=a effect=none").kind === "fg" && (first("@fg storage=a effect=none") as { effect?: string }).effect).toBeUndefined();
    const ins = first("@fg storage=a xblur=4 yblur=1");
    expect(ins).toMatchObject({ kind: "fg", blurx: 4, blury: 1 });
  });

  it("un attribut absent ne pose pas de champ (le moteur applique ses défauts)", () => {
    const ins = first("@fg storage=a center=1 vcenter=2 index=3");
    expect((ins as { type?: number }).type).toBeUndefined();
    expect((ins as { effect?: string }).effect).toBeUndefined();
    expect((ins as { brightness?: number }).brightness).toBeUndefined();
    expect((ins as { contrast?: number }).contrast).toBeUndefined();
  });
});

describe("parse — commandes KAG standard (#277)", () => {
  const first = (source: string) => parse(lex(source)).pages[0]!.instructions[0]!;
  const textsOf = (source: string) => {
    const ins = parse(lex(source)).pages[0]!.instructions;
    return ins.flatMap((i) => (i.kind === "text" ? i.segments : []));
  };

  it("@image page=back layer=base = image de fond sans transition", () => {
    const ins = first("@image page=back layer=base storage=white");
    expect(ins).toMatchObject({ kind: "image", storage: "white", page: "back", layer: "base" });
  });

  it("@image accepte left/top, l'apparence et un numéro de couche", () => {
    const ins = first("@image page=fore layer=2 storage=p1b left=100 top=200 opacity=128 type=16 effect=nega");
    expect(ins).toMatchObject({
      kind: "image",
      layer: 2,
      left: 100,
      top: 200,
      opacity: 128 / 255,
      type: 16,
      effect: "nega",
    });
    // Sans layer : la couche de base est le défaut du moteur.
    expect(first("@image storage=white")).toMatchObject({ kind: "image", layer: "base" });
  });

  it("@s = arrêt du déroulement (attente de sélection)", () => {
    expect(first("@s")).toEqual({ kind: "stop" });
  });

  it("@endif/@else/@elsif/@endignore orphelins : no-op explicite, pas commande brute", () => {
    for (const command of ["endif", "else", "elsif", "endignore"]) {
      const ins = first(`@${command}`);
      expect(ins.kind).toBe("noop");
      if (ins.kind === "noop") {
        expect(ins.command).toBe(command);
        expect(ins.reason).toContain("fermeture");
      }
    }
  });

  it("@ruby numérique : ruby appliqué aux N caractères suivants", () => {
    const segments = textsOf('@ruby char=2 text=かんじ\n漢字です');
    expect(segments).toEqual([
      { text: "漢字", ruby: "かんじ" },
      { text: "です" },
    ]);
  });

  it("@ruby avec texte de base : le texte est affiché et le ruby réparti (extension TYPE-MOON)", () => {
    const segments = textsOf('@ruby char="Ab" text="かんじ"\n次');
    expect(segments).toEqual([
      { text: "A", ruby: "かん" },
      { text: "b", ruby: "じ" },
      { text: "次" },
    ]);
  });

  it("[ruby] avec texte de base : même extension en forme balise", () => {
    const segments = textsOf('[ruby char="Ab" text="かんじ"]次');
    expect(segments).toEqual([
      { text: "A", ruby: "かん" },
      { text: "b", ruby: "じ" },
      { text: "次" },
    ]);
  });

  it("[ruby char=N] conserve la sémantique existante (N caractères suivants)", () => {
    const segments = textsOf("[ruby text=ふ char=1]触れた");
    expect(segments).toEqual([{ text: "触", ruby: "ふ" }, { text: "れた" }]);
  });
});

describe("parse — crédits de fin (#286)", () => {
  const first = (source: string) => parse(lex(source)).pages[0]!.instructions[0]!;

  it("@wstaffroll = attente de fin de défilement, non skippable (plugin d'origine)", () => {
    expect(first("@wstaffroll")).toEqual({ kind: "waitfor", what: "staffroll", skippable: false });
  });

  it("@staffrolluninit", () => {
    expect(first("@staffrolluninit")).toEqual({ kind: "staffrolluninit" });
  });

  it("@staffrollsetting bgcolor (ARGB 0xFF000000 → #000000)", () => {
    expect(first("@staffrollsetting bgcolor=0xFF000000")).toEqual({
      kind: "staffrollsetting",
      bgcolor: "#000000",
    });
  });

  it("@staffrollsetting bgcolor avec alpha non opaque (0x80FF0000 → #ff000080)", () => {
    expect(first("@staffrollsetting bgcolor=0x80FF0000")).toEqual({
      kind: "staffrollsetting",
      bgcolor: "#ff000080",
    });
  });

  it("@staffrollinit/text/start restent lus (non-régression)", () => {
    const ins = parse(lex('@staffrollinit face="ＭＳ Ｐ明朝"\n@staffrolltext size=19 y=612 text="x"\n@staffrollstart height=11252 time=160000')).pages[0]!.instructions;
    expect(ins[0]).toMatchObject({ kind: "staffrollinit", face: "ＭＳ Ｐ明朝" });
    expect(ins[1]).toMatchObject({ kind: "staffrolltext", text: "x", y: 612, size: 19 });
    expect(ins[2]).toMatchObject({ kind: "staffrollstart", height: 11252, time: 160000 });
  });
});

describe("parse — audio et déroulement (#285)", () => {
  const first = (source: string) => parse(lex(source)).pages[0]!.instructions[0]!;

  it("@xchgbgm : fondu croisé (time, overlap, volume, storage)", () => {
    expect(first("@xchgbgm storage=m38 time=8000 overlap=7000 volume=80")).toEqual({
      kind: "xchgbgm",
      storage: "m38",
      time: 8000,
      intime: undefined,
      outtime: undefined,
      overlap: 7000,
      volume: 80,
      loop: undefined,
    });
  });

  it("@xchgbgm : intime/outtime/loop", () => {
    expect(first("@xchgbgm storage=m10 intime=3000 outtime=4000 loop=0")).toMatchObject({
      kind: "xchgbgm",
      intime: 3000,
      outtime: 4000,
      loop: false,
    });
  });

  it("@wb : attente de fin de fondu BGM, non skippable par défaut", () => {
    expect(first("@wb")).toEqual({ kind: "waitfor", what: "bgmFade", skippable: false });
    expect(first("@wb canskip=1")).toEqual({ kind: "waitfor", what: "bgmFade", skippable: true });
  });

  it("@clickskip/@effectskip : enabled (défaut true, 0/false = false)", () => {
    expect(first("@clickskip enabled=0")).toEqual({ kind: "clickskip", enabled: false });
    expect(first("@clickskip enabled=false")).toEqual({ kind: "clickskip", enabled: false });
    expect(first("@clickskip")).toEqual({ kind: "clickskip", enabled: true });
    expect(first("@effectskip enabled=false")).toEqual({ kind: "effectskip", enabled: false });
    expect(first("@effectskip enabled=1")).toEqual({ kind: "effectskip", enabled: true });
  });

  it("@cancelskip", () => {
    expect(first("@cancelskip")).toEqual({ kind: "cancelskip" });
  });
});

describe("parse — commandes visuelles secondaires (#85)", () => {
  const first = (source: string) => parse(lex(source)).pages[0]!.instructions[0]!;

  it("@chgpartbg : image/paramètres d'un partbg existant (id, transition, apparence)", () => {
    expect(first("@chgpartbg id=pb1 storage=ev0901 time=500 rule=crossfade blur=2 textoff=0")).toMatchObject({
      kind: "chgpartbg",
      id: "pb1",
      storage: "ev0901",
      time: 500,
      rule: "crossfade",
      blurx: 2,
      blury: 2,
    });
  });

  it("@dispclock : h/m, position, zoom (zoomx/zoomy/zoom), effet, time", () => {
    expect(first("@dispclock h=10 m=51 left=-800 top=-600 time=200 effect=屋外深夜 zoom=80")).toMatchObject({
      kind: "dispclock",
      h: 10,
      m: 51,
      left: -800,
      top: -600,
      zoomx: 80,
      zoomy: 80,
      effect: "屋外深夜",
      time: 200,
    });
    expect(first("@dispclock h=3 m=18 left=-2000 top=-1300")).toMatchObject({ zoomx: 100, zoomy: 100 });
  });

  it("@tickclock : h/m, attente par défaut, `wait` inverse la sémantique du moteur", () => {
    expect(first("@tickclock h=6 m=55")).toMatchObject({ kind: "tickclock", h: 6, m: 55, wait: true });
    expect(first("@tickclock h=6 m=55 wait=1")).toMatchObject({ wait: false });
    expect(first("@tickclock h=6 m=55 wait=0")).toMatchObject({ wait: true });
  });

  it("@setdefaultmessageaction / @resetdefaultmessageaction (commande et balise en ligne)", () => {
    expect(first("@setdefaultmessageaction type=swing")).toEqual({ kind: "setdefaultmessageaction", type: "swing" });
    expect(first("@resetdefaultmessageaction")).toEqual({ kind: "resetdefaultmessageaction" });
    // Forme balise en ligne du corpus (1.5-3.ks).
    const ins = parse(lex("[setdefaultmessageaction type=swing]abc[resetdefaultmessageaction]")).pages[0]!.instructions;
    expect(ins[0]).toEqual({ kind: "setdefaultmessageaction", type: "swing" });
    expect(ins.some((i) => i.kind === "resetdefaultmessageaction")).toBe(true);
  });

  it("@fg accepte afx/afy (point d'ancrage utilisé par l'horloge)", () => {
    expect(first("@fg storage=hand center=100 vcenter=200 index=1200 afx=69 afy=621 rotate=45")).toMatchObject({
      kind: "fg",
      afx: 69,
      afy: 621,
      rotate: 45,
    });
  });
});
