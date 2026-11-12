import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildReviewUrl,
  buildSessionPayload,
  dumpFlagCount,
  dumpFlags,
  endReasonMessage,
  parseReviewArgs,
  reviewShotName,
  summarizeReviewSession,
  writeSession,
  zeroFlagHelpLines,
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

describe("lanceur review — mode manuel et session (#405)", () => {
  it("parse --manual et --no-open (désactivés par défaut)", () => {
    expect(parseReviewArgs([]).manual).toBe(false);
    expect(parseReviewArgs(["--manual"]).manual).toBe(true);
    expect(parseReviewArgs(["--no-open"]).manual).toBe(true);
    expect(parseReviewArgs(["--manual", "--no-console-log"]).manual).toBe(true);
  });

  it("construit une session complète avec raison de fin et durée", () => {
    const session = buildSessionPayload({
      url: "http://localhost/?review=1",
      browser: "chromium",
      consoleLog: "/tmp/review-console.log",
      flags: [{ id: "flag-1", category: "texte", script: { scriptName: "1-0.ks" } }],
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:42.000Z",
      endReason: "external-close",
    });
    expect(session.kind).toBe("mahoyo-review-session");
    expect(session.version).toBe(1);
    expect(session.durationMs).toBe(42_000);
    expect(session.endReason).toBe("external-close");
    expect(session.flags).toHaveLength(1);
    expect(() => JSON.stringify(session)).not.toThrow();
  });

  it("explique chaque raison de fin avec le nombre de flags sauvegardés", () => {
    expect(endReasonMessage("external-close", 2, 40_000)).toContain("2 flag(s) sauvegardé(s)");
    expect(endReasonMessage("external-close", 2, 40_000)).toContain("--manual");
    expect(endReasonMessage("création" as never, 0, 1000)).toBeTruthy();
    expect(endReasonMessage("crash", 0, 40_000)).toContain("crash");
    expect(endReasonMessage("signal", 1, 5_000)).toContain("Ctrl+C");
    expect(endReasonMessage(null, 0, 10_000)).toContain("session terminée");
  });

  it("affiche l'aide 0 flag, avec la suggestion --manual et la session courte", () => {
    const short = zeroFlagHelpLines(0, 40_000).join("\n");
    expect(short).toContain("--manual");
    expect(short).toContain("session courte");
    expect(short).toContain("F2");
    const long = zeroFlagHelpLines(0, 120_000).join("\n");
    expect(long).toContain("--manual");
    expect(long).not.toContain("session courte");
    expect(zeroFlagHelpLines(2, 40_000)).toEqual([]);
  });

  it("écrit la session et les captures sur disque (sauvegarde incrémentale)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mahoyo-review-session-"));
    try {
      const session = buildSessionPayload({
        url: "http://localhost/?review=1",
        browser: "firefox",
        consoleLog: null,
        flags: [
          { id: "flag-a", category: "fond", capture: "data:image/jpeg;base64,AAAA" },
          { id: "flag-b", category: "texte" },
        ],
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: "2026-01-01T00:00:10.000Z",
        endReason: "disconnected",
      });
      const written = writeSession(dir, session);
      expect(written.shots).toBe(1);
      expect(written.sessionPath).toBe(join(dir, "review-session.json"));
      const onDisk = JSON.parse(readFileSync(written.sessionPath, "utf-8"));
      expect(onDisk.flags).toHaveLength(2);
      expect(onDisk.endReason).toBe("disconnected");
      expect(readFileSync(join(dir, "review-shots", "flag-a.jpg"))).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tolère les dumps absents ou partiels", () => {
    expect(dumpFlagCount(null)).toBe(0);
    expect(dumpFlagCount({ flags: [{ id: "a" }, { id: "b" }] })).toBe(2);
    expect(dumpFlags(null)).toEqual([]);
    expect(dumpFlags({ flags: [{ id: "a", category: "son" }, {}, null] })).toEqual([{ id: "a", category: "son" }]);
  });
});
