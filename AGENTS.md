# Directives pour les agents IA

Ce fichier est lu par les agents (OpenCode, Claude Code, etc.) avant de travailler sur ce dépôt. Il définit le **contrat de travail** : contexte, conventions et garde-fous.

## 1. Ce qu'est ce projet

Port web du visual novel **Mahoutsukai no Yoru** (Mahoyo), inspiré de l'architecture de **tsukiweb-public**.

- **Ce qu'on construit** : un *player* web + un *pipeline de conversion d'assets*.
- **Ce qu'on ne fait pas** : redistribuer le jeu, ses assets, ou son texte original.
- **Cible technique** : la version PC **2012** de Mahoyo (moteur KiriKiri/KAG3, archives `.xp3`, images `.tlg`).

## 2. Règles non négociables

1. **Aucun asset sous copyright** (images `.tlg`/`.png`, sons `.ogg`, scripts `.ks`, polices) ne doit être commité. Seuls le code du player, les toolings, et des *placeholders* originaux sont versionnés.
2. **Une issue = une tâche.** Ne pas entamer un travail qui n'a pas d'issue associée (ou en créer une).
3. **Respecter la [Définition of Done](docs/DEFINITION_OF_DONE.md)** avant de marquer une issue ou une PR comme terminée.
4. Le **Kanban GitHub** (Project) est la source de vérité du statut. Mettre à jour la colonne de l'issue quand on la déplace (Backlog → À faire → En cours → En revue → Terminé).
5. **Langue : français** pour les docs, les issues et les commentaires de commit (le code peut être en anglais).

## 3. Où trouver l'information

| Besoin | Fichier |
|---|---|
| Progression visuelle | `docs/PROGRESS.md` |
| Découpage en épics/phases | `docs/ROADMAP.md` |
| Critères "terminé" | `docs/DEFINITION_OF_DONE.md` |
| Vue technique | `docs/ARCHITECTURE.md` |
| Analyse du HUD d'origine, écarts, backlog UI, flowchart | `docs/ANALYSE_HUD_ORIGINAL.md` |
| Design system (palette, typo, tokens, états) | `docs/DESIGN.md` |
| Suivi des tâches | Project GitHub (kanban) + issues |

## 4. Cycle de vie d'une tâche

1. **Créer l'issue** (template `epic`/`feat`/`bug`/`task`), la rattacher à un épic et une priorité (`p0`→`p3`).
2. **Lister les critères d'acceptation** dans l'issue (ce sont les `DoD` spécifiques).
3. **Travailler sur une branche** dédiée : `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.
4. **Ouvrir une PR** avec la checklist du `pull_request_template.md`.
5. **Ne merger qu'une fois la DoD remplie** (tests, doc, pas d'asset commité).

## 5. Conventions

### Commits
- Format : `type(scope): description` en français (ex. `feat(lexer): parsing des commandes @bg`).
- Types : `feat`, `fix`, `chore`, `docs`, `test`, `refactor`.

### Nommage
- Fichiers docs en `SCREAMING_SNAKE.md` sous `docs/`.
- Code en anglais (noms de fonctions/variables), commentaires libres.

### Structure du code
- Le moteur KAG est dans `src/kag/` (lexer, parser, runtime, types).
- Le rendu navigateur est dans `src/renderer/`.
- L'interface utilisateur est dans `src/ui/`.
- Les scripts d'extraction sont dans `tools/`.

## 6. Garde-fous techniques

- Le moteur doit **tolérer les commandes KAG inconnues** (no-op avec warning) pour ne pas planter sur le vrai script Mahoyo.
- Le pipeline d'assets doit **générer** les fichiers web à partir des fichiers de l'utilisateur, et ne jamais les embarquer.
- On privilégie **WebP** pour les images et **OGG/MP3** pour l'audio (compatibles web).
