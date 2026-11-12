# Objectifs de performance (#100)

Ce document définit les **budgets chiffrés** du player, la façon de les **mesurer de façon
reproductible**, et le **rapport de référence** sur lequel ils sont calés. Le script
`npm run perf` rejoue la mesure et compare aux budgets de `tools/perf-budgets.ts` ; il écrit un
rapport JSON (`reports/perf.json`, ignoré par git).

## Objectifs

Budgets définis dans [`tools/perf-budgets.ts`](../tools/perf-budgets.ts) — chaque budget est un
plafond (sauf la fluidité, un plancher). Les valeurs de référence sont **mesurées avec les
placeholders** (aucun asset du jeu) sur la machine de référence décrite plus bas.

| Budget | Plafond / plancher | Référence mesurée | Marge | Pourquoi ce chiffre |
|---|---|---|---|---|
| Bundle JS (gzip) | **≤ 130 Ko** | 101,8 Ko (348,1 Ko brut) | 21,7 % | Garder un chargement initial rapide et détecter un grossissement de dépendance |
| Bundle CSS (gzip) | **≤ 20 Ko** | 13,0 Ko (73,8 Ko brut) | 35,1 % | Le HUD est fait de CSS : éviter l'explosion des feuilles |
| Durée du build | **≤ 60 s** | 3,6–5,9 s (`tsc && vite build`) | ≥ 90 % | Runners CI plus lents ; le build Vite seul est ~1 s, le reste est `tsc` |
| Premier rendu (titre visible) | **≤ 1 500 ms** | 353 ms (FCP 332 ms, DCL 313 ms) | 76,5 % | Le premier écran doit apparaître avant toute transition |
| Requêtes au démarrage | **≤ 40** | 16 (212,3 Ko transférés) | 60 % | Éviter les cascades de requêtes (manifest, scripts, cadres, polices) |
| Mémoire JS après premier rendu | **≤ 96 Mo** | 3,05 Mo | 96,8 % | Détecter une fuite ou un chargement massif en mémoire |
| Fluidité de la transition (plancher) | **≥ 50 fps** | 60,0 fps | 20 % | Transition titre → jeu fluide ; 60 fps sur écran 60 Hz |
| p95 des intervalles entre images | **≤ 25 ms** | 17 ms (max 17 ms) | 32,8 % | Éviter les à-coups : 25 ms ≈ 40 fps au pire 5 % du temps |

> Les budgets sont volontairement larges par rapport à la mesure de référence : l'outil doit
> **détecter une régression franche**, pas échouer au bruit de mesure d'une machine ou d'un runner.

### Manifest d'assets (hors budget automatique)

Le manifest est **généré à partir des fichiers de l'utilisateur** et n'est jamais commité : sa
taille dépend du corpus installé, pas du code du player. Mesures de référence, à titre indicatif :

| Corpus | Taille brute | Taille gzip | Clés |
|---|---|---|---|
| Placeholders (§ mesuré en CI/local) | 1,5 Ko | ~0,6 Ko | 6 images, 0 audio, 4 scripts |
| Vrais assets locaux (référence, non commités) | **1,03 Mo** | **70,6 Ko** | 5 422 images, 870 audio, 251 scripts |

La CI n'a pas de vrai manifest ; `npm run perf -- --manifest <dossier/assets>` permet de le mesurer
en local. Un manifest plus gros coûte une requête et une désérialisation JSON au démarrage, pas au
chargement du bundle.

## Mesurer

```bash
# Mesure complète : build + tailles + navigateur (Chromium headless via Playwright)
npm run perf

# Sans rebuild (réutilise dist/ existant) : tailles seules, pas de navigateur
npm run perf -- --no-build --static-only --warn-only

# Mesurer aussi le manifest des vrais assets
npm run perf -- --manifest public/assets
```

| Option | Effet |
|---|---|
| `--static-only` | pas de navigateur : build (sauf `--no-build`) + tailles bundle + manifest |
| `--no-build` | réutilise `dist/` ; la durée de build n'est pas mesurée (contrôle « skippé ») |
| `--warn-only` | n'échoue pas (exit 0) si un budget est dépassé — utilisé par la CI non bloquante |
| `--assets <dir>` | dossier de production des placeholders (défaut : `<tmp>/mahoyo-perf-assets`) |
| `--manifest <dossier\|fichier>` | manifest à mesurer (défaut : `public/assets`, absent sur checkout nu) |
| `--json <fichier>` | rapport JSON (défaut : `reports/perf.json`) |

Le script génère ses propres **placeholders originaux** (`tests/e2e/placeholders.ts`) : aucun asset
sous copyright n'est lu ou copié, et la mesure est reproductible sur un checkout nu.

### Ce que mesure chaque métrique

- **Bundle JS/CSS** : somme des fichiers de `dist/assets/` (gzip via zlib, sourcemaps exclues ;
  les dossiers d'assets copiés par `publicDir` sont ignorés).
- **Premier rendu** : temps mural entre le début de la navigation et l'écran titre visible
  (Playwright + `PerformanceNavigationTiming`/`PerformancePaintTiming` pour FCP/DCL/load).
- **Requêtes au démarrage** : nombre de requêtes HTTP émises jusqu'à l'affichage du titre, et somme
  des `transferSize`.
- **Mémoire** : `performance.memory.usedJSHeapSize` (Chromium, `--enable-precise-memory-info`).
- **Fluidité** : intervalles entre images (`requestAnimationFrame`) pendant 2,5 s couvrant la
  transition titre → jeu ; moyenne (fps), p95 et maximum.

## Rapport de référence

Mesure du 2026-11-09, avec placeholders, build Vite 5.4.21 :

- **Machine** : macOS arm64 (Apple Silicon), Node v26.0.0, Chromium headless Playwright (1280×720) ;
- **Build** : `tsc && vite build` ≈ 3,6–5,9 s (Vite seul ~0,6–1,3 s) ;
- **Bundle** : `index-*.js` 348,1 Ko brut → **101,8 Ko gzip** ; `index-*.css` 73,8 Ko → **13,0 Ko gzip** ;
- **Premier rendu** : **353 ms** (FCP 332 ms, DCL 313 ms) ; 16 requêtes / 212,3 Ko ;
- **Mémoire** : 3,05 Mo ; **transition** : 60,0 fps, p95 17 ms.

Le rapport JSON complet (métriques + budgets + statut de chaque contrôle) est écrit dans
`reports/perf.json` à chaque exécution.

## Budgets `scene-ready` (#375, PERF-09)

Les seuils du plan [`PERF_PLAN_OPUS.md`](PERF_PLAN_OPUS.md) (§1) sont formalisés dans
[`tools/perf-budgets.ts`](../tools/perf-budgets.ts) (`PERF_SCENE_BUDGETS`) et vérifiés par
`npm run perf` à partir du rapport du banc `npm run perf:scenes`
([`PERF_BENCH.md`](PERF_BENCH.md)) :

| Budget | desktop | mobile (CPU ×4, 10 Mbps) |
|---|---|---|
| p95 `scene-ready`, premier affichage sans préchargement | **≤ 100 ms** | **≤ 250 ms** |
| p95 `scene-ready`, image préchargée (lookahead) + cache chaud | **≤ 16 ms** | **≤ 33 ms** |
| Blocages > 50 ms pendant une transition | **0** | **≤ 1** |
| INP au clic d'avance | **≤ 100 ms** | **≤ 200 ms** |
| Cache décodé estimé | **≤ 192 Mo** | **≤ 64 Mo** |

Mesure : `npm run perf:scenes` écrit `reports/perf-scenes.json` (profils desktop/mobile, passes
froides/chaude) ; `npm run perf` le lit (option `--scenes-report <fichier>`) et affiche les contrôles.
Le seuil « préchargé + cache chaud » n'est évalué que si la passe chaude contient réellement du
lookahead ou de la réutilisation d'image ; sinon il est marqué « skippé » (note explicite), jamais en
échec.

**Non bloquant en CI** : sans assets réels, le banc ne tourne pas ; l'absence de rapport
`reports/perf-scenes.json` produit un **avertissement explicite** (`… aucune passe perf:scenes
trouvée`), pas une erreur. Pour un contrôle bloquant local : `npm run perf -- --strict-scenes`
(échoue si un budget `scene-ready` mesuré est dépassé). Les budgets de bundle restent, eux, vérifiés
en CI via [`CI.md`](CI.md) (Ship v2) et l'étape non bloquante existante.

## Banc des scènes (#361)

`npm run perf:scenes` mesure les temps de chargement entre scènes sur `vite preview` (profils
desktop / mobile CPU ×4 + 10 Mbps, passes cache froid/chaud) : `scene-ready` p50/p95, lookahead,
réutilisation d'image, blocages > 50 ms, INP, mémoire. La baseline avant correction et le mode
placeholders lourds (CI, sans asset) sont documentés dans [`PERF_BENCH.md`](PERF_BENCH.md).

## CI

### Budgets de durée des workflows (#371)

Le flux **SHIP v2** (#371, voir [`CI.md`](CI.md)) vise une livraison `main` en 15-30 min. Les durées
cibles des workflows (suivies dans l'onglet GitHub Actions) :

| Gate | Cible | Mesure de référence |
|---|---|---|
| `build-and-test` | **≤ 3 min** | ~2 min (lint, assets, marqueurs de conflit, build, tests unitaires/intégration, full read, audit zéro strict, `check:generated`) |
| e2e **par shard** (Chromium ou Firefox, 1/2 ou 2/2) | **≤ 6 min** | ~3-4 min (moitié de la suite + installation du navigateur) |
| Gate `main` (push) | **≤ 4 min** | `changes` + `build-and-test` (~2 min), + `pwa` si chemins PWA |

La gate `main` est volontairement légère : l'e2e complet n'y est pas bloquant (il tourne sur `v1.1`
à chaque vague et chaque nuit sur `main` via `e2e-nightly.yml`). Une PR docs/outils ne lance que
`build-and-test`.

### Budgets de bundle (mesure statique)

Le job `build-and-test` exécute, **après le build**, une mesure **statique non bloquante** des
budgets de bundle :

```yaml
- name: Performance budgets (non-blocking, static)
  continue-on-error: true
  run: npm run perf -- --no-build --static-only --warn-only
```

Choix : la mesure navigateur complète (premier rendu, fps, mémoire) dépend de la machine et de la
charge du runner — elle reste donc **locale** (`npm run perf`) et n'est pas bloquante en CI tant que
les budgets ne sont pas calibrés sur les runners. Les budgets de bundle, eux, sont déterministes et
peuvent être surveillés à chaque PR sans coût (quelques secondes, aucun navigateur à installer).

## En cas de dépassement

1. Identifier la cause (dépendance ajoutée, CSS dupliqué, requête en cascade, boucle d'animation…).
2. Corriger la régression si elle est réelle.
3. Si la nouvelle valeur est **légitime**, mettre à jour **dans le même commit** le budget de
   `tools/perf-budgets.ts` **et** le tableau ci-dessus, en expliquant la décision. Un budget ne se
   relève jamais silencieusement.

## Limites

- Mesure en **headless** : le rAF suit l'horloge de composition du navigateur headless, pas
  exactement le vsync d'un écran réel ; les fps servent de garde-fou relatif, pas de benchmark GPU.
- Le **premier rendu** dépend de la machine et du système de fichiers ; les budgets gardent une marge
  importante pour rester stables entre machines.
- Les mesures sont faites avec les **placeholders** : avec les vrais assets (~7 Go), les temps de
  chargement d'images/audio dépendent du disque et du réseau locaux ; le manifest réel est mesuré à
  part (tableau ci-dessus).
- Pas de Lighthouse (pas de nouvelle dépendance lourde) : les métriques utiles sont lues via la
  Performance API dans Chromium.

## Sonde `?perf=1` (mesures chez le propriétaire)

Pour mesurer sur l'appareil réel sans console (marqueurs boot/attente/audio, bouton
« Copier le rapport perf »), ouvrir :

- **URL recommandée** : `/?perf=1#/title` (le flag est dans la query **avant** le hash, préservé
  par le routeur) ;
- **variante** : `/#/title?perf=1` (flag après le hash : accepté depuis #391, sans casser
  `parseRoute`) ;
- **après un redirect ou un reload** : la sonde reste active via `sessionStorage` (`mh:perf=1`),
  même si l'URL perd le paramètre ;
- **désactiver** : `/?perf=0#/title` (ou `#/title?perf=0`) — la persistance `mh:perf` est nettoyée ;
- **sans flag** : aucun marqueur, aucun `window.__mhPerf`, aucun bouton (coût nul).

Si un ancien service worker/PWA sert une coquille en cache, la sonde peut ne pas apparaître :
désenregistrer le SW (DevTools → Application → *Unregister*) et vider le cache storage, ou
utiliser une fenêtre privée. En local sans réseau, préférer `vite preview` (jamais `npm run dev`)
pour des chiffres représentatifs.
