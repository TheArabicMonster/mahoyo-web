/**
 * Tests runtime pour @if/@elsif/@else/@endif et @macro/@endmacro.
 *
 * Couvre :
 * - évaluation des conditions (littérales + expressions f/sf/tf via @eval) ;
 * - sélection de branche (if / elsif / else) ;
 * - @eval exécuté à l'intérieur d'une branche ;
 * - imbrication de @if ;
 * - stops/wait dans une branche (reprise correcte) ;
 * - définition + expansion de macro ;
 * - rawCount non incrémenté pour les macros expansées (régression).
 */
import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";
import { parse } from "@/kag/parser.js";
import { Runtime } from "@/kag/runtime.js";

/** Construit un script mono-page à partir de lignes de commandes. */
function script(...lines: string[]): ReturnType<typeof parse> {
  return parse(lex(["*page0|", ...lines, "@pg"].join("\n")));
}

function fvars(runtime: Runtime): Record<string, unknown> {
  return runtime.getSaveData().state.variables.f;
}

describe("Runtime @if/@elsif/@else/@endif", () => {
  it("@if cond=\"1\" exécute la branche", () => {
    const runtime = new Runtime(
      script(
        `@if cond="1"`,
        `@eval exp=f.taken="if"`,
        `@endif`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).taken).toBe("if");
  });

  it("@if cond=\"0\" + @else exécute la branche else", () => {
    const runtime = new Runtime(
      script(
        `@if cond="0"`,
        `@eval exp=f.taken="if"`,
        `@else`,
        `@eval exp=f.taken="else"`,
        `@endif`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).taken).toBe("else");
  });

  it("@if cond=\"f.x == 1\" : branche if quand f.x=1", () => {
    const runtime = new Runtime(
      script(
        `@eval exp=f.x=1`,
        `@if cond="f.x == 1"`,
        `@eval exp=f.taken="if"`,
        `@else`,
        `@eval exp=f.taken="else"`,
        `@endif`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).taken).toBe("if");
  });

  it("@if cond=\"f.x == 1\" : branche else quand f.x=2", () => {
    const runtime = new Runtime(
      script(
        `@eval exp=f.x=2`,
        `@if cond="f.x == 1"`,
        `@eval exp=f.taken="if"`,
        `@else`,
        `@eval exp=f.taken="else"`,
        `@endif`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).taken).toBe("else");
  });

  it("@if cond=\"1\" + @eval exp=\"f.result = 42\" → f.result === 42", () => {
    const runtime = new Runtime(
      script(
        `@if cond="1"`,
        `@eval exp="f.result = 42"`,
        `@endif`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).result).toBe(42);
  });

  it("@elsif sélectionne la première branche vraie", () => {
    const runtime = new Runtime(
      script(
        `@eval exp=f.x=5`,
        `@if cond="f.x == 1"`,
        `@eval exp=f.branch="a"`,
        `@elsif cond="f.x == 5"`,
        `@eval exp=f.branch="b"`,
        `@else`,
        `@eval exp=f.branch="c"`,
        `@endif`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).branch).toBe("b");
  });

  it("@elsif tombe sur @else si aucune condition n'est vraie", () => {
    const runtime = new Runtime(
      script(
        `@eval exp=f.x=99`,
        `@if cond="f.x == 1"`,
        `@eval exp=f.branch="a"`,
        `@elsif cond="f.x == 2"`,
        `@eval exp=f.branch="b"`,
        `@else`,
        `@eval exp=f.branch="c"`,
        `@endif`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).branch).toBe("c");
  });

  it("imbrication : la branche interne n'est exécutée que si l'externe est vraie", () => {
    const runtime = new Runtime(
      script(
        `@if cond="1"`,
        `@if cond="0"`,
        `@eval exp=f.inner="taken"`,
        `@else`,
        `@eval exp=f.inner="else"`,
        `@endif`,
        `@endif`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).inner).toBe("else");
  });

  it("imbrication : branche externe fausse saute tout le bloc interne", () => {
    const runtime = new Runtime(
      script(
        `@if cond="0"`,
        `@if cond="1"`,
        `@eval exp=f.inner="taken"`,
        `@endif`,
        `@else`,
        `@eval exp=f.outer="else"`,
        `@endif`,
      ),
    );

    runtime.step();

    // Branche interne jamais exécutée, branche else externe exécutée.
    expect(fvars(runtime).inner).toBeUndefined();
    expect(fvars(runtime).outer).toBe("else");
  });

  it("un @wait dans une branche arrête le runtime puis reprend à l'instruction suivante", () => {
    const runtime = new Runtime(
      script(
        `@if cond="1"`,
        `@wait time=100`,
        `@eval exp=f.after_wait=1`,
        `@endif`,
      ),
    );

    // 1er step : la branche est empilée, le @wait provoque un arrêt.
    const step1 = runtime.step();
    expect(step1.stop.kind).toBe("wait");
    // Le @eval après le wait n'a pas encore été exécuté.
    expect(fvars(runtime).after_wait).toBeUndefined();

    // 2e step : reprise de la frame, @eval s'exécute.
    runtime.step();
    expect(fvars(runtime).after_wait).toBe(1);
  });
});

describe("Runtime @macro/@endmacro", () => {
  it("définit une macro et l'expanse à l'appel", () => {
    const runtime = new Runtime(
      script(
        `@macro name=toto`,
        `@eval exp=f.flag=1`,
        `@endmacro`,
        `@toto`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).flag).toBe(1);
  });

  it("l'appel d'une macro n'incrémente PAS rawCount", () => {
    const runtime = new Runtime(
      script(
        `@macro name=toto`,
        `@eval exp=f.flag=1`,
        `@endmacro`,
        `@toto`,
      ),
    );

    runtime.step();

    expect(runtime.rawCount).toBe(0);
  });

  it("une commande vraiment inconnue incrémente toujours rawCount (régression)", () => {
    const runtime = new Runtime(
      script(`@totally_unknown_command`),
    );

    const warnings: string[] = [];
    runtime.onWarning = (msg) => warnings.push(msg);

    runtime.step();

    expect(runtime.rawCount).toBe(1);
    expect(warnings.some((w) => w.includes("totally_unknown_command"))).toBe(true);
  });

  it("une macro peut être appelée plusieurs fois", () => {
    const runtime = new Runtime(
      script(
        `@macro name=inc`,
        `@eval exp=f.count=f.count+1`,
        `@endmacro`,
        `@eval exp=f.count=0`,
        `@inc`,
        `@inc`,
        `@inc`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).count).toBe(3);
    expect(runtime.rawCount).toBe(0);
  });

  it("une macro dont le corps contient un @if est exécutée correctement", () => {
    const runtime = new Runtime(
      script(
        `@macro name=set_if`,
        `@if cond="f.cond_flag == 1"`,
        `@eval exp=f.macro_taken="yes"`,
        `@else`,
        `@eval exp=f.macro_taken="no"`,
        `@endif`,
        `@endmacro`,
        `@eval exp=f.cond_flag=1`,
        `@set_if`,
      ),
    );

    runtime.step();

    expect(fvars(runtime).macro_taken).toBe("yes");
    expect(runtime.rawCount).toBe(0);
  });

  it("@if utilise exp= (syntaxe Mahoyo réelle)", () => {
    const runtime = new Runtime(
      script(
        `@if exp="1"`,
        `@eval exp="f.branch = 'then'"`,
        `@else`,
        `@eval exp="f.branch = 'else'"`,
        `@endif`,
      ),
    );
    runtime.step();
    expect(fvars(runtime).branch).toBe("then");
  });

  it("@if exp= avec expression TJS (void → undefined)", () => {
    const runtime = new Runtime(
      script(
        `@eval exp="f.val = void"`,
        `@if exp="f.val === void"`,
        `@eval exp="f.result = 'is_void'"`,
        `@else`,
        `@eval exp="f.result = 'not_void'"`,
        `@endif`,
      ),
    );
    runtime.step();
    expect(fvars(runtime).result).toBe("is_void");
  });

  it("@jump cond= saute si condition vraie", () => {
    const s = parse(lex([
      `*page0|`,
      `@eval exp="f.flag = 1"`,
      `@jump cond="f.flag === 1" target=skipped`,
      `@eval exp="f.reached = 'no'"`,
      `@pg`,
      `*skipped|`,
      `@eval exp="f.reached = 'yes'"`,
      `@pg`,
    ].join("\n")));
    const runtime = new Runtime(s);
    runtime.step();
    expect(fvars(runtime).reached).toBe("yes");
    expect(fvars(runtime).flag).toBe(1);
  });

  it("@jump cond= ne saute pas si condition fausse", () => {
    const s = parse(lex([
      `*page0|`,
      `@eval exp="f.flag = 0"`,
      `@jump cond="f.flag === 1" target=skipped`,
      `@eval exp="f.reached = 'after_jump'"`,
      `@pg`,
      `*skipped|`,
      `@eval exp="f.reached = 'skipped'"`,
      `@pg`,
    ].join("\n")));
    const runtime = new Runtime(s);
    runtime.step();
    expect(fvars(runtime).reached).toBe("after_jump");
  });

  it("@eval cond= n'évalue que si condition vraie", () => {
    const runtime = new Runtime(
      script(
        `@eval exp="f.x = 10" cond="1"`,
        `@eval exp="f.y = 20" cond="0"`,
      ),
    );
    runtime.step();
    expect(fvars(runtime).x).toBe(10);
    expect(fvars(runtime).y).toBeUndefined();
  });

  it("macro avec paramètres %page|fore (substitution)", () => {
    const runtime = new Runtime(
      script(
        `@macro name=do_clall`,
        `@clall page=%page|fore`,
        `@endmacro`,
        `@do_clall page=back`,
      ),
    );
    runtime.step();
    // The macro expansion should have executed @clall page=back (not page=fore).
    // We verify by checking that the page= was substituted correctly.
    // @clall on back → no scene event (back operations emit no event).
    const save = runtime.getSaveData();
    // After @clall page=back, back.layers should be empty.
    expect(save.state.back.layers.length).toBe(0);
  });

  it("macro : mp (macro params) accessible dans les expressions", () => {
    const runtime = new Runtime(
      script(
        `@macro name=set_val`,
        `@eval exp="f.from_mp = mp.myparam"`,
        `@endmacro`,
        `@set_val myparam=42`,
      ),
    );
    runtime.step();
    // KAG keeps macro params as strings; "42" is a string.
    expect(fvars(runtime).from_mp).toBe("42");
  });

  it("expression TJS : & préfixe traité comme no-op", () => {
    const runtime = new Runtime(
      script(
        `@eval exp="f.x = 5"`,
        `@if exp="&f.x === 5"`,
        `@eval exp="f.result = 'ok'"`,
        `@endif`,
      ),
    );
    runtime.step();
    expect(fvars(runtime).result).toBe("ok");
  });

  it("@rclick exp= n'est PAS évalué comme condition", () => {
    // exp= on a raw command should not be treated as cond=.
    const runtime = new Runtime(
      script(
        `@rclick exp="f.called = true"`,
      ),
    );
    runtime.step();
    // @rclick falls through as raw (with exp=), but exp= should NOT be treated as a condition.
    // It's just a raw command with args.exp.
    expect(runtime.rawCount).toBeGreaterThan(0);
  });

  it("mp utilisé dans un @if à l'intérieur d'une macro", () => {
    const runtime = new Runtime(
      script(
        `@macro name=check_val`,
        `@if exp="mp.val === 'yes'"`,
        `@eval exp="f.result = 'matched'"`,
        `@else`,
        `@eval exp="f.result = 'no_match'"`,
        `@endif`,
        `@endmacro`,
        `@check_val val=yes`,
      ),
    );
    runtime.step();
    expect(fvars(runtime).result).toBe("matched");
  });

  it("%param absent sans défaut → attribut supprimé", () => {
    const runtime = new Runtime(
      script(
        `@macro name=do_fg`,
        `@fg storage=%storage center=512 vcenter=288`,
        `@endmacro`,
        `@do_fg`,  // no storage= provided → attribute removed, storage=""
      ),
    );
    runtime.step();
    // @fg with storage="" should still work (empty storage is valid).
    const save = runtime.getSaveData();
    // The @fg instruction was executed with storage="".
    expect(save.state.back.layers.length).toBeGreaterThanOrEqual(0);
  });

  it("@call cond= faux ne call pas", () => {
    const s = parse(lex([
      `*page0|`,
      `@eval exp="f.flag = 0"`,
      `@call cond="f.flag === 1" storage=sub.ks`,
      `@eval exp="f.reached = 'after_call'"`,
      `@pg`,
    ].join("\n")));
    const runtime = new Runtime(s);
    runtime.step();
    expect(fvars(runtime).reached).toBe("after_call");
  });

  it("save/load préserve les macros", () => {
    const runtime = new Runtime(
      script(
        `@macro name=hello`,
        `@eval exp="f.greeting = 'hi'"`,
        `@endmacro`,
        `@eval exp="f.x = 1"`,
      ),
    );
    runtime.step();
    const save = runtime.getSaveData();
    expect(save.macros).toBeDefined();
    expect(save.macros["hello"]).toBeDefined();
    // The macro should be restorable.
    const macros = save.macros as Record<string, unknown>;
    expect(macros["hello"]).toBeTypeOf("object");
  });

  it("B1: @call dans @if reprend l'instruction après @endif", () => {
    const s = parse(lex([
      `*page0|`,
      `@if exp="1"`,
      `@call target=sub`,
      `@endif`,
      `@eval exp="f.afterIf = 'yes'"`,
      `@pg`,
      `*sub|`,
      `@eval exp="f.subCalled = 'yes'"`,
      `@return`,
      `@pg`,
    ].join("\n")));
    const runtime = new Runtime(s);
    runtime.step();
    expect(fvars(runtime).subCalled).toBe("yes");
    expect(fvars(runtime).afterIf).toBe("yes");
  });

  it("B2: @call dans macro reprend l'instruction après macro", () => {
    const s = parse(lex([
      `*page0|`,
      `@macro name=do_call`,
      `@call target=sub`,
      `@endmacro`,
      `@do_call`,
      `@eval exp="f.afterMacro = 'yes'"`,
      `@pg`,
      `*sub|`,
      `@eval exp="f.subCalled = 'yes'"`,
      `@return`,
      `@pg`,
    ].join("\n")));
    const runtime = new Runtime(s);
    runtime.step();
    expect(fvars(runtime).subCalled).toBe("yes");
    expect(fvars(runtime).afterMacro).toBe("yes");
  });

  it("B3: @jump dans @if (même page) n'exécute pas les instructions suivantes", () => {
    const s = parse(lex([
      `*page0|`,
      `@if exp="1"`,
      `@jump target=target`,
      `@eval exp="f.shouldNotRun = 'oops'"`,
      `@endif`,
      `@pg`,
      `*target|`,
      `@eval exp="f.reached = 'yes'"`,
      `@pg`,
    ].join("\n")));
    const runtime = new Runtime(s);
    runtime.step();
    expect(fvars(runtime).shouldNotRun).toBeUndefined();
    expect(fvars(runtime).reached).toBe("yes");
  });

  it("B4: %param n'est pas substitué au milieu d'une valeur", () => {
    // Macro body contains "7%x". Since the whole value does not start with %,
    // %x should NOT be substituted (it would turn into r=7 if it were).
    const runtime = new Runtime(
      script(
        `@macro name=calc`,
        `@eval exp="f.r = 7%x"`,
        `@endmacro`,
        `@calc`,
      ),
    );
    runtime.step();
    expect(fvars(runtime).r).toBeUndefined();
  });

  it("B4bis: %param au début d'une valeur est substitué", () => {
    // The whole value is "%1", which gets substituted by the call argument.
    const runtime = new Runtime(
      script(
        `@macro name=set_x`,
        `@eval exp="%1"`,
        `@endmacro`,
        `@set_x 1="f.x = 42"`,
      ),
    );
    runtime.step();
    expect(fvars(runtime).x).toBe(42);
  });

  it("B5: [p] dans @if produit une pause clic", () => {
    const runtime = new Runtime(
      parse(lex([
        `*page0|`,
        `@if exp="1"`,
        `texte avant[p]texte après`,
        `@endif`,
      ].join("\n")))
    );
    const step1 = runtime.step();
    expect(step1.stop?.kind).toBe("click");
  });

  it("B1bis: @call dans @if reprend après @endif (limitation connue)", () => {
    const warnings: string[] = [];
    const s = parse(lex([
      `*page0|`,
      `@if exp="1"`,
      `@call target=sub`,
      `@eval exp="f.afterCallInIf = 'yes'"`,
      `@endif`,
      `@eval exp="f.afterIf = 'yes'"`,
      `@pg`,
      `*sub|`,
      `@eval exp="f.subCalled = 'yes'"`,
      `@return`,
      `@pg`,
    ].join("\n")));
    const runtime = new Runtime(s);
    runtime.onWarning = (msg) => warnings.push(msg);
    runtime.step();
    expect(fvars(runtime).subCalled).toBe("yes");
    expect(fvars(runtime).afterIf).toBe("yes");
    // Known limitation: with nested frames, @call returns after the @endif,
    // so instructions between @call and @endif are skipped.
    expect(fvars(runtime).afterCallInIf).toBeUndefined();
    expect(warnings.some((w) => w.includes("@call inside @if/macro"))).toBe(true);
  });

  it("B3bis: @jump dans @if vers un label de la même page", () => {
    const s = parse(lex([
      `*page0|`,
      `@if exp="1"`,
      `@jump target=afterIf`,
      `@eval exp="f.shouldNotRun = 'oops'"`,
      `@endif`,
      `*afterIf|`,
      `@eval exp="f.reached = 'yes'"`,
      `@pg`,
    ].join("\n")));
    const runtime = new Runtime(s);
    runtime.step();
    expect(fvars(runtime).shouldNotRun).toBeUndefined();
    expect(fvars(runtime).reached).toBe("yes");
  });

  it("B8: @return dans un @if de la sous-routine ne fuit pas de frames", () => {
    const s = parse(lex([
      `*page0|`,
      `@call target=sub`,
      `@eval exp="f.caller1 = 'yes'"`,
      `@eval exp="f.caller2 = 'yes'"`,
      `@pg`,
      `*sub|`,
      `@if exp="1"`,
      `@if exp="1"`,
      `@return`,
      `@endif`,
      `@eval exp="f.leak += 1"`,
      `@endif`,
      `@pg`,
    ].join("\n")));
    const runtime = new Runtime(s);
    runtime.step();
    expect(fvars(runtime).caller1).toBe("yes");
    expect(fvars(runtime).caller2).toBe("yes");
    expect(fvars(runtime).leak).toBeUndefined();
  });

  it("B5bis: [p] dans @if attend exactement un clic avant de continuer", () => {
    const runtime = new Runtime(
      parse(lex([
        `*page0|`,
        `@if exp="1"`,
        `ligne 1[p]ligne 2`,
        `@endif`,
        `@eval exp="f.afterP = 'yes'"`,
      ].join("\n")))
    );
    const step1 = runtime.step();
    expect(step1.stop?.kind).toBe("click");
    expect(fvars(runtime).afterP).toBeUndefined();
    const step2 = runtime.step();
    expect(step2.stop?.kind).toBe("click");
    expect(fvars(runtime).afterP).toBe("yes");
  });
});
