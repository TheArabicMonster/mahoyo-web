# CI et train de vagues (`v1.1` → `main`)

Ce document décrit le flux de livraison **« SHIP v2 »** (#371) : objectif **15-30 min** entre une PR
verte et `main`, au lieu de 40-90 min. Le coût était dominé par l'e2e (~9-12 min/navigateur) et par
l'orchestration manuelle ; la CI filtre désormais les jobs par chemins, shard l'e2e et une gate
légère protège `main`.

## Flux

```
PR (feature/fix/docs) ──CI filtrée──▶ merge dans v1.1 (branche d'intégration)
                                             │
                          push v1.1 ────────┤ e2e shardé obligatoire (porte)
                                             ▼
                                   merge-train (toutes les 45 min) :
                                   v1.1 en avance + CI tête v1.1 verte
                                             ▼
                                           main (gate légère : build-and-test + pwa si chemins)
```

| Élément | Fichier |
|---|---|
| CI des PR / pushs | `.github/workflows/ci.yml` |
| e2e complet la nuit / sur tag | `.github/workflows/e2e-nightly.yml` |
| Train `v1.1` → `main` | `.github/workflows/merge-train.yml` |
| Configuration Playwright (projets, `grepInvert`) | `playwright.config.ts` |

## Filtres de chemins (`ci.yml`, job `changes`)

Le job `changes` utilise `dorny/paths-filter@v3` et expose deux sorties :

- **`e2e`** : `src/renderer/**`, `src/ui/**`, `src/player/**`, `src/kag/**`, `tests/e2e/**`,
  `vite.config.ts`, `playwright.config.ts`, `playwright.pwa.config.ts`, `index.html`, `public/**`,
  `package.json`/`package-lock.json`, `.github/workflows/ci.yml` ;
- **`pwa`** : `public/**`, `src/pwa/**`, `tools/pwa-sw.ts`, `src/main.ts`, `vite.config.ts`,
  `playwright.pwa.config.ts`, `tests/e2e/pwa.spec.ts`, `package.json`/`package-lock.json`.

Sur une PR, l'action compare avec la base de la PR (API GitHub) ; sur un push, elle compare avec
`github.event.before` (merge de vague) — d'où `fetch-depth: 0` dans le job `changes`.

Conséquences :

| Changement | Jobs exécutés |
|---|---|
| Docs/outils seuls | `changes` + `build-and-test` (~2 min) |
| Renderer/UI/player/kag/e2e | `changes` + `build-and-test` + `e2e` shardé (4 jobs) + `pwa` si chemins PWA |
| Chemins PWA | `changes` + `build-and-test` + `pwa` (+ e2e si chemins e2e aussi) |
| Push `v1.1` | `changes` + `build-and-test` + **e2e shardé obligatoire** + `pwa` si chemins PWA |
| Push `main` | `changes` + `build-and-test` seul (+ `pwa` si chemins PWA) — **e2e non bloquant** |

## Shards e2e

La matrice `e2e` est `browser × shard` (`chromium 1/2`, `chromium 2/2`, `firefox 1/2`,
`firefox 2/2`) ; chaque job exécute :

```bash
npm run test:e2e -- --project=<browser> --shard=<n>/2
```

- noms lisibles : `e2e (chromium 1/2)`, `e2e (firefox 2/2)`… ;
- la couverture est identique (somme des shards = suite complète) ; `fail-fast: false` pour que tous
  les shards tournent ;
- le `--grep-invert` éventuel du projet Firefox est porté par `playwright.config.ts`, donc conservé
  automatiquement via `--project` ;
- les rapports/artefacts d'échec (`test-results/`, `playwright-report/`) sont conservés 7 jours
  (`.github/workflows/e2e-nightly.yml` : 14 jours) ;
- le rapport de débordement de texte (`text:overflow`, #319) tourne une seule fois (Chromium 1/2),
  non bloquant.

## `main` : gate légère

Sur un push `main`, seuls `changes` et `build-and-test` tournent (build ≤ 3 min cible, gate ≤ 4 min
cible). L'e2e n'est **pas** bloquant sur `main` : il tourne sur `v1.1` à chaque vague et chaque nuit
sur `main` (`e2e-nightly.yml`), ce qui couvre le risque de régression sans payer 10 min par merge.

## e2e nightly

`.github/workflows/e2e-nightly.yml` : `schedule` quotidien (`0 3 * * *`) + `workflow_dispatch` +
push de tag `v*`. Exécute la suite e2e complète Chromium + Firefox (2 shards chacun) sur le commit
courant (`main` par défaut) et publie les artefacts d'échec 14 jours. Pour forcer un run :
onglet Actions → « E2E nightly » → *Run workflow*, ou `gh workflow run e2e-nightly.yml`.

## Merge train (`v1.1` → `main`)

`.github/workflows/merge-train.yml` tourne toutes les 45 min (`*/45 * * * *`) + manuellement
(`workflow_dispatch`). Il :

1. vérifie l'avance : `git rev-list --count origin/main..origin/v1.1` > 0, sinon no-op ;
2. vérifie la CI de la tête `v1.1` :
   `gh run list --branch v1.1 --limit 1 --json status,conclusion,headSha` → exige
   `status=completed`, `conclusion=success` **et** `headSha == git rev-parse origin/v1.1` ;
   sinon no-op avec `::notice::` (aucun merge d'une tête non vérifiée) ;
3. merge `--no-ff origin/v1.1` dans `main` avec un message explicite
   (`chore(merge-train): v1.1 → main (automatique, CI v1.1 verte)`) puis `git push origin HEAD:main`
   (avec une nouvelle tentative après `pull --rebase` si `main` a avancé) ;
4. permissions : `contents: write`, `actions: read` ; concurrence `merge-train-v1-1` (pas deux
   trains en parallèle).

Garde-fou anti-boucle : pas de trigger sur `push` (un merge de `main` ne relance pas le train) ;
après le merge, `v1.1` n'est plus en avance, la prochaine exécution est un no-op.

## Automerge des PR

Le dépôt a `allow_auto_merge=true` et `main` n'est pas protégée. Une fois la CI de la PR verte
(`build-and-test` + jobs conditionnels), le merge se fait avec :

```bash
gh pr merge <numéro> --auto --merge        # merge automatique dès que les checks requis sont verts
gh pr merge <numéro> --merge               # merge immédiat (si checks verts)
```

Les PR ciblent `v1.1` (branche d'intégration) ; le train promeut `v1.1` → `main`. Un humain peut
toujours :

```bash
gh workflow run merge-train.yml            # forcer un passage du train
gh workflow run e2e-nightly.yml            # forcer la suite e2e complète
gh pr checks <numéro> --watch              # suivre les checks
```

## Budgets de durée CI (#371)

| Gate | Cible | Mesure de référence |
|---|---|---|
| `build-and-test` | **≤ 3 min** | ~2 min (gates existants : lint, assets, marqueurs, build, tests, full read, audit) |
| e2e **par shard** | **≤ 6 min** | ~3-4 min (shard = moitié de la suite, installation du navigateur incluse) |
| Gate `main` (push) | **≤ 4 min** | `changes` + `build-and-test` (~2 min) + pwa si chemins PWA |

Les budgets de bundle et la mesure locale restent dans [`PERFORMANCE.md`](PERFORMANCE.md) et
[`tools/perf-budgets.ts`](../tools/perf-budgets.ts) ; les budgets ci-dessus sont des durées de
workflow, suivies dans l'onglet Actions.

## Dépannage

- **PR docs : `e2e`/`pwa` skippés** — normal (filtre de chemins). Pour forcer un run complet sur une
  PR : ajouter un label ? Non — relancer le workflow ne change pas le diff ; forcer en local
  (`npm run test:e2e`) ou pousser un changement de chemin surveillé (ex. toucher
  `playwright.config.ts`).
- **Push `v1.1` sans e2e** — impossible : la condition force l'e2e sur `refs/heads/v1.1`.
- **Train ne merge pas** — lire le `::notice::` du job : soit aucune avance, soit la CI de tête
  `v1.1` n'est pas verte au sha courant (attendre la fin du run puis relancer
  `workflow_dispatch`).
- **Shard rouge isolé** — les artefacts du shard concerné contiennent `test-results/` et
  `playwright-report/` ; rejouer localement `npm run test:e2e -- --project=chromium --shard=1/2`.
