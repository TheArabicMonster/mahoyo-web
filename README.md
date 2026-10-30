# Mahoyo Web

> Port web du visual novel **Mahoutsukai no Yoru** (*Witch on the Holy Night*, TYPE-MOON), inspiré de l'architecture de [tsukiweb-public](https://github.com/requinDr/tsukiweb-public).

Ce dépôt contient le **projet réel** : un player web moderne et maintenable pour lire Mahoyo dans un navigateur, en partant des fichiers du jeu original possédés par l'utilisateur.

## Statut

Voir [`docs/PROGRESS.md`](docs/PROGRESS.md) pour la barre de progression détaillée.

**Phase actuelle : E7 — Projet réel** 🔄 en cours. Le socle Vite + TypeScript + Vitest est en place, le moteur KAG3 et les tests du PoC ont été portés, le build et les tests passent.

## Langues

- **Japonais** : langue originale, toujours disponible.
- **Français** : support du patch fan Moon-Trad, installable via `npm run translation`. Voir [`docs/TRADUCTION.md`](docs/TRADUCTION.md).

## ⚠️ Avertissement légal

**Aucun asset original du jeu (images, sons, scripts, polices) n'est stocké ni redistribué dans ce dépôt.** Ce projet est un *player* + un *outillage de conversion* : l'utilisateur doit fournir ses propres fichiers, issus d'une copie qu'il possède. Ne commitez jamais d'asset sous copyright.

## Liens

- [Progression](docs/PROGRESS.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Définition of Done](docs/DEFINITION_OF_DONE.md)
- [Directives agents IA](AGENTS.md)

## Démarrage rapide

```bash
git clone git@github.com:TheArabicMonster/mahoyo-web.git
cd mahoyo-web
npm install

# Lancer les tests
npm test

# Lancer le player web en dev
npm run dev

# Build de production
npm run build
npm run preview
```

## Jouer

Le dépôt ne contient aucun asset du jeu : il faut posséder une copie du jeu et en générer les fichiers web.

1. **Convertir les assets** du jeu (images, sons, scripts) vers `public/assets/` : voir [`docs/PIPELINE.md`](docs/PIPELINE.md) (`npm run pipeline`). Ce dossier est ignoré par git.
2. **Générer les deux tables** à partir des fichiers du jeu. Elles ne sont pas produites par `npm run pipeline` :

   ```bash
   # main.gc se trouve dans data.xp3 (dossier others/) une fois l'archive extraite
   npm run chain -- <chemin/main.gc> public/assets   # ordre des scripts, chapitres, choix
   npm run timelines -- public/assets                # musique et images de l'ouverture
   ```

   Sans `story-chain.json`, le jeu ne propose que le prologue et s'arrête à la fin du script ; sans
   `timelines.json`, l'ouverture est sautée. Voir [`docs/ENCHAINEMENT_SCRIPTS.md`](docs/ENCHAINEMENT_SCRIPTS.md)
   et [`docs/TIMELINES.md`](docs/TIMELINES.md).
3. **Lancer** : `npm run dev`, puis ouvrir l'adresse affichée. L'écran titre propose *Nouvelle partie*,
   *Continuer* (autosave), *Charger*, *Réglages* et la liste des chapitres.

> `npm run build` copie `public/assets/` dans `dist/` (environ **7 Go** avec le jeu complet). Pour jouer
> en local, `npm run dev` suffit.

### Commandes

| Touche | Action |
|---|---|
| Clic, Espace, Entrée | Avancer |
| Ctrl (maintenu) ou `S` | Passer le texte (le texte déjà lu ; le non lu se règle dans *Réglages*) |
| `A` | Lecture automatique |
| `1`…`9` | Choisir une option |
| `F` | Plein écran |
| Échap | Pause : sauvegarder, charger, réglages, historique, retour au titre |
| Bouton ↶ | Retour arrière |

Les sauvegardes sont conservées dans le navigateur (`localStorage`) ; l'autosave alimente *Continuer*.

### Limites connues

- L'ouverture est un diaporama (images, musique, pluie) **toujours sautable** : ses panoramiques, calques et effets ne sont pas rendus.
- Les bulles des scripts « omake » (`@ploysay`) sont positionnées mais pas dessinées.
- Un chapitre choisi à l'écran titre démarre avec un **état vide** : les variables que le jeu posait en entrant dans un chapitre ne sont pas reprises.
- Une quinzaine d'images de personnages sont introuvables dans les assets convertis (voir l'issue #110).
- Le jeu a été essayé dans un navigateur Chromium ; Firefox et le mobile ne sont pas testés (v1.1).

## Architecture

```
src/kag/              Moteur KAG3 (indépendant du DOM)
  lexer.ts            Tokenisation des scripts .ks
  parser.ts           Tokens → pages avec instructions
  runtime.ts          Machine à états fore/back + pile d'appels + save/load
  types.ts            Types partagés

src/renderer/         Rendu navigateur
  audio-manager.ts    Gestion BGM/SE
  types.ts            Interface Renderer + RenderEvent

src/ui/               Interface utilisateur
  player.ts           Player principal

src/core/             Utilitaires partagés
  asset-resolver.ts   Résolution des URLs d'assets
```
