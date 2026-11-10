# Débordement du texte et mise en page logique (#319)

Outil de **mesure headless** du texte du corpus, pour objectiver les écarts de rendu du port
revus par Opus 5.5 (#314). Depuis #320, le port applique la mise en page **calibrée capture** ;
l'outil s'aligne sur la **source unique de vérité** du renderer (`src/renderer/text-fit.ts` :
`FRAME_TEXT_LAYOUT`, `FRAME_TEXT_LAYOUT_PROVENANCE`, `ENGINE_CONFIG_SHA256`) — il ne duplique plus
aucune valeur. Après arbitrage :

- la cause du rétrécissement n'est **pas** la taille nominale telle que d'abord supposée : c'est la
  **marge horizontale** (largeur utile trop étroite) et, secondairement, l'écart d'encre
  (cosmétique) ;
- **la police ne doit pas être réduite à ~1,43 rem** : le ratio d'encre ×1,19 mesure la hauteur
  d'encre, pas la taille em ; le pas des glyphes et les caractères/ligne dépendent de la taille em
  (26 px logiques) ;
- la mise en page cible est exprimée en **unités logiques** (repère 1024×576), sans rem ni
  pourcentage en dur : **marge 69 px logiques**, **police 26 px logiques** (32,5 px écran),
  interligne 40,8 px logiques. Règle de provenance : **config = modèle, capture = oracle** — le
  `config.tjs` dit `marginL/R = 142` et `marginT/B = 69`, mais la capture mesure ≈ 69 / ≈ 46,7 : les
  valeurs **appliquées** restent calibrées capture, la contradiction est documentée (non tranchée).

L'outil **ne modifie pas le runtime** : il fournit les mesures, la provenance et le snapshot ; le
correctif reste dans #314.

## Commande

```bash
# Assets réels locaux si disponibles (MAHOYO_ASSETS_DIR ou public/assets), sinon placeholders
npm run text:overflow

# Placeholders forcés (CI, aucun asset du jeu) — rapport partiel + avertissement
npm run text:overflow -- --placeholders --browsers chromium --max-pages 400

# Les deux navigateurs, tout le corpus, avec snapshot versionné
MAHOYO_ASSETS_DIR=public/assets npm run text:overflow -- \
  --browsers chromium,firefox --max-pages 60000 --snapshot docs/TEXTE_DEBORDEMENT_SNAPSHOT.json
```

| Option | Effet |
|---|---|
| `--placeholders` | force le corpus de placeholders (aucun asset du jeu), rapport partiel |
| `--browsers chromium,firefox` | navigateurs mesurés (défaut : chromium) |
| `--max-pages N` / `--max-scripts N` | bornes du corpus mesuré (défaut 4 000 pages / 300 scripts) |
| `--assets <dir>` | dossier d'assets (défaut : `MAHOYO_ASSETS_DIR`, sinon `public/assets`) |
| `--json` / `--md` | chemins des rapports (défaut : `reports/text-overflow.{json,md}`, ignorés par git) |
| `--snapshot <f>` | écrit le snapshot versionnable des pages restant en débordement (config logique) |

Les rapports ne contiennent **aucun texte du jeu** (noms de scripts, positions, tailles, métriques).

## Méthode

1. **Extraction** (`tools/text-overflow-lib.ts`) : chaque script narratif est rejoué en headless avec
   le vrai `Runtime` ; une page est le texte accumulé jusqu'au clic de **page**. Le texte est
   concaténé comme le fait le renderer : un clic `[l]` **ne coupe pas** la ligne (le renderer
   continue le texte sur la même ligne) ; seuls les `lineBreak` du script (saut de source, `[r]`)
   ajoutent un `\n`.
2. **Mesure navigateur** : page de mesure autonome reproduisant le cadre image à partir des
   **constantes importées** du renderer (`FRAME_TEXT_LAYOUT`, `frameTextAreaHeight`) ; deux
   configurations mesurées côte à côte :
   - **appliquée (#320, calibrée capture)** : marges 69/69 px logiques (86,3 px écran), police
     26 px logiques (32,5 px écran), interligne 40,8 px logiques ;
   - **modèle `config.tjs` (non calibré)** : marges 142/142 px, marges verticales 69/69 px,
     police 26 px, interligne 44 px — pour documenter ce que donnerait la config non calibrée.
3. **Verdict** : hauteur rendue vs hauteur de zone (576 − 2 × marge verticale) et débordement
   horizontal, par page. Une page « déborde » si son texte dépasse la zone à la taille nominale
   (donc si le port `fitTextBox` réduirait la police).
4. **Validation** : pas des glyphes (1 em attendu), caractères/ligne, symétrie des marges
   (`x_min ≈ W − x_max`), lignes/page, et écart d'encre vs original.

## Mesures de référence

Corpus **réel local** (221 scripts narratifs, **7 297 pages** ; assets non commités), Chromium **et**
Firefox headless (verdicts et métriques identiques), macOS arm64, police Mincho du port résolue :

| Indicateur | Config appliquée (#320, capture) | Config modèle `config.tjs` |
|---|---|---|
| Pages en débordement à la taille nominale | **0 (0,00 %)** | **10 (0,14 %)** Chromium / 14 Firefox |
| p95 du taux de remplissage de la zone | 59,3 % | 80,4 % |
| Marge minimale observée | 74,6 px logiques | −2,0 px logiques |
| Caractères par ligne (CJK) | **34** (attendu original : 34) | **28** |
| Lignes par page (p95) | 7,0 | 8,6 |
| Marge gauche à l'écran | **86,3 px** (original mesuré 85,4 → écart 0,8 px) | — |

**Corrections assumées** :
1. une première mesure annonçait 444 pages en débordement (6,08 %) ; elle était fausse — le modèle
   d'extraction insérait un saut de ligne à chaque clic `[l]`, alors que le renderer du port continue
   le texte sur la même ligne. Après alignement sur le rendu réel : **aucune page du corpus ne
   déborde** en config appliquée (0/7 297), ce qui rejoint l'observation du propriétaire (#314 : le
   rétrécissement n'était pas déclenché).
2. la config « actuelle » du port a changé : #320 a calibré la mise en page sur la capture
   (69/26/40,8/46,7) et supprimé l'autoshrink. L'outil mesure désormais la **config appliquée** et
   la **config modèle** `config.tjs` ; seule cette dernière, non calibrée, déborde encore
   (10 pages Chromium / 14 Firefox, soit 0,14–0,19 %), ce qui confirme que la calibration capture
   est la bonne décision.

Le snapshot versionné
[`TEXTE_DEBORDEMENT_SNAPSHOT.json`](TEXTE_DEBORDEMENT_SNAPSHOT.json) fige la liste (vide) des pages
restantes en débordement avec la config appliquée : toute régression future apparaîtra comme un
écart au snapshot. L'écart d'encre (×1,189) reste **cosmétique** et ne justifie pas de réduire la
police.

Pages les plus denses (contrôle, noms de scripts seuls, aucun texte) : `2-4.ks` p11 (168 caractères,
84,5 %), `1-0.ks` p21 (102, 76 %), `1-1.ks` p15 (137, 76 %), `2-4.ks` p23 (164, 76 %), etc.

## Mise en page appliquée et provenance

Aucune valeur en rem ni en pourcentage en dur : tout est exprimé en **unités logiques** du stage
(repère 1024×576), converti à l'écran par `STAGE_SCALE` (×1,25). Ces valeurs sont **dérivées de la
source unique** `src/renderer/text-fit.ts` (`FRAME_TEXT_LAYOUT`, `FRAME_TEXT_LAYOUT_PROVENANCE`,
`ENGINE_CONFIG_SHA256`) ; l'outil (`LAYOUT_LOGICAL` / `LAYOUT_PROVENANCE` /
`CONFIG_TJS_REFERENCE`) n'en duplique aucune.

**Modèle `config.tjs`** (fichier local, **non commité**, sha256
`82ea1af8b44663097027965ba4e868e3e402b487b853298a5c2df4b2e6006893`, chemin
`…/decrypted/data/override/config.tjs`) :

```
mw = 1024          mh = 576
marginL = 142      marginR = 142      marginT = 69        marginB = 69     # ordre du fichier L, R, T, B
defaultFontSize = 26
defaultLineSpacing = 18   (→ interligne 26 + 18 = 44 px logiques)          # conflictuel avec la capture
defaultPitch = 1           (pas d'un em, pas de letter-spacing supplémentaire)
frameGraphic = "txtwindow01"
```

**Règle** : *config = modèle, capture = oracle*. La capture contredit partiellement le modèle
(marge horizontale ≈ 69 vs 142 ; marge verticale ≈ 46,7 vs 69 ; interligne ≈ 40,8 vs 44) : les
valeurs **appliquées** restent donc calibrées sur la capture, statut `hypothèse`, et la divergence
est conservée en regard — elle n'est **pas tranchée**.

| Paramètre | Appliqué (capture, px logiques) | `config.tjs` (modèle, px logiques) | Écran appliqué (px) | Tolérance | Divergence |
|---|---|---|---|---|---|
| Marge horizontale (gauche et droite) | **69** | **142** | 86,3 | ±2 % | Modèle 142 vs capture ≈ 69 — non tranché |
| Taille de police nominale | **26** | **26** | 32,5 | ±2 % sur le pas | Aucun écart |
| Interligne | **40,8** | **44** (26 + 18) | 51,0 | ±2 % | Modèle 44 vs capture 40,8 — **conflictuel** |
| Marge verticale (haut et bas) | **46,7** | **69** | 58,4 | ±2 % | Modèle 69 vs capture 46,7 — non tranché |

**Hypothèses d'écart (non tranchées)** : version localisée/override, `@position frame=…` ou le
graphique de cadre (`frameGraphic = "txtwindow01"`) peuvent expliquer que la capture ne montre pas la
valeur du modèle. Tant que ces hypothèses ne sont pas départagées, les valeurs appliquées restent
celles de la capture (oracle) et gardent le statut `hypothèse` ; elles ne sont jamais ajustées par
scène. La police (26) et le pas (`defaultPitch = 1`, pas de letter-spacing) sont au contraire
confirmés par le modèle **et** par la capture (pas des glyphes mesuré ×1,000).

## Mesures de validation (config logique)

| Contrôle | Attendu | Mesuré | Verdict |
|---|---|---|---|
| Pas des glyphes (1 em) à 26 px logiques | 26,0 px logique / 32,5 px écran ±2 % | **26,0 px logique (×1,000)** | ✓ |
| Caractères par ligne | attendu original **34** | appliquée **34** — modèle 28 (largeurs 886 / 740 px logiques) | ✓ |
| Symétrie des marges (`x_min ≈ W − x_max`) | 69,0 ≈ 69,0 px logiques | écart **0,00 px** | ✓ |
| Lignes par page (p95) | config appliquée vs modèle | appliquée 7,0 → modèle 8,6 | — |
| Modèle `defaultPitch` | 1 (pas d'un em, sans letter-spacing) | **×1,000** sur le pas mesuré | ✓ |
| Écart d'encre (x-height/capitale) | — | **×1,189** (port 22 px vs original 18,5 px, #314) | cosmétique |

**Lecture de l'écart d'encre** : ×1,189 porte sur l'**encre** (hauteur de capitale/x-height), pas
sur la taille em. La police appliquée est déjà l'em du moteur (26 px logiques = `defaultFontSize`),
et le pas des glyphes est exact (×1,000) : l'écart restant est attribuable aux **métriques de
police** (famille Mincho du port vs police d'origine) et reste **cosmétique** — à traiter par
l'approximation `text-font-metrics` (`size-adjust` éventuel) **seulement si** les caractères/ligne
restent corrects, ce que cette mesure vérifie (34 attendus, 34 obtenus). **Réduire la police à
~1,43 rem est écarté.**

## Taille des scripts

Le moteur du jeu travaille en **1024×576** (docs/KAG_MAHOYO_SEMANTICS.md §1) ; le stage du port
reprend ce repère, agrandi ×1,25. Une taille `@font size=` est donc déjà en px logiques : la taille
CSS du stage est la taille du script (identité), la taille écran vaut ×1,25. Le corpus narratif
mesuré **n'utilise aucun `@font size=`** (seuls des `@font` de couleur/contour) : la seule taille en
jeu est la constante nominale.

## Pagination (pas d'autoshrink)

Aucune page du corpus mesuré ne déborde en config appliquée ; la config **modèle** `config.tjs`
(non calibrée) déborderait sur 10 pages (Chromium) / 14 (Firefox), ce qui confirme la calibration
capture. Si une page devait dépasser à l'avenir (traduction, nouvelle scène), la règle est de
**paginer** (découpage aux limites de phrase, comme `@cm`/pages du moteur d'origine) et jamais de
rétrécir la police : la police reste constante, la zone ne défile pas. Le snapshot versionné sert
de garde-fou : le mode `--snapshot` réécrit la liste des pages en débordement, à committer si elle
évolue légitimement.

## CI et limites

- **CI** : étape **non bloquante** dans le job `e2e (chromium)` —
  `npm run text:overflow -- --placeholders --browsers chromium --max-pages 400`
  (`continue-on-error: true`). Le corpus de placeholders (pages courtes) donne un rapport **partiel** :
  il vérifie l'outil, pas la couverture du vrai corpus.
- Les mesures de référence nécessitent les **assets réels locaux** (`MAHOYO_ASSETS_DIR`), jamais
  commités ; seuls des noms de scripts, positions et métriques apparaissent dans les rapports.
- La police dépend du système : la pile Mincho du port résout « Hiragino Mincho ProN » sur macOS ;
  le rapport enregistre la police résolue. Les chiffres de ce document sont mesurés sur macOS.
- **Observation à confirmer avec #314** : le renderer du port ne pose pas de saut de ligne pour
  `[l]` (le texte continue sur la même ligne) ; la mesure reflète ce comportement. Si le runtime doit
  insérer un `\n` pour `[l]` comme le moteur d'origine, les hauteurs augmenteront — à rejouer avec
  l'outil après correction.
- La provenance est volontairement **contradictoire** : `config.tjs` (modèle) et capture (oracle) ne
  concordent pas sur les marges et l'interligne ; les valeurs appliquées suivent la capture, la
  divergence est consignée pour l'issue de correction (#314), pas résolue ici.
- L'outil ne modifie pas le runtime : #320 a appliqué la mise en page calibrée, cette PR fournit
  uniquement la mesure, la provenance dérivée du renderer et le snapshot.

## Tests

`tests/unit/tools/text-overflow-lib.test.ts` (16 tests) : conversions de repères, comparaison des
tailles, extraction des pages (regroupement, `[l]` sans coupure, `@font size=`, bornes, métadonnées
sans texte), verdict de débordement, agrégats/p95, rendu Markdown sans fuite de texte et avec la
provenance.
