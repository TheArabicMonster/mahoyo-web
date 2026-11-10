/**
 * Réducteurs purs pour reconstruire l'état de scène et audio à partir
 * d'une séquence de RenderEvent.
 *
 * Ces fonctions sont partagées entre le runtime, le player et les tests.
 * Elles garantissent que save/load/rollback travaillent sur le même état
 * que celui affiché par le renderer.
 */
import type {
  AudioChannel,
  AudioSnapshot,
  RenderEvent,
  SceneState,
  StaffrollState,
  StageSnapshot,
  TextboxState,
} from "./events.js";
import type { AnimationDef, TextSegment } from "./types.js";

function emptyScene(): SceneState {
  return { bg: null, sprites: [], effect: null };
}

function emptyTextbox(): TextboxState {
  return { visible: true, frame: true };
}

/** État mutable interne utilisé par reduceStage. */
type StageState = {
  fore: SceneState;
  back: SceneState;
  textbox: TextboxState;
  text: TextSegment[];
  staffroll: StaffrollState | null;
  /** Animations en cours, indexées par target. */
  animations: Map<string, AnimationDef>;
};

function createStageState(): StageState {
  return {
    fore: emptyScene(),
    back: emptyScene(),
    textbox: emptyTextbox(),
    text: [],
    staffroll: null,
    animations: new Map(),
  };
}

/**
 * Applique un RenderEvent à l'état interne.
 *
 * Note : les événements `audio` sont ignorés ici (ils sont routés vers
 * `reduceAudio`). Les événements `scene` normalisent fore/back.
 */
function applyEvent(state: StageState, event: RenderEvent): void {
  switch (event.kind) {
    case "scene": {
      state.fore = { ...event.scene };
      break;
    }
    case "bgMove": {
      state.fore = { ...state.fore, bgLeft: event.left, bgTop: event.top };
      break;
    }
    case "track":
      // Une piste de calque de timeline est transitoire : hors de l'état sauvegardé.
      break;
    case "timelineLayerClear":
      break;
    case "animate": {
      state.animations.set(event.target, event.def);
      break;
    }
    case "stopAnimation": {
      if (event.target) {
        state.animations.delete(event.target);
      } else {
        state.animations.clear();
      }
      break;
    }
    case "quake":
    case "screenShake":
      // Les secousses d'écran ne sont pas persistées dans le snapshot (comme quake).
      break;
    case "textbox": {
      state.textbox = { ...event.state };
      break;
    }
    case "clearText": {
      state.text = [];
      break;
    }
    case "text": {
      state.text.push(...event.segments);
      break;
    }
    case "lineBreak": {
      state.text.push({ text: "\n" });
      break;
    }
    case "staffroll": {
      state.staffroll = event.state;
      break;
    }
    case "effect": {
      state.fore = { ...state.fore, effect: event.effect };
      break;
    }
    case "noiseAct": {
      // Le bruit animé devient l'effet courant persistant (opacité brute 0..255 comme @noise).
      state.fore = { ...state.fore, effect: { kind: "noise", opacity: event.opacity, monocro: event.monocro } };
      break;
    }
    case "audio":
      // Ignoré : géré par reduceAudio.
      break;
  }
}

/**
 * Réduit une séquence de RenderEvent en un StageSnapshot.
 *
 * Utile pour :
 * - reconstruire l'écran lors d'un load/rollback sans rejouer tout le script ;
 * - capturer l'état affiché à un point de sauvegarde ;
 * - tester le runtime indépendamment du renderer.
 */
export function reduceStage(events: readonly RenderEvent[]): StageSnapshot {
  const state = createStageState();
  for (const event of events) {
    applyEvent(state, event);
  }
  return {
    scene: state.fore,
    textbox: state.textbox,
    text: state.text,
    staffroll: state.staffroll,
  };
}

/**
 * Réduit une séquence de RenderEvent en un AudioSnapshot.
 *
 * Seuls les sons en boucle sont persistés (BGM + SE loopés).
 */
export function reduceAudio(events: readonly RenderEvent[]): AudioSnapshot {
  const loops = new Map<AudioChannel, { storage: string; volume: number }>();

  for (const event of events) {
    if (event.kind !== "audio") continue;
    const audio = event.event;

    switch (audio.kind) {
      case "play": {
        if (audio.loop) {
          loops.set(audio.channel, { storage: audio.storage, volume: audio.volume });
        }
        break;
      }
      case "stop": {
        if (audio.channel === "allSe") {
          for (const [channel] of loops) {
            if (channel.startsWith("se:")) loops.delete(channel);
          }
        } else {
          loops.delete(audio.channel);
        }
        break;
      }
      case "fade": {
        const current = loops.get(audio.channel);
        if (current) {
          loops.set(audio.channel, { ...current, volume: audio.volume });
        }
        break;
      }
      case "pause": {
        // Une piste en pause reste dans l'instantané, silencieuse : une sauvegarde
        // faite entre @playpause et @playresume retrouve la piste que la reprise réveille.
        const current = loops.get(audio.channel);
        if (current) loops.set(audio.channel, { ...current, volume: 0 });
        break;
      }
      case "resume": {
        const current = loops.get(audio.channel);
        if (current) loops.set(audio.channel, { ...current, volume: audio.volume });
        break;
      }
    }
  }

  return {
    loops: Array.from(loops.entries()).map(([channel, data]) => ({
      channel,
      storage: data.storage,
      volume: data.volume,
    })),
  };
}

/**
 * Applique un événement de scène à un StageSnapshot existant.
 *
 * Cette variante est utile pour le renderer qui maintient déjà un état
 * et veut le synchroniser avec un snapshot de sauvegarde.
 */
export function applyStageSnapshot(base: StageSnapshot, events: readonly RenderEvent[]): StageSnapshot {
  const state: StageState = {
    fore: base.scene,
    back: emptyScene(),
    textbox: base.textbox,
    text: [...base.text],
    staffroll: base.staffroll,
    animations: new Map(),
  };
  for (const event of events) {
    applyEvent(state, event);
  }
  return {
    scene: state.fore,
    textbox: state.textbox,
    text: state.text,
    staffroll: state.staffroll,
  };
}
