/**
 * Bouton « Copier le rapport perf » (PERF-V2-01 / #385) : absent sans `?perf=1`, copie le JSON
 * (summary + Resource Timing) avec le flag.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPerfProbe } from "@/core/perf-probe.js";
import { buildPerfReport, mountPerfReportButton } from "@/ui/perf-report-button.js";

afterEach(() => {
  document.querySelector("#mh-perf-report")?.remove();
  document.querySelector("#mh-perf-toast-host")?.remove();
  window.sessionStorage?.clear();
  delete (window as unknown as { __mhPerf?: unknown }).__mhPerf;
});

describe("mountPerfReportButton (#385)", () => {
  it("ne monte rien sans ?perf=1", () => {
    const probe = createPerfProbe({ search: "", storage: null });
    expect(mountPerfReportButton(probe)).toBeNull();
    expect(document.querySelector("#mh-perf-report")).toBeNull();
    expect(document.querySelector("#mh-perf-toast-host")).toBeNull();
  });

  it("monte un bouton et copie le rapport JSON quand ?perf=1", async () => {
    const probe = createPerfProbe({ search: "?perf=1", nextFrame: (fn) => fn() });
    probe.markBoot("manifest-fetched");
    probe.markTransitionWait(12, "ready");
    probe.markAudio("bgm", "request");
    let copied = "";
    const button = mountPerfReportButton(probe, {
      writeText: (text) => {
        copied = text;
        return Promise.resolve();
      },
    });
    expect(button).not.toBeNull();
    // Indice discret (#391) : toast d'activation uniquement en mode perf.
    expect(document.querySelector(".mh-toast")?.textContent).toContain("Mode perf activé");
    // Le toast ne doit pas gêner les clics du bouton (host pointer-events:none).
    button!.click();
    await vi.waitFor(() => expect(copied).not.toBe(""));
    const payload = JSON.parse(copied) as {
      summary: { boot: Record<string, number>; transitionWait: { count: number }; audio: { bgm: { request: number } } };
      res: unknown[];
      url: string;
    };
    expect(payload.summary.boot["manifest-fetched"]).toBeGreaterThan(0);
    expect(payload.summary.transitionWait.count).toBe(1);
    expect(payload.summary.audio.bgm.request).toBe(1);
    expect(Array.isArray(payload.res)).toBe(true);
    expect(typeof payload.url).toBe("string");
    expect(button!.textContent).toBe("Rapport copié ✓");
  });

  it("buildPerfReport contient navigation et Resource Timing quand disponibles", () => {
    const probe = createPerfProbe({ search: "?perf=1" });
    const report = buildPerfReport(probe);
    expect(report).toHaveProperty("summary");
    expect(report).toHaveProperty("nav");
    expect(Array.isArray(report.res)).toBe(true);
  });
});
