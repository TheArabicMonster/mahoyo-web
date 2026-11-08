# Sauvegardes : IndexedDB, migration, export/import

Issue #198 (WEB-03). 120 emplacements avec vignette en data-URL dépassent le quota d'environ 5 Mo de `localStorage` (voir `ANALYSE_HUD_ORIGINAL.md` §2.3, écart E29) : les sauvegardes vivent dans IndexedDB.

## Stockage

| Priorité | Stockage | Quand |
|---|---|---|
| 1 | IndexedDB, base `mahoyo-saves` | cas normal |
| 2 | `localStorage`, clés `mahoyo.save.<slot>` | IndexedDB absente, refusée, bloquée ou sans réponse en 4 s (navigation privée) |
| 3 | Mémoire (perdue au rechargement) | aucun stockage accessible (un avertissement est écrit dans la console) |

`createSaveStore()` (`src/player/save-store-idb.ts`) choisit au premier accès et ne lève aucune exception à cause de l'indisponibilité du stockage. `await store.backend()` indique le stockage retenu. Les réglages (`mahoyo.settings`, `mahoyo.read`, `mahoyo.progress`, `mahoyo.story-progress`) restent dans `localStorage`, inchangés.

Dans IndexedDB, deux object stores indexés par emplacement (`"auto"`, `"quick"`, `"3"`) : `saves` (l'enregistrement sans vignette) et `thumbnails` (la data-URL). Écriture, suppression et mise à jour sont atomiques sur les deux stores, et le verrou est vérifié dans la même transaction (`SaveLockedError`). Un dépassement de quota annule la transaction : l'ancien contenu reste intact et l'appelant reçoit une erreur (le player affiche « Échec de la sauvegarde »).

## Migration depuis localStorage

À l'ouverture d'IndexedDB, chaque clé `mahoyo.save.<slot>` est :

1. lue, passée par `migrateSaveRecord` (titre de scène, commentaire, verrou et choix complétés) ;
2. écrite dans IndexedDB, puis **relue et comparée** à ce qui devait être écrit ;
3. retirée du `localStorage` **seulement si** la comparaison est exacte.

Garanties : sans perte (toute clé non vérifiée reste en place), idempotente (relancée après une interruption, elle ne crée ni doublon ni perte), jamais d'écrasement (si IndexedDB contient déjà une autre sauvegarde pour l'emplacement, elle est plus récente : l'ancienne clé est conservée), clés illisibles laissées en place. `await store.migration()` renvoie le bilan (`migrated`, `alreadyPresent`, `kept`, `unreadable`).

## Export / import JSON

Équivalent des fichiers `.dat` du jeu d'origine. Format (`format: "mahoyo-saves"`, `version: 1`) :

```json
{ "format": "mahoyo-saves", "version": 1, "exportedAt": "…", "saves": [ { "slot": 1, "record": { … } } ], "storyProgress": { "visited": [], "finished": [], "choices": [], "endings": [] } }
```

Les enregistrements gardent `locked`, `comment`, `sceneTitle`, `choices` et la vignette. Le fichier contient des données de l'utilisateur : il ne doit jamais être commité.

Règles d'import (décisions documentées) :

- **Un emplacement verrouillé n'est jamais écrasé** : il est conservé et rapporté (`skippedLocked`). Les emplacements non verrouillés sont écrasés (`overwritten` les liste). Pour importer sur un emplacement verrouillé, le déverrouiller d'abord.
- Un emplacement importé avec `locked: true` reste verrouillé.
- La progression du flowchart est **fusionnée** (union avec `mergeStoryProgress`), jamais remplacée.
- Une entrée invalide (emplacement hors `auto`/`quick`/entier positif, enregistrement sans script, position, runtime, audio, arrêt ou scène) est ignorée et comptée (`invalid`).
- Une vignette qui n'est pas une data-URL `png`/`jpeg`/`webp` est retirée : un fichier importé ne peut pas faire charger une URL externe.
- Les métadonnées manquantes sont complétées par `migrateSaveRecord`.

Le rapport (`ImportReport`) contient `imported`, `overwritten`, `skippedLocked`, `failed` (écriture impossible, quota), `invalid` et `progressMerged`.

## Utilisation

En attendant les boutons de l'écran de sauvegarde (#196), `src/main.ts` expose dans la console du navigateur :

```js
await mahoyoSaves.export(); // télécharge mahoyo-saves-AAAA-MM-JJ.json
await mahoyoSaves.import(); // ouvre le sélecteur de fichier, renvoie le message récapitulatif
await mahoyoSaves.backend(); // "indexeddb" | "localstorage" | "memory"
```

Après un import, recharger la page : le suivi de progression du player garde sa copie en mémoire et pourrait sinon réécrire une progression sans l'import. Les écrans appelleront `downloadSaveExport`, `pickSaveFile` et `importSaveFile` (`src/ui/save-transfer.ts`) ; les messages passent par le dictionnaire (`saveTransfer.*`).

## Tests

`tests/unit/player/save-store-idb.test.ts` (IndexedDB factice `fake-indexeddb`, migration, quota, repli), `save-transfer.test.ts` (aller-retour, verrou, entrées invalides), `save-store.test.ts` (contrat commun aux quatre magasins), `tests/unit/ui/save-transfer.test.ts`.
