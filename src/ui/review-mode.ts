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
const HELP_ID = "mh-review-help";
const TOAST_ID = "mh-review-toast";
const HELP_SEEN_KEY = "mahoyo-review-help-seen";
const STYLE_ID = "mh-review-style";

const CSS = `
#${HUD_ID} { position: fixed; top: 8px; right: 8px; z-index: 900; display: flex; gap: 6px; align-items: center;
  font: 600 12px/1.2 system-ui, sans-serif; color: #f5e9c8; background: rgba(20, 16, 10, .9);
  border: 1px solid #c9a75a; border-radius: 6px; padding: 4px; box-shadow: 0 2px 10px rgba(0,0,0,.45); }
#${HUD_ID}[data-empty="true"] { border-color: #8a7440; }
#${HUD_ID} button { font: inherit; color: inherit; background: transparent; border: 1px solid #4a3f2a;
  border-radius: 4px; padding: 4px 7px; cursor: pointer; }
#${HUD_ID} button:hover { background: rgba(201, 167, 90, .18); border-color: #c9a75a; }
#${HUD_ID} .mh-review-count { min-width: 16px; text-align: center; color: #e8c980; font-weight: 700; }
#${PANEL_ID} { position: fixed; inset: 0; z-index: 901; display: none; align-items: center; justify-content: center;
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
#${HELP_ID} { position: fixed; inset: 0; z-index: 902; display: none; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .6); font: 14px/1.5 system-ui, sans-serif; color: #f6f1e4; }
#${HELP_ID}[data-open="true"] { display: flex; }
#${HELP_ID} .mh-review-help-box { width: min(520px, 92vw); background: #16130d; border: 1px solid #c9a75a;
  border-radius: 10px; padding: 18px 20px; box-shadow: 0 10px 40px rgba(0,0,0,.6); }
#${HELP_ID} h2 { margin: 0 0 8px; font-size: 17px; color: #e8c980; }
#${HELP_ID} ul { margin: 0 0 12px; padding-left: 18px; }
#${HELP_ID} li { margin: 3px 0; }
#${HELP_ID} kbd { background: #2a2418; border: 1px solid #5a4a2a; border-radius: 4px; padding: 0 5px; font: inherit; }
#${HELP_ID} .mh-review-help-actions { display: flex; justify-content: flex-end; gap: 8px; }
#${HELP_ID} button { background: #c9a75a; color: #16130d; border: 0; border-radius: 6px; padding: 7px 14px; font-weight: 700; cursor: pointer; }
#${TOAST_ID} { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 903;
  max-width: 86vw; padding: 8px 14px; border-radius: 6px; background: rgba(24, 20, 12, .96);
  border: 1px solid #c9a75a; color: #f6f1e4; font: 600 13px/1.3 system-ui, sans-serif;
  opacity: 0; pointer-events: none; transition: opacity .18s linear; }
#${TOAST_ID}[data-visible="true"] { opacity: 1; }
`;

function newId(): string {
  return `flag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Scène logique du moteur (16:9) ; le stage est agrandi dans le viewport par `transform: scale(1.25)`. */
export const STAGE_LOGICAL_WIDTH = 1024;
export const STAGE_LOGICAL_HEIGHT = 576;
const CAPTURE_MAX_WIDTH = 960;

/** Géométrie de capture : image 16:9 plein cadre, largeur max 960 (helper pur, testé). */
export function captureGeometry(maxWidth = CAPTURE_MAX_WIDTH): { width: number; height: number; scale: number } {
  const width = Math.min(maxWidth, STAGE_LOGICAL_WIDTH);
  return { width, height: Math.round((width * STAGE_LOGICAL_HEIGHT) / STAGE_LOGICAL_WIDTH), scale: width / STAGE_LOGICAL_WIDTH };
}

/** Décode l'image de fond du cadre de texte avant la capture (html2canvas n'attend pas les fonds). */
async function waitForFrameImage(): Promise<void> {
  const frame = document.querySelector<HTMLElement>("#textbox-frame");
  if (!frame) return;
  const background = getComputedStyle(frame).backgroundImage;
  const url = background.match(/url\("?([^")]+)"?\)/)?.[1];
  if (!url) return;
  await new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
    setTimeout(resolve, 1500);
  });
}

/**
 * Capture fiable de la scène (#415) : on capture `.mh-stage` (1024×576 logique) et non le
 * viewport 1280×720, car html2canvas n'applique pas `transform: scale(1.25)` → bandes noires.
 * `onclone` déplie le transform, fixe la taille logique et neutralise le layout du viewport ;
 * le cadre de texte (fond CSS `txtwindow02`) est attendu (décodage) puis rendu comme le reste.
 */
async function captureScreenshot(): Promise<string | null> {
  const stage = document.querySelector<HTMLElement>(".mh-stage");
  const target = stage ?? document.getElementById("viewport") ?? document.body;
  try {
    await waitForFrameImage();
    const { default: html2canvas } = await import("html2canvas");
    const geometry = captureGeometry();
    const canvas = await html2canvas(target, {
      width: STAGE_LOGICAL_WIDTH,
      height: STAGE_LOGICAL_HEIGHT,
      scale: geometry.scale,
      backgroundColor: "#000",
      useCORS: true,
      logging: false,
      imageTimeout: 5000,
      onclone: (clonedDocument: Document) => {
        // Déplie le transform du stage (sinon letterbox : contenu 1024×576 dans 1280×720).
        for (const element of clonedDocument.querySelectorAll<HTMLElement>(".mh-stage")) {
          element.style.transform = "none";
          element.style.transformOrigin = "0 0";
          element.style.width = `${STAGE_LOGICAL_WIDTH}px`;
          element.style.height = `${STAGE_LOGICAL_HEIGHT}px`;
          element.style.left = "0px";
          element.style.top = "0px";
        }
        // Neutralise un éventuel fit/transform du viewport ou du stage parent.
        for (const element of clonedDocument.querySelectorAll<HTMLElement>("#viewport, .mh-stage-parent")) {
          element.style.transform = "none";
          element.style.transformOrigin = "0 0";
        }
      },
    });
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
  hud.setAttribute("role", "toolbar");
  hud.setAttribute("aria-label", "Mode revue");
  hud.innerHTML = `
    <button type="button" class="mh-review-mark" title="Marquer un passage (F2)">⚑ Marquer (F2)</button>
    <span class="mh-review-count" aria-label="Nombre de flags">0</span>
    <button type="button" class="mh-review-export" title="Exporter la session (F3)">Exporter (F3)</button>
    <button type="button" class="mh-review-help" title="Aide du mode revue">?</button>`;
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.dataset.open = "false";
  const help = document.createElement("div");
  help.id = HELP_ID;
  help.dataset.open = "false";
  help.innerHTML = `
    <div class="mh-review-help-box" role="dialog" aria-modal="true" aria-label="Aide du mode revue">
      <h2>⚑ Mode revue actif</h2>
      <ul>
        <li><kbd>F2</kbd> (ou le bouton <strong>⚑ Marquer</strong>) : marquer le passage — catégorie avec <kbd>1</kbd>–<kbd>7</kbd> (Texte/Sprite/Fond/Transition/Son/Icône/Autre), note libre, <kbd>Entrée</kbd> valide.</li>
        <li><kbd>F3</kbd> : exporter <code>review-session.json</code> ; <kbd>F4</kbd> : copier le JSON.</li>
        <li><strong>Fermez le navigateur pour terminer la session</strong> : le lanceur récupère les flags automatiquement.</li>
        <li>Si les touches ne répondent pas, cliquez une fois dans la page (focus).</li>
      </ul>
      <div class="mh-review-help-actions"><button type="button" class="mh-review-help-ok">Compris (Entrée)</button></div>
    </div>`;
  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.dataset.visible = "false";
  toast.setAttribute("role", "status");
  document.body.append(hud, panel, help, toast);

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

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const showToast = (text: string): void => {
    toast.textContent = text;
    toast.dataset.visible = "true";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.dataset.visible = "false";
    }, 2600);
  };

  const hideHelp = (): void => {
    help.dataset.open = "false";
    try {
      sessionStorage.setItem(HELP_SEEN_KEY, "1");
    } catch {
      // stockage indisponible : l'aide se réaffichera au prochain chargement, sans impact.
    }
  };
  const showHelp = (): void => {
    help.dataset.open = "true";
  };
  let helpShownThisSession = false;
  const maybeShowFirstLaunchHelp = (): void => {
    try {
      if (sessionStorage.getItem(HELP_SEEN_KEY) === "1") return;
    } catch {
      // pas de sessionStorage : on affiche quand même l'aide une fois.
    }
    if (!helpShownThisSession) {
      helpShownThisSession = true;
      showHelp();
    }
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
      const allFlags = [...readStoredFlags(), flag];
      writeStoredFlags(allFlags);
      refreshHud();
      closePanel();
      showToast(`Flag #${allFlags.length} enregistré — ${categoryLabel(selectedCategory)}`);
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
    if (help.dataset.open === "true") {
      if (event.key === "Enter" || event.key === "Escape" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        hideHelp();
        return;
      }
      if (event.key !== "F2" && event.key !== "F3" && event.key !== "F4") return;
      hideHelp();
    }
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

  hud.querySelector<HTMLButtonElement>(".mh-review-mark")?.addEventListener("click", () => {
    if (panel.dataset.open === "true") closePanel();
    else openPanel();
  });
  hud.querySelector<HTMLButtonElement>(".mh-review-export")?.addEventListener("click", () => void downloadSession());
  hud.querySelector<HTMLButtonElement>(".mh-review-help")?.addEventListener("click", () => showHelp());
  help.querySelector<HTMLButtonElement>(".mh-review-help-ok")?.addEventListener("click", hideHelp);
  help.addEventListener("click", (event) => {
    if (event.target === help) hideHelp();
  });
  window.addEventListener("keydown", onKeyDown, true);
  refreshHud();
  maybeShowFirstLaunchHelp();

  const handle: ReviewModeHandle = {
    dispose: () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (toastTimer) clearTimeout(toastTimer);
      hud.remove();
      panel.remove();
      help.remove();
      toast.remove();
    },
    dump: () => exportSession(),
  };
  (window as unknown as { __mhReview?: ReviewModeHandle }).__mhReview = handle;
  return handle;
}
