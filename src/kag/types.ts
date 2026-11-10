export type Token =
  | { type: "command"; name: string; args: Record<string, string> }
  | { type: "tag"; name: string; args: Record<string, string> }
  | { type: "label"; name: string }
  | { type: "text"; content: string }
  | { type: "comment"; content: string }
  | { type: "linebreak" };

/**
 * Style du texte posé par @font (sous-ensemble de la balise [font] de KAG3).
 * Seuls les champs renseignés modifient le style courant.
 */
export type TextStyle = {
  face?: string;
  size?: number;
  /** Couleur au format `#rrggbb`. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  edge?: boolean;
  /** Couleur du contour au format `#rrggbb`. */
  edgeColor?: string;
  shadow?: boolean;
  shadowColor?: string;
};

/** Segment de texte avec annotation ruby et style optionnels */
export type TextSegment =
  | { text: string; ruby?: undefined; rubyGroup?: undefined; style?: TextStyle }
  | { text: string; ruby: string; rubyGroup?: number; style?: TextStyle }
  | { pause: true }
  /**
   * Image inline dans le flux de texte (`[graph storage=… alt=…]`, KAG3). `storage` est la clé
   * d'asset résolue par l'`AssetResolver` ; `alt` sert de repli accessible et si l'image manque.
   * `ruby`/`rubyGroup` : annotation ruby posée sur l'image (#300). Le moteur compte l'image comme
   * un caractère de base (`messagelayer.tjs` `putGraph` incrémente `rubyCharCount` et dessine le
   * ruby au-dessus de l'image), donc le ruby s'attache au graph, pas au texte suivant.
   */
  | { graph: { storage: string; alt?: string; ruby?: string; rubyGroup?: number } }
  /**
   * Marqueur interne des macros emoji de `macro.tjs` (`[heart]`, `[ageage]`…) : le runtime le
   * convertit en segment `graph` avec `storage = base + fontSize courant` au moment de l'affichage.
   * Il ne doit jamais atteindre le rendu ni l'état persisté.
   */
  | { emoji: { base: string; alt: string; ruby?: string; rubyGroup?: number } };

/** Métadonnées de crop pour un calque partbg (@partbg). */
export type CropSpec = {
  /** Largeur du viewport de crop (px, repère 1024×576). */
  width: number;
  /** Hauteur du viewport de crop (px). */
  height: number;
  /** Offset source horizontal (px) — l'image est translatée de -srcLeft. */
  srcLeft: number;
  /** Offset source vertical (px). */
  srcTop: number;
  /** Zoom source X (100 = 1.0). */
  srcZoomX: number;
  /** Zoom source Y (100 = 1.0). */
  srcZoomY: number;
  /** Fond derrière le crop (storage). */
  bgStorage?: string;
};

export type Layer = {
  /** Identité stable du calque : id= explicite, sinon storage. Jamais parseInt. */
  id: string;
  storage: string;
  center: number;
  vcenter: number;
  /** z-index (= index= / absolute=). */
  index: number;
  opacity: number;
  /** `@layopt visible=0` : calque masqué sans être détruit. Absent = visible. */
  visible?: boolean;
  /** Si défini, ce calque est un partbg (crop viewport @partbg). */
  crop?: CropSpec;
  /** Pour @fg/@fgact partbgid= : id du partbg parent (clipage). */
  partbgId?: string;
  /**
   * Zoom en % (100 = taille d'origine, négatif = miroir) et rotation en degrés (sens horaire),
   * autour du centre de l'image. Absents = neutres (100 %, 0°) ; un calque neutre n'en porte pas.
   */
  zoomx?: number;
  zoomy?: number;
  rotate?: number;
  /** Point d'ancrage du zoom/rotation (px dans l'image) ; absent = centre de l'image. */
  afx?: number;
  afy?: number;
  /** Mode de fusion et filtre d'image (`type=`, `effect=`, `blur`, `brightness`, `contrast`). */
  type?: number;
  effect?: string;
  brightness?: number;
  contrast?: number;
  blurx?: number;
  blury?: number;
};

export type PageLayer = "fore" | "back";

/** Une keyframe d'animation (propriétés interpolables) */
export type AnimKeyframe = {
  time: number;       // ms absolu depuis le début de l'animation
  duration: number;   // delta ms depuis la keyframe précédente
  /** Lettre interp brute : "l"=linear, "n"=steps(palier), "~"=warning. */
  interp: "l" | "n" | "~";
  easing: string;     // "linear" | "steps" | "warn" (dérivé de interp)
  accel: number;      // accélération (col 2)
  // Props continues :
  center?: number;
  vcenter?: number;
  /** Position du fond (`@bgact`), repère 1024×576 : coin haut gauche de l'image. */
  left?: number;
  top?: number;
  opacity?: number;   // 0..1
  zoomx?: number;     // 1.0 = 100%
  zoomy?: number;
  rotate?: number;    // degrés
  absolute?: number;  // z-index
  // Props continues spécifiques aux partbg (crop interne) :
  srcleft?: number;
  srctop?: number;
  srczoomx?: number;
  srczoomy?: number;
  /** Luminosité (−255..255) et flou de boîte (px), props `-brightness` / `-xblur` / `-yblur`. */
  brightness?: number;
  blurx?: number;
  blury?: number;
  // Props discrètes (appliquées instantanément, pas interpolées) :
  storage?: string;
  visible?: boolean;
  type?: number | string;
  effect?: string;
  contrast?: number;
};

/**
 * Keyframe d'une action de plugin (`@noiseact`, `noiseplugin.tjs` `kt.noiseact`) : mêmes colonnes
 * que `@fgact`/`@bgact` (temps, accel, interp, puis valeurs des `props`), mais propriétés du bruit.
 * `opacity` est en 0..255 comme dans le moteur ; les propriétés discrètes (`-`) sont appliquées
 * instantanément.
 */
export type PluginKeyframe = {
  time: number;
  duration: number;
  interp: "l" | "n" | "~";
  opacity?: number;
  monocro?: boolean;
  visible?: boolean;
  status?: string;
  absolute?: number;
};

export type AnimationDef = {
  storage: string;
  page?: PageLayer;
  keyframes: AnimKeyframe[];
  loop?: boolean;
  id?: string;
  /** Pour @fgact sur un partbg : identifiant du calque partbg ciblé. */
  partbgid?: string;
  /** Si true, l'animation cible un partbg (ex. @partbgact). */
  isPartbg?: boolean;
  /** Si true, c'est un @movefg/@movepartbg (cible fore, écrit aussi sur back). */
  isMove?: boolean;
};

/**
 * Zoom (%) et rotation (degrés) lus sur un `@bg`, `@fg` ou `@chgfg` ; absents = non précisés.
 * `afx`/`afy` déplacent le point d'ancrage du zoom/rotation (px dans l'image).
 */
export type TransformArgs = {
  zoomx?: number;
  zoomy?: number;
  rotate?: number;
  afx?: number;
  afy?: number;
};

/**
 * Apparence d'un calque (`@bg`, `@fg`, `@chgfg`, `@partbg`) : mode de fusion, filtre d'image,
 * flou, luminosité et contraste. Sémantique vérifiée dans les sources du moteur (tag étendu
 * `@image` de `data/override/tagex.tjs` et application dans `AnimationLayer.override.tjs`) :
 *
 * - `type` : mode de composition KiriKiri (entier). Valeurs connues (cf.
 *   `scenario/noiseplugin.tjs`) : 1 opaque, 2 alpha, 3 additif, 4 soustractif, 5 multiplicatif,
 *   8 densité, 9 sombre, 10 clair, 11 écran, 12 alpha additif, 13 PS normal, 14 PS linéaire
 *   éclaircir, 15 PS linéaire brûler, 16 PS multiplier, 17 PS écran, 18 PS superposition,
 *   19 PS lumière crue, 20 PS lumière douce, 21 PS densité couleur, 22 idem (<=5),
 *   23 PS brûlure couleur, 24 PS éclaircir, 25 PS assombrir, 26 PS différence,
 *   27 idem (<=5), 28 PS exclusion. Absent = défaut du moteur (alpha).
 * - `effect` : nom d'effet. Effets intrinsèques : `monocro`/`monochrome`, `sepia`, `nega`,
 *   `red`, `green`, `blue`, `mono<rrggbb>` (aplat de couleur en conservant l'alpha — le nom
 *   `mono…` est un remplissage, pas une teinte). Les autres noms (`屋外深夜`, `mh屋内曇り`…)
 *   sont des **effets d'ambiance** définis dans `data/others/envcolor.ksc` (données du jeu,
 *   non installées par le pipeline) : non appliqués pour l'instant (avertissement).
 * - `blurx`/`blury` : flou de boîte (px), `blur=` s'applique aux deux axes.
 * - `brightness` : −255..255 ; `contrast` : −127..127 (comme le moteur).
 */
export type AppearanceArgs = {
  type?: number;
  effect?: string;
  blurx?: number;
  blury?: number;
  brightness?: number;
  contrast?: number;
};

export type Instruction =
  | ({ kind: "bg"; storage: string; time: number; rule?: string; page?: PageLayer; left?: number; top?: number; noclear?: boolean; nowait?: boolean; canskip?: boolean } & TransformArgs & AppearanceArgs)
  | ({ kind: "bgact"; storage: string; page?: PageLayer; keyframes: AnimKeyframe[] })
  | ({ kind: "fg"; storage: string; center: number; vcenter: number; index: number; opacity?: number; page?: PageLayer; id?: string; partbgId?: string; time?: number; rule?: string; nowait?: boolean; canskip?: boolean } & TransformArgs & AppearanceArgs)
  | ({ kind: "chgfg"; storage: string; id?: string; index?: number; page?: PageLayer; center?: number; vcenter?: number; time?: number; rule?: string; nowait?: boolean; canskip?: boolean } & TransformArgs & AppearanceArgs)
  | ({ kind: "partbg"; storage: string; center: number; vcenter: number; index: number; opacity?: number; page?: PageLayer; id?: string; noclear?: boolean; bgstorage?: string; time?: number; rule?: string; nowait?: boolean; canskip?: boolean; crop: CropSpec } & AppearanceArgs)
  | { kind: "animate"; def: AnimationDef }
  | {
      kind: "infg";
      storage: string;
      id?: string;
      page?: PageLayer;
      index?: number;
      center: number;
      vcenter: number;
      opacity: number;
      time: number;
      accel: number;
      /** Décalage horizontal/vertical du point de départ de l'apparition (défauts : 24 / 0). */
      mx: number;
      my: number;
      zoomx?: number;
      zoomy?: number;
      rotate?: number;
      type?: number;
      effect?: string;
      brightness?: number;
      contrast?: number;
      blurx?: number;
      blury?: number;
    }
  | { kind: "outfg"; page?: PageLayer; id?: string; storage?: string; time: number; accel: number; mx: number; my: number }
  | {
      kind: "layopt";
      page?: PageLayer;
      id?: string;
      storage?: string;
      /** Nom de calque KAG (`layer=message0`…) — les calques de message ne sont pas modélisés. */
      layer?: string;
      center?: number;
      vcenter?: number;
      left?: number;
      top?: number;
      opacity?: number;
      visible?: boolean;
    }
  | { kind: "bindbg"; enabled: boolean; page?: PageLayer }
  /** @cm : vide la fenêtre de texte (clearText explicite). */
  | { kind: "cm" }
  /** @cm4pg (tagex.tjs) : `cm` + copie des drapeaux de cache moteur (sans effet visible ici). */
  | { kind: "cm4pg" }
  | { kind: "clall"; page?: PageLayer }
  | { kind: "clfg"; storage?: string; index?: number; id?: string; page?: PageLayer }
  | { kind: "backlay"; storage?: string }
  | {
      kind: "trans";
      rule?: string;
      time: number;
      nowait?: boolean;
      canskip?: boolean;
      cond?: string;
      /** Échange fore/back à la fin du fondu (moteur : `exchange=true` par défaut, #253). */
      exchange?: boolean;
      /** Ne pas exécuter le backlay après une transition bloquante (`@trans noback=1`, #253). */
      noback?: boolean;
    }
  | { kind: "play"; storage: string; volume?: number }
  | { kind: "playstop"; time?: number }
  | { kind: "playpause"; time: number; storage?: string }
  | { kind: "playresume"; time: number; volume: number; storage?: string }
  | { kind: "fadebgm"; time: number; volume?: number }
  | { kind: "se"; storage: string; volume?: number; loop?: boolean; delay?: number }
  | { kind: "seact"; storage: string; delay: number; fadeIn: number; volume: number; loop: boolean; cond?: string }
  | { kind: "playtimeline"; scene: number; next?: number }
  | { kind: "sestop"; storage?: string; time?: number }
  | { kind: "fadese"; storage?: string; time: number; volume: number }
  | { kind: "quake"; vmax: number; hmax: number; time: number; interval: number }
  | { kind: "stopquake" }
  | { kind: "lockquickmenu" }
  | { kind: "unlockquickmenu" }
  | { kind: "pauseautomode" }
  | { kind: "resumeautomode" }
  | {
      /**
       * `@current` (KAG3) : couche de message courante (`message0`/`message1`), approximée en état
       * seul (le port n'a qu'une textbox). `withback` est mémorisé, sans effet visuel.
       */
      kind: "current";
      layer?: "message0" | "message1";
      withBack?: boolean;
    }
  /** `@store` (KAG3) : active/désactive la sauvegarde et le chargement (défaut : activé). */
  | { kind: "store"; enabled: boolean }
  /**
   * `@action` (KAG3 + `override/action.tjs`) : action animée sur un calque. Seul le module
   * `LayerNormalMoveModule` a une sémantique complète (translation `startx/x`, `starty/y` sur
   * `time`) ; les autres modules sont approximés en translation linéaire (écart documenté).
   */
  | {
      kind: "action";
      module: string;
      page?: PageLayer;
      id?: string;
      storage?: string;
      startx?: number;
      starty?: number;
      x?: number;
      y?: number;
      time: number;
      accel?: number;
      delay?: number;
      nonstop?: boolean;
    }
  /** `@removeaction` (tagex.tjs) : annule les actions en conservant l'état courant (vs `@stopaction`). */
  | { kind: "removeaction"; page?: PageLayer; id?: string; storage?: string }
  /** `@pauseaction` (tagex.tjs) : met en pause les actions (`all=1` : même non-pausables). */
  | { kind: "pauseaction"; all: boolean; page?: PageLayer; id?: string; storage?: string }
  /** `@resumeaction` (tagex.tjs) : relance les actions en pause. */
  | { kind: "resumeaction"; page?: PageLayer; id?: string; storage?: string }
  /** `@pauseploy` : masque temporairement la bulle « ploy » (fin + police par défaut). */
  | { kind: "pauseploy" }
  /** `@resumeploy` : rétablit la bulle « ploy » masquée par `@pauseploy`. */
  | { kind: "resumeploy" }
  /** `@beginfallnote` (fallnoteplugin.tjs) : pluie de notes de papier — approximation particules. */
  | { kind: "beginfallnote"; index?: number; page?: PageLayer }
  /** `@fallnoteopt` : règle le taux d'émission des notes (autres options hors approximation). */
  | { kind: "fallnoteopt"; rate?: number }
  /** `@endfallnote` : arrête l'émission de nouvelles notes. */
  | { kind: "endfallnote" }
  | { kind: "textoff"; time: number }
  | { kind: "texton" }
  | { kind: "position"; visible?: boolean; frame?: string }
  | { kind: "invisibleframe" }
  | { kind: "visibleframe" }
  | { kind: "noise"; opacity: number; monocro?: boolean; page?: PageLayer }
  | { kind: "stopnoise" }
  | { kind: "stopaction" }
  | { kind: "stoptrans" }
  | { kind: "haze"; power: number; delta: number; omega: number; page?: PageLayer }
  | { kind: "stophaze"; page?: PageLayer }
  /** Secousse sinusoïdale (`@shake`, override tagex.tjs) : amplitude et période. `time` absent = continu. */
  | { kind: "shake"; vmax: number; hmax: number; cycle: number; time?: number }
  /** Secousse aléatoire continue (`@swing`, tagex.tjs) : périodes et vibrations tirées au hasard. */
  | { kind: "swing"; minCycle: number; maxCycle: number; minVibration: number; maxVibration: number; rate: number; time?: number }
  | { kind: "stopswing" }
  /** Modification animée des propriétés du bruit (`@noiseact`, noiseplugin.tjs `kt.noiseact`). */
  | { kind: "noiseact"; keyframes: PluginKeyframe[] }
  /** Lignes de concentration (`@focusline`, focuslineplugin.tjs) : rendu dédié approximé. */
  | {
      kind: "focusline";
      cx: number;
      cy: number;
      minLength: number;
      maxLength: number;
      minLines: number;
      maxLines: number;
      appear: number;
      color: string;
      opacity: number;
      status: string;
    }
  | { kind: "stopfocusline" }
  | { kind: "clearfocusline" }
  | { kind: "beginploy" }
  | { kind: "endploy" }
  | { kind: "ploysay"; mode: string; ox: number; oy: number }
  | { kind: "font"; style: TextStyle }
  | { kind: "resetfont" }
  | { kind: "staffrollinit"; face?: string }
  | { kind: "staffrolltext"; text: string; y: number; size: number; face?: string; cmx?: number }
  | { kind: "staffrollstart"; height: number; time: number }
  | { kind: "staffrolluninit" }
  | { kind: "staffrollsetting"; bgcolor?: string }
  | { kind: "xchgbgm"; storage: string; time?: number; intime?: number; outtime?: number; overlap?: number; volume?: number; loop?: boolean }
  | { kind: "clickskip"; enabled: boolean }
  | { kind: "cancelskip" }
  | { kind: "effectskip"; enabled: boolean }
  /** `@chgpartbg` : change l'image/les paramètres d'un partbg existant (avec transition optionnelle). */
  | ({ kind: "chgpartbg"; storage?: string; id?: string; page?: PageLayer; time?: number; rule?: string; nowait?: boolean; canskip?: boolean } & TransformArgs & AppearanceArgs)
  /** `@dispclock` : horloge in-game — fond + 4 aiguilles (plugin `macro.tjs`). */
  | { kind: "dispclock"; h: number; m: number; left: number; top: number; zoomx: number; zoomy: number; effect?: string; time?: number }
  /** `@tickclock` : avance les aiguilles de l'horloge (animations `fgact` de 300 ms). */
  | { kind: "tickclock"; h: number; m: number; wait: boolean }
  /** `@setdefaultmessageaction` / `@resetdefaultmessageaction` : action continue des messages. */
  | { kind: "setdefaultmessageaction"; type: string }
  | { kind: "resetdefaultmessageaction" }
  | { kind: "iscript" }
  | { kind: "endscript" }
  | { kind: "wait"; time: number; skippable?: boolean }
  | {
      kind: "waitfor";
      what: "transition" | "animation" | "quake" | "bgmFade" | "staffroll";
      skippable?: boolean;
      /** `@wt noback=1` : ne pas copier fore→back après l'attente de transition (#253). */
      noback?: boolean;
    }
  | { kind: "text"; segments: TextSegment[] }
  | { kind: "break" }
  | { kind: "jump"; target?: string; storage?: string; cond?: string }
  | { kind: "call"; target?: string; storage?: string; cond?: string }
  | { kind: "return" }
  | { kind: "eval"; expression: string; cond?: string }
  | { kind: "raw"; command: string; args: Record<string, string> }
  /**
   * `@image` (KAG3 standard) : charge une image dans une couche d'une page, sans transition.
   * `layer` = `base` (fond de la page, cas de tous les usages du corpus) ou un numéro de couche.
   */
  | ({ kind: "image"; storage: string; page?: PageLayer; layer: "base" | number; left?: number; top?: number; opacity?: number; visible?: boolean } & AppearanceArgs)
  /** `@s` (KAG3) : arrête le déroulement en attendant une sélection (bouton/lien). */
  | { kind: "stop" }
  /**
   * Commande KAG standard volontairement sans effet ici (fermeture de bloc conditionnel
   * orpheline, cf. `@endif` sans `@if`). N'est pas comptée comme commande inconnue.
   */
  | { kind: "noop"; command: string; reason: string }
  | { kind: "conditional"; branches: Array<{ cond?: string; instructions: Instruction[] }> }
  /** Saut inconditionnel vers un index d'instruction aplati (#80). */
  | { kind: "jumpIndex"; target: number }
  /** Saut conditionnel vers un index aplati si `cond` est faux (#80). */
  | { kind: "jumpIfNot"; cond?: string; target: number }
  | { kind: "macrodef"; name: string; rawTokens: Token[] };

export type Page = {
  label?: string;
  instructions: Instruction[];
};

export type ParsedScript = {
  pages: Page[];
  labels: Record<string, number>;
  /**
   * Instruction index within the target page for each label. Required now
   * that labels are no longer page boundaries.
   */
  labelInstructionIndex: Record<string, number>;
};
