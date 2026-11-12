import { describe, it, expect } from "vitest";
import {
  buildReviewUrl,
  parseReviewArgs,
  reviewShotName,
  summarizeReviewSession,
} from "../../../tools/review-lib.js";

describe("lanceur review — options (#400)", () => {
  it("applique les valeurs par défaut (chromium, journal actif, assets env)", () => {
    const options = parseReviewArgs([], { MAHOYO_E2E_ASSETS: "/assets/locaux" } as NodeJS.ProcessEnv);
    expect(options.url).toBeNull();
    expect(options.port).toBeNull();
    expect(options.browser).toBe("chromium");
    expect(options.assets).toBe("/assets/locaux");
    expect(options.noBuild).toBe(false);
    expect(options.consoleLog).toBe(true);
    expect(options.outDir.endsWith("reports")).toBe(true);
  });

  it("parse les options du lanceur", () => {
    const options = parseReviewArgs([
      "--url",
      "https://example.test/game/",
      "--port",
      "4321",
      "--browser",
      "firefox",
      "--assets",
      "/tmp/public",
      "--no-build",
      "--no-console-log",
      "--out",
      "/tmp/out",
    ]);
    expect(options.url).toBe("https://example.test/game/");
    expect(options.port).toBe(4321);
    expect(options.browser).toBe("firefox");
    expect(options.assets).toBe("/tmp/public");
    expect(options.noBuild).toBe(true);
    expect(options.consoleLog).toBe(false);
    expect(options.outDir).toBe("/tmp/out");
  });

  it("retombe sur chromium pour un navigateur inconnu et ignore un port invalide", () => {
    const options = parseReviewArgs(["--browser", "webkit", "--port", "abc"]);
    expect(options.browser).toBe("chromium");
    expect(options.port).toBeNull();
  });
});

describe("lanceur review — URL et fichiers (#400)", () => {
  it("ajoute review=1 sans perdre les paramètres existants", () => {
    expect(buildReviewUrl("http://127.0.0.1:5173/")).toBe("http://127.0.0.1:5173/?review=1");
    const url = new URL(buildReviewUrl("https://example.test/game/?lang=fr#/title"));
    expect(url.searchParams.get("review")).toBe("1");
    expect(url.searchParams.get("lang")).toBe("fr");
    expect(url.hash).toBe("#/title");
  });

  it("assainit le nom de capture et résume la session", () => {
    expect(reviewShotName("flag-abc/../x")).toBe("flag-abc____x.jpg");
    expect(summarizeReviewSession({ flags: [] })).toContain("Aucun flag");
    expect(
      summarizeReviewSession({
        flags: [
          { category: "texte", script: { scriptName: "1-0.ks" } },
          { category: "sprite", script: { scriptName: "2-0.ks" } },
          { category: "texte", script: null },
        ],
      }),
    ).toContain("3 flag(s)");
  });
});
