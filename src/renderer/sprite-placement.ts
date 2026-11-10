/**
 * Placement des sprites et partbg, en **pixels absolus** du repère logique 1024×576 (#315).
 *
 * Le renderer n'utilise plus `translate(-50%, -50%)` sur une boîte 0×0 : cette fonction pure calcule
 * la boîte finale `{x, y, width, height}` (coin haut-gauche, pixels du stage), le `transform` de zoom/
 * rotation autour du centre (ou du pivot `afx`/`afy` du moteur), la zone de clip absolue d'un sprite
 * `partbgid` et la géométrie de l'image interne d'un `@partbg` (crop).
 *
 * Sémantique (docs/KAG_MAHOYO_SEMANTICS.md §2/§4, `data/override/tagex.tjs`) :
 * - `center`/`vcenter` sont le **centre** du calque (défauts : centre du stage) ;
 * - sans crop, la boîte a la taille native de l'image (aucune mise à l'échelle de la boîte ; le
 *   zoom/rotation passent par `transform`, pivot centre ou `afx`/`afy`) ;
 * - avec crop (`@partbg`), la boîte est le rectangle `width×height` du crop, et l'image interne est
 *   posée en `(-srcleft, -srctop)` puis scalée de `srczoom/100` autour de son propre centre ;
 * - un sprite `partbgid` est **clippé** au rectangle de son partbg parent (intersection avec le
 *   stage), quelle que soit sa taille/position : aucun sprite ne doit déborder de la fenêtre.
 *
 * Aucune constante par scène : tout dépend des paramètres du script, de la taille d'image et du stage.
 */

export type ImageSize = { width: number; height: number };
export type StageSize = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Paramètres de placement issus du script (ou d'une sauvegarde). */
export type PlacementParams = {
  /** Centre horizontal du calque en px du stage (défaut : stage.width / 2). */
  center?: number;
  /** Centre vertical du calque en px du stage (défaut : stage.height / 2). */
  vcenter?: number;
  /** Zoom en pourcentage (100 = natif). */
  zoomx?: number;
  zoomy?: number;
  /** Rotation en degrés. */
  rotate?: number;
  /** Pivot absolu du zoom/rotation (moteur `afx`/`afy`) ; sinon centre de la boîte. */
  afx?: number;
  afy?: number;
  /** Crop `@partbg` : boîte et zone source. */
  crop?: {
    width: number;
    height: number;
    srcLeft: number;
    srcTop: number;
    srcZoomX: number;
    srcZoomY: number;
  } | null;
  /** Rectangle de clip absolu (partbg parent) ; null/absent = pas de clip. */
  clipRect?: Rect | null;
};

/** Image interne d'un partbg (crop) : boîte absolue + transform source. */
export type InnerPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  transform: string;
  transformOrigin: string;
};

export type Placement = {
  /** Coin haut-gauche de la boîte, pixels du stage. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Transform CSS de zoom/rotation (chaîne vide si neutre). */
  transform: string;
  /** Origine du transform CSS (toujours explicite). */
  transformOrigin: string;
  /** Clip absolu éventuel (intersection du clip demandé et du stage). */
  clip: Rect | null;
  /** Géométrie de l'image interne pour un crop partbg. */
  inner: InnerPlacement | null;
};

function scale(value: number | undefined): number {
  return (value ?? 100) / 100;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Résout le placement d'un calque.
 *
 * @param params paramètres du script
 * @param imageSize dimensions natives de l'image (manifeste des dimensions, ou décodage)
 * @param stage taille du stage logique (1024×576)
 */
export function resolvePlacement(
  params: PlacementParams,
  imageSize: ImageSize,
  stage: StageSize,
): Placement {
  const center = params.center ?? stage.width / 2;
  const vcenter = params.vcenter ?? stage.height / 2;
  const crop = params.crop ?? null;
  const width = crop ? crop.width : imageSize.width;
  const height = crop ? crop.height : imageSize.height;
  const x = center - width / 2;
  const y = vcenter - height / 2;

  const zx = scale(params.zoomx);
  const zy = scale(params.zoomy);
  const rotate = params.rotate ?? 0;
  const parts: string[] = [];
  if (rotate !== 0) parts.push(`rotate(${rotate}deg)`);
  if (zx !== 1 || zy !== 1) parts.push(`scale(${zx}, ${zy})`);

  // Pivot : `afx`/`afy` du moteur sont des coordonnées absolues du calque ; sinon centre de la boîte.
  const origin = params.afx !== undefined && params.afy !== undefined
    ? `${params.afx - x}px ${params.afy - y}px`
    : "50% 50%";

  const stageRect: Rect = { x: 0, y: 0, width: stage.width, height: stage.height };
  const clip = params.clipRect ? intersect(params.clipRect, stageRect) : null;

  let inner: InnerPlacement | null = null;
  if (crop) {
    // L'image est posée en (-srcleft, -srctop) dans la boîte du wrapper, puis zoomée autour de son centre.
    // Son centre, dans le repère du wrapper, vaut (largeurImage/2 - srcleft, hauteurImage/2 - srctop).
    const sx = (crop.srcZoomX ?? 100) / 100;
    const sy = (crop.srcZoomY ?? 100) / 100;
    inner = {
      x: crop.srcLeft === 0 ? 0 : -crop.srcLeft,
      y: crop.srcTop === 0 ? 0 : -crop.srcTop,
      width: imageSize.width,
      height: imageSize.height,
      transform: sx !== 1 || sy !== 1 ? `scale(${sx}, ${sy})` : "",
      transformOrigin: "50% 50%",
    };
  }

  return {
    x,
    y,
    width,
    height,
    transform: parts.join(" "),
    transformOrigin: origin,
    clip,
    inner,
  };
}

/** Rect du clip d'un sprite `partbgid` : le rectangle du partbg parent (crop), avant intersection stage. */
export function partbgClipRect(params: {
  center?: number;
  vcenter?: number;
  crop: { width: number; height: number };
}): Rect {
  const width = params.crop.width;
  const height = params.crop.height;
  return { x: (params.center ?? 512) - width / 2, y: (params.vcenter ?? 288) - height / 2, width, height };
}
