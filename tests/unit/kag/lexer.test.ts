import { describe, it, expect } from "vitest";
import { lex } from "@/kag/lexer.js";

const SAMPLE = `
@call target=*tladata
*page0|
@bg time=100 rule=crossfade storage=black
@invisibleframe
\u3000その子の影になったのは８年前の冬のこと。[l][r]
\u3000彼女がはじめて命に[ruby text=ふ]触れた、[ruby char=1 text=しず]厳かな朝の出来事だ。
@pg
`;

describe("lex", () => {
  it("tokenizes commands", () => {
    const tokens = lex("@bg time=100 rule=crossfade storage=black");
    expect(tokens).toHaveLength(2); // command + linebreak
    expect(tokens[0]).toEqual({
      type: "command",
      name: "bg",
      args: { time: "100", rule: "crossfade", storage: "black" },
    });
  });

  it("tokenizes labels", () => {
    const tokens = lex("*page0|");
    expect(tokens[0]).toEqual({ type: "label", name: "page0" });
  });

  it("tokenizes text with inline tags", () => {
    const tokens = lex("\u3000その子の影になったのは８年前の冬のこと。[l][r]");
    const [text1, l, r] = tokens;
    expect(text1.type).toBe("text");
    expect(l).toEqual({ type: "tag", name: "l", args: {} });
    expect(r).toEqual({ type: "tag", name: "r", args: {} });
  });

  it("tokenizes ruby tags", () => {
    const tokens = lex("[ruby text=ふ]");
    expect(tokens[0]).toEqual({
      type: "tag",
      name: "ruby",
      args: { text: "ふ" },
    });
  });

  it("tokenizes the sample", () => {
    const tokens = lex(SAMPLE).filter((t) => t.type !== "linebreak");
    expect(tokens.some((t) => t.type === "command" && t.name === "call")).toBe(true);
    expect(tokens.some((t) => t.type === "command" && t.name === "bg")).toBe(true);
    expect(tokens.some((t) => t.type === "label" && t.name === "page0")).toBe(true);
    expect(tokens.some((t) => t.type === "tag" && t.name === "ruby")).toBe(true);
  });

  it("ignores content between @iscript and @endscript", () => {
    const source = `
@iscript
sf.test = 1;
console.log("hello");
@endscript
@bg storage=black
`;
    const tokens = lex(source).filter((t) => t.type !== "linebreak");
    const commands = tokens.filter((t) => t.type === "command");
    expect(commands.map((c) => c.name)).toEqual(["iscript", "endscript", "bg"]);
  });
});
