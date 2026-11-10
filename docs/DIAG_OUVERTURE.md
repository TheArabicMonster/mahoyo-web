# Diagnostic de l'ouverture — flash, panoramique final, synchro (#352)

Outil : **`npm run diag:opening`** (`tools/diag-opening.ts`). But : mesurer de façon reproductible
l'ouverture du jeu sur les **assets réels locaux**, pour instruire et valider **#254** (flash blanc,
panoramique final décalés) et **#158** (synchro musique / timeline), y compris **avant** de recevoir
l'enregistrement OP du propriétaire.

> Aucun asset, capture ou texte original n'est commité : les images, vidéos et rapports restent dans
> un dossier **hors dépôt** (`--out`, défaut `/tmp/mahoyo-opening`). L'outil n'est pas lancé en CI
> (assets réels requis).

## Usage

```bash
# Prérequis : assets réels locaux (public/assets) et Chromium Playwright.
MAHOYO_E2E_ASSETS=/chemin/vers/public npm run diag:opening
# options
npm run diag:opening -- --assets /chemin/vers/public --out /tmp/mahoyo-opening
npm run diag:opening -- --reference /chemin/vers/op-owner.mp4   # comparaison à l'OP du propriétaire
npm run diag:opening -- --strict                                 # exit 1 si flash absent ou pan non mesuré
```

Sorties : `rapport.json` + images de capture dans `--out`. Le rapport contient `flash`, `finalPan`,
`logoOnSky`, `layers`, `sync`, `title`, `referenceComparison`.

## Méthode

1. Le player est lancé avec les **assets réels**, l'enchaînement forcé sur `opening.ks`, et l'ouverture
   jouée **jusqu'au retour à l'écran titre**.
2. Pendant la lecture : une image toutes ~100 ms (analyse de luminance / fondus), et un échantillon
   DOM + audio toutes ~100 ms (fond `storage`/`left`/`top`, calques de timeline x/y/opacité, animations
   WAAPI `duration`, événements `HTMLAudioElement.play/pause`).
3. **Flash blanc** : luminance par image ; un flash = luminance > **0,7** durant ≥ **120 ms** ; on
   relève début/fin/durée/pic, le ratio vs médiane, et si le pic précède la **première image** du jeu.
   Une **coupure** = saut de luminance > **0,3** hors intervalle de flash.
4. **Panoramique final** : position du fond observée aux instants clés (`162 400`, `173 750`,
   `176 900`, `187 000` ms du modèle) comparée à `timelines.json` (`bg`/`moves`/`accel`, même loi
   d'interpolation que le renderer) → Δ en px ; idem pour le logo `00_タイトル` et les calques
   `12_手前c`/`00_タイトル`.
5. **Synchro** : horodatage des changements de fond observés vs `at` du modèle, lancement audio vs
   `audio[].at`, durées d'animation demandées vs `fade` attendus.
6. **Ouverture → titre** : durée totale vs `duration` du modèle, phases (`black`/`in`/`idle`/`out`),
   transition de fermeture.
7. **Mode `--reference <video>`** : extraction ffmpeg d'images de la vidéo OP du propriétaire,
   alignement temporel grossier (~0,1 s) par corrélation des luminances, puis comparaison des flashs.

## Mesures du build courant (référence, `main` = `8aef924`, CI 4/4 verte)

| Mesure | Valeur |
|---|---|
| Flash(s) détecté(s) | **1** — 8 445 → 9 798 ms, durée **1 453 ms**, pic 9 246 ms, L=1,00, ratio ×2,43 |
| Flash avant première image | **non** (pic après) |
| Coupures hors flash | **1** |
| Panoramique final — Δ observé−modèle | t=162 400 ms : (0 ; **+30,0**) px · t=173 750 ms : (0 ; **+27,8**) px · t=176 900 ms : (0 ; **0**) px · t=187 000 ms : (0 ; **0**) px |
| Logo `00_タイトル` (t=176 750 ms) | fond attendu top=−173,8 ; observé −154,1 ; **Δ=19,7 px** |
| Calques (t=173 750 ms) | `L8` Δ=(0 ; 17,9) px · `L11` Δ=(0 ; 0) |
| Synchro fonds | **16/16** changements appariés ; offsets ms = [28, 0, 15, 63, 1, −91, −58, −141, −39, −90, −106, −75, −91, −129, −143, −113] |
| Synchro audio | 2/3 événements appariés ; offsets [−3, −11, n/a] ms |
| Durée ouverture | 196,46 s (modèle 197,30 s, **Δ=−844 ms**) ; fermeture → titre **83 ms** ; phases : black=216 ms, in=869 ms, idle=196 042 ms, out=414 ms |
| Animations demandées | 147 durées (100–25 150 ms) ; fondus attendus [1350, 2000, 5000] ms |

**Lecture** : la mesure confirme **#254** (flash d'environ 1,45 s en début d'ouverture, pic à
~9,2 s) et **#158** (offsets de synchro des changements de fond jusqu'à ~±140 ms, durée d'ouverture
écourtée de 844 ms ; panoramique final correct en fin mais décalé d'environ +28/+30 px sur les poses
intermédiaires, logo décalé de ~20 px). Ces chiffres servent de base d'analyse et de comparaison
avant/après correctif.

## Limites

- Précision temporelle ≈ 1 échantillon (~100 ms) ; les grosses variations sont fiables, les offsets
  < 100 ms sont à interpréter avec prudence.
- L'alignement du mode `--reference` est grossier (~0,1 s) ; il suffit à comparer flash et ordre des
  événements, pas les durées à l'image près.
- La scène de référence (`雨アニメあり`) est celle du modèle `timelines.json` ; un décalage
  d'ordonnancement (~1,2 s) est mesuré et appliqué à la calibration.
- Les captures ne sont jamais commitées ; seuls les chiffres de ce document et le rapport local
  (hors dépôt) servent de preuve.

## Références

- #254 (flash/pan de l'ouverture), #158 (fidélité timeline/musique), #352 (outil).
- Outil voisin : [`VALIDATION_VISUELLE.md`](VALIDATION_VISUELLE.md) (sprites/transitions, #315/#316/#347).
- `tools/diag-opening.ts`, `timelines.json` (généré par `npm run timelines`), `docs/ARCHITECTURE.md`.
