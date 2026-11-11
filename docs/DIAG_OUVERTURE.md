# Diagnostic de l'ouverture (#352)

Outil de **mesure reproductible de l'ouverture** pour préparer la validation de #254 (flash blanc /
panoramique final) et #158 (synchro musique/timeline) : on joue l'ouverture complète avec les
**assets réels locaux** (jamais commités), on mesure le rendu courant, et le mode `--reference`
comparera la vidéo OP du propriétaire dès qu'elle sera fournie.

> Outil de **diagnostic local** : aucune modification du runtime, aucun asset commité. Captures et
> rapports restent hors dépôt (`--out`, défaut `/tmp/mahoyo-opening`).

## Commande

```bash
# Assets réels locaux requis (dossier parent de assets/ : public/)
MAHOYO_E2E_ASSETS=/chemin/vers/public npm run diag:opening

# Avec la vidéo OP du propriétaire (ffmpeg requis pour l'extraction d'images)
MAHOYO_E2E_ASSETS=/chemin/vers/public npm run diag:opening -- --reference /tmp/op.mov
```

| Option | Effet |
|---|---|
| `--assets <dir>` | dossier `publicDir` contenant `assets/` (défaut : `MAHOYO_E2E_ASSETS` ou `public`) |
| `--out <dir>` | captures/rapport (défaut `/tmp/mahoyo-opening`) |
| `--reference <video>` | vidéo OP de référence : comparaison flash + alignement temporel (ffmpeg requis) |
| `--max-seconds N` | borne de capture (défaut 260 s) |
| `--strict` | code de sortie 1 si flash absent ou panoramique non observable |

Sortie : `frames/frame_*.jpg` (~10 Hz), `timeline.json`, `rapport.json`, et la synthèse console.
**Aucun fichier n'est écrit dans le dépôt.**

## Méthode

1. **Capture** : le player est lancé sur un serveur Vite dédié avec `MAHOYO_E2E_ASSETS` (assets
   réels) ; l'enchaînement est forcé sur `opening.ks` (scène par défaut `雨アニメあり`, `id 4`,
   durée modèle **197 300 ms**), jusqu'au retour à l'écran titre. Pendant la lecture : une image JPEG
   toutes ~100 ms + un échantillon DOM (fond : image/position ; calques `#stage-timeline` :
   position/opacité ; animations WAAPI ; journal `HTMLAudioElement.play/pause`).
2. **Flash blanc** : luminance moyenne par image ; intervalle au-dessus de `max(0,70 ; médiane+0,35)`
   pendant ≥ 120 ms ; temps du pic, durée, luminance, ratio vs médiane, position avant/après la
   première image de l'ouverture.
3. **Panoramique final** : position attendue du fond calculée depuis `timelines.json` (keyframes
   `bg` + `moves`, interpolation `accel` **avec la même loi que le renderer**,
   `src/core/easing.ts`) aux instants clés **162 400 / 173 750 / 176 900 / 187 000 ms**, comparée à
   la position DOM observée (écart px). Calques `12_手前c` (L8) et `00_タイトル` (L11) comparés de
   même façon. Mesure dédiée **logo sur le ciel** : à l'opacité pleine du logo (176 750 ms), le fond
   doit être sur le ciel (`背景c`, haut ≈ −174 px), pas sur la ville.
4. **Synchro musique/animations** : horodatage des changements de fond observés vs `at` du modèle
   (offsets ms), lancements audio observés vs `audio[].at`, et durées demandées aux animations WAAPI
   vs `fade` attendus.
5. **Ouverture → titre** : durée d'ouverture vs modèle, transition de fermeture, phases du rideau,
   coupures (saut de luminance > 0,30 hors flash).
6. **`--reference`** : extraction des images de la vidéo OP (ffmpeg, 10 im/s), alignement temporel par
   corrélation des luminances (pas 0,1 s), comparaison des flashs (temps/durée) — prêt pour la vidéo
   du propriétaire.

## Résultats du build courant

Mesure du 2026-11-10 sur `v1.1` (commit `dec65ac`), macOS arm64, assets réels locaux, 1 872 images /
1 852 échantillons :

| Mesure | Valeur |
|---|---|
| Scène modèle | `雨アニメあり` (id 4), durée 197 300 ms |
| Décalage d'ordonnancement (1er fond) | **+1 215 ms** (temps de démarrage de la timeline) |
| **Flash blanc** | **8 445 → 9 798 ms** (durée **1 453 ms**), pic **9 246 ms**, luminance 1,00, ratio **×2,43** vs médiane |
| Flash normalisé (temps OP) | début **7 230 ms**, pic **8 031 ms** — modèle : fond `white` à **6 750 ms** (fondu 1 350 ms) → début **+480 ms tard**, durée **+103 ms** |
| Flash avant la première image | **aucun** (première image à 2 215 ms) |
| Coupures hors flash | **1** à 198 784 ms (apparition du titre après le rideau `out`), Δluminance 0,36 |
| Pan final — 162 400 ms | modèle `背景c` @(−48, −750) ; observé @(−48, −720,0) → **Δ=+30,0 px** |
| Pan final — 173 750 ms | modèle @(−48, −526,8) ; observé @(−48, −499,0) → **Δ=+27,8 px** |
| Pan final — 176 900 ms | modèle @(−48, −149) ; observé @(−48, −149) → **Δ=0 px** |
| Pan final — 187 000 ms | modèle `bg02学校01外観-(小雨)` @(−48, −48) ; observé identique → **Δ=0 px** |
| **Logo `00_タイトル` sur le ciel** | fond attendu haut −173,8 px ; observé **−154,1 px** (Δ+19,7 px), fond `背景c` → **logo sur le ciel ✓**, léger retard local du pan |
| Calque `12_手前c` (L8) | Δ(0, +1,1) px à 162 400 ; **Δ(0, +17,9) px** à 173 750 ; Δ0 ensuite |
| Calque `00_タイトル` (L11) | position/opacité conformes (Δ0) aux 4 instants |
| Sync fonds | **16/16 changements appariés**, offsets **−143…+63 ms** (médiane ≈ −48 ms) |
| Sync audio | **2/2 observables appariés** : BGM `m01s` à −3 ms, SE `se01004` à −11 ms (3ᵉ entrée = action `volume`, non observable en `play`) |
| Durées d'animation vs `fade` | fondus attendus **[1 350, 2 000, 5 000]** tous présents dans les durées demandées |
| Durée d'ouverture | **196,46 s** observée vs **197,30 s** modèle → **−844 ms** |
| Fermeture → titre | **83 ms** (`out` 414 ms), phases : black 216 ms, in 869 ms, out 414 ms |
| Coupures | 1 (celle du titre, à vérifier vs vidéo OP) |

### Lecture / suites

- **Flash** : un seul flash détecté, **postérieur à la première image**, durée 1,45 s. Par rapport au
  modèle il démarre ~0,48 s tard et dure ~0,10 s de plus : chiffres à confronter à la vidéo OP
  (`--reference`) avant de conclure sur #254.
- **Pan final** : le fond et les calques suivent le modèle à **±30 px** près (≈2,9 % de 1 024 px) ;
  le logo apparaît bien sur le ciel (fond `背景c`, haut −154 px au lieu de −174 px). La dérive
  locale (~+20–30 px) est à comparer à la vidéo OP ; l'apparition du titre à 187 000 ms est exacte
  (Δ0).
- **Synchro** : les changements de fond (16/16) et les lancements audio (BGM −3 ms, SE −11 ms) sont
  alignés sur le modèle à **≤ 150 ms** près ; les fondus de 1 350 / 2 000 / 5 000 ms sont bien
  demandés aux animations.
- **Ouverture → titre** : durée −0,84 s vs modèle et **une coupure** à l'apparition du titre
  (198 784 ms) — point à instruire avec la référence OP.
- L'outil a servi à ce que #254/#158 disposent de la **base de mesure prête** avant la vidéo OP ;
  aucun changement de rendu dans cette PR.

## Limites

- Précision temporelle ≈ 1 image de capture (~100 ms) ; les comparaisons de position sont limitées
  par la même cadence (échantillon le plus proche).
- Le modèle `timelines.json` et la loi `accel` (`src/core/easing.ts`) servent de référence
  d'ordonnancement : un écart observé/modèle peut être soit un bug de rendu, soit une convention
  d'interprétation — le mode `--reference` tranchera avec la vidéo OP.
- L'ouverture est jouée avec les assets réels locaux (décodage réel, pas de placeholders) : la mesure
  est locale, hors CI, et les captures ne sont jamais commitées.
- Le mode `--reference` nécessite **ffmpeg** sur la machine (extraction d'images de la vidéo OP) ;
  sans lui, la comparaison est ignorée avec un avertissement.
