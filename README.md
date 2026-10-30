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
