/**
 * KAG3 parser — transforms tokens into a list of "pages" that can be executed
 * by the runtime.
 *
 * Page boundaries are: labels (*pageN|), @pg/[p] (page break), end of input.
 */

import type { AnimationDef, AnimKeyframe, Instruction, ParsedScript, TextSegment, Token } from "./types.js";
import { storageKey } from "@/core/storage-key.js";

function parseIntArg(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Normalise un argument storage via storageKey. "" si absent. */
function normStorage(value: string | undefined): string {
  return value ? storageKey(value) : "";
}

/** Normalise un argument storage optionnel (undefined si absent). */
function normStorageOpt(value: string | undefined): string | undefined {
  return value ? storageKey(value) : undefined;
}

function parsePageLayer(value: string | undefined): "fore" | "back" | undefined {
  if (value === "fore" || value === "back") return value;
  return undefined;
}

/**
 * Parse les keyframes d'une commande @fgact.
 * Format: keys=(frame,dur,easing,storage,center,vcenter,absolute,opacity,...)(...)
 * Les props= nous donnent l'ordre des colonnes. Pour simplifier, on utilise
 * un mapping par position standard.
 */
function parseFgactKeyframes(keysStr: string | undefined, propsStr: string | undefined): AnimKeyframe[] {
  if (!keysStr) return [];
  const keyframeMatches = keysStr.match(/\([^)]+\)/g);
  if (!keyframeMatches || keyframeMatches.length === 0) return [];

  // Determiner les indices des colonnes depuis props
  const propsList = (propsStr ?? "").split(",").map(p => p.replace(/^-/, "").trim());
  const propIndex: Record<string, number> = {};
  propsList.forEach((p, i) => { propIndex[p] = i; });

  const keyframes: AnimKeyframe[] = [];
  let cumulativeTime = 0;

  for (const match of keyframeMatches) {
    const parts = match.slice(1, -1).split(",").map(s => s.trim());
    const frame = parseInt(parts[0] ?? "0");
    const dur = parseInt(parts[1] ?? "0");
    const easing = parts[2] ?? "l"; // "l" = linear, "n" = ease-in-out

    cumulativeTime += dur || frame;

    const kf: AnimKeyframe = {
      time: cumulativeTime,
      duration: dur || frame,
      easing: easing === "n" ? "ease-in-out" : "linear",
    };

    // Extraire les propriétés par position si disponibles
    if (propIndex.center !== undefined && parts[propIndex.center] && parts[propIndex.center] !== "")
      kf.center = parseInt(parts[propIndex.center]);
    else if (parts.length > 4 && parts[4] !== "")
      kf.center = parseInt(parts[4]);

    if (propIndex.vcenter !== undefined && parts[propIndex.vcenter] && parts[propIndex.vcenter] !== "")
      kf.vcenter = parseInt(parts[propIndex.vcenter]);
    else if (parts.length > 5 && parts[5] !== "")
      kf.vcenter = parseInt(parts[5]);

    if (propIndex.opacity !== undefined && parts[propIndex.opacity] && parts[propIndex.opacity] !== "")
      kf.opacity = parseInt(parts[propIndex.opacity]) / 255;
    else if (parts.length > 7 && parts[7] !== "")
      kf.opacity = parseInt(parts[7]) / 255;

    if (propIndex.zoomx !== undefined && parts[propIndex.zoomx] && parts[propIndex.zoomx] !== "")
      kf.zoomx = parseInt(parts[propIndex.zoomx]) / 100;
    if (propIndex.zoomy !== undefined && parts[propIndex.zoomy] && parts[propIndex.zoomy] !== "")
      kf.zoomy = parseInt(parts[propIndex.zoomy]) / 100;
    if (propIndex.rotate !== undefined && parts[propIndex.rotate] && parts[propIndex.rotate] !== "")
      kf.rotate = parseFloat(parts[propIndex.rotate]);

    keyframes.push(kf);
  }

  return keyframes;
}

function parseCommand(token: Extract<Token, { type: "command" }>): Instruction {
  const { name, args } = token;

  switch (name) {
    case "bg":
      return {
        kind: "bg",
        storage: normStorage(args.storage),
        time: parseIntArg(args.time),
        rule: args.rule,
        page: parsePageLayer(args.page),
      };
    case "fg":
      return {
        kind: "fg",
        storage: normStorage(args.storage),
        center: parseIntArg(args.center),
        vcenter: parseIntArg(args.vcenter),
        index: parseIntArg(args.index),
        opacity: args.opacity !== undefined ? parseIntArg(args.opacity) / 255 : undefined,
        page: parsePageLayer(args.page),
      };
    case "clall":
      return { kind: "clall", page: parsePageLayer(args.page) };
    case "clfg":
    case "clpartbg": {
      const page = parsePageLayer(args.page);
      const storage = normStorageOpt(args.storage);
      const index = args.index !== undefined ? parseIntArg(args.index) : undefined;
      return { kind: "clfg", storage, index, page };
    }
    case "backlay":
      return { kind: "backlay", storage: args.storage };
    case "trans":
      return {
        kind: "trans",
        rule: args.rule,
        time: parseIntArg(args.time),
      };
    case "fgact": {
      // @fgact = animation de sprite avec keyframes
      const storage = normStorage(args.storage);
      const page = parsePageLayer(args.page);
      const keyframes = parseFgactKeyframes(args.keys, args.props);
      const loop = args.loop === "1";
      const id = args.id;

      if (keyframes.length >= 2) {
        // On a des vraies keyframes -> instruction animate
        return {
          kind: "animate",
          def: { storage, page, keyframes, loop, id },
        };
      }

      // Fallback: traiter comme un @fg statique (position initiale de la 1ère keyframe)
      const keysMatch = args.keys?.match(/\([^)]+\)/);
      let center = parseIntArg(args.center);
      let vcenter = parseIntArg(args.vcenter);
      let index = parseIntArg(args.index);
      let opacity: number | undefined = undefined;
      if (keysMatch) {
        const parts = keysMatch[0].slice(1, -1).split(",");
        if (parts.length >= 7) center = parseInt(parts[4]) || center;
        if (parts.length >= 8) vcenter = parseInt(parts[5]) || vcenter;
        if (parts.length >= 9) opacity = parseInt(parts[7]) / 255 || undefined;
      }
      if (args.opacity !== undefined) opacity = parseIntArg(args.opacity) / 255;
      return {
        kind: "fg",
        storage,
        center,
        vcenter,
        index: index || 1,
        opacity,
        page,
      };
    }
    case "partbg": {
      // @partbg = partie de background (panorama). Traité comme un @fg positionné.
      const storage = normStorage(args.storage);
      const center = parseIntArg(args.center);
      const vcenter = parseIntArg(args.vcenter);
      const index = parseIntArg(args.index, 1000);
      const page = parsePageLayer(args.page);
      return {
        kind: "fg",
        storage,
        center,
        vcenter,
        index,
        opacity: 1,
        page,
      };
    }
    case "bgact": {
      // @bgact = animation de background. On extrait le storage.
      const storage = normStorage(args.storage);
      const page = parsePageLayer(args.page);
      return { kind: "bg", storage, time: 0, rule: undefined, page };
    }
    case "chgfg": {
      // @chgfg = changer l'image d'un sprite existant (garde position, change storage)
      const storage = normStorage(args.storage);
      return {
        kind: "fg",
        storage,
        center: 0,
        vcenter: 0,
        index: parseIntArg(args.index) || 1,
        opacity: undefined,
        page: parsePageLayer(args.page),
      };
    }
    case "movefg":
    case "movepartbg": {
      // @movefg / @movepartbg = déplacer un sprite/partie de background
      const storage = normStorage(args.storage);
      const page = parsePageLayer(args.page);
      const time = parseIntArg(args.time, 1000);
      const center = parseIntArg(args.center);
      const vcenter = parseIntArg(args.vcenter);
      const opacity = args.opacity !== undefined ? parseIntArg(args.opacity) / 255 : undefined;
      const id = args.id;

      if (time > 0) {
        // Créer une animation simple à 2 keyframes
        return {
          kind: "animate",
          def: {
            storage,
            page,
            keyframes: [
              { time: 0, duration: time, easing: "linear" },
              { time, duration: time, easing: "linear", center, vcenter, opacity },
            ],
            id,
          },
        };
      }

      return {
        kind: "fg",
        storage,
        center,
        vcenter,
        index: parseIntArg(args.index) || 1,
        opacity,
        page,
      };
    }
    case "play":
      return {
        kind: "play",
        storage: normStorage(args.storage),
        volume: args.volume !== undefined ? parseIntArg(args.volume) : undefined,
      };
    case "playstop":
      return { kind: "playstop" };
    case "fadebgm":
      return { kind: "fadebgm", time: parseIntArg(args.time, 1000) };
    case "se":
      return {
        kind: "se",
        storage: normStorage(args.storage),
        volume: args.volume !== undefined ? parseIntArg(args.volume) : undefined,
      };
    case "sestop":
      return {
        kind: "sestop",
        storage: normStorageOpt(args.storage),
        time: args.time !== undefined ? parseIntArg(args.time) : undefined,
      };
    case "fadese":
      return {
        kind: "fadese",
        storage: normStorageOpt(args.storage),
        time: parseIntArg(args.time, 1000),
        volume: parseIntArg(args.volume, 100),
      };
    case "quake":
    case "shock":
      return {
        kind: "quake",
        vmax: parseIntArg(args.vmax, 5),
        hmax: parseIntArg(args.hmax, 0),
        time: parseIntArg(args.time, 500),
        interval: parseIntArg(args.interval, 40),
      };
    case "stopquake":
      return { kind: "stopquake" };
    case "textoff":
      return { kind: "textoff", time: parseIntArg(args.time, 300) };
    case "texton":
      return { kind: "texton" };
    case "position":
      return {
        kind: "position",
        visible: args.visible !== undefined ? args.visible !== "false" : undefined,
      };
    case "invisibleframe":
      return { kind: "invisibleframe" };
    case "visibleframe":
      return { kind: "visibleframe" };
    case "noise":
      return {
        kind: "noise",
        opacity: parseIntArg(args.opacity, 128),
        monocro: args.monocro === "1" || args.monocro === "true",
        page: parsePageLayer(args.page),
      };
    case "haze":
      return {
        kind: "haze",
        power: parseIntArg(args.power, 5),
        delta: parseIntArg(args.delta, 5),
        omega: parseIntArg(args.omega, 5),
        page: parsePageLayer(args.page),
      };
    case "stophaze":
      return { kind: "stophaze", page: parsePageLayer(args.page) };
    case "beginploy":
      return { kind: "beginploy" };
    case "staffrollinit":
      return { kind: "staffrollinit", face: args.face };
    case "staffrolltext":
      return {
        kind: "staffrolltext",
        text: args.text ?? "",
        y: parseIntArg(args.y, 0),
        size: parseIntArg(args.size, 16),
        face: args.face,
        cmx: args.cmx !== undefined ? parseIntArg(args.cmx) : undefined,
      };
    case "staffrollstart":
      return {
        kind: "staffrollstart",
        height: parseIntArg(args.height, 10000),
        time: parseIntArg(args.time, 60000),
      };
    case "iscript":
      return { kind: "iscript" };
    case "endscript":
      return { kind: "endscript" };
    case "wait":
      return { kind: "wait", time: parseIntArg(args.time) };
    case "wt":
    case "wact":
    case "wm":
      // Ces commandes attendent la fin des animations/transitions. Pour le PoC, on utilise une durée fixe.
      return { kind: "wait", time: 500 };
    case "jump": {
      // @jump target=*label (intra-script) ou @jump storage=xxx.ks (inter-script)
      // storage est un nom de fichier : on garde la casse et l'extension.
      const target = (args.target ?? "").replace(/^\*/, "") || undefined;
      const storage = args.storage || undefined;
      return { kind: "jump", target, storage };
    }
    case "call": {
      // @call target=*label (intra-script) ou @call storage=xxx.ks (inter-script)
      // storage est un nom de fichier : on garde la casse et l'extension.
      const target = (args.target ?? "").replace(/^\*/, "") || undefined;
      const storage = args.storage || undefined;
      return { kind: "call", target, storage };
    }
    case "return":
      return { kind: "return" };
    case "eval":
      return { kind: "eval", expression: args.exp ?? "" };
    default:
      return { kind: "raw", command: name, args };
  }
}

export function parse(tokens: Token[]): ParsedScript {
  const pages: ParsedScript["pages"] = [];
  const labels: ParsedScript["labels"] = {};

  let current: { label?: string; instructions: Instruction[] } = { instructions: [] };

  // Text accumulation with ruby support
  let pendingSegments: TextSegment[] = [];
  // Pending ruby annotation that applies to the next text characters
  let pendingRuby: string | null = null;
  let pendingRubyCharCount = 1; // how many chars the ruby covers

  function flushText() {
    if (pendingSegments.length > 0) {
      current.instructions.push({ kind: "text", segments: pendingSegments });
      pendingSegments = [];
    }
    pendingRuby = null;
  }

  function pushPage() {
    flushText();
    if (current.instructions.length > 0 || current.label) {
      pages.push(current);
    }
    current = { instructions: [] };
  }

  /**
   * Add text content, applying any pending ruby annotation.
   * [ruby text=ふ] applies to the next character.
   * [ruby char=N text=foo] applies to the next N characters.
   */
  function addText(content: string) {
    if (content.length === 0) return;

    if (pendingRuby !== null) {
      // Apply ruby to the first N characters
      const rubyText = content.slice(0, pendingRubyCharCount);
      const rest = content.slice(pendingRubyCharCount);

      pendingSegments.push({ text: rubyText, ruby: pendingRuby });
      pendingRuby = null;
      pendingRubyCharCount = 1;

      if (rest.length > 0) {
        pendingSegments.push({ text: rest });
      }
    } else {
      pendingSegments.push({ text: content });
    }
  }

  for (const token of tokens) {
    switch (token.type) {
      case "command": {
        if (token.name === "pg") {
          // @pg is a page break macro
          pushPage();
        } else {
          flushText();
          current.instructions.push(parseCommand(token));
        }
        break;
      }
      case "tag": {
        if (token.name === "p") {
          pushPage();
        } else if (token.name === "r") {
          flushText();
          current.instructions.push({ kind: "break" });
        } else if (token.name === "l") {
          // [l] is a click-wait marker — insert a pause segment
          pendingSegments.push({ pause: true });
        } else if (token.name === "ruby") {
          // Set pending ruby for next text — DON'T flush here
          // The ruby applies to the next N characters of text
          pendingRuby = token.args.text ?? null;
          pendingRubyCharCount = parseIntArg(token.args.char, 1);
        } else {
          flushText();
          current.instructions.push({ kind: "raw", command: token.name, args: token.args });
        }
        break;
      }
      case "label": {
        pushPage();
        current.label = token.name;
        labels[token.name] = pages.length;
        break;
      }
      case "text": {
        addText(token.content);
        break;
      }
      case "comment":
      case "linebreak":
        break;
    }
  }

  pushPage();

  return { pages, labels };
}
