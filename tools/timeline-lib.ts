/**
 * Extraction des timelines d'animation embarquées dans les scripts `.ks`.
 *
 * Une timeline est stockée dans la section `*tladata` d'un script :
 *
 *   @iscript
 *   global.__tmp_tla = Scripts.eval('(const) %[ ... ]');
 *   global.__tla_name = "opening";
 *   @endscript
 *
 * Le littéral est un dictionnaire TJS (voir `story-chain-lib.ts` pour le lecteur).
 * Format déduit de l'observation des données, sans documentation :
 * - `scenes` est une liste plate `[id, scène, id, scène…]` ;
 * - une scène est un tableau positionnel : [0] objets racine, [2] cadence, [4] nom ;
 * - un objet porte `className`, `name`, `children` et `timeline` ;
 * - `timeline = [noms des propriétés, lignes de keyframes, durée]` ;
 * - une ligne = [instant, 4 indicateurs, valeurs dans l'ordre des propriétés, …] :
 *   la valeur de la propriété i est à l'indice 5 + i ; une valeur absente ou « ~ »
 *   laisse la propriété inchangée ;
 * - le 2e indicateur (indice 2) active (1) ou coupe (0) l'interpolation linéaire vers
 *   la ligne suivante ; absent, il garde sa dernière valeur ;
 * - l'unité de temps vaut 50 ms (la plus grande valeur, 3945, donne 197 250 ms,
 *   soit exactement le `next=197250` du script).
 *
 * Les fonds sont répartis sur des **pages** (`BGObject.page` : 0, 1…) ; un
 * `PageObject` choisit la page visible (propriété `page`, interpolée pendant un
 * fondu enchaîné). Le fond affiché est donc celui de la page visible, pas le
 * dernier fond modifié : une page cachée prépare son image avant d'être montrée.
 *
 * Les **calques** (`LayerObject`) sont les enfants d'un `BGObject` : ils appartiennent
 * à sa page et s'effacent avec elle. Le 1er indicateur (indice 1) les masque (1) ou
 * les montre (0) ; `center`/`vcenter` placent le centre de l'image, `opacity` va de 0
 * à 255, `absolute` donne l'ordre d'empilement, `processing = "rain1"` ajoute la pluie.
 *
 * Logique pure ; l'I/O est dans `timelines.ts`.
 */
import { parseTjs, type TjsValue } from "./story-chain-lib.js";
import type { TimelineAudio, TimelineBg, TimelineData, TimelineLayerKey, TimelineMove, TimelineScene } from "../src/core/timeline.js";

/** Durée d'une unité de temps de la timeline, en ms. */
export const TIME_UNIT_MS = 50;
/** Nombre de colonnes avant les valeurs de propriétés (instant + 4 indicateurs). */
const VALUE_OFFSET = 5;
/** Colonne de l'indicateur d'interpolation. */
const INTERP_COLUMN = 2;

type Obj = { [key: string]: TjsValue };

function isObj(v: TjsValue | undefined): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Déséchappe le littéral TJS placé entre apostrophes dans `Scripts.eval('…')`. */
function unescapeLiteral(raw: string): string {
  return raw.replace(/\\(["'\\])/g, "$1");
}

/** Lit la timeline d'un script ; null si le script n'en contient pas. */
export function extractTla(ksText: string): { name: string; graph: TjsValue } | null {
  const m = /Scripts\.eval\('([\s\S]*?)'\);\s*global\.__tla_name\s*=\s*"([^"]*)"/.exec(ksText);
  if (!m) return null;
  return { name: m[2]!, graph: parseTjs(unescapeLiteral(m[1]!)) };
}

type Track = { props: string[]; rows: TjsValue[][]; end: number };

/** Valeur d'une propriété à une ligne de keyframe (null si absente ou « ~ », qui signifie « inchangé »). */
function cell(row: TjsValue[], props: string[], prop: string): TjsValue | undefined {
  const i = props.indexOf(prop);
  if (i < 0) return undefined;
  const v = row[VALUE_OFFSET + i];
  return v === undefined || v === null || v === "~" ? undefined : v;
}

function timelineOf(obj: Obj): Track | null {
  const tl = obj.timeline;
  if (!Array.isArray(tl) || !Array.isArray(tl[0]) || !Array.isArray(tl[1])) return null;
  const props = tl[0].filter((p): p is string => typeof p === "string");
  const rows = tl[1].filter((r): r is TjsValue[] => Array.isArray(r) && typeof r[0] === "number" && Number.isFinite(r[0]));
  rows.sort((a, b) => (a[0] as number) - (b[0] as number));
  return { props, rows, end: typeof tl[2] === "number" ? tl[2] : 0 };
}

function walk(objs: TjsValue, visit: (o: Obj, parent: Obj | null) => void, parent: Obj | null = null): void {
  if (!Array.isArray(objs)) return;
  for (const o of objs) {
    if (!isObj(o)) continue;
    visit(o, parent);
    walk(o.children ?? null, visit, o);
  }
}

function num(v: TjsValue | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: TjsValue | undefined): string | undefined {
  return typeof v === "string" && v !== "" && v !== "void" ? v : undefined;
}

// ── Courbes ──

/**
 * Courbe d'une propriété numérique, en unités de temps : linéaire entre deux points
 * consécutifs ; deux points au même instant marquent un saut.
 */
export type Curve = { t: number; v: number }[];

/** Construit la courbe d'une propriété numérique d'après les lignes et l'indicateur d'interpolation. */
export function numericCurve(track: Track, prop: string): Curve {
  const points: Curve = [];
  let current: number | undefined;
  let interp = false;
  for (const row of track.rows) {
    const t = row[0] as number;
    const value = num(cell(row, track.props, prop));
    if (value !== undefined) {
      // Sans interpolation sur le segment qui arrive ici, la valeur tient jusqu'à t puis saute.
      if (!interp && current !== undefined) points.push({ t, v: current });
      points.push({ t, v: value });
      current = value;
    } else if (current !== undefined) {
      points.push({ t, v: current });
    }
    const flag = num(row[INTERP_COLUMN]);
    if (flag !== undefined) interp = flag !== 0;
  }
  return points;
}

/** Valeur à l'instant t (après un éventuel saut à t) ; undefined avant le premier point. */
export function valueAt(curve: Curve, t: number): number | undefined {
  let last = -1;
  for (let i = 0; i < curve.length && curve[i]!.t <= t; i++) last = i;
  if (last < 0) return undefined;
  const a = curve[last]!;
  const b = curve[last + 1];
  if (!b || b.t === a.t || t === a.t) return a.v;
  return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/** Valeur juste avant t (avant un éventuel saut à t) ; undefined si aucun point ne précède t. */
export function valueBefore(curve: Curve, t: number): number | undefined {
  const j = curve.findIndex((p) => p.t >= t);
  if (j === 0) return undefined;
  if (j < 0) return curve[curve.length - 1]?.v;
  // Le premier point à t porte la valeur d'avant le saut (voir numericCurve).
  const a = curve[j - 1]!;
  const b = curve[j]!;
  return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/** Changements d'une propriété texte (image), dans l'ordre. */
function storageKeys(track: Track): { t: number; storage: string }[] {
  const out: { t: number; storage: string }[] = [];
  for (const row of track.rows) {
    const s = str(cell(row, track.props, "storage"));
    if (s && s !== out[out.length - 1]?.storage) out.push({ t: row[0] as number, storage: s });
  }
  return out;
}

/** Changements d'une propriété texte où « void » est une valeur (retour à « rien »). */
function textKeys(track: Track, prop: string): { t: number; value: string }[] {
  const out: { t: number; value: string }[] = [];
  for (const row of track.rows) {
    const v = cell(row, track.props, prop);
    if (typeof v === "string" && v !== out[out.length - 1]?.value) out.push({ t: row[0] as number, value: v });
  }
  return out;
}

/** Courbe en escalier d'une colonne d'indicateur (`initial` avant la première ligne qui la précise). */
function flagCurve(track: Track, column: number, initial: number): Curve {
  const points: Curve = [{ t: 0, v: initial }];
  let current = initial;
  for (const row of track.rows) {
    const v = num(row[column]);
    if (v === undefined || v === current) continue;
    const t = row[0] as number;
    points.push({ t, v: current }, { t, v });
    current = v;
  }
  return points;
}

function storageAt(keys: { t: number; storage: string }[], t: number): string | undefined {
  let found: string | undefined;
  for (const k of keys) if (k.t <= t) found = k.storage;
  return found;
}

// ── Fonds visibles ──

type Page = { storage: { t: number; storage: string }[]; left: Curve; top: Curve; segments: Segment[] };

/** Déplacement de u à w vers (left, top) ; u = w pour un saut. */
type Segment = { u: number; w: number; left: number; top: number; fromLeft: number; fromTop: number };

const round2 = (x: number): number => Math.round(x * 100) / 100;

function samePos(a: { left: number; top: number }, b: { left: number; top: number }): boolean {
  return a.left === b.left && a.top === b.top;
}

/** Même direction et même vitesse : deux segments consécutifs n'en font qu'un. */
function aligned(a: Segment, b: Segment): boolean {
  const da = a.w - a.u;
  const db = b.w - b.u;
  return (
    Math.abs((a.left - a.fromLeft) / da - (b.left - b.fromLeft) / db) < 1e-6 &&
    Math.abs((a.top - a.fromTop) / da - (b.top - b.fromTop) / db) < 1e-6
  );
}

/** Déplacements continus (u < w) et sauts (u = w) de la position d'un fond, fusionnés quand ils sont alignés. */
function motionSegments(left: Curve, top: Curve): Segment[] {
  const times = [...new Set([...left, ...top].map((p) => p.t))].sort((a, b) => a - b);
  const pos = (at: (c: Curve, t: number) => number | undefined, t: number) => {
    const l = at(left, t);
    const tp = at(top, t);
    return l === undefined || tp === undefined ? null : { left: l, top: tp };
  };
  const segments: Segment[] = [];
  times.forEach((w, i) => {
    const u = times[i - 1];
    const from = u === undefined ? null : pos(valueAt, u);
    const to = pos(valueBefore, w);
    if (u !== undefined && from && to && !samePos(from, to)) {
      const seg: Segment = { u, w, left: to.left, top: to.top, fromLeft: from.left, fromTop: from.top };
      const prev = segments[segments.length - 1];
      if (prev && prev.w === u && prev.u < prev.w && aligned(prev, seg)) Object.assign(prev, { w, left: to.left, top: to.top });
      else segments.push(seg);
    }
    const after = pos(valueAt, w);
    if (to && after && !samePos(to, after)) {
      segments.push({ u: w, w, left: after.left, top: after.top, fromLeft: to.left, fromTop: to.top });
    }
  });
  return segments;
}

type Shot = { at: number; page: number; shownAt: number };

/**
 * Plans de la séquence : le fond de la page visible, chaque fois qu'elle change
 * (fondu enchaîné de la durée du changement de page) ou que la page visible change
 * d'image (coupe franche) ; puis les panoramiques de chaque plan.
 */
function buildBg(pageTrack: Track | null, pages: Map<number, Page>, end: number): { bg: TimelineBg[]; moves: TimelineMove[] } {
  if (pages.size === 0) return { bg: [], moves: [] };
  const firstPage = pages.keys().next().value as number;

  // Changements de page : segments de la courbe `page` où la valeur change.
  const shots: Shot[] = [];
  const pageCurve = pageTrack ? numericCurve(pageTrack, "page") : [];
  const initial = Math.round(valueAt(pageCurve, 0) ?? pageCurve[0]?.v ?? firstPage);
  shots.push({ at: 0, page: initial, shownAt: 0 });
  for (let i = 1; i < pageCurve.length; i++) {
    const a = pageCurve[i - 1]!;
    const b = pageCurve[i]!;
    const to = Math.round(b.v);
    if (to === Math.round(a.v) || !pages.has(to)) continue;
    shots.push({ at: a.t, page: to, shownAt: b.t });
  }

  // Coupes : la page visible change d'image en dehors d'un fondu.
  const cuts: Shot[] = [];
  shots.forEach((shot, i) => {
    const next = shots[i + 1]?.at ?? Infinity;
    for (const k of pages.get(shot.page)?.storage ?? []) {
      if (k.t > shot.shownAt && k.t < next) cuts.push({ at: k.t, page: shot.page, shownAt: k.t });
    }
  });
  const all = [...shots, ...cuts].sort((a, b) => a.at - b.at);

  const bg: TimelineBg[] = [];
  const moves: TimelineMove[] = [];
  all.forEach((shot, i) => {
    const page = pages.get(shot.page);
    if (!page) return;
    const storage = storageAt(page.storage, shot.shownAt) ?? storageAt(page.storage, shot.at);
    if (!storage) return;
    const entry: TimelineBg = { at: shot.at * TIME_UNIT_MS, storage, fade: (shot.shownAt - shot.at) * TIME_UNIT_MS };
    const left = valueAt(page.left, shot.at);
    const top = valueAt(page.top, shot.at);
    if (left !== undefined && top !== undefined) {
      entry.left = round2(left);
      entry.top = round2(top);
    }
    bg.push(entry);
    if (entry.left === undefined) return;

    const next = all[i + 1]?.at ?? Math.max(end, shot.at);
    for (const s of page.segments) {
      if (s.u >= next) break;
      if (s.u === s.w) {
        if (s.u > shot.at) moves.push({ at: s.u * TIME_UNIT_MS, left: round2(s.left), top: round2(s.top), time: 0 });
        continue;
      }
      const start = Math.max(s.u, shot.at);
      if (s.w <= start) continue;
      moves.push({ at: start * TIME_UNIT_MS, left: round2(s.left), top: round2(s.top), time: (s.w - start) * TIME_UNIT_MS });
    }
  });
  return { bg, moves };
}

// ── Calques ──

/** Colonne de l'indicateur « calque masqué ». */
const HIDDEN_COLUMN = 1;
/** Centre de l'écran (repère 1024×576) : position d'un calque sans `center`/`vcenter`. */
const CENTER_X = 512;
const CENTER_Y = 288;

type LayerSource = { id: string; track: Track; page: number };

type LayerState = { storage: string | undefined; x: number; y: number; opacity: number; z: number; rain: boolean };

/**
 * Poids d'une page à l'instant t : 1 affichée, 0 cachée, intermédiaire pendant le
 * fondu enchaîné du `PageObject` (sa propriété `page` passe de 0 à 1).
 */
function pageWeight(pageCurve: Curve | null, firstPage: number, page: number, t: number, before: boolean): number {
  if (!pageCurve) return page === firstPage ? 1 : 0;
  const p = (before ? valueBefore(pageCurve, t) : valueAt(pageCurve, t)) ?? pageCurve[0]?.v ?? firstPage;
  return Math.max(0, 1 - Math.abs(p - page));
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

function sameState(a: LayerState, b: LayerState): boolean {
  return a.storage === b.storage && a.x === b.x && a.y === b.y && a.opacity === b.opacity && a.z === b.z && a.rain === b.rain;
}

/** Vitesse (par unité de temps) de la position et de l'opacité entre deux états. */
function rate(a: LayerState, b: LayerState, d: number): number[] {
  return [(b.x - a.x) / d, (b.y - a.y) / d, (b.opacity - a.opacity) / d];
}

/**
 * Changements d'état des calques. Chaque propriété est une courbe linéaire par
 * morceaux ; entre deux instants clés consécutifs (union des points de toutes les
 * courbes), le calque passe en ligne droite de l'état du début à celui de la fin.
 * L'opacité est multipliée par le poids de la page : un calque s'efface avec la page
 * qui le porte. Un segment où le calque reste invisible ne produit rien.
 */
function buildLayers(sources: LayerSource[], pageCurve: Curve | null, firstPage: number, end: number): TimelineLayerKey[] {
  const keys: TimelineLayerKey[] = [];
  for (const { id, track, page } of sources) {
    const hidden = flagCurve(track, HIDDEN_COLUMN, 1);
    const opacity = numericCurve(track, "opacity");
    const x = numericCurve(track, "center");
    const y = numericCurve(track, "vcenter");
    const z = numericCurve(track, "absolute");
    const storage = storageKeys(track);
    const processing = textKeys(track, "processing");
    const last = Math.max(end, track.end);

    const curves = [hidden, opacity, x, y, z, pageCurve ?? []];
    const times = [...new Set([0, ...curves.flatMap((c) => c.map((p) => p.t)), ...storage.map((k) => k.t), ...processing.map((k) => k.t)])]
      .filter((t) => t >= 0 && t <= last)
      .sort((a, b) => a - b);

    const at = (curve: Curve, t: number, before: boolean, fallback: number): number =>
      (before ? valueBefore(curve, t) : valueAt(curve, t)) ?? fallback;
    /** État à t (après un saut à t) ; avec `base`, état juste avant t sur le segment commencé par `base`. */
    const stateOf = (t: number, base?: LayerState): LayerState => {
      const before = base !== undefined;
      const img = base ? base.storage : storageAt(storage, t);
      const visible = img !== undefined && at(hidden, t, before, 1) === 0;
      const op = visible ? (at(opacity, t, before, 255) / 255) * pageWeight(pageCurve, firstPage, page, t, before) : 0;
      let rain = false;
      for (const k of processing) if (k.t <= t) rain = k.value === "rain1";
      return {
        storage: img,
        x: round2(at(x, t, before, CENTER_X)),
        y: round2(at(y, t, before, CENTER_Y)),
        opacity: round3(Math.min(1, Math.max(0, op))),
        z: base ? base.z : Math.round(at(z, t, false, 0)),
        rain: base ? base.rain : rain,
      };
    };
    const key = (t: number, s: LayerState, time: number): TimelineLayerKey => {
      const k: TimelineLayerKey = { at: t * TIME_UNIT_MS, id, storage: s.storage!, x: s.x, y: s.y, opacity: s.opacity, z: s.z, time: time * TIME_UNIT_MS };
      if (s.rain) k.rain = true;
      return k;
    };

    /** État affiché (posé ou atteint) ; null tant que le calque n'a jamais été montré. */
    let shown: LayerState | null = null;
    /** Dernier mouvement émis, prolongé si le segment suivant va dans le même sens à la même vitesse. */
    let lastMove: { key: TimelineLayerKey; u: number; w: number; from: LayerState; to: LayerState } | null = null;

    times.forEach((u, i) => {
      const start = stateOf(u);
      const w = times[i + 1];
      const finish = w === undefined ? start : stateOf(w, start);
      if (start.opacity === 0 && finish.opacity === 0) {
        // Invisible pendant tout le segment : il suffit de masquer ce qui est affiché.
        if (shown && shown.opacity !== 0) {
          shown = { ...shown, opacity: 0 };
          keys.push(key(u, shown, 0));
        }
        lastMove = null;
        return;
      }
      if (!shown || !sameState(shown, start)) {
        keys.push(key(u, start, 0));
        shown = start;
        lastMove = null;
      }
      if (w === undefined || sameState(start, finish)) {
        lastMove = null;
        return;
      }
      const prev = lastMove;
      if (prev && prev.w === u) {
        const r1 = rate(prev.from, prev.to, prev.w - prev.u);
        const r2 = rate(start, finish, w - u);
        if (r1.every((v, j) => Math.abs(v - r2[j]!) < 1e-6)) {
          Object.assign(prev.key, { x: finish.x, y: finish.y, opacity: finish.opacity, time: (w - prev.u) * TIME_UNIT_MS });
          prev.w = w;
          prev.to = finish;
          shown = finish;
          return;
        }
      }
      const k = key(u, finish, w - u);
      keys.push(k);
      lastMove = { key: k, u, w, from: start, to: finish };
      shown = finish;
    });
  }
  // Tri stable : à instant égal, l'ordre de construction (pose avant mouvement) est gardé.
  return keys.sort((a, b) => a.at - b.at);
}

/** Construit les scènes d'une timeline (identifiant de scène -> scène). */
export function buildTimelineScenes(graph: TjsValue): Record<string, TimelineScene> {
  if (!isObj(graph) || !Array.isArray(graph.scenes)) throw new Error("timeline : liste de scènes absente");
  const out: Record<string, TimelineScene> = {};
  const list = graph.scenes;

  for (let i = 0; i + 1 < list.length; i += 2) {
    const id = list[i];
    const scene = list[i + 1];
    if (typeof id !== "number" || !Array.isArray(scene)) continue;

    const roots = scene[0];
    const name = typeof scene[4] === "string" ? scene[4] : "";
    const audio: TimelineAudio[] = [];
    const pages = new Map<number, Page>();
    const layerSources: LayerSource[] = [];
    let pageTrack: Track | null = null;
    let end = 0;

    walk(roots ?? null, (obj, parent) => {
      const tl = timelineOf(obj);
      if (!tl) return;
      end = Math.max(end, tl.end);
      const kind = String(obj.className);

      if (kind === "LayerObject") {
        // Un calque appartient à la page de son BGObject parent (page 0 sans parent).
        const page = parent && String(parent.className) === "BGObject" ? (num(parent.page) ?? 0) : 0;
        layerSources.push({ id: `L${layerSources.length + 1}`, track: tl, page });
      } else if (kind === "PageObject") {
        pageTrack ??= tl;
      } else if (kind === "BGObject") {
        // Une page par BGObject ; le premier rencontré l'emporte.
        const page = num(obj.page) ?? 0;
        if (!pages.has(page)) {
          const left = numericCurve(tl, "left");
          const top = numericCurve(tl, "top");
          pages.set(page, { storage: storageKeys(tl), left, top, segments: motionSegments(left, top) });
        }
      } else if (kind === "BGMObject" || kind === "SEObject") {
        for (const row of tl.rows) {
          const ms = (row[0] as number) * TIME_UNIT_MS;
          const state = cell(row, tl.props, "state");
          const storage = str(cell(row, tl.props, "storage"));
          const volume = num(cell(row, tl.props, "volume"));
          const loop = num(cell(row, tl.props, "loop")) === 1;
          const channel = kind === "BGMObject" ? "bgm" : "se";
          if (state === "play" && storage) {
            audio.push({ at: ms, channel, storage, loop, volume: (volume ?? 100) / 100, action: "play" });
          } else if (state === "continuous" && volume !== undefined) {
            audio.push({ at: ms, channel, loop, volume: volume / 100, action: "volume" });
          }
        }
      }
    });

    const { bg, moves } = buildBg(pageTrack, pages, end);
    const firstPage = pages.size > 0 ? (pages.keys().next().value as number) : 0;
    const layers = buildLayers(layerSources, pageTrack ? numericCurve(pageTrack, "page") : null, firstPage, end);
    audio.sort((a, b) => a.at - b.at);
    const built: TimelineScene = { name, duration: end * TIME_UNIT_MS, bg, moves, audio };
    if (layers.length > 0) built.layers = layers;
    out[String(id)] = built;
  }
  return out;
}

/** Extrait les timelines de tous les scripts donnés (nom de fichier -> texte). */
export function buildTimelines(scripts: ReadonlyMap<string, string>): { data: TimelineData; failures: string[] } {
  const data: TimelineData = { version: 1, scripts: {} };
  const failures: string[] = [];
  for (const [file, text] of scripts) {
    if (!text.includes("__tla_name")) continue;
    try {
      const tla = extractTla(text);
      if (!tla) continue;
      const scenes = buildTimelineScenes(tla.graph);
      if (Object.keys(scenes).length > 0) data.scripts[file] = scenes;
    } catch (err) {
      failures.push(`${file} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { data, failures };
}
