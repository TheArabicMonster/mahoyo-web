# Agent A — Questions et hypothèses

Choix faits pour `src/renderer/stage-renderer.ts` là où les contrats ne tranchent pas. Chaque point prend l'hypothèse la plus simple.

## Transitions

- **`universal` = crossfade.** Une vraie transition par rule (seuil sur la luminance) demande un canvas/WebGL. Le `rule` et le `vague` sont ignorés pour l'instant.
- **Mécanisme du crossfade.** L'ancien fond est cloné dans un overlay qui s'estompe, révélant le nouveau fond en dessous.
- `method: "none"` ou `time: 0` applique la scène instantanément.

## Sprites

- Les sprites sont triés par `z` croissant.
- Leur position (`x`, `y`) est exprimée en pixels logiques 1280×720 et appliquée telle quelle.
- Un sprite manquant laisse un `<img>` avec une URL invalide ; le navigateur affiche une icône de rupture sans bloquer le player.

## Animations

- Mode `instant` : les animations sont ignorées.
- Sinon une `AnimationController` maintient une promesse qui se résout à la fin de la durée totale.
- `waitFor("animation", target)` attend la promesse associée.
- `hurry()` résout immédiatement toutes les animations en cours.

## Quake

- Le décalage est appliqué sur `.mh-stage` via `transform: translate(...)`.
- Un nouveau décalage est tiré toutes les 40 ms dans `±hmax` / `±vmax`.
- `quake: null` arrête le tremblement.

## Effets

- `noise.opacity` : si > 1, divisé par 255 ; sinon utilisé tel quel.
- `noise.monocro` applique un filtre `grayscale(100%)`.
- `haze` : rendu par un dégradé radial pulsé ; `power` → opacité (`power / 20`).

## Texte / Typewriter

- Les segments `{ pause: true }` sont ignorés (les pauses `[l]` sont des `StopReason`).
- `textSpeed` est le délai entre deux caractères.
- `hurry()` affiche le texte entier immédiatement.

## Textbox

- `visible: false` ou `setUserHidden(true)` passe l'opacité à 0 mais garde `pointer-events: auto`.
- `frame: false` masque le cadre.
- `textboxOpacity` règle l'opacité du fond noir.
- `fontScale` règle la taille de police de `#text`.

## Staffroll

- Rendu simple : le conteneur défile de `top: 720px` vers le haut sur `time` ms.
- `cmx` est ignoré.

## Préchargement

- `AssetRef` est un simple `string` ; on le résout comme une image.
- Un échec est loggé et résolu (pas de rejet).

## Vignette

- `captureThumbnail` utilise un canvas 2D (fond noir) puis `canvas.toBlob()`.
- En jsdom, elle retourne un Blob simulé.

## Général

- `mount()` lève une erreur au second appel.
- Les styles sont injectés dans `<head>` via une balise `<style>` unique.
