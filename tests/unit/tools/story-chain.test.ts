/**
 * Génération de la table d'enchaînement. Les graphes sont des exemples inventés
 * au format TJS de `main.gc` ; aucun contenu du jeu n'est utilisé.
 */
import { describe, it, expect } from "vitest";
import { deflateSync } from "zlib";
import { buildStoryChain, buildStoryChainFromGc, decodeGc, parseTjs } from "../../../tools/story-chain-lib.js";

function block(id: number, script: string | string[], routes: { to: number; cond?: string; choice?: string }[] = []): string {
  const s = Array.isArray(script) ? `[${script.map((x) => `string "${x}"`).join(", ")}]` : `string "${script}"`;
  const r = routes
    .map(
      (x) =>
        `%[ "arrival" => int ${x.to}, "condition" => ${x.cond ? `string "${x.cond}"` : "void"}, ` +
        `"alternative" => ${x.choice ? `%[ "text" => string "${x.choice}" ]` : 'string ""'} ]`,
    )
    .join(", ");
  return `%[ "id" => int ${id}, "script" => ${s}, "routes" => [ ${r} ] ]`;
}

function graph(first: number, blocks: string[]): string {
  return `%[ "first" => int ${first}, "pages" => [ %[ "blocks" => [ ${blocks.join(", ")} ] ] ] ]`;
}

describe("parseTjs", () => {
  it("lit les types scalaires, listes et dictionnaires", () => {
    const v = parseTjs('%[ "a" => int -3, "b" => real 1.5, "c" => string "x", "d" => void, "e" => [ int 1, int 2 ] ]');
    expect(v).toEqual({ a: -3, b: 1.5, c: "x", d: null, e: [1, 2] });
  });

  it("gère les séquences d'échappement et les caractères non ASCII", () => {
    expect(parseTjs('%[ "t" => string "a\\"b\\nc é 背景" ]')).toEqual({ t: 'a"b\nc é 背景' });
  });

  it("signale une valeur inattendue avec sa position", () => {
    expect(() => parseTjs('%[ "a" => ??? ]')).toThrow(/position/);
  });
});

describe("decodeGc", () => {
  const header = (compressed: Buffer) =>
    Buffer.concat([Buffer.from([0xfe, 0xfe, 0x02, 0xff, 0xfe]), Buffer.alloc(16), compressed]);

  it("décompresse un fichier KiriKiri zlib/UTF-16LE", () => {
    const text = '%[ "a" => int 1 ]\r\n';
    const buf = header(deflateSync(Buffer.from("﻿" + text, "utf16le")));
    expect(decodeGc(buf)).toBe('%[ "a" => int 1 ]\n');
  });

  it("refuse un en-tête inattendu", () => {
    expect(() => decodeGc(Buffer.from("pas un main.gc, trop court?........."))).toThrow(/en-tête/);
  });
});

describe("buildStoryChain", () => {
  const build = (first: number, blocks: string[]) => buildStoryChain(parseTjs(graph(first, blocks)));

  it("enchaîne des blocs linéaires", () => {
    const { chain } = build(1, [block(1, "a.ks", [{ to: 2 }]), block(2, "b.ks", [{ to: 3 }]), block(3, "c.ks")]);
    expect(chain.first).toBe("a.ks");
    expect(chain.next).toEqual({ "a.ks": [{ to: "b.ks" }], "b.ks": [{ to: "c.ks" }], "c.ks": [] });
  });

  it("traverse les blocs sans script (en-têtes de chapitre)", () => {
    const { chain } = build(1, [block(1, "", [{ to: 2 }]), block(2, "a.ks", [{ to: 3 }]), block(3, "", [{ to: 4 }]), block(4, "b.ks")]);
    expect(chain.first).toBe("a.ks");
    expect(chain.next["a.ks"]).toEqual([{ to: "b.ks" }]);
  });

  it("enchaîne les scripts d'un bloc à plusieurs scripts", () => {
    const { chain } = build(1, [block(1, ["a.ks", "b.ks"], [{ to: 2 }]), block(2, "c.ks")]);
    expect(chain.next["a.ks"]).toEqual([{ to: "b.ks" }]);
    expect(chain.next["b.ks"]).toEqual([{ to: "c.ks" }]);
  });

  it("conserve conditions et libellés de choix", () => {
    const { chain } = build(1, [
      block(1, "a.ks", [{ to: 2, choice: "Option B" }, { to: 3, cond: "room>0" }]),
      block(2, "b.ks"),
      block(3, "c.ks"),
    ]);
    expect(chain.next["a.ks"]).toEqual([
      { to: "b.ks", choice: "Option B" },
      { to: "c.ks", condition: "room>0" },
    ]);
  });

  it("combine en ET la condition d'une route et celle de la route suivante", () => {
    const { chain } = build(1, [
      block(1, "a.ks", [{ to: 2, cond: "x>0" }]),
      block(2, "", [{ to: 3, cond: "y>0" }]),
      block(3, "b.ks"),
    ]);
    expect(chain.next["a.ks"]).toEqual([{ to: "b.ks", condition: "(x>0)&&(y>0)" }]);
  });

  it("représente un interlude partagé par then, sans entrée propre", () => {
    const { chain, sharedScripts } = build(1, [
      block(1, "ch1.ks", [{ to: 10 }]),
      block(10, "tea.ks", [{ to: 2 }]),
      block(2, "ch2.ks", [{ to: 11 }]),
      block(11, "tea.ks", [{ to: 3 }]),
      block(3, "ch3.ks"),
    ]);
    expect(sharedScripts).toEqual(["tea.ks"]);
    expect(chain.next["tea.ks"]).toBeUndefined();
    expect(chain.next["ch1.ks"]).toEqual([{ to: "tea.ks", then: ["ch2.ks"] }]);
    expect(chain.next["ch2.ks"]).toEqual([{ to: "tea.ks", then: ["ch3.ks"] }]);
  });

  it("un interlude sans suite se joue seul", () => {
    const { chain } = build(1, [block(1, "a.ks", [{ to: 2 }]), block(2, "end.ks"), block(3, "end.ks")]);
    expect(chain.next["a.ks"]).toEqual([{ to: "end.ks" }]);
  });

  it("ignore une route vers un bloc inexistant et la compte", () => {
    const { chain, danglingRoutes } = build(1, [block(1, "a.ks", [{ to: 99 }])]);
    expect(chain.next["a.ks"]).toEqual([]);
    expect(danglingRoutes).toBe(1);
  });

  it("supporte un cycle sans boucler", () => {
    const { chain } = build(1, [block(1, "a.ks", [{ to: 2 }]), block(2, "", [{ to: 2 }, { to: 3 }]), block(3, "b.ks")]);
    expect(chain.next["a.ks"]).toEqual([{ to: "b.ks" }]);
  });

  it("échoue sans premier script", () => {
    expect(() => build(7, [block(1, "a.ks")])).toThrow(/premier script/);
  });

  it("échoue sur un graphe sans pages", () => {
    expect(() => buildStoryChain(parseTjs('%[ "first" => int 1 ]'))).toThrow(/pages/);
  });

  it("construit depuis un fichier main.gc complet", () => {
    const text = graph(1, [block(1, "a.ks", [{ to: 2 }]), block(2, "b.ks")]);
    const buf = Buffer.concat([
      Buffer.from([0xfe, 0xfe, 0x02, 0xff, 0xfe]),
      Buffer.alloc(16),
      deflateSync(Buffer.from("﻿" + text, "utf16le")),
    ]);
    expect(buildStoryChainFromGc(buf).chain.next["a.ks"]).toEqual([{ to: "b.ks" }]);
  });
});
