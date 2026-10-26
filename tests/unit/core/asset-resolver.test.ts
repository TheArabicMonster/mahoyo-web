import { describe, it, expect } from "vitest";
import { createAssetResolver } from "@/core/asset-resolver.js";

describe("AssetResolver", () => {
  it("resolves background, image and audio URLs", () => {
    const resolver = createAssetResolver();
    expect(resolver.background("black")).toBe("/assets/bg/black.webp");
    expect(resolver.image("青子")).toBe("/assets/image/青子.webp");
    expect(resolver.bgm("m01")).toBe("/assets/bgm/m01.ogg");
    expect(resolver.se("se01")).toBe("/assets/se/se01.ogg");
    expect(resolver.rule("rule01")).toBe("/assets/rule/rule01.png");
    expect(resolver.scenario("1-0.ks")).toBe("/assets/scenario/1-0.ks");
    expect(resolver.scenario("1-0")).toBe("/assets/scenario/1-0.ks");
  });

  it("strips suffixes from storage names", () => {
    const resolver = createAssetResolver();
    expect(resolver.background("black|night")).toBe("/assets/bg/black.webp");
  });

  it("accepts a custom base URL", () => {
    const resolver = createAssetResolver({ baseUrl: "/static" });
    expect(resolver.background("black")).toBe("/static/bg/black.webp");
  });
});
