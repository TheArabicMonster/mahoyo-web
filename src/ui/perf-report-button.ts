/**
 * Bouton « Copier le rapport perf » (PERF-V2-01 / #385, docs/PERF_PLAN_V2_OPUS.md §A).
 *
 * Affiché **uniquement** quand `?perf=1` est actif (`probe.enabled`) : sans le flag, aucun nœud
 * n'est créé. Il copie dans le presse-papiers un JSON lisible par le propriétaire (même sans
 * console, utile sur mobile) contenant :
 * - `summary()` de la sonde (#360/#385 : images, scene-ready, boot, attentes, audio, cache…) ;
 * - l'entrée `navigation` et le Resource Timing (ttfb, download, transfer/encoded/decoded,
 *   workerStart), comme dans le protocole de mesure du plan v2.
 */
import type { PerfProbe } from "@/core/perf-probe.js";

export type PerfResourceRow = {
  u: string;
  t: string;
  start: number;
  dur: number;
  ttfb: number;
  dl: number;
  sz: number;
  enc: number;
  dec: number;
  sw: boolean;
};

export type PerfReport = {
  generatedAt: string;
  url: string;
  summary: ReturnType<PerfProbe["summary"]>;
  nav: Record<string, unknown> | null;
  res: PerfResourceRow[];
};

/** Construit le rapport copié par le bouton (exporté pour les tests). */
export function buildPerfReport(probe: PerfProbe): PerfReport {
  const resources: PerformanceResourceTiming[] =
    typeof performance !== "undefined" && typeof performance.getEntriesByType === "function"
      ? (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      : [];
  const navigation =
    typeof performance !== "undefined" && typeof performance.getEntriesByType === "function"
      ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
      : undefined;
  return {
    generatedAt: new Date().toISOString(),
    url: typeof location !== "undefined" ? location.href : "",
    summary: probe.summary(),
    nav: (navigation as unknown as { toJSON?: () => Record<string, unknown> } | undefined)?.toJSON?.() ?? null,
    res: resources
      .filter((entry) => /\.(png|jpe?g|webp|ogg|opus|wav|mp3|m4a|json|ks|js|css)$/i.test(entry.name))
      .map((entry) => ({
        u: entry.name.split("/assets/")[1] ?? entry.name.split("/").pop() ?? entry.name,
        t: entry.initiatorType,
        start: Math.round(entry.startTime),
        dur: Math.round(entry.duration),
        ttfb: Math.round(entry.responseStart - entry.requestStart),
        dl: Math.round(entry.responseEnd - entry.responseStart),
        sz: entry.transferSize ?? 0,
        enc: entry.encodedBodySize ?? 0,
        dec: entry.decodedBodySize ?? 0,
        sw: (entry.workerStart ?? 0) > 0,
      })),
  };
}

export type PerfReportButtonOptions = {
  /** Copie injectable (tests) ; défaut : `navigator.clipboard.writeText`. */
  writeText?: (text: string) => Promise<void>;
  /** Rapport injectable (tests). */
  buildReport?: (probe: PerfProbe) => PerfReport;
};

async function defaultWriteText(text: string): Promise<void> {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (clipboard && typeof clipboard.writeText === "function") return clipboard.writeText(text);
  // Repli sans Clipboard API (http, anciens navigateurs) : zone de texte + execCommand.
  if (typeof document === "undefined") throw new Error("clipboard indisponible");
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = typeof document.execCommand === "function" && document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copie impossible");
}

/**
 * Monte le bouton flottant si et seulement si la sonde est active. Retourne le bouton ou null.
 * Aucun nœud, aucun listener et aucun accès presse-papiers sans `?perf=1`.
 */
export function mountPerfReportButton(
  probe: PerfProbe,
  options: PerfReportButtonOptions = {},
): HTMLButtonElement | null {
  if (!probe.enabled || typeof document === "undefined") return null;
  const writeText = options.writeText ?? defaultWriteText;
  const buildReport = options.buildReport ?? buildPerfReport;
  const button = document.createElement("button");
  button.type = "button";
  button.id = "mh-perf-report";
  button.dataset.perfReport = "true";
  button.textContent = "Copier le rapport perf";
  button.setAttribute("aria-label", "Copier le rapport perf");
  button.style.cssText = [
    "position:fixed",
    "right:calc(12px + env(safe-area-inset-right, 0px))",
    "bottom:calc(12px + env(safe-area-inset-bottom, 0px))",
    "z-index:10000",
    "padding:8px 10px",
    "border:1px solid var(--mh-cyan-glint, #5fcfc5)",
    "border-radius:4px",
    "background:rgba(12, 25, 36, 0.92)",
    "color:var(--mh-text-ui, #eef4f5)",
    "font:12px/1.2 system-ui, sans-serif",
    "cursor:pointer",
    "opacity:0.85",
  ].join(";");
  button.addEventListener("click", () => {
    void writeText(JSON.stringify(buildReport(probe), null, 2)).then(
      () => {
        button.textContent = "Rapport copié ✓";
        setTimeout(() => (button.textContent = "Copier le rapport perf"), 2000);
      },
      () => {
        button.textContent = "Copie impossible";
      },
    );
  });
  document.body.appendChild(button);
  return button;
}
