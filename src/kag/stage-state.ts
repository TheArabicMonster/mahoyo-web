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
  AudioEvent,
  AudioSnapshot,
  EffectState,
  RenderEvent,
  SceneState,
  SpriteState,
  StaffrollState,
  StageSnapshot,
  TextboxState,
} from "./events.js";
import type { AnimationDef, Layer, TextSegment } from "./types.js";

function emptyScene(): SceneState {
  return { bg: null, sprites: [], effect: null };
}

function emptyTextbox(): TextboxState {
  return { visible: true, frame: true };
}

function emptyStageSnapshot(): StageSnapshot {
  return {
    scene: emptyScene(),
    textbox: emptyTextbox(),
    text: [],
    staffroll: null,
  };
}

function layerToSprite(layer: Layer): SpriteState {
  return {
    id: String(layer.index),
    storage: layer.storage,
    x: layer.center,
    y: layer.vcenter,
    z: layer.index,
    opacity: layer.opacity,
  };
}

/** État mutable interne utilisé par reduceStage. */
type StageState = {
  fore: SceneState;
  back: SceneState;
  textbox: TextboxState;
  text: TextSegment[];
  staffroll: StaffrollState;
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
      // L'état de quake n'est pas persisté dans le snapshot pour l'instant.
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
