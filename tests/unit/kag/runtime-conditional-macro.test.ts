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
});
