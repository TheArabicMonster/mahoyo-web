# Agent C — Questions et hypothèses

Points non couverts par les contrats ; hypothèse la plus simple retenue.

1. **Continuer (title)** : `hasContinue` → `commands.load("auto")`. Le contrat n'indique pas quel slot reprendre.
2. **Voix du backlog** : `PlayerCommands` n'a pas de commande pour rejouer une voix. `BacklogEntry.voice` est exposé en `data-voice` sans action. Il faudrait une commande `playVoice(ref)`.
3. **Flowchart** : `ScriptSummary` ne contient pas de liens entre chapitres, donc pas d'arêtes tracées, uniquement des nœuds positionnés (x/y sur 1280×720). Un nœud est cliquable s'il est `unlocked` ou `completed`.
4. **Écrans overlay vs `closeScreen`** : Échap sur `title` ne fait rien ; sur tout autre écran non-jeu → `closeScreen()`. C'est au Player de rappeler `show()` avec l'écran précédent.
5. **Sauvegarde/suppression** : confirmation gérée par l'UI (`confirm`) avant écrasement/suppression ; « Retour au titre » demande aussi confirmation.
6. **Settings** : `Partial<GameSettings>` étant superficiel, l'UI renvoie le groupe `display` ou `audio` complet à chaque changement.
7. **Ctrl-skip** : à l'appui, `setMode("skip")` ; au relâchement, retour au mode précédent si le mode courant est encore `skip`.
8. **Choix** : touches 1–9 sélectionnent un choix (ajout non demandé). Clic/Espace/molette n'avancent pas tant que des choix sont affichés.
9. **Layout** : `init(root)` crée (ou réutilise) `#ui-overlay` sous `root` ; le clic de lecture est capté par l'overlay (qui recouvre `#textbox`).
10. **CSS** : `ui-manager.css` est importé depuis `ui-manager.ts` (aucun fichier interdit modifié).
