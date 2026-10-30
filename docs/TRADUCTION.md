# Traduction française

Ce document décrit le support de la traduction fan de *Mahoutsukai no Yoru* dans le player web.

> ⚠️ **Aucun texte de traduction n'est versionné dans ce dépôt.** Seuls le code et les outils le sont. Les fichiers traduits sont générés localement à partir du patch du traducteur, fourni par l'utilisateur.

## Traduction supportée

- **Patch** : Moon-Trad
- **Langue** : français
- **Dépôt public** : <https://github.com/IDerr/mahoyo-french>
- **Crédits** : traduction Naoyrig, relecture Naoyrig et Caster, technique IDerr, portage Steam RequinDr et loicfr.

## Principe

Le player peut remplacer les scripts japonais originaux par les scripts traduits lorsqu'une langue autre que le japonais est sélectionnée. Si un script n'a pas de traduction pour la langue choisie, le player charge automatiquement le script original (fallback).

Le changement de langue s'applique au prochain script chargé. Si le joueur change de langue en cours de partie, un toast l'informe que la nouvelle langue sera effective au chapitre suivant.

## Fichiers générés

Après installation, les fichiers suivants sont créés dans le dossier d'assets (ex. `public/assets`) :

```text
public/assets/
└── lang/
    └── fr/
        ├── index.json          ← index de la traduction (liste des scripts retenus)
        └── scenario/
            └── *.ks            ← scripts traduits installés
```

Le dossier `lang/` est ignoré par git : il ne doit pas être commité.

## Installation

### Depuis le dépôt Moon-Trad (recommandé)

Avec `--fetch`, le CLI télécharge automatiquement les scripts depuis le dépôt public et les installe dans les assets :

```bash
npm run translation -- fr /tmp/mahoyo-french --fetch
```

Le dossier `/tmp/mahoyo-french` sera créé et rempli avec les scripts source, puis la traduction sera installée dans `public/assets/lang/fr/`.

### Depuis une copie locale du patch

Si vous possédez déjà les scripts traduits localement :

```bash
npm run translation -- fr /chemin/vers/Texte/Complete public/assets
```

Le second argument est le dossier d'assets cible (défaut : `public/assets`, ou `MAHOYO_ASSETS_DIR` si défini).

### Sortie du CLI

Le rapport final indique :

- **Scripts source** : nombre de scripts `.ks` trouvés dans le dossier source.
- **Scripts originaux correspondants** : scripts dont l'original existe dans le corpus Mahoyo.
- **Scripts installés** : scripts retenus après vérification de compatibilité.
- **Scripts stricts** : scripts dont le squelette complet (texte inclus) est identique à l'original.
- **Scripts ignorés** : scripts incompatibles (pages ou labels différents, etc.).

Exemple :

```text
Scripts source : 205
Scripts originaux correspondants : 205
Scripts installés : 23
Scripts stricts : 20
Scripts ignorés : 182
```

## Vérification de compatibilité

Pour qu'un script traduit soit installé, il doit être **compatible** avec l'original :

1. Même nombre de pages.
2. Même labels aux mêmes indices de page.
3. Même squelette structurel (commandes hors texte/break).

Un script est **strict** si, en plus, la séquence complète d'instructions (texte et break inclus) est identique à l'original. Un script strict garantit que les sauts de page et les pauses sont conservés ; un script compatible peut avoir un découpage texte/break différent tout en gardant une structure jouable.

Les scripts incompatibles sont ignorés avec une raison (nombre de pages différent, label absent, etc.).

## Utilisation dans le player

1. Ouvrir les **Réglages** (bouton en jeu ou écran titre).
2. Choisir la langue **Français** dans le sélecteur.
3. La langue s'applique au prochain script chargé.

Le japonais est toujours disponible ; les langues traduites apparaissent uniquement si leur `lang/<lang>/index.json` est présent dans les assets.

## Tests

Le test d'intégration `tests/integration/translation.test.ts` vérifie que :

- l'index `lang/fr/index.json` est valide ;
- les scripts listés existent sur disque ;
- chaque script traduit s'exécute sans erreur bloquante via le runtime KAG.

Il nécessite les vrais assets locaux (`MAHOYO_ASSETS_DIR` ou `public/assets`).

```bash
npm run test:integration -- tests/integration/translation.test.ts
```

## Dépannage

- **La langue française n'apparaît pas dans le sélecteur** : vérifiez que `lang/fr/index.json` est présent dans les assets et que le serveur web sert bien ce fichier.
- **Un script traduit n'est pas chargé** : consultez le rapport du CLI ; le script a peut-être été ignoré pour incompatibilité.
- **Le jeu plante après avoir changé de langue** : assurez-vous que les fichiers originaux sont toujours présents dans `scenario/` pour le fallback.
