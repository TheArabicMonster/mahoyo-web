# Débordement du texte et taille nominale (#319)

Outil de **mesure headless** du texte du corpus, pour objectiver deux écarts constatés sur le rendu
du port (revue Opus 5.5, #314) : le port affiche des glyphes ~19 % plus grands que l'original et une
marge gauche ~+94 px écran. `fitTextBox` ne peut que **réduire** la police : la cause est donc la
**taille nominale / la position** de la fenêtre de message, pas l'autoshrink. Ce document donne la
méthode, les mesures de référence et la formule proposée ; **le correctif du runtime reste dans #314**.

## Commande

```bash
# Assets réels locaux si disponibles (MAHOYO_ASSETS_DIR ou public/assets), sinon placeholders
npm run text:overflow

# Placeholders forcés (CI, aucun asset du jeu) — rapport partiel + avertissement
npm run text:overflow -- --placeholders --browsers chromium --max-pages 400

# Les deux navigateurs (Firefox s'il est installé) et tout le corpus
MAHOYO_ASSETS_DIR=public/assets npm run text:overflow -- --browsers chromium,firefox --max-pages 60000
```

| Option | Effet |
|---|---|
| `--placeholders` | force le corpus de placeholders (aucun asset du jeu), rapport partiel |
| `--browsers chromium,firefox` | navigateurs mesurés (défaut : chromium) |
| `--max-pages N` | borne le nombre de pages mesurées (défaut 4 000) |
| `--max-scripts N` | borne le nombre de scripts (défaut 300) |
| `--assets <dir>` | dossier d'assets (défaut : `MAHOYO_ASSETS_DIR`, sinon `public/assets`) |
| `--json` / `--md` | chemins des rapports (défaut : `reports/text-overflow.{json,md}`, ignorés par git) |

L'outil écrit un rapport **JSON** et **Markdown** ; il ne contient **aucun texte du jeu** (seuls les
noms de scripts, positions, tailles et métriques de mise en page). Il ne modifie pas le runtime.

## Méthode

1. **Extraction** (`tools/text-overflow-lib.ts`) : chaque script narratif du corpus est rejoué en
   headless avec le vrai `Runtime` ; les pages sont le texte accumulé entre deux clics de **page**,
   avec un saut de ligne pour chaque attente de ligne `[l]`. Le texte n'est jamais écrit dans les
   rapports.
2. **Mesure navigateur** : une page de mesure autonome reproduit le cadre image du port à partir des
   **constantes importées** (`FRAME_TEXT_AREA`, `FRAME_TEXT_REM`, `FRAME_TEXT_LINE_HEIGHT`,
   `frameTextAreaHeight`) : stage 1024×576 agrandi ×1,25, police Mincho du port, `line-height` 1,5,
   `letter-spacing` 0,06 em, `white-space: pre-wrap`. La police réellement résolue est enregistrée.
3. **Verdict** : pour chaque page, la hauteur rendue est comparée à la hauteur de la zone
   (482,7 px stage) et la largeur au débordement horizontal. Une page « déborde » si son texte
   dépasse à la **taille nominale** (donc si `fitTextBox` réduirait la police).
4. Deux configurations sont mesurées côte à côte : **actuelle** (marge gauche 14 %, police 1,7 rem)
   et **proposée** (marge gauche 6,67 %, police ~1,43 rem — voir formules ci-dessous).

## Mesures de référence

Corpus **réel local** (221 scripts narratifs, **7 298 pages** ; assets non commités), Chromium **et** Firefox
headless, placeholders non utilisés, macOS arm64 (les deux navigateurs donnent les mêmes verdicts) :

| Indicateur | Valeur |
|---|---|
| Pages mesurées | **7 298** (identiques Chromium/Firefox) |
| Pages qui débordent à la taille nominale | **444 (6,08 %)** — cause « hauteur » uniquement, sur les deux navigateurs |
| p95 du taux de remplissage de la zone | **101,5 %** (Firefox : 101,3 %) |
| Marge minimale observée | **−251,3 px** (stage) — page la plus longue |
| Avec la configuration proposée | **10 pages (0,14 %)** en débordement (idem Firefox) |

Pages les plus denses (noms de scripts seuls, aucun texte) :

| Script | Page | Caractères | Remplissage | Marge (px stage) |
|---|---|---|---|---|
| `wik_nap.ks` | 4 | 151 | 152,1 % | −251,3 |
| `5a-9.ks` | 2 | 159 | 135,3 % | −170,3 |
| `5b-15.ks` | 27 | 130 | 135,3 % | −170,3 |
| `b-3.ks` | 6 | 169 | 135,3 % | −170,3 |
| `1-0.ks` | 21 | 102 | 126,8 % | −129,3 |
| `2-3.ks` | 41 | 150 | 126,8 % | −129,3 |
| `2-4.ks` | 23 | 164 | 126,8 % | −129,3 |
| `3-1.ks` | 29 | 147 | 126,8 % | −129,3 |
| `4-4.ks` | 45 | 138 | 126,8 % | −129,3 |
| `6-1.ks` | 2 | 107 | 126,8 % | −129,3 |

Interprétation : **6 % des pages du corpus déclenchent réellement le rétrécissement** de police du
port (dont `1-0.ks` page 21) — le mécanisme n'est pas théorique. Avec la police nominale
et la marge corrigées, il ne reste que **10 pages** en débordement (0,14 %), à traiter par pagination
ou ajustement de page plutôt que par rétrécissement global.

## Taille nominale : formule de conversion

Repères : le moteur du jeu travaille en **1024×576** (docs/KAG_MAHOYO_SEMANTICS.md §1) ; le stage du
port reprend ce repère, agrandi ×1,25 vers le viewport 1280×720 (`STAGE_SCALE`).

- Une taille `@font size=` est **déjà dans le repère 1024** : la taille CSS du stage est la taille du
  script (identité) et la taille écran vaut ×1,25. Si un script utilisait un repère 1280, la
  conversion serait ×(1024/1280) = ×0,8 ; le corpus narratif mesuré **n'utilise aucun `@font size=`**
  (seuls des `@font` de couleur/contour), donc cette hypothèse n'a pas d'effet ici.
- La **taille nominale par défaut** (sans `@font size=`) est la constante du port
  `FRAME_TEXT_REM = 1,7 rem` = 27,2 px stage = **34 px écran**.
- Mesure de glyphes **sur les mêmes caractères** (canvas, police du port) :

| Police CSS (stage px) | Écran (px) | M (hauteur écran) | x (hauteur écran) | あ (hauteur écran) |
|---|---|---|---|---|
| 27,2 (actuelle) | 34,0 | 24,7 | 17,2 | 29,2 |
| 22,9 (recommandée) | 28,6 | 20,7 | 14,4 | 24,6 |

Le ratio entre les deux est **1,19** (24,7/20,7), identique au ratio mesuré par le propriétaire sur
les vidéos (#314 : port 22 px vs original 18,5 px). La formule recommandée est donc **globale** :

```
police nominale écran = FRAME_TEXT_REM × (18,5 / 22)  →  1,7 rem × 0,841 ≈ 1,43 rem ≈ 28,6 px écran
taille CSS stage      = taille écran / 1,25           →  22,9 px
```

Aucune constante par scène : le facteur ne dépend que du ratio de glyphe mesuré (à valider par une
capture comparée de l'original avant correction).

## Marge gauche

| | Valeur |
|---|---|
| Port (`FRAME_TEXT_AREA.left` = 14 %) | 143,4 px stage = **179,2 px écran** |
| Original (mesure vidéo #319 : 114 px / 1708 × 1280) | **85,4 px écran** (6,67 %) |
| Écart | **+93,8 px écran** |

La zone utile du port est donc réduite de ~94 px, ce qui provoque des retours à la ligne
supplémentaires. Marge recommandée : `left = 114/1708 ≈ 6,67 %` (constante unique, dérivée de la
mesure de l'original, pas par scène). La marge droite (`right = 9 %`) reste à confirmer par la même
capture.

## CI et limites

- **CI** : une étape **non bloquante** exécute le mode placeholders sur Chromium dans le job `e2e
  (chromium)` (`npm run text:overflow -- --placeholders --browsers chromium --max-pages 400`,
  `continue-on-error: true`). Le corpus de placeholders (pages courtes) donne un rapport **partiel** :
  il vérifie le fonctionnement de l'outil, pas la couverture du vrai corpus.
- Les mesures de référence ci-dessus nécessitent les **assets réels locaux** (`MAHOYO_ASSETS_DIR`),
  jamais commités.
- La police dépend du système : la pile Mincho du port résout « Hiragino Mincho ProN » sur macOS ;
  sur une machine sans ces polices, le navigateur retombe sur une police de remplacement (le rapport
  enregistre la police résolue). Les comparaisons chiffrées de ce document sont faites sur macOS.
- Le ratio de glyphe de l'original (18,5/22) vient de la mesure vidéo du propriétaire (#314), pas
  d'une capture de référence dans le dépôt : il sert de proposition à valider, pas de vérité
  définitive.
- Aucune modification du runtime de rendu dans cette PR : le correctif (police nominale, marges, wrap
  déterministe, suppression du rétrécissement) est traité dans #314.

## Tests

`tests/unit/tools/text-overflow-lib.test.ts` (13 tests) : conversions de repères, comparaison des
tailles, extraction des pages (regroupement, `[l]`, `@font size=`, bornes, métadonnées sans texte),
verdict de débordement, agrégats/p95, rendu Markdown sans fuite de texte.
