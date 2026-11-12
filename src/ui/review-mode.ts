/**
 * Mode revue (#400) : flags en jeu pour le propriétaire.
 *
 * Activé uniquement par `?review=1` (alias `?mark=1`) : sans ce paramètre, **aucun nœud DOM,
 * aucun écouteur, aucune écriture** (no-op total).
 *
 * - HUD discret (« Revue », bouton ⚑, compteur) ;
 * - **F2** : pose un flag (le jeu est brièvement mis en pause) → panneau catégorie
 *   (Texte/Sprite/Fond/Transition/Son/Icône/Autre, touches 1-7) + note libre ; Entrée enregistre ;
 * - **F3** : export `review-session.json` (téléchargement, captures inline) ; **F4** : copie JSON ;
 * - métadonnées en `localStorage` (`mahoyo-review-flags`), captures JPEG (html2canvas, q0.8,
 *   largeur max 960) en IndexedDB (`mahoyo-review` / `captures`) ;
 * - `window.__mhReview.dump()` expose l'export complet (utilisé par `tools/review.ts`).
 *
 * Aucun envoi réseau : tout reste local au navigateur.
 */
import type { GameLanguage } from "./types.js";

// ── Catégories et types publics (testables sans DOM) ─────────────────────────

export type ReviewCategory = "texte" | "sprite" | "fond" | "transition" | "son" | "icone" | "autre";

export const REVIEW_CATEGORIES: readonly { id: ReviewCategory; label: string; key: string }[] = [
  { id: "texte", label: "Texte", key: "1" },
  { id: "sprite", label: "Sprite", key: "2" },
  { id: "fond", label: "Fond", key: "3" },
  { id: "transition", label: "Transition", key: "4" },
  { id: "son", label: "Son", key: "5" },
  { id: "icone", label: "Icône", key: "6" },
  { id: "autre", label: "Autre", key: "7" },
];

/** Actif seulement avec `?review=1` ou `?mark=1` (valeur stricte). */
export function isReviewMode(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  return params.get("review") === "1" || params.get("mark") === "1";
}

export function categoryFromKey(key: string): ReviewCategory | null {
  return REVIEW_CATEGORIES.find((category) => category.key === key)?.id ?? null;
}

export function categoryLabel(category: ReviewCategory): string {
  return REVIEW_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
}

/** Instantané de l'état du jeu au moment du flag (lecture seule, fourni par le player). */
export type ReviewScriptPosition = {
  scriptName: string | null;
  page: number | null;
  instruction: number | null;
  segment: number | null;
};

export type ReviewSceneState = {
  bg: string | null;
  bgLeft?: number;
  bgTop?: number;
  bgZoomX?: number;
  bgZoomY?: number;
  bgRotate?: number;
  bgEffect?: string;
  bgType?: number;
  sprites: { id: string; storage: string; x: number; y: number; z: number; opacity: number; visible?: boolean }[];
  effect: unknown;
  textbox: { visible: boolean; frame: boolean; frameImage?: string; action?: string };
};

export type ReviewSnapshot = {
  screen: string;
  state: string;
  mode: string;
  script: ReviewScriptPosition;
  text: string;
  scene: ReviewSceneState;
  timelineLayers: { id: string; storage: string; x: number; y: number; opacity: number; z: number }[];
  transition: { method: string; timeMs: number; elapsedMs: number } | null;
  audio: { loops: { channel: string; storage: string; volume: number }[] };
  settings: { language: GameLanguage; audio: { master: number; bgm: number; se: number; voice: number; muted: boolean } };
  historyPreview: string[];
};

export type ReviewFlagMeta = {
  id: string;
  createdAt: string;
  sessionMs: number;
  category: ReviewCategory;
  note: string;
  route: string;
  screen: string;
  script: ReviewScriptPosition;
  text: string;
  scene: ReviewSceneState;
  timelineLayers: ReviewSnapshot["timelineLayers"];
  transition: ReviewSnapshot["transition"];
  audio: ReviewSnapshot["audio"];
  settings: ReviewSnapshot["settings"];
  environment: { viewport: { width: number; height: number }; dpr: number; userAgent: string; assetsVersion: string };
  diagnostics: { console: { level: string; text: string }[]; failedRequests: { url: string; status: number }[] };
  hasCapture: boolean;
};

/** Flag complet exporté (capture inline si disponible). */
export type ReviewFlag = ReviewFlagMeta & { capture: string | null };

export type ReviewSessionExport = {
  kind: "mahoyo-review-session";
  version: 1;
  generatedAt: string;
  session: {
    startedAt: string;
    durationMs: number;
    route: string;
    viewport: { width: number; height: number };
    dpr: number;
    language: GameLanguage;
    assetsVersion: string;
    userAgent: string;
  };
  flags: ReviewFlag[];
};

/** Métadonnée sérialisable sans capture (localStorage). */
export function toFlagMeta(flag: ReviewFlagMeta): ReviewFlagMeta {
  return flag;
}

/** Export complet d'une session à partir des flags (helper pur, testé). */
export function buildSessionExport(
  flags: readonly ReviewFlag[],
  environment: {
    startedAt: string;
    durationMs: number;
    route: string;
    viewport: { width: number; height: number };
    dpr: number;
    language: GameLanguage;
    assetsVersion: string;
    userAgent: string;
  },
): ReviewSessionExport {
  return {
    kind: "mahoyo-review-session",
    version: 1,
    generatedAt: new Date().toISOString(),
    session: environment,
    flags: flags.map((flag) => ({ ...flag })),
  };
}

/** Résumé lisible du lanceur/console (helper pur, testé). */
export function summarizeFlags(flags: readonly ReviewFlagMeta[]): string {
  if (flags.length === 0) return "Aucun flag posé.";
  const byCategory = new Map<ReviewCategory, number>();
  const scripts = new Set<string>();
  for (const flag of flags) {
    byCategory.set(flag.category, (byCategory.get(flag.category) ?? 0) + 1);
    if (flag.script.scriptName) scripts.add(flag.script.scriptName);
  }
  const categories = [...byCategory.entries()].map(([category, count]) => `${categoryLabel(category)}=${count}`).join(", ");
  return `${flags.length} flag(s) — ${categories} — script(s) : ${[...scripts].join(", ") || "n/a"}`;
}

// ── Stockage local ──────────────────────────────────────────────────────────

const FLAGS_KEY = "mahoyo-review-flags";
const DB_NAME = "mahoyo-review";
const STORE = "captures";

function readStoredFlags(): ReviewFlagMeta[] {
  try {
    const raw = localStorage.getItem(FLAGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ReviewFlagMeta[]) : [];
  } catch {
    return [];
  }
}

function writeStoredFlags(flags: readonly ReviewFlagMeta[]): void {
  localStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putCapture(id: string, dataUrl: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(dataUrl, id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function readCaptures(): Promise<Map<string, string>> {
  const db = await openDb();
  const out = new Map<string, string>();
  if (!db) return out;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          out.set(String(cursor.key), String(cursor.value));
          cursor.continue();
        } else resolve(out);
      };
      request.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

async function deleteCapture(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function loadFlagsWithCaptures(): Promise<ReviewFlag[]> {
  const flags = readStoredFlags();
  const captures = await readCaptures();
  return flags.map((flag) => ({ ...flag, capture: captures.get(flag.id) ?? null }));
}

// ── Buffers diagnostics (console / erreurs) ─────────────────────────────────

type ConsoleEntry = { level: string; text: string };
const consoleBuffer: ConsoleEntry[] = [];
const MAX_CONSOLE = 80;
let consoleInstalled = false;

function installConsoleBuffer(): void {
  if (consoleInstalled) return;
  consoleInstalled = true;
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      consoleBuffer.push({ level, text: args.map((arg) => String(arg)).join(" ").slice(0, 500) });
      if (consoleBuffer.length > MAX_CONSOLE) consoleBuffer.shift();
      original(...args);
    };
  }
  window.addEventListener("error", (event) => {
    consoleBuffer.push({ level: "error", text: `${event.message} @ ${event.filename}:${event.lineno}` });
  });
  window.addEventListener("unhandledrejection", (event) => {
    consoleBuffer.push({ level: "error", text: `unhandledrejection: ${String(event.reason)}` });
  });
}

/** Requêtes en échec récentes (Resource Timing `responseStatus`, Chromium récent). */
function failedRequests(): { url: string; status: number }[] {
  const entries = performance.getEntriesByType("resource") as (PerformanceResourceTiming & { responseStatus?: number })[];
  return entries
    .filter((entry) => (entry.responseStatus ?? 0) >= 400)
    .slice(-20)
    .map((entry) => ({ url: entry.name.slice(0, 300), status: entry.responseStatus ?? 0 }));
}

// ── Téléchargement / presse-papiers ────────────────────────────────────────

function downloadJson(fileName: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── Montage du mode revue ─────────────────────────────────────────────────

export type ReviewModeDeps = {
  /** Instantané de l'état jeu (lecture seule, fourni par le player). */
  snapshot: () => ReviewSnapshot;
  /** Version/empreinte des assets locaux (manifeste), pour le rapport. */
  assetsVersion: string;
  /** Met le jeu en pause courte pendant le panneau (le player restaure l'état à la fermeture). */
  pause: (paused: boolean) => void;
};

export type ReviewModeHandle = {
  dispose: () => void;
  dump: () => Promise<ReviewSessionExport>;
};

const HUD_ID = "mh-review-hud";
const PANEL_ID = "mh-review-panel";
const STYLE_ID = "mh-review-style";

const CSS = `
#${HUD_ID} { position: fixed; top: 8px; right: 8px; z-index: 400; display: flex; gap: 6px; align-items: center;
  font: 600 12px/1.2 system-ui, sans-serif; color: #f5e9c8; background: rgba(20, 16, 10, .78);
  border: 1px solid #c9a75a; border-radius: 6px; padding: 5px 8px; cursor: pointer; user-select: none; }
#${HUD_ID}:hover { background: rgba(40, 32, 18, .9); }
#${HUD_ID} .mh-review-badge { letter-spacing: .04em; }
#${HUD_ID}[data-empty="true"] { opacity: .65; }
#${PANEL_ID} { position: fixed; inset: 0; z-index: 401; display: none; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .55); font: 14px/1.4 system-ui, sans-serif; color: #f6f1e4; }
#${PANEL_ID}[data-open="true"] { display: flex; }
#${PANEL_ID} .mh-review-box { width: min(560px, 92vw); max-height: 84vh; overflow: auto; background: #16130d;
  border: 1px solid #c9a75a; border-radius: 10px; padding: 16px 18px; box-shadow: 0 10px 40px rgba(0,0,0,.6); }
#${PANEL_ID} h2 { margin: 0 0 4px; font-size: 16px; color: #e8c980; }
#${PANEL_ID} .mh-review-hint { margin: 0 0 12px; opacity: .75; font-size: 12px; }
#${PANEL_ID} .mh-review-cats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
#${PANEL_ID} .mh-review-cat { padding: 6px 8px; border: 1px solid #4a3f2a; border-radius: 6px; background: #221d13;
  color: #f2e7cf; cursor: pointer; text-align: left; font: inherit; font-size: 12px; }
#${PANEL_ID} .mh-review-cat[data-selected="true"] { border-color: #e8c980; background: #332a18; }
#${PANEL_ID} input[type="text"] { width: 100%; box-sizing: border-box; padding: 8px; background: #0f0d08;
  border: 1px solid #4a3f2a; border-radius: 6px; color: #f6f1e4; font: inherit; }
#${PANEL_ID} .mh-review-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
#${PANEL_ID} button.mh-review-primary { background: #c9a75a; color: #16130d; border: 0; border-radius: 6px; padding: 7px 12px; font-weight: 700; cursor: pointer; }
#${PANEL_ID} button.mh-review-secondary { background: transparent; color: #d8c9a8; border: 1px solid #4a3f2a; border-radius: 6px; padding: 7px 12px; cursor: pointer; }
#${PANEL_ID} .mh-review-list { margin-top: 14px; border-top: 1px solid #3a301f; padding-top: 10px; font-size: 12px; }
#${PANEL_ID} .mh-review-item { display: flex; gap: 8px; justify-content: space-between; align-items: center; padding: 3px 0; }
#${PANEL_ID} .mh-review-item button { background: transparent; border: 0; color: #d98b7a; cursor: pointer; }
#${PANEL_ID} .mh-review-status { min-height: 18px; margin-top: 8px; font-size: 12px; color: #9fd39f; }
`;

function newId(): string {
  return `flag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function captureScreenshot(): Promise<string | null> {
  const target = document.getElementById("viewport") ?? document.body;
  try {
    const { default: html2canvas } = await import("html2canvas");
    const scale = Math.min(1, 960 / Math.max(1, target.clientWidth));
    const canvas = await html2canvas(target, { scale, backgroundColor: "#000", logging: false, useCORS: true });
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch (error) {
    console.warn("[review] capture html2canvas impossible :", error);
    return null;
  }
}

/** Monte le HUD/panneau/raccourcis du mode revue. Appelé seulement si `?review=1`. */
export function mountReviewMode(deps: ReviewModeDeps): ReviewModeHandle {
  installConsoleBuffer();
  const startedAt = Date.now();
  const sessionRoute = location.hash || location.pathname;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }

  const hud = document.createElement("div");
  hud.id = HUD_ID;
  hud.dataset.empty = "true";
  hud.setAttribute("role", "button");
  hud.tabIndex = 0;
  hud.innerHTML = `<span class="mh-review-badge">Revue</span><span aria-hidden="true">⚑</span><span class="mh-review-count">0</span>`;
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.dataset.open = "false";
  document.body.append(hud, panel);

  let selectedCategory: ReviewCategory = "autre";
  let saving = false;
  const status = (text: string): void => {
    const line = panel.querySelector<HTMLElement>(".mh-review-status");
    if (line) line.textContent = text;
  };

  const refreshHud = (): void => {
    const count = readStoredFlags().length;
    hud.dataset.empty = count === 0 ? "true" : "false";
    const counter = hud.querySelector<HTMLElement>(".mh-review-count");
    if (counter) counter.textContent = String(count);
  };

  const buildPanel = (): void => {
    const flags = readStoredFlags();
    panel.innerHTML = `
      <div class="mh-review-box" role="dialog" aria-modal="true" aria-label="Poser un flag de revue">
        <h2>⚑ Flag de revue</h2>
        <p class="mh-review-hint">Catégorie (touches 1–7) puis note libre optionnelle. Entrée enregistre, Échap annule.</p>
        <div class="mh-review-cats">${REVIEW_CATEGORIES.map(
          (category) =>
            `<button type="button" class="mh-review-cat" data-cat="${category.id}" data-selected="${
              category.id === selectedCategory
            }">${category.key}. ${category.label}</button>`,
        ).join("")}</div>
        <input type="text" class="mh-review-note" maxlength="400" placeholder="Note (optionnel : ce qui cloche, attendu…)" />
        <div class="mh-review-actions">
          <button type="button" class="mh-review-secondary" data-action="cancel">Annuler (Échap)</button>
          <button type="button" class="mh-review-primary" data-action="save">Enregistrer (Entrée)</button>
        </div>
        <div class="mh-review-status"></div>
        <div class="mh-review-list">
          <strong>Journal (${flags.length})</strong>
          ${flags
            .slice(-8)
            .reverse()
            .map(
              (flag) =>
                `<div class="mh-review-item"><span>${new Date(flag.createdAt).toLocaleTimeString()} · ${categoryLabel(
                  flag.category,
                )}${flag.note ? ` — ${flag.note.slice(0, 60)}` : ""}</span><button type="button" data-delete="${
                  flag.id
                }" title="Supprimer">✕</button></div>`,
            )
            .join("") || "<div class='mh-review-hint'>Aucun flag pour l'instant.</div>"}
        </div>
      </div>`;
    panel.querySelectorAll<HTMLButtonElement>(".mh-review-cat").forEach((button) => {
      button.addEventListener("click", () => {
        selectedCategory = (button.dataset.cat as ReviewCategory) ?? "autre";
        panel.querySelectorAll<HTMLButtonElement>(".mh-review-cat").forEach((entry) => {
          entry.dataset.selected = String(entry.dataset.cat === selectedCategory);
        });
      });
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.delete ?? "";
        writeStoredFlags(readStoredFlags().filter((flag) => flag.id !== id));
        void deleteCapture(id).then(() => {
          refreshHud();
          buildPanel();
          panel.dataset.open = "false";
          deps.pause(false);
        });
      });
    });
    panel.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.addEventListener("click", closePanel);
    panel.querySelector<HTMLButtonElement>('[data-action="save"]')?.addEventListener("click", () => void saveFlag());
  };

  const closePanel = (): void => {
    panel.dataset.open = "false";
    deps.pause(false);
  };

  const openPanel = (): void => {
    if (saving) return;
    buildPanel();
    panel.dataset.open = "true";
    deps.pause(true);
    const note = panel.querySelector<HTMLInputElement>(".mh-review-note");
    note?.focus();
  };

  const saveFlag = async (): Promise<void> => {
    if (saving) return;
    saving = true;
    status("Capture de l'écran…");
    const note = panel.querySelector<HTMLInputElement>(".mh-review-note")?.value.trim() ?? "";
    let capture: string | null = null;
    try {
      capture = await captureScreenshot();
      const snapshot = deps.snapshot();
      const id = newId();
      const flag: ReviewFlagMeta = {
        id,
        createdAt: new Date().toISOString(),
        sessionMs: Date.now() - startedAt,
        category: selectedCategory,
        note,
        route: location.hash || location.pathname,
        screen: snapshot.screen,
        script: snapshot.script,
        text: snapshot.text,
        scene: snapshot.scene,
        timelineLayers: snapshot.timelineLayers,
        transition: snapshot.transition,
        audio: snapshot.audio,
        settings: snapshot.settings,
        environment: {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          dpr: window.devicePixelRatio,
          userAgent: navigator.userAgent,
          assetsVersion: deps.assetsVersion,
        },
        diagnostics: { console: consoleBuffer.slice(-10), failedRequests: failedRequests() },
        hasCapture: false,
      };
      if (capture) flag.hasCapture = await putCapture(id, capture);
      writeStoredFlags([...readStoredFlags(), flag]);
      refreshHud();
      closePanel();
    } catch (error) {
      console.warn("[review] échec de l'enregistrement du flag :", error);
    } finally {
      saving = false;
    }
  };

  const exportSession = async (): Promise<ReviewSessionExport> => {
    const flags = await loadFlagsWithCaptures();
    return buildSessionExport(flags, {
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      route: sessionRoute,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dpr: window.devicePixelRatio,
      language: deps.snapshot().settings.language,
      assetsVersion: deps.assetsVersion,
      userAgent: navigator.userAgent,
    });
  };

  const downloadSession = async (): Promise<void> => {
    const session = await exportSession();
    downloadJson("review-session.json", JSON.stringify(session, null, 2));
  };

  const copySession = async (): Promise<void> => {
    const session = await exportSession();
    const json = JSON.stringify(session);
    const ok = await copyText(json);
    if (!ok) console.warn("[review] copie impossible ; JSON :", json);
    if (panel.dataset.open === "true") status(ok ? "JSON copié dans le presse-papiers." : "Copie impossible — JSON en console.");
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "F2") {
      event.preventDefault();
      event.stopPropagation();
      if (panel.dataset.open === "true") closePanel();
      else openPanel();
      return;
    }
    if (event.key === "F3") {
      event.preventDefault();
      event.stopPropagation();
      void downloadSession();
      return;
    }
    if (event.key === "F4") {
      event.preventDefault();
      event.stopPropagation();
      void copySession();
      return;
    }
    if (panel.dataset.open !== "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void saveFlag();
      return;
    }
    const category = categoryFromKey(event.key);
    if (category) {
      event.preventDefault();
      selectedCategory = category;
      panel.querySelectorAll<HTMLButtonElement>(".mh-review-cat").forEach((entry) => {
        entry.dataset.selected = String(entry.dataset.cat === selectedCategory);
      });
      status(`Catégorie : ${categoryLabel(selectedCategory)}`);
    }
  };

  hud.addEventListener("click", () => (panel.dataset.open === "true" ? closePanel() : openPanel()));
  hud.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPanel();
    }
  });
  window.addEventListener("keydown", onKeyDown, true);
  refreshHud();

  const handle: ReviewModeHandle = {
    dispose: () => {
      window.removeEventListener("keydown", onKeyDown, true);
      hud.remove();
      panel.remove();
    },
    dump: () => exportSession(),
  };
  (window as unknown as { __mhReview?: ReviewModeHandle }).__mhReview = handle;
  return handle;
}
