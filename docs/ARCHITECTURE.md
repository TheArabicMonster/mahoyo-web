# Architecture

Vue technique du projet `mahoyo-web`.

## Pipeline global

```
Jeu original (PC 2012)
   │  .xp3 / .tlg / .ogg / .ks
   ▼
tools/  ── extraction + conversion
   │  → public/assets/... (WebP, OGG, scripts normalisés)
   ▼
src/kag/  ── lexer → parser → runtime
   │  → Step { events, stop }
   ▼
src/ui/player.ts  ── orchestrateur
   │  → StageRenderer + AudioPlayer + UIManager
   ▼
src/renderer/ + src/ui/  ── rendu navigateur
```

## Composants

### `src/kag/` — moteur KAG

1. **`lexer.ts`** : découpe des lignes, parsing des arguments, tags inline.
2. **`parser.ts`** : produit une liste d'instructions + table des labels.
3. **`runtime.ts`** : exécute instruction par instruction et produit des `Step { events, stop }`.
4. **`types.ts`** : types partagés (Token, Instruction, Page, TextSegment).
5. **`events.ts`** : contrat de sortie du runtime (`RenderEvent`, `StopReason`, `Step`, snapshots).
6. **`stage-state.ts`** : réducteurs purs `reduceStage()` / `reduceAudio()` pour save/load/rollback.

### `src/renderer/` — rendu navigateur

- **`types.ts`** : interfaces `StageRenderer` et `AudioPlayer`, `DisplaySettings` et `AudioSettings`.
- **`stage-renderer.ts`** : scène, sprites, fonds, transitions, effets, texte, cadre image et indicateurs.
- **`text-fit.ts`** : calculs purs de la police, de la zone de texte et de l'atténuation du texte lu.
- **`text-frame.ts`** : choix du cadre de message, opacité, glyphes `linebreak_a`/`pagebreak_a` et position de l'indicateur.
- **`audio-manager.ts`** : implémentation web de `AudioPlayer` (BGM, SE, voix, fondus, volumes et mutes par canal).
- **`action-compiler.ts`**, **`transform-helpers.ts`**, **`css-url.ts`** : compilation des animations, géométrie des calques et URLs CSS.

### `src/ui/` — interface utilisateur

- **`types.ts`** : interfaces `UIManager`, `PlayerCommands`, `UIView`, `GameSettings` et progression.
- **`player.ts`** : orchestrateur Runtime ↔ StageRenderer ↔ AudioPlayer ↔ UIManager, boucle de lecture, modes auto/skip, sauvegardes et viewport.
- **`ui-manager.ts`** : écrans DOM (titre et Extra/Archive, menu système, historique, sauvegarde/chargement, flowchart, configuration) et gestion des entrées ; il délègue aux composants ci-dessous et branche les commandes tactiles.
- **`ui-assets.ts`** : résolveur d'images d'interface avec repli (`createUiAssets`, `UI_ASSET_KEYS`, variables `--mh-asset-*`) ; aucune requête quand la clé manque (HUD-03, #189).
- **`save-load-screen.ts`** / **`save-pages.ts`** : écrans de sauvegarde et de chargement (grille 2×4, 15 pages, fiches, verrou, commentaire) et leur modèle pur ; voir `docs/DESIGN.md` §9.5.
- **`ui-manager.css`**, **`tokens.css`** : styles des écrans et tokens du design system (palette, typo, durées, états).
- **`toast.ts`**, **`toast.css`** : composant `ToastStack` des messages éphémères (cadre sarcelle bas droite, 3 au plus, `aria-live="polite"`) ; `DomUIManager.toast()` y délègue.
- **`confirm-dialog.ts`** / **`confirm-dialog.css`** : boîte de confirmation au design d'origine (HUD-05, #190), composant
  autonome en CSS pur. `openConfirmDialog(parent, { message, yesLabel, noLabel, defaultButton? })` renvoie
  `{ element, result, close }` ; `result` se résout par `true` (Oui) ou `false` (Non, Échap, fermeture forcée).
  `UIManager.confirm(message, { defaultButton? })` s'appuie dessus : **Non** est présélectionné par défaut (actions
  destructrices : retour au titre, écrasement, suppression), `{ defaultButton: "yes" }` présélectionne **Oui**
  (charger, et « sauter les scènes déjà lues » dans `player.ts`). Clavier : `Entrée` valide la sélection,
  `Échap` répond Non, `←`/`→` sélectionnent Oui/Non, `Tab` boucle dans la boîte, le focus ne peut pas en sortir et
  revient à l'élément précédent à la fermeture. Sémantique : `role="dialog"`, `aria-modal="true"`, nom accessible =
  message. Il n'existe plus de `window.confirm` ni de confirmation « quitter le jeu » (bouton Exit retiré).
- **`system-menu.ts`** / **`system-menu.css`** : menu système plein cadre (HUD-06, #194), ouvert par clic droit ou `Échap`
  (vue `pause`, slot `#ui-pause`). Composant autonome : `renderSystemMenu(ctx)` construit l'en-tête, la colonne
  d'entrées issue du tableau `SYSTEM_MENU_ENTRIES` (insérer ou retirer une entrée = une ligne) et « Back » ;
  `syncSystemMenu` reflète `PlayerStatus` (verrou `quickMenuLocked`, `aria-pressed` d'auto et skip) ;
  `syncSystemMenuVeil` pose `mh-ui-night mh-ui-night-veil` sur le slot seulement quand il a du contenu.
  Voir [`DESIGN.md`](DESIGN.md) §9.2.
- **`router.ts`** (WEB-04, #204) : routes d'URL des écrans (`#/title`, `#/game`, `#/load`, `#/save`, `#/config`,
  `#/backlog`, `#/flowchart` ; voir [`DESIGN.md`](DESIGN.md) §9.6). Fonctions pures (`parseRoute`, `serializeRoute`,
  `resolveRoute` = repli sur le titre, `viewRoute` = route de la vue du player) et `HistoryRouter`, adaptateur
  `location`/`history` injectable (`RouterHost`), jamais en exception. Contrat `ScreenRouter` (`start`, `publish`) injecté
  au `Player` par `main.ts` (`deps.router`, null dans les tests). Le player **publie** sa vue (`syncRoute` dans
  `openScreen`, `closeScreen`, `showTitle`, `enterGame`) et **applique** les navigations du navigateur
  (`Player.applyRoute`). Le routeur tient un miroir des entrées d'historique qu'il crée (`history.state = { mahoyo: profondeur }`) :
  ouvrir un écran fait `pushState`, le fermer fait `history.back()` quand l'entrée du dessous est la bonne, sinon
  `replaceState` ; il n'écrit jamais `location.hash` (pas de boucle) et ignore le `hashchange` qu'il provoque lui-même.
  Seul le nom de l'écran est dans l'URL (pas de script, libellé ni progression).
- **`night.ts`** / **`night.css`** : fond « nuit bleue » en CSS pur (HUD-02, #188) ; `NIGHT_FIXED_SCREENS` (sauvegarde, chargement, historique, configuration) et démonstration `?night` via `syncNightDemo`. Voir [`DESIGN.md`](DESIGN.md) §9.1.
- **`title-screen.ts`** / **`title-screen.css`** (HUD-07 #195) : écran titre au design d'origine et sous-menu Extra ; **`archive-view.ts`** / **`archive-view.css`** (HUD-08, #199) : liste de chapitres anti-spoiler ouverte depuis Extra. Voir [`DESIGN.md`](DESIGN.md) §9.9.
- **`config-screen.ts`** / **`config-screen.css`** (HUD-09, #200) : configuration au design d'origine (onglets Système, Message, Son/Effet, Raccourcis ; contrôles, aperçu du fondu) et option « tout révéler » du flowchart ; le modèle de réglages et `updateSettings` ne changent pas. Voir [`DESIGN.md`](DESIGN.md) §9.10.
- **`transitions.ts`** / **`transitions.css`** (HUD-14, #205) : rideaux plein écran entre les vues (titre → jeu, chargement → scène, ouverture/fermeture d'écran), timings lus dans les tokens CSS ; transition **inerte** sous `prefers-reduced-motion`. Voir [`DESIGN.md`](DESIGN.md) §7.
- **`cg-mode.ts`** / **`cg-mode.css`** (HUD-15, #208) : galerie CG construite depuis le manifeste (`buildCgCatalog`), suivi des CG vues (`src/player/cg-seen.ts`), visionneuse plein écran avec navigation clavier ; aucune miniature n'est commitée. Voir [`DESIGN.md`](DESIGN.md) §9.13.
- **`sound-mode.ts`** / **`sound-mode.css`** (HUD-16, #209) : galerie sonore depuis `AssetResolver.audioEntries()`, lecteur indépendant (`SoundEngine` de `audio-manager.ts`), titres et compositeurs fournis par l'utilisateur. Voir [`DESIGN.md`](DESIGN.md) §9.16.
- **`backlog-screen.ts`** / **`backlog-screen.css`** (HUD-12, #201) : historique plein cadre, ascenseur natif stylé, navigation clavier, ouverture à vide remplacée par le toast `toast.historyEmpty`. Voir [`DESIGN.md`](DESIGN.md) §9.7.
- **`gestures.ts`** : reconnaissance de gestes **pure** (appui, appui long, balayages, abandon sur pincement), horloge injectée ; **`touch-controls.ts`** / **`touch-controls.css`** (WEB-01, #203) : bouton de menu persistant et barre d'actions rapides, créés **seulement** sur appareil tactile (`pointer: coarse` ou toucher observé), cibles de 48 px réels via `--mh-ui-scale`. Voir [`DESIGN.md`](DESIGN.md) §9.8.
- **`chapter-list.ts`** : construction de la liste des chapitres/scripts et règle de déverrouillage de l'Archive.
- **`i18n.ts`** et **`locales/`** : dictionnaire d'interface FR/JA/EN (`t(clé)`, repli sur le français). Voir [`I18N.md`](I18N.md).

### `src/player/` — persistance

- **`save-store.ts`** : contrat `SaveStore` (`list`, `get`, `put`, `delete`, `update`, tous asynchrones) et magasins
  simples (localStorage, clés `mahoyo.save.<slot>`, et mémoire). Un `SaveRecord` porte l'état de reprise
  (runtime, scène, audio, arrêt) et, depuis HUD-11 (#183), `sceneTitle` (libellé du sommaire local de l'utilisateur,
  sinon nom du fichier de script), `comment` (libre, `""` par défaut) et `locked`.
  - **Migration à la lecture** (`migrateSaveRecord`) : une sauvegarde sans ces champs reçoit `sceneTitle` = nom du
    fichier, `comment` = `""`, `locked` = `false` ; aucun champ existant n'est modifié et le stockage n'est pas réécrit
    à la lecture. Elle est idempotente.
  - **Verrou** : `put` et `delete` rejettent avec `SaveLockedError` sur un emplacement verrouillé (le player vérifie
    aussi avant la confirmation et affiche un message). `update(slot, { comment, locked })` modifie ces deux
    métadonnées, y compris sur un emplacement verrouillé.
- **`save-store-idb.ts`** (#198) : magasin IndexedDB (base `mahoyo-saves`, stores `saves` et `thumbnails`),
  `createSaveStore()` (IndexedDB, sinon localStorage, sinon mémoire, sans exception) et `migrateLocalSaves`
  (migration idempotente des anciennes clés). Voir [`SAUVEGARDES.md`](SAUVEGARDES.md).
- **`save-transfer.ts`** (#198) : export / import JSON (`exportSaves`, `parseSaveExport`, `importSaves`) ; helpers DOM
  (téléchargement, sélecteur de fichier, messages i18n) dans `src/ui/save-transfer.ts`.
- **`settings-store.ts`** : réglages (`mahoyo.settings`), « déjà lu » (`mahoyo.read`), progression par chapitre
  (`mahoyo.progress`) et progression par scène (`mahoyo.story-progress`). Lecture tolérante (absent, partiel,
  corrompu ou stockage inaccessible = valeurs vides/par défaut).
- **`story-progress.ts`** : fonctions pures de la progression par scène pour le flowchart (`StoryProgress` :
  `visited`, `finished`, `choices` = arêtes `{from, to}` en scripts, **jamais de libellé**, `endings`).
  `normalizeStoryProgress` sert aussi à l'import ; `mergeStoryProgress` à l'union de deux exports.
- **`progress-tracker.ts`** : `ProgressTracker`, qui alimente la progression par scène pendant la partie (#193).
  La progression est gardée en mémoire (un seul blob, chargé une fois) et réécrite en entier par des écritures
  sérialisées et regroupées ; un échec d'écriture (quota dépassé) est toléré (avertissement unique, progression
  conservée en mémoire, nouvel essai à la modification suivante). `scriptIdOf` donne l'identifiant d'un script (nom
  sans extension, minuscules, comme les nœuds du graphe) ; `reachableEndings(chain)` calcule les fins du parcours :
  scripts sans suite **atteignables depuis le premier script** (un bonus isolé n'en est pas une).
- **Événements branchés dans `Player`** : démarrage d'un script (nouvelle partie, enchaînement, interlude, restauration)
  → `visited` (et `endings` si c'est une fin du parcours) ; `@return` → `finished` ; menu de choix de l'enchaînement →
  arête `{from, to}` en scripts. Les menus internes à un script (`@s`, cibles = labels du même script) ne créent
  pas d'arête. `Player.currentScript` (null au titre) est transmis à la vue `flowchart` avec la progression
  (`currentScript`, `story`).
- **Sauvegarde et progression** : `SaveRecord.choices` (optionnel, `[]` par défaut à la migration, réduit à des paires
  d'identifiants de scripts) garde le chemin de la **partie** en cours, restauré au chargement et au retour arrière.
  La progression **globale** est cumulative : charger une sauvegarde ou revenir en arrière n'y retire rien ; le
  chargement y ajoute seulement les arêtes de la sauvegarde (utile pour une sauvegarde importée).
- Réglage `flowchartRevealAll` (défaut `false`) : anti-spoiler du flowchart actif tant qu'il est faux ; relu à chaque
  ouverture de l'écran (FLOW-08 / #207).
- **Intégration du flowchart (FLOW-08 / #207)** : une seule vue `screen: "flowchart"` (FLOW-05/06/07) pour les trois
  entrées — menu de l'écran titre, menu système en jeu (entre `backlog` et `graphic`) et route `#/flowchart`. Hors Extra
  et historique (décision 2). `Player` transmet `currentScript`, `story`, graphe, vignettes et `revealAll` ; la carte se
  centre sur la position courante. L'ancien écran en liste (et ses champs de position/progression devenus morts) a été
  retiré.
- **`flowchart-view.ts`** / **`flowchart-view.css`** : rendu statique de l'écran Flowchart (FLOW-05, #197 ; accessibilité
  clavier/lecteur d'écran/portrait FLOW-07, #206 : navigation par arêtes, équivalent liste `<ul>`, `aria-live`,
  anti-spoiler de l'arbre d'accessibilité) ; voir `ENCHAINEMENT_SCRIPTS.md` (« Rendu du flowchart »).
  `DomUIManager` n'y délègue que `renderFlowchartScreen`.
- **`flowchart-viewport.ts`** : pan et zoom de la carte (FLOW-06, #202) : fonctions pures (`zoomAround`, `centerOn`, `pinchView`, `keyAction`…) et `attachViewport` (pointeur, molette, pincement, clavier), zoom mémorisé pour la session. **`flowchart-detail.ts`** : volet de détails d'un nœud visité (`describeNode`) et « Relire depuis ici » (`requestReplay` : confirmation Non par défaut puis `startScript`). `DomUIManager` ne branche que `confirm` et `replay`.
  `Player` charge `story-graph.json` (`AssetResolver.graph()`) à la première ouverture de l'écran, puis le fournit à
  la vue `flowchart` avec `revealAll` (réglage), `currentScript`, `story` et `thumbnail` (clé du manifeste -> URL,
  `AssetResolver.uiImage`). Les entrées titre/menu système et la route ouvrent tous cette vue (FLOW-08 / #207).

### `src/core/` — utilitaires

- **`asset-resolver.ts`** / **`asset-manifest.ts`** : résolution des URLs d'assets et manifeste.
- **`story-chain.ts`** : types de la table d'enchaînement des scripts et des choix.
- **`story-graph.ts`** : types du graphe de scénario (nœuds, arêtes, conditions).
- **`flow-graph.ts`** : `parseStoryGraph` (validation du `story-graph.json`), types de la mise en page du flowchart, `groupTitle`, `endingProgress`, `choiceLabelLines`.
- **`flow-layout.ts`** : `layoutFlowchart(graph)`, mise en page pure (sans DOM) du flowchart : groupes par chapitre, niveaux, arêtes orthogonales.
- **`timeline.ts`** : parsing et validation des timelines d'ouverture.
- **`shortcuts.ts`** : définition, normalisation et résolution des 14 raccourcis configurables.
- **`display.ts`** : calcul pur de l'échelle du viewport (fit/fill/1:1, taille maximale).
- **`language.ts`** : langues disponibles et index du patch de traduction.
- **`easing.ts`** : courbes d'animation partagées.

### `tools/` — pipeline d'assets (hors dépôt pour les assets)

- **`pipeline.ts`** (E1, #95) : orchestrateur `npm run pipeline -- --input … --output …` — résolution de la
  source (extraction `.xp3` par gabarit `{in}`/`{out}`), inventaire, plan, conversion, écriture du manifeste
  `asset-manifest.json`, vérification des références et rapports (`<work>/pipeline-report.json`,
  `<work>/report.json`). Options `--dry-run`, `--strict`, `--force`, `--no-translation` ; garde-fous : refus
  d'un dossier de sortie/travail du dépôt non ignoré par git, code de sortie 1 si un fichier n'est pas produit.
  Voir [`PIPELINE.md`](PIPELINE.md).
- **`tlg-decode.ts`** : décodeur intégré TLG0.0/TLG5.0 (PNG via zlib), utilisé sans `--tlg-cmd` ; TLG6 signalé en échec.
- **`story-chain.ts`** : génère `story-chain.json` (enchaînement, chapitres, choix) et `story-graph.json` (graphe de scénario).
- **`timelines.ts`** : génère `timelines.json` pour l'ouverture.
- **`audit-scenario.ts`** : audit des commandes KAG et des assets référencés (`MAHOYO_ASSETS_DIR` ou `public/assets`).
- Conversions `convert-tlg.ts` / `convert-audio.ts`, normalisation `normalize-ks.ts`, traduction `translation.ts`,
  contrôle anti-assets `check-no-assets.ts` et progression `progress.ts` ; tests unitaires dans `tests/unit/tools/`.

### Configuration et design system

- Les réglages sont décrits dans [`CONFIG_PLAN.md`](CONFIG_PLAN.md) (quatre onglets, valeurs par défaut, adaptations web).
- Le langage visuel du HUD est dans [`DESIGN.md`](DESIGN.md) ; l'analyse écran par écran et le backlog UI dans
  [`ANALYSE_HUD_ORIGINAL.md`](ANALYSE_HUD_ORIGINAL.md).
- Les tokens CSS sont déclarés une seule fois dans `src/ui/tokens.css` et importés par `src/main.ts`.

## Flux de lecture

1. Le **player** charge un script `.ks`, le parse et crée un `Runtime`.
2. Le **player** appelle `runtime.step()` de manière répétée.
3. Chaque `Step` contient :
   - `events` : événements de rendu purs (scène, texte, audio, effets…)
   - `stop` : raison d'arrêt (`click`, `wait`, `loadScript`, `end`…)
4. Le **player** route les events :
   - visuels/texte vers `StageRenderer.apply()`
   - audio vers `AudioPlayer.apply()`
   - menus/flowchart via `UIManager`
5. Le **player** attend l'interaction utilisateur selon `stop`, puis rappelle `runtime.step()`.

## Agents parallèles

Les prompts et contrats pour les agents sont dans `docs/agents/{A,B,C,D}.md` :

- **A** : `StageRenderer` DOM (`src/renderer/stage-renderer.ts`)
- **B** : `AudioPlayer` (`src/renderer/audio-manager.ts`)
- **C** : `UIManager` (`src/ui/ui-manager.ts`)
- **D** : orchestrateur `Player` (`src/ui/player.ts`)

Les contrats `src/kag/events.ts`, `src/renderer/types.ts` et `src/ui/types.ts` sont figés (`contracts-v1`). Toute modification doit passer par `docs/agents/*-QUESTIONS.md` et une revue humaine.

## Tests et fixtures

- `tests/unit/` : **1939 tests unitaires** (112 fichiers) sur le moteur KAG, le rendu, les écrans, la
  persistance et les outils ; `tests/unit/mocks/` fournit les mocks partagés (`FakeAudioPlayer`,
  `FakeUIManager`, `FakeRuntime`) et `tests/fixtures/*.json` les séquences de `Step` générées à partir de samples.
- `tests/integration/` : lecture complète du corpus (`full-read.test.ts`, 221 scripts, 0 erreur, 0 boucle),
  traduction, enchaînement, flowchart et timelines ; voir « Tests d'intégration et lecture complète » ci-dessous.

### Tests end-to-end (Playwright, #243 / #94)

- `tests/e2e/*.spec.ts` : parcours navigateur (écran titre, player, menus, routes, sauvegarde, tactile,
  flowchart, transitions, son/CG) vérifiés dans Chromium et Firefox sur le viewport logique 1280×720.
- `tests/e2e/full-playthrough.spec.ts` : **parcours complet** (#94) en placeholders — titre → Start,
  lecture de plusieurs pages, **choix** validé, **sauvegarde puis chargement** (aller-retour après
  rechargement) et **changement de chapitre** par enchaînement, jusqu'au retour au titre.
- `tests/e2e/prepare-assets.ts` : prépare le `publicDir` de Vite **avant** son démarrage. En mode
  placeholders (défaut, CI incluse), `tests/e2e/placeholders.ts` génère un jeu d'assets synthétique
  déterministe sous `$MAHOYO_E2E_ASSETS/assets/` : manifeste minimal, PNG générés, quatre scripts KAG
  originaux (prologue, deux voies, chapitre 2) et une `story-chain.json` qui fait se terminer le
  prologue sur un **choix** puis enchaîne les chapitres. L'ouverture du prologue reprend la géométrie
  du vrai `1-0.ks` (`@bg` noir puis `@partbg center=748 width=522 height=576 srcleft=542`, image
  1120×672) pour couvrir la bounding box des calques `partbg` (#70). Aucun asset du jeu n'est lu ni
  commité.
- `MAHOYO_E2E_REAL_ASSETS=1` sert de vrais assets (`MAHOYO_E2E_ASSETS` pointe vers un dossier
  contenant `assets/`) ; utile pour vérifier le rendu avec les vrais assets, sans être nécessaire à
  la suite (le retour au titre est corrigé depuis #231).
- L'ordre importe : la génération a lieu dans la commande `webServer`, car Playwright démarre le
  serveur avant les `globalSetup` et Vite fige la liste des fichiers publics à la création.
- `playwright.config.ts` définit deux projets, `chromium` et `firefox`. Les skips par navigateur
  (émulation tactile CDP/`isMobile`, ascenseur `::-webkit-scrollbar`) sont déclarés dans les specs
  avec leur justification.
- `.github/workflows/ci.yml` comporte **3 jobs** : `build-and-test` (`npm ci`, `npm run lint`, contrôle
  anti-assets, `npm run build`, tests unitaires, tests d'intégration en skip propre sur checkout nu, puis
  corpus de placeholders et lecture complète des 221 scripts, Prettier non bloquant) et la matrice
  `e2e (chromium)` / `e2e (firefox)` (`fail-fast: false`) qui exécute la suite en mode placeholders et
  téléverse `test-results/` par navigateur en cas d'échec.

### Tests d'intégration et lecture complète (#269)

- `tests/integration/*.test.ts` : tests sur le corpus KAG (prologue, lecture complète, traduction,
  enchaînement, flowchart, timelines). Sans `MAHOYO_ASSETS_DIR` ni `public/assets`, ils se
  **skippent proprement** (exit 0) au lieu d'échouer au chargement.
- `tests/integration/full-read.test.ts` : traverse tous les scripts narratifs du corpus via le vrai
  moteur. Deux modes : vrais assets (seuil de référence 221 scripts) ou **corpus de placeholders**
  (marqueur `placeholder-corpus.json` : la taille attendue vient du corpus généré).
- `tests/integration/prepare-full-read-corpus.ts` (`npm run corpus:full-read`) : génère ce corpus
  original sous `$MAHOYO_E2E_ASSETS/assets/` (manifeste, images, scripts `corpus-NNN.ks` couvrant les
  commandes visuelles), à partir du générateur e2e `tests/e2e/placeholders.ts`. Variables :
  `MAHOYO_E2E_ASSETS`, `MAHOYO_FULL_READ_SCRIPTS` (défaut 221), puis `MAHOYO_ASSETS_DIR` pour le test.
- CI : le job `build-and-test` exécute `npm run test:integration` (checkout nu → skips) puis
  `npm run corpus:full-read` + `npm run test:full-read` (corpus de placeholders, 221 scripts). Ces
  étapes coûtent quelques secondes : elles restent dans le job existant plutôt que dans un job dédié.

### Lint (ESLint 9, #220)

- `eslint.config.js` (flat config) couvre `src/`, `tools/`, `tests/` et les fichiers de configuration ;
  `npm run lint` s'exécute en CI dans le job `build-and-test`, juste après `npm ci` (0 erreur exigée).
- Socle : `@eslint/js` recommended + `typescript-eslint` recommended (sans règles *type-aware*), globals
  navigateur + Node. Aucune règle désactivée globalement : les rares ajustements et l'unique exception
  locale justifiée sont documentés dans [`LINT.md`](LINT.md).

## Principes

- Le moteur KAG est indépendant du DOM (testable en headless).
- Le renderer est passif : aucune décision de flux.
- Les assets originaux ne sont jamais versionnés.
