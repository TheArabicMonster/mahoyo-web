# Mahoyo Web

> Port web du visual novel **Mahoutsukai no Yoru** (*Witch on the Holy Night*, TYPE-MOON), inspiré de l'architecture de [tsukiweb-public](https://github.com/requinDr/tsukiweb-public).

Ce dépôt contient le **projet réel** : un player web moderne et maintenable pour lire Mahoyo dans un navigateur, en partant des fichiers du jeu original possédés par l'utilisateur.

## Statut (10 novembre 2026)

- **v1.0 : 101 issues fermées sur 101 (100 %, 🟢 Terminé)** — DoD v1.0 close le 2026-11-09 (#302) : audit KAG **0 commande inconnue** (**125 implémentées**, **5 no-ops justifiés**, baseline vide), lecture complète **221/221 scripts** (0 erreur, 0 maxSteps) et garde-fous zéro strict en CI (`npm run audit:guard`, `npm run check:generated`). Notes de version **non publiées** ([`docs/RELEASE_NOTES_V1.0.md`](docs/RELEASE_NOTES_V1.0.md)) ; **aucun tag ni release** avant validation du propriétaire.
- **v1.1 : 67 issues fermées sur 74 (91 %, 🟡 En cours)** — vague « confort, accessibilité et finitions » : 6 issues restantes (#315, #316, #254, #213, #187, #158) + #347 (validation visuelle automatisée), dont plusieurs **bloquées sur des enregistrements/captures du propriétaire**. Notes **brouillon** : [`docs/RELEASE_NOTES_V1_1.md`](docs/RELEASE_NOTES_V1_1.md) (**aucun tag ni release**).
- Phases actives : **E5 — UI/UX** (écran de choix #213, captures #187) et **E6 — QA & optimisation** (validation visuelle #347).
- Le player lit le corpus narratif complet, gère les choix, l'historique, les sauvegardes IndexedDB et les écrans du HUD d'origine.
- Dernières livraisons (vague v1.1, 10 novembre) : **WCAG AA** (0 violation axe-core), focus Firefox (#257), mobile/tactile (#98, #210), thème et animations (#99), KAG à plat (#80), pistes/transitions unifiées (#317, correctifs #315/#316 mergés), garde-fou anti-marqueurs de conflit (#342), CI 4 jobs et corrections #332/#337.
- Vérification locale : `npm run test:unit` (**2382 tests**), `npm run lint`, `npm run build` et `npm run check:assets` passent ; `npm run test:e2e` tourne en placeholders sur Chromium et Firefox (**254 tests**, 26 fichiers) ; la CI comporte **4 jobs** (`build-and-test`, `pwa`, `e2e (chromium)`, `e2e (firefox)`), avec `check:generated`, `audit:guard` zéro strict et `oracle:state`.

Voir [`docs/PROGRESS.md`](docs/PROGRESS.md) pour le détail par milestone.

## Fonctionnalités

- **Moteur KAG3** : lexer, parser, runtime fore/back, conditions, macros, appels, furigana, sauvegarde/rollback, tolérance aux commandes inconnues.
- **Lecture** : enchaînement des chapitres, autosave, skip du texte lu, avance rapide, mode automatique avec délais page/ligne réglables.
- **Fenêtre de message** : texte posé sur le cadre du jeu (sans boîte), texte déjà lu atténué, indicateurs de ligne/page animés.
- **Configuration** : quatre onglets (Système, Message, Son/Effet, Raccourcis), 14 raccourcis clavier modifiables, plein écran fit/fill/1:1, volumes et mutes BGM/SE/système.
- **Sauvegardes** : 15 pages de 8 emplacements, rapide et auto dans IndexedDB, migration depuis `localStorage`, export/import JSON depuis l'écran de chargement, titre de scène, commentaire et verrou par emplacement.
- **Interface** : écran titre avec sous-menu Extra (Archive, CG mode, Sound mode), menu système, historique, chargement/sauvegarde, configuration au design d'origine, flowchart interactif (pan, zoom, volet de détails), routes d'URL, toasts et confirmations.
- **CG mode** : galerie des illustrations vues, visionneuse plein écran et navigation clavier ; vignettes calculées à l'exécution depuis les assets de l'utilisateur (aucune miniature commitée).
- **Sound mode** : galerie BGM avec lecture/pause, répétition, aléatoire, volume et progression ; titres et compositeurs fournis par l'utilisateur dans le manifeste.
- **Audio** : BGM 2012 (60 pistes) et 810 sons SE joués ; les **voix sont absentes des assets 2012** (doublage du remaster 2022/2023 uniquement) et les SE partagent un **canal unique** — état complet, chiffres et procédure dans [`docs/AUDIO.md`](docs/AUDIO.md).
- **Transitions** : rideaux plein écran entre titre, chargement et jeu (HUD-14), sans animation sous `prefers-reduced-motion`.
- **Accessibilité** : flowchart utilisable au clavier et au lecteur d'écran (navigation par arêtes, équivalent liste, portrait) et audité par axe-core (WCAG A/AA) ; `prefers-reduced-motion` respecté sur les transitions et les écrans. Conformité WCAG AA globale suivie en v1.1 (#97).
- **Tactile** : appui long = menu système, balayage vers le haut = historique, barre d'actions rapides (Q.Save, Q.Load, Auto, Skip, Historique, Plein écran) sur appareil tactile uniquement, cibles de 48 px réels ; la souris et le clavier ne changent pas.
- **Traductions** : japonais d'origine et patch fan français Moon-Trad installable par script ; sélecteur de langue dans la configuration.
- **Pipeline** : extraction `.xp3` automatisée par gabarit d'outil externe, manifeste d'assets, rapport d'exécution et codes de sortie, conversion `.tlg` → PNG/WebP, audio OGG, normalisation des `.ks`, audit classé du corpus (commandes KAG implémentée / ignorée volontairement / inconnue, registre et garde-fou CI, #275), table d'enchaînement et graphe de scénario.
- **Qualité** : 2181 tests unitaires, `npm run lint` (ESLint 9, 0 erreur), suite e2e Playwright sur Chromium et Firefox en placeholders (159 tests, 18 fichiers, parcours complet inclus), lecture complète des 221 scripts en CI sur corpus de placeholders, **audit KAG zéro inconnue (125 implémentées, 5 no-ops justifiés)**, registre d'**approximations documentées** ([`docs/APPROXIMATIONS.md`](docs/APPROXIMATIONS.md), #296), CI à 3 jobs et contrôle anti-assets.
- **Design system** : palette, typographie, espacements et états mesurés sur le jeu d'origine, tokens CSS dans `src/ui/tokens.css`.

## Langues

- **Japonais** : langue originale, toujours disponible.
- **Français** : support du patch fan Moon-Trad, installable via `npm run translation`. Voir [`docs/TRADUCTION.md`](docs/TRADUCTION.md).

## ⚠️ Avertissement légal

**Aucun asset original du jeu (images, sons, scripts, polices) n'est stocké ni redistribué dans ce dépôt.** Ce projet est un *player* + un *outillage de conversion* : l'utilisateur doit fournir ses propres fichiers, issus d'une copie qu'il possède. Ne commitez jamais d'asset sous copyright.

## Démarrage rapide

```bash
git clone git@github.com:TheArabicMonster/mahoyo-web.git
cd mahoyo-web
npm ci

# Tests
npm run test:unit
npm run test:integration
npm run test:e2e          # Playwright ; placeholders générés automatiquement

# Player en développement
npm run dev

# Build de production
npm run build
npm run preview
```

## Tests

| Commande | Portée |
|---|---|
| `npm run test:unit` | Vitest, code et composants |
| `npm run test:integration` | tests d'intégration (se skippent proprement sans assets) |
| `npm run test:full-read` | lecture complète du corpus KAG (vrais assets ou placeholders, voir ci-dessous) |
| `npm run corpus:full-read` | génère un corpus de placeholders pour la lecture complète (CI) |
| `npm run test:e2e` | Playwright, player dans un vrai navigateur (voir ci-dessous) |
| `npm run lint` | ESLint 9 (flat config) sur `src/`, `tools/`, `tests/` et les configs (voir [`docs/LINT.md`](docs/LINT.md)) |
| `npm run validate:visual` | validation visuelle locale des sprites/transitions sur assets réels (voir [`docs/VALIDATION_VISUELLE.md`](docs/VALIDATION_VISUELLE.md)) |
| `npm run diag:opening` | diagnostic de l'ouverture : flash blanc, panoramique final, synchro musique (voir [`docs/DIAG_OUVERTURE.md`](docs/DIAG_OUVERTURE.md)) |
| `npm run perf` | budgets de performance chiffrés : bundle, premier rendu, fluidité, mémoire (voir [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)) |
| `npm run perf:scenes` | banc des temps de chargement entre scènes (vite preview, profils desktop/mobile, cache froid/chaud ; voir [`docs/PERF_BENCH.md`](docs/PERF_BENCH.md)) |
| `npm run text:overflow` | mesure du débordement du texte du corpus et de la taille nominale (voir [`docs/TEXTE_DEBORDEMENT.md`](docs/TEXTE_DEBORDEMENT.md)) |

### Lecture complète (placeholders en CI)

La DoD v1.0 exige que la CI exécute la logique de lecture complète avec des **placeholders
originaux**. Le corpus est généré sans aucun asset du jeu et réutilise l'infrastructure e2e
(`tests/e2e/placeholders.ts`) :

```bash
MAHOYO_E2E_ASSETS=/tmp/mahoyo-full-read npm run corpus:full-read
MAHOYO_ASSETS_DIR=/tmp/mahoyo-full-read/assets npm run test:full-read
```

| Variable | Effet |
|---|---|
| `MAHOYO_E2E_ASSETS` | dossier de sortie du corpus (défaut : `<tmp>/mahoyo-full-read`) ; le corpus est écrit sous `assets/` |
| `MAHOYO_FULL_READ_SCRIPTS` | nombre de scripts narratifs générés (défaut `221`, taille du corpus de référence) |
| `MAHOYO_ASSETS_DIR` | dossier d'assets lu par `test:full-read` / `test:integration` (vrais assets locaux ou corpus de placeholders) |

Sans `MAHOYO_ASSETS_DIR` ni `public/assets`, les tests d'intégration sont **skippés proprement**
(exit 0). La CI exécute les deux : skip sur checkout nu, puis lecture complète du corpus de
placeholders (221 scripts, marqueur `placeholder-corpus.json`).

### Tests end-to-end (Playwright)

La suite e2e tourne **sans aucun asset du jeu** : avant le démarrage de Vite,
`tests/e2e/prepare-assets.ts` génère un jeu de placeholders déterministe sous `$MAHOYO_E2E_ASSETS/assets/`
(manifeste minimal, PNG générés, quatre scripts KAG originaux et une table d'enchaînement qui fait se
terminer le prologue sur un **choix** puis enchaîne les chapitres). Rien n'est lu dans `public/assets/`
ni commité ; la CI peut donc lancer la suite sur un checkout nu.

`tests/e2e/full-playthrough.spec.ts` couvre le **parcours complet** (#94) sur les deux navigateurs :
titre → Start, lecture de plusieurs pages, choix validé, sauvegarde puis chargement après rechargement,
changement de chapitre par enchaînement, jusqu'au retour au titre.

| Commande | Usage |
|---|---|
| `npx playwright install chromium firefox` | installe les navigateurs (une fois) |
| `npm run test:e2e` | toute la suite, tous les projets (`chromium` et `firefox`) |
| `npm run test:e2e -- --project=chromium --project=firefox` | les deux navigateurs, comme la CI |
| `npm run test:e2e -- --project=chromium` | projet Chromium seul |
| `npm run test:e2e -- --project=firefox` | projet Firefox seul |

| Variable | Effet |
|---|---|
| `MAHOYO_E2E_ASSETS` | dossier `publicDir` servi par Vite (défaut : `<tmp>/mahoyo-e2e-assets`). Les placeholders sont écrits sous `assets/`, comme un `public/assets/` local. |
| `MAHOYO_E2E_REAL_ASSETS=1` | n'écrit aucun placeholder et sert de vrais assets : `MAHOYO_E2E_ASSETS` doit alors pointer vers un dossier contenant `assets/` (ex. `$PWD/public`). Exemple : `MAHOYO_E2E_REAL_ASSETS=1 MAHOYO_E2E_ASSETS=$PWD/public npm run test:e2e`. |

Skips explicites (aucun skip silencieux). En mode placeholders, **Chromium passe toute la suite
sans aucun skip** ; les seules exclusions concernent Firefox :

- `tests/e2e/touch-controls.spec.ts` : l'émulation tactile repose sur CDP et `isMobile`, disponibles
  dans Chromium uniquement ; les deux séquences tactiles brutes (appui long, balayage) sont skippées
  hors Chromium, le reste du spec (dont « desktop souris ») tourne sur les deux navigateurs.
- `tests/e2e/backlog.spec.ts` (géométrie) : mesure l'ascenseur natif de 39 px imposé par
  `::-webkit-scrollbar`, Chromium uniquement (Firefox impose sa propre largeur).
- Projet `firefox` : uniquement le test « 9 entrées dans l'ordre d'origine » du menu système est exclu
  (`grepInvert` dans `playwright.config.ts`). Mesuré : Firefox ne marque pas `:focus-visible` sur le
  focus programmatique consécutif à une touche (`outlineStyle: none` contre `solid` dans Chromium),
  l'anneau de focus clavier du menu n'apparaît donc pas — écart d'accessibilité réel suivi hors de ce
  lot (fichier propriété de #231).

La CI est **filtrée par chemins** (#371, détail dans [`docs/CI.md`](docs/CI.md)) : le job `changes`
(`dorny/paths-filter`) décide quels jobs tournent. `build-and-test` (lint, anti-assets, marqueurs de
conflit, build, tests unitaires/intégration, corpus de placeholders, lecture complète des 221
scripts, audit zéro strict, `check:generated`) tourne toujours (~2 min) ; `e2e` (matrice
`chromium`/`firefox` × 2 shards : `e2e (chromium 1/2)`, `e2e (firefox 2/2)`…) ne tourne que si des
chemins UI/renderer/player/kag/e2e changent — et **toujours** sur push `v1.1` (porte d'intégration) ;
`pwa (offline)` ne tourne que si des chemins PWA changent. Sur `main`, la gate est légère
(`build-and-test` seul) ; l'e2e complet tourne chaque nuit (`e2e-nightly.yml`) et un merge train
automatique promeut `v1.1` → `main` (`merge-train.yml`). Une PR docs/outils seule ne lance donc que
`build-and-test`.

> Environnements restreints (sandbox macOS d'un agent, conteneurs) : Firefox imbrique son propre
> sandbox, que certains sandboxes d'exécution refusent (`sandbox_init() failed`). Pour la
> vérification locale uniquement, lancer avec `MOZ_DISABLE_CONTENT_SANDBOX=1` (et
> `PLAYWRIGHT_BROWSERS_PATH` si les navigateurs sont installés hors du cache utilisateur).

## Jouer

Le dépôt ne contient aucun asset du jeu : il faut posséder une copie du jeu PC 2012 et générer les
fichiers web soi-même. Cette section donne le parcours complet, de vos fichiers à une partie jouable ;
le détail technique du pipeline (gabarits, décodeur TLG, cache, dossiers) est dans
[`docs/PIPELINE.md`](docs/PIPELINE.md#parcours-complet-e1-de-larchive-au-jouable).

> ⚠️ **Légal** : vous devez posséder une copie du jeu. Les fichiers extraits et convertis restent sur
> votre machine, dans des dossiers ignorés par git (`public/assets/`, `.pipeline-work/`) ; rien n'est
> redistribué. `npm run check:assets` protège le dépôt : il échoue si un asset sous copyright y est ajouté.

### Prérequis

| Prérequis | Rôle | Obligatoire ? |
|---|---|---|
| **Node.js 22** | version utilisée par la CI (`.github/workflows/ci.yml`) ; ≥ 18 requis par les outils `tsx` | ✅ |
| **npm** | installation et scripts | ✅ (fourni avec Node) |
| **Copie du jeu PC 2012** | archives `.xp3` (`data.xp3`, `bg.xp3`, …) **ou** fichiers déjà extraits | ✅ |
| **Extracteur `.xp3`** | décompresse les archives (`xp3extract`, `krkrExtract`, GARbro CLI, script Python…) | ✅ si `--input` contient des `.xp3` (outil externe, non fourni) |
| **Convertisseur `.tlg`** | `.tlg` → `.webp` (ex. `tlg2png` + `cwebp`) | ⬚ Optionnel : sans lui, le décodeur intégré produit des `.png` (TLG0.0/TLG5 ; TLG6 non décodé) |
| **Encodeur audio** | `.wav` → `.ogg` (ex. `ffmpeg`) | ⬚ Optionnel : sans lui, les `.wav` sont copiés tels quels |
| **Navigateur récent** | Chrome/Chromium ou Firefox, cibles de la CI | ✅ |

Les outils externes sont appelés par des **gabarits de commande** (`{in}` et `{out}` remplacés argument
par argument, sans shell) : adaptez-les à votre extracteur/convertisseur. Un extracteur en GUI
(krkrExtract) se lance à la main ; passez ensuite le dossier extrait à `--input` sans `--xp3-cmd`.
Voir [`docs/PIPELINE.md`](docs/PIPELINE.md#prérequis) pour les variantes et les outils testés.

### 1. Récupérer le dépôt et installer

```bash
git clone git@github.com:TheArabicMonster/mahoyo-web.git
cd mahoyo-web
npm ci          # versions exactes du package-lock.json, comme la CI
```

> Worktrees d'agents : lier les dépendances avec `ln -s <dépôt>/node_modules .` est
> ignoré par git — la règle `.gitignore` `node_modules` (sans barre finale) couvre le
> dossier **et** le lien symbolique (#265).

### 2. Extraire les assets, convertir et générer le manifeste

Le pipeline fait tout en une commande : extraction `.xp3`, conversion des images et de l'audio,
normalisation des scripts UTF-8 et **écriture du manifeste** `public/assets/asset-manifest.json`
(il n'y a pas d'étape manifeste séparée).

Parcours minimal (sans outil de conversion supplémentaire) :

```bash
npm run pipeline -- \
  --input ./jeu \
  --output ./public/assets \
  --xp3-cmd "<extracteur> {in} {out}"
```

Parcours recommandé, avec WebP et audio OGG :

```bash
npm run pipeline -- \
  --input ./jeu \
  --output ./public/assets \
  --xp3-cmd "<extracteur> {in} {out}" \
  --tlg-cmd "<convertisseur TLG→WebP> {in} {out}" \
  --audio-cmd "ffmpeg -y -i {in} -c:a libopus -b:a 96k -f ogg {out}"
```

- `./jeu` contient les archives (`.xp3`) **ou** les fichiers déjà extraits ; dans ce second cas,
  omettez `--xp3-cmd`.
- Les sorties vont dans `public/assets/` (ignoré par git), le travail et les rapports dans
  `.pipeline-work/` (ignoré par git également). Le pipeline **refuse de démarrer** si `--output` ou
  `--work` est un dossier du dépôt non ignoré.
- **Manifeste** : `public/assets/asset-manifest.json` mappe les clés normalisées des scripts vers les
  URLs web. C'est lui que le player charge au démarrage.
- **Rapports** : le résumé console liste les fichiers non convertis ; le détail est dans
  `.pipeline-work/pipeline-report.json` et les références manquantes dans `.pipeline-work/report.json`.
  Code de sortie `0` si tout est produit, `1` sinon.
- **`-f ogg` est nécessaire** dans `--audio-cmd` : le pipeline écrit d'abord la sortie dans un fichier
  temporaire `<sortie>.tmp` (écriture atomique), et `ffmpeg` ne peut pas deviner le format depuis cette
  extension. Si votre `ffmpeg` dispose de `libvorbis`, remplacez le codec par
  `-c:a libvorbis -q:a 4` (en gardant `-f ogg`).
- Par défaut, le pipeline tente aussi d'installer la traduction française depuis le dépôt Moon-Trad
  (rien n'est versionné) ; un échec réseau n'est qu'un avertissement. Ajoutez `--no-translation` pour
  l'ignorer.
- Vérifiez d'abord le plan sans rien écrire : `npm run pipeline -- --help`, puis la même commande avec
  `--dry-run`.

> Sans `--tlg-cmd`, le décodeur intégré convertit les `.tlg` en `.png` ; un `.tlg` TLG6 ou chiffré
> apparaît comme « fichier non converti » (code de sortie 1) : fournissez alors `--tlg-cmd`. Détail
> complet des options : `npm run pipeline -- --help` et [`docs/PIPELINE.md`](docs/PIPELINE.md).

### 3. Générer les tables d'enchaînement et de timelines

Ces tables ne sont **pas** produites par `npm run pipeline` ; elles dérivent des fichiers du jeu et
sont ignorées par git.

```bash
# main.gc est extrait de data.xp3 (dossier others/) ; le localiser si besoin :
find .pipeline-work/extracted -name main.gc

npm run chain -- <chemin/main.gc> public/assets
# → story-chain.json (enchaînement, chapitres, choix) + story-graph.json (graphe de scénario)

npm run timelines -- public/assets
# → timelines.json (musique et images de l'ouverture)
```

Sans `story-chain.json`, le jeu ne propose que le prologue et s'arrête à la fin du script ; sans
`timelines.json`, l'ouverture est sautée ; sans `story-graph.json`, le flowchart n'a pas de données de graphe.
Voir [`docs/ENCHAINEMENT_SCRIPTS.md`](docs/ENCHAINEMENT_SCRIPTS.md) et [`docs/TIMELINES.md`](docs/TIMELINES.md).

### 4. Lancer le player

```bash
npm run dev     # ouvrir l'adresse affichée (http://localhost:5173 par défaut)
```

L'écran titre propose *Start*, *Load*, *Continuer* (autosave), *Flowchart*, *Config* et *Extra* ;
*Extra* ouvre la liste des chapitres. Pour une version optimisée :

```bash
npm run build
npm run preview
```

> `npm run build` copie `public/assets/` dans `dist/` (environ **7 Go** avec le jeu complet). Pour jouer
> en local, `npm run dev` suffit.

### Vérifier l'installation

```bash
ls -l public/assets/asset-manifest.json   # présent après l'étape 2
npm run check:assets                      # aucun asset sous copyright dans le dépôt
npm run audit                             # audit du corpus KAG (via public/assets, ou MAHOYO_ASSETS_DIR)
npm run audit:guard                       # garde-fou commandes KAG (zéro strict : registre des no-ops, baseline vide, doc ; échec sur toute inconnue)
npm run audit:doc -- --check              # vérifie que la doc des commandes KAG est à jour
npm run approximations:doc -- --check     # vérifie que la doc des approximations est à jour
```

### Dépannage

| Symptôme | Cause probable | Diagnostic / correctif |
|---|---|---|
| Le player n'affiche que le titre, des fonds unis ou des images cassées ; console : `Impossible de charger le manifest` | manifeste absent ou écrit ailleurs | DevTools → Network : `asset-manifest.json` renvoie la page `index.html` (repli du serveur) au lieu du JSON. Vérifier `--output ./public/assets` et relancer l'étape 2. Sans manifeste, le player retombe sur les conventions `/assets/bg/<clé>.webp`, d'où les images cassées. |
| `npm run audit` : `Répertoire scenario introuvable : …/public/assets/scenario` | pipeline pas lancé ou sortie dans un autre dossier | `ls public/assets/scenario` ; relancer l'étape 2 avec `--output ./public/assets`. |
| Console : `Asset introuvable (image)` / `Asset introuvable (audio)` | clé absente du manifeste (conversion en échec, nom non normalisé) | `cat .pipeline-work/pipeline-report.json` (fichiers non convertis) puis `cat .pipeline-work/report.json` (`missingStorages`). `npm run audit` liste aussi les assets référencés. |
| Pipeline : `Fichiers non convertis` et code de sortie `1` | `.tlg` TLG6/chiffré, outil externe introuvable ou en échec | lire `.pipeline-work/pipeline-report.json` ; fournir `--tlg-cmd` (TLG6) ; tester la commande du gabarit à la main. |
| Pipeline : `Aucune archive .xp3 trouvée` ou `Aucun fichier asset trouvé` | `--input` ne pointe pas sur la racine des archives/fichiers extraits | passer le bon dossier à `--input`, ou extraire d'abord et retirer `--xp3-cmd`. |
| Pipeline : `Le dossier de sortie … n'est pas ignoré par git` | sortie dans le dépôt en dehors des dossiers ignorés | utiliser `./public/assets`, `--work .pipeline-work`, ou un dossier hors dépôt (`/tmp/…`). |
| Le player affiche l'interface mais pas les images du jeu | assets incomplets ou manifeste absent | vérifier le manifeste et les fichiers sous `public/assets/` ; les placeholders synthétiques de `npm run test:e2e` ne sont pas les assets du jeu. |
| Avertissement « traduction non installée (réseau ?) » | dépôt Moon-Trad inaccessible | relancer `npm run translation -- fr <dossier> public/assets --fetch`, ou ignorer avec `--no-translation`. |
| Un fichier du jeu apparaît dans `git status` | sortie écrite hors des dossiers ignorés | ne jamais commiter ; `git status` doit rester propre, `npm run check:assets` doit passer. |

Diagnostic rapide de bout en bout :

```bash
npm run pipeline -- --help
ls -l public/assets/asset-manifest.json public/assets/scenario
cat .pipeline-work/pipeline-report.json
cat .pipeline-work/report.json
npm run check:assets
```

## Installer le jeu (PWA) et jouer hors ligne

Une fois `public/assets/` généré et le site servi en **HTTPS** (ou sur `localhost`), le player est une
**PWA installable** — le service worker n'est actif qu'en production (`vite preview`, site déployé).

- **Manifeste** `public/manifest.json` : nom, `display: standalone`, orientation paysage, thème sombre
  (`#1a1a2e` / `#0a0a0a`, voir [`docs/DESIGN.md`](docs/DESIGN.md)), icônes originales 192 et 512 (dont
  `maskable`). Lié depuis `index.html` (manifeste, `theme-color`, icônes Apple).
- **Service worker généré au build** (`npm run build` → `dist/sw.js`, source `tools/pwa-sw.ts`) :
  - **pré-cache de la coquille** (HTML, JS/CSS hachés du build, manifeste, icônes) dans un cache
    versionné `mahoyo-shell-<hash>` : l'application démarre hors ligne dès le premier chargement ;
  - **cache d'assets versionné** (#372) : nommé `mahoyo-assets-<assetsVersion>` d'après le hash du
    manifeste écrit par le pipeline ; les anciens caches sont **purgés à l'activation** du service
    worker (plus de vidage/remplissage en boucle entre deux versions) ; borné à 2 000 entrées avec
    trim **différé** (`cache.keys()` un `put` sur 25) en attendant un versionnage complet ; les
    assets ne sont **jamais** pré-cachés (plusieurs Go) ; `asset-manifest.json` et
    `image-dimensions.json` sont servis en stale-while-revalidate ;
  - **navigation network-first** (une nouvelle version déployée est vue dès qu'on est en ligne, repli
    sur la coquille hors ligne), assets **cache-first** ; les requêtes cross-origin (polices), `Range`
    et `/api/` ne sont pas mises en cache.
- **Hors ligne** : après un premier chargement (qui met les fichiers utilisés en cache), le player se
  recharge et lit le contenu **déjà chargé** ; les pages/images jamais chargées resteront manquantes
  jusqu'à un passage en ligne (le player tolère l'asset absent, il n'y a pas de blocage).
- **Mise à jour** : un nouveau build change le hash de la coquille ; le nouveau service worker est
  installé puis activé sur message `SKIP_WAITING`, et la page est **rechargée une seule fois**
  (garde-fou de session anti-boucle). Les anciens caches `mahoyo-shell-*` et `mahoyo-assets-*` sont
  supprimés à l'activation.
- **Installation** : bouton « Installer » dans Chrome/Edge ; Safari iOS via Partager → « Sur l'écran
  d'accueil ». Firefox ne propose pas l'installation PWA de bureau sous Linux (limite du navigateur).
- **Vérification automatisée** : `npm run test:e2e:pwa` (Chromium) construit avec placeholders, sert
  `vite preview`, contrôle le manifeste, l'enregistrement du service worker, les caches et une
  **relecture hors ligne** (`context.setOffline(true)`). Lighthouse a retiré sa catégorie PWA
  (v12, 2024) : l'installabilité est vérifiée par ces contrôles explicites plutôt que par un score.

## Commandes et configuration

Les raccourcis par défaut reprennent la configuration du jeu d'origine et sont modifiables dans **Config → Raccourcis**.

| Touche | Action |
|---|---|
| Clic, Espace, Entrée, molette bas | Avancer (une touche maintenue n'avance qu'une seule fois) |
| Molette haut, flèche gauche | Retour arrière |
| `S` / `F2` | Menu de sauvegarde |
| `L` / `F3` | Menu de chargement |
| `F11` | Sauvegarde rapide |
| `O` / `F9` | Menu de chargement rapide |
| `F12` | Charger la sauvegarde la plus récente |
| `Delete` / `Backspace` | Masquer / réafficher le texte |
| `F4` | Fenêtré / plein écran |
| `C` | Ouvrir les options |
| `Échap` | Ouvrir le menu / fermer l'écran courant |
| `A` / `F6` | Lecture automatique |
| `F` / `F7` | Avancer jusqu'au dernier texte lu |
| `R` / `F5` | Historique |
| `P` | Retour à l'écran titre |
| `Alt+F4` | Quitter le jeu (si le navigateur l'autorise) |
| `1`…`9` | Choisir une option |
| Clic droit | Menu, ou masquer le texte puis menu selon le réglage |
| Ctrl (maintenu) | Skip temporaire (raccourci de confort du port) |

La configuration couvre aussi les vitesses de texte lu/non lu, les délais auto page/ligne, le fondu du texte déjà lu,
les modes plein écran, la taille d'affichage, le comportement de la souris, les volumes/mutes et les effets.
Détail complet : [`docs/CONFIG_PLAN.md`](docs/CONFIG_PLAN.md).

## Limites connues

État au 9 novembre 2026, v1.0 close. Les écarts de fidélité, d'accessibilité et de confort ci-dessous
restent suivis en v1.1 (voir les approximations documentées dans [`docs/APPROXIMATIONS.md`](docs/APPROXIMATIONS.md) et les notes de version).

- **Ouverture** : rejouée par le lecteur de timeline (panoramiques, calques et audio, #125) et toujours
  sautable. Restent la fidélité de la pluie et des accélérations (#158) et le flash blanc/panoramique
  final (#254), suivis en v1.1.
- **Bulles `@ploysay`** (scripts « omake ») : positionnées (décalages exposés) mais pas dessinées.
- **Chapitre choisi dans *Extra > Archive*** ou « Relire depuis ici » dans le flowchart : démarre avec un
  **état initial vide** ; les variables posées par le jeu en entrant dans le chapitre ne sont pas reprises.
- **Assets absents** : seul le son `bgm101` (générique de fin) manque au corpus japonais — le générique se
  joue sans musique ; la traduction française référence en plus 43 images propres à la version Steam,
  absentes de l'archive 2012 et tolérées par un avertissement unique (#110, #155). Aucun asset n'est substitué.
- **Voix et sons d'ambiance Steam** : les assets PC 2012 **ne contiennent aucune voix** (doublage du remaster
  2022/2023 uniquement) ; la traduction FR (scripts Steam) ajoute des réfs `@se` de voix/ambiance absentes,
  muettes avec un avertissement unique par asset. Les 810 SE 2012 jouent mais partagent le **canal unique
  `se:0`** (un SE coupe le précédent). État, chiffres et procédure pour fournir les voix : [`docs/AUDIO.md`](docs/AUDIO.md).
- **`@trans`** : `exchange=true` et `backlay` après `@wt` ne sont pas implémentés (#253, v1.1).
- **Accessibilité** : le flowchart est couvert par axe-core (WCAG A/AA) et le clavier ; il reste l'anneau de
  focus du menu système sous Firefox (#257, v1.1) et la conformité WCAG AA globale (#97, v1.1).
- **Mobile/tablette** : non validé ; responsive portrait (#210) et accessibilité des écrans système (#211)
  sont suivis en v1.1.
- **Écran de choix** : fidélité à l'original suivie en v1.1 (#213).

## Documentation

| Sujet | Fichier |
|---|---|
| Progression et milestones | [`docs/PROGRESS.md`](docs/PROGRESS.md) |
| Notes de version v1.0 (non publiées) | [`docs/RELEASE_NOTES_V1.0.md`](docs/RELEASE_NOTES_V1.0.md) |
| Notes de version v1.1 (brouillon, non publiées) | [`docs/RELEASE_NOTES_V1_1.md`](docs/RELEASE_NOTES_V1_1.md) |
| Recette visuelle v1.1 (propriétaire) | [`docs/TEST_VISUEL_V1_1.md`](docs/TEST_VISUEL_V1_1.md) |
| Captures complémentaires (HUD-17) | [`docs/GUIDE_CAPTURES.md`](docs/GUIDE_CAPTURES.md) |
| Approximations documentées (suivi v1.1, registre #295) | [`docs/APPROXIMATIONS.md`](docs/APPROXIMATIONS.md) |
| État audio : BGM, voix, ambiances, procédure | [`docs/AUDIO.md`](docs/AUDIO.md) |
| Roadmap et épics | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| Architecture et contrats | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Design system du HUD | [`docs/DESIGN.md`](docs/DESIGN.md) |
| Analyse du HUD d'origine et backlog UI | [`docs/ANALYSE_HUD_ORIGINAL.md`](docs/ANALYSE_HUD_ORIGINAL.md) |
| Configuration et raccourcis | [`docs/CONFIG_PLAN.md`](docs/CONFIG_PLAN.md) |
| Sémantique KAG Mahoyo | [`docs/KAG_MAHOYO_SEMANTICS.md`](docs/KAG_MAHOYO_SEMANTICS.md) |
| Bugs du prologue | [`docs/BUGS_PROLOGUE.md`](docs/BUGS_PROLOGUE.md) |
| Pipeline d'assets | [`docs/PIPELINE.md`](docs/PIPELINE.md) |
| Enchaînement des scripts et graphe | [`docs/ENCHAINEMENT_SCRIPTS.md`](docs/ENCHAINEMENT_SCRIPTS.md) |
| Ouverture et timelines | [`docs/TIMELINES.md`](docs/TIMELINES.md) |
| Lecture complète du corpus | [`docs/LECTURE_COMPLETE.md`](docs/LECTURE_COMPLETE.md) |
| Budgets et mesures de performance | [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) |
| Banc des transitions de scènes | [`docs/PERF_BENCH.md`](docs/PERF_BENCH.md) |
| Débordement du texte et taille nominale | [`docs/TEXTE_DEBORDEMENT.md`](docs/TEXTE_DEBORDEMENT.md) |
| Validation visuelle (sprites, transitions) | [`docs/VALIDATION_VISUELLE.md`](docs/VALIDATION_VISUELLE.md) |
| Diagnostic de l'ouverture (flash, pan, synchro) | [`docs/DIAG_OUVERTURE.md`](docs/DIAG_OUVERTURE.md) |
| Traduction française | [`docs/TRADUCTION.md`](docs/TRADUCTION.md) |
| Layout DOM et z-index | [`docs/layout.md`](docs/layout.md) |
| Définition of Done | [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md) |
| Directives agents IA | [`AGENTS.md`](AGENTS.md) |

## Architecture

```
src/kag/              Moteur KAG3 (indépendant du DOM)
  lexer.ts            Tokenisation des scripts .ks
  parser.ts           Tokens → pages avec instructions
  runtime.ts          Machine à états fore/back + pile d'appels + save/load
  events.ts           Contrat RenderEvent / StopReason / snapshots
  stage-state.ts      Réducteurs purs pour save/load/rollback
  types.ts            Types partagés

src/renderer/         Rendu navigateur
  stage-renderer.ts   Scène, texte, transitions, effets, cadre de message
  text-fit.ts         Calcul pur de la police et de la zone de texte
  text-frame.ts       Cadre image, opacité et indicateurs de page
  audio-manager.ts    BGM / SE / voix, fondus, volumes et mutes
  types.ts            Interfaces StageRenderer et AudioPlayer

src/ui/               Interface utilisateur
  player.ts           Orchestrateur Runtime ↔ rendu ↔ audio ↔ UI
  ui-manager.ts       Écrans, configuration, raccourcis, toasts
  ui-manager.css      Styles de l'interface
  tokens.css          Tokens du design system
  toast.ts / .css     Toasts au design d'origine (pile de 3, bas droite)
  transitions.ts/.css Rideaux plein écran entre écrans (HUD-14)
  cg-mode.ts / .css   Galerie CG (HUD-15)
  sound-mode.ts/.css  Galerie sonore (HUD-16)
  chapter-list.ts     Chapitres et scripts
  types.ts            Contrats UIManager, PlayerCommands, UIView

src/player/           Persistance
  save-store.ts       Contrat SaveStore, métadonnées et migration des enregistrements
  save-store-idb.ts   Stockage IndexedDB, migration depuis localStorage, repli
  save-transfer.ts    Export / import JSON des sauvegardes et de la progression
  settings-store.ts   Réglages, lecture, progression
  story-progress.ts   Progression par scène et choix
  save-messages.ts    Libellés de sauvegarde

src/core/             Utilitaires partagés
  asset-resolver.ts   Résolution des URLs d'assets
  story-chain.ts      Enchaînement des scripts
  story-graph.ts      Types du graphe de scénario
  timeline.ts         Timelines d'ouverture
  shortcuts.ts        Raccourcis configurables
  display.ts          Échelle du viewport et tailles
  language.ts         Langues et index de traduction
  easing.ts           Courbes d'animation

tools/                Pipeline d'assets et génération hors dépôt
  pipeline.ts         Orchestrateur (extraction, conversion, manifeste, rapport)
  tlg-decode.ts       Décodeur TLG0.0/TLG5.0 intégré (PNG via zlib)
  story-chain.ts      story-chain.json + story-graph.json
  timelines.ts        timelines.json
  audit-scenario.ts   Audit du corpus KAG
```

Les assets du jeu ne sont jamais versionnés : `npm run check:assets` échoue si un fichier sous copyright est ajouté.
