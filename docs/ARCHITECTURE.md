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
- **`ui-manager.ts`** : écrans DOM (titre, pause, sauvegarde/chargement, historique, flowchart, configuration) et gestion des entrées.
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
- **`chapter-list.ts`** : construction de la liste des chapitres/scripts.
- **`i18n.ts`** et **`locales/`** : dictionnaire d'interface FR/JA/EN (`t(clé)`, repli sur le français). Voir [`I18N.md`](I18N.md).

### `src/player/` — persistance

- **`save-store.ts`** : `SaveStore` (clés `localStorage` `mahoyo.save.<slot>`). Un `SaveRecord` porte l'état de reprise
  (runtime, scène, audio, arrêt) et, depuis HUD-11 (#183), `sceneTitle` (libellé du sommaire local de l'utilisateur,
  sinon nom du fichier de script), `comment` (libre, `""` par défaut) et `locked`.
  - **Migration à la lecture** (`migrateSaveRecord`) : une sauvegarde sans ces champs reçoit `sceneTitle` = nom du
    fichier, `comment` = `""`, `locked` = `false` ; aucun champ existant n'est modifié et le stockage n'est pas réécrit
    à la lecture. Elle est idempotente.
  - **Verrou** : `put` et `delete` rejettent avec `SaveLockedError` sur un emplacement verrouillé (le player vérifie
    aussi avant la confirmation et affiche un message). `update(slot, { comment, locked })` modifie ces deux
    métadonnées, y compris sur un emplacement verrouillé.
- **`settings-store.ts`** : réglages (`mahoyo.settings`), « déjà lu » (`mahoyo.read`), progression par chapitre
  (`mahoyo.progress`) et progression par scène (`mahoyo.story-progress`). Lecture tolérante (absent, partiel,
  corrompu ou stockage inaccessible = valeurs vides/par défaut).
- **`story-progress.ts`** : fonctions pures de la progression par scène pour le flowchart (`StoryProgress` :
  `visited`, `finished`, `choices` = arêtes `{from, to}` en scripts, **jamais de libellé**, `endings`).
  `normalizeStoryProgress` sert aussi à l'import ; `mergeStoryProgress` à l'union de deux exports.
- Réglage `flowchartRevealAll` (défaut `false`) : anti-spoiler du flowchart actif tant qu'il est faux.

### `src/core/` — utilitaires

- **`asset-resolver.ts`** / **`asset-manifest.ts`** : résolution des URLs d'assets et manifeste.
- **`story-chain.ts`** : types de la table d'enchaînement des scripts et des choix.
- **`story-graph.ts`** : types du graphe de scénario (nœuds, arêtes, conditions).
- **`timeline.ts`** : parsing et validation des timelines d'ouverture.
- **`shortcuts.ts`** : définition, normalisation et résolution des 14 raccourcis configurables.
- **`display.ts`** : calcul pur de l'échelle du viewport (fit/fill/1:1, taille maximale).
- **`language.ts`** : langues disponibles et index du patch de traduction.
- **`easing.ts`** : courbes d'animation partagées.

### `tools/` — pipeline d'assets (hors dépôt pour les assets)

- Extraction `.xp3`, conversion `.tlg` → WebP, audio OGG, normalisation des `.ks`.
- **`story-chain.ts`** : génère `story-chain.json` (enchaînement, chapitres, choix) et `story-graph.json` (graphe de scénario).
- **`timelines.ts`** : génère `timelines.json` pour l'ouverture.
- **`audit-scenario.ts`** : audit des commandes KAG et des assets référencés.

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

- `tests/unit/mocks/` : mocks partagés (`FakeAudioPlayer`, `FakeUIManager`, `FakeRuntime`).
- `tests/fixtures/*.json` : séquences de `Step` générées par le runtime à partir de samples.

## Principes

- Le moteur KAG est indépendant du DOM (testable en headless).
- Le renderer est passif : aucune décision de flux.
- Les assets originaux ne sont jamais versionnés.
