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
 * - une ligne = [instant, 4 indicateurs d'interpolation, valeurs dans l'ordre des
 *   propriétés, …] : la valeur de la propriété i est à l'indice 5 + i ;
 * - l'unité de temps vaut 50 ms (la plus grande valeur, 3945, donne 197 250 ms,
 *   soit exactement le `next=197250` du script).
 *
 * Logique pure ; l'I/O est dans `timelines.ts`.
 */
import { parseTjs, type TjsValue } from "./story-chain-lib.js";
import type { TimelineAudio, TimelineBg, TimelineData, TimelineScene } from "../src/core/timeline.js";

/** Durée d'une unité de temps de la timeline, en ms. */
export const TIME_UNIT_MS = 50;
/** Nombre de colonnes avant les valeurs de propriétés (instant + 4 indicateurs). */
const VALUE_OFFSET = 5;

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

/** Valeur d'une propriété à une ligne de keyframe (null si absente ou « ~ », qui signifie « inchangé »). */
function cell(row: TjsValue[], props: string[], prop: string): TjsValue | undefined {
  const i = props.indexOf(prop);
  if (i < 0) return undefined;
  const v = row[VALUE_OFFSET + i];
  return v === undefined || v === null || v === "~" ? undefined : v;
}

function timelineOf(obj: Obj): { props: string[]; rows: TjsValue[][]; end: number } | null {
  const tl = obj.timeline;
  if (!Array.isArray(tl) || !Array.isArray(tl[0]) || !Array.isArray(tl[1])) return null;
  const props = tl[0].filter((p): p is string => typeof p === "string");
  const rows = tl[1].filter((r): r is TjsValue[] => Array.isArray(r));
  return { props, rows, end: typeof tl[2] === "number" ? tl[2] : 0 };
}

function walk(objs: TjsValue, visit: (o: Obj) => void): void {
  if (!Array.isArray(objs)) return;
  for (const o of objs) {
    if (!isObj(o)) continue;
    visit(o);
    walk(o.children ?? null, visit);
  }
}

function num(v: TjsValue | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: TjsValue | undefined): string | undefined {
  return typeof v === "string" && v !== "" && v !== "void" ? v : undefined;
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
    const bg: TimelineBg[] = [];
    const audio: TimelineAudio[] = [];
    let end = 0;

    walk(roots ?? null, (obj) => {
      const tl = timelineOf(obj);
      if (!tl) return;
      end = Math.max(end, tl.end);
      const kind = String(obj.className);

      for (const row of tl.rows) {
        const at = num(row[0]);
        if (at === undefined) continue;
        const ms = at * TIME_UNIT_MS;

        if (kind === "BGObject") {
          const storage = str(cell(row, tl.props, "storage"));
          if (!storage) continue;
          const left = num(cell(row, tl.props, "left"));
          const top = num(cell(row, tl.props, "top"));
          bg.push(left !== undefined && top !== undefined ? { at: ms, storage, left, top } : { at: ms, storage });
        } else if (kind === "BGMObject" || kind === "SEObject") {
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

    bg.sort((a, b) => a.at - b.at);
    audio.sort((a, b) => a.at - b.at);
    out[String(id)] = { name, duration: end * TIME_UNIT_MS, bg, audio };
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
