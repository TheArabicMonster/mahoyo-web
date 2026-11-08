# Mahoyo Web

> Port web du visual novel **Mahoutsukai no Yoru** (*Witch on the Holy Night*, TYPE-MOON), inspiré de l'architecture de [tsukiweb-public](https://github.com/requinDr/tsukiweb-public).

Ce dépôt contient le **projet réel** : un player web moderne et maintenable pour lire Mahoyo dans un navigateur, en partant des fichiers du jeu original possédés par l'utilisateur.

## Statut (8 novembre 2026)

- **v1.0** : 74 issues fermées sur 82 (**90 %**), 8 restantes.
- **v1.1** : 13 issues fermées sur 52 (**25 %**).
- Phases actives : **E7 — Projet réel**, **E5 — UI/UX** (refonte HUD) et **E6 — QA**.
- Le player lit le corpus narratif, gère les choix, l'historique, les sauvegardes et un écran de configuration complet.
- Dernières livraisons : fenêtre de message sans boîte (#173), indicateur de page aligné (#175), configuration à quatre onglets (#177), sauvegardes enrichies côté modèle (#183), progression par scène et option flowchart (#186), graphe de scénario (#185), design system HUD et tokens CSS (#179, #181).
- Vérification locale : `npm run test:unit` (**1014 tests**), `npm run test:integration` (**20 tests**) et `npm run build` passent. `npm run lint` attend la migration ESLint 9 (#220).

Voir [`docs/PROGRESS.md`](docs/PROGRESS.md) pour le détail par milestone.

## Fonctionnalités

- **Moteur KAG3** : lexer, parser, runtime fore/back, conditions, macros, appels, furigana, sauvegarde/rollback, tolérance aux commandes inconnues.
- **Lecture** : enchaînement des chapitres, autosave, skip du texte lu, avance rapide, mode automatique avec délais page/ligne réglables.
- **Fenêtre de message** : texte posé sur le cadre du jeu (sans boîte), texte déjà lu atténué, indicateurs de ligne/page animés.
- **Configuration** : quatre onglets (Système, Message, Son/Effet, Raccourcis), 14 raccourcis clavier modifiables, plein écran fit/fill/1:1, volumes et mutes BGM/SE/système.
- **Sauvegardes** : emplacements numérotés, rapide et auto dans `localStorage` ; le modèle stocke désormais le titre de scène, le commentaire et le verrou (écran de sauvegarde HUD à venir, #196).
- **Interface** : écran titre, pause, historique, chargement/sauvegarde, flowchart par chapitres, toasts et confirmations.
- **Traductions** : japonais d'origine et patch fan français Moon-Trad installable par script ; sélecteur de langue dans la configuration.
- **Pipeline** : extraction `.xp3`, conversion `.tlg` → WebP, audio OGG, normalisation des `.ks`, audit du corpus, table d'enchaînement et graphe de scénario.
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
npm install

# Tests
npm test
npm run test:unit
npm run test:integration

# Player en développement
npm run dev

# Build de production
npm run build
npm run preview
```

## Jouer

Le dépôt ne contient aucun asset du jeu : il faut posséder une copie du jeu et générer les fichiers web.

1. **Convertir les assets** (images, sons, scripts) vers `public/assets/` : voir [`docs/PIPELINE.md`](docs/PIPELINE.md) (`npm run pipeline`). Ce dossier est ignoré par git.
2. **Générer les tables** à partir des fichiers du jeu. Elles ne sont pas produites par `npm run pipeline` :

   ```bash
   # main.gc se trouve dans data.xp3 (dossier others/) une fois l'archive extraite
   npm run chain -- <chemin/main.gc> public/assets
   # → story-chain.json (enchaînement, chapitres, choix) + story-graph.json (graphe de scénario)

   npm run timelines -- public/assets
   # → timelines.json (musique et images de l'ouverture)
   ```

   Sans `story-chain.json`, le jeu ne propose que le prologue et s'arrête à la fin du script ; sans
   `timelines.json`, l'ouverture est sautée ; sans `story-graph.json`, le flowchart n'a pas de données de graphe.
   Voir [`docs/ENCHAINEMENT_SCRIPTS.md`](docs/ENCHAINEMENT_SCRIPTS.md) et [`docs/TIMELINES.md`](docs/TIMELINES.md).
3. **Lancer** : `npm run dev`, puis ouvrir l'adresse affichée. L'écran titre propose *Nouvelle partie*,
   *Continuer* (autosave), *Charger*, *Réglages*, *Flowchart* et la liste des chapitres.

> `npm run build` copie `public/assets/` dans `dist/` (environ **7 Go** avec le jeu complet). Pour jouer
> en local, `npm run dev` suffit.

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

- L'ouverture est un diaporama (images, musique, pluie) **toujours sautable** : ses panoramiques, calques et effets ne sont pas encore rendus (#125).
- Les bulles des scripts « omake » (`@ploysay`) sont positionnées mais pas dessinées.
- Un chapitre choisi à l'écran titre démarre avec un **état vide** : les variables posées par le jeu en entrant dans un chapitre ne sont pas reprises.
- Une quinzaine d'images de personnages sont introuvables dans les assets convertis (#110).
- Quelques gros plans de sprites restent mal ancrés (#171).
- L'écran de sauvegarde/chargement utilise encore l'ancienne interface ; le modèle enrichi (titre, commentaire, verrou) n'est pas encore exposé (#196).
- La refonte des écrans HUD (titre, menu système, chargement, historique, flowchart) est suivie dans le backlog `HUD-xx`, `WEB-xx` et `FLOW-xx` ; la configuration est déjà refaite (#177), les autres écrans restent à aligner (#200).
- Les sauvegardes et vignettes vivent dans `localStorage` ; le passage à IndexedDB et l'export/import JSON sont prévus (#198).
- Le jeu est testé dans Chromium ; Firefox et le mobile restent à valider (v1.1).
- `npm run lint` est indisponible tant que la configuration ESLint 9 n'est pas rétablie (#220).

## Documentation

| Sujet | Fichier |
|---|---|
| Progression et milestones | [`docs/PROGRESS.md`](docs/PROGRESS.md) |
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
  chapter-list.ts     Chapitres et scripts
  types.ts            Contrats UIManager, PlayerCommands, UIView

src/player/           Persistance
  save-store.ts       Sauvegardes, métadonnées et migration
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
  pipeline.ts         Orchestrateur d'extraction/conversion
  story-chain.ts      story-chain.json + story-graph.json
  timelines.ts        timelines.json
  audit-scenario.ts   Audit du corpus KAG
```

Les assets du jeu ne sont jamais versionnés : `npm run check:assets` échoue si un fichier sous copyright est ajouté.
