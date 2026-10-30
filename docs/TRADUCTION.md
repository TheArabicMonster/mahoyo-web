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
        ├── index.json          ← index de la traduction (liste des scripts retenus, stricts, ignorés, ressources supplémentaires)
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
- **Scripts stricts** : scripts dont le squelette complet (texte et break inclus) est identique à l'original.
- **Scripts ignorés** : scripts incompatibles (pages ou labels différents, etc.).
- **Ressources absentes du manifest** : ressources supplémentaires référencées par la traduction et absentes du manifest d'assets.

Exemple avec le patch Moon-Trad (dernier run) :

```text
Scripts source : 205
Scripts originaux correspondants : 205
Scripts installés : 187
Scripts stricts : 20
Scripts ignorés : 18
Ressources absentes du manifest mais référencées par la traduction : 7451
```

## Vérification de compatibilité

Pour qu'un script traduit soit installé, il doit être **compatible** avec l'original :

1. Même nombre de pages.
2. Mêmes labels aux mêmes indices de page.
3. Même squelette de flux : instructions `jump`, `call`, `return`, `conditional`, `macrodef`, ainsi que les commandes `raw` qui pilotent le flux ou les choix (`s`, `link`, `endlink`, `button`, `select`, `waittrig`, `waitclick`, `cancelautomode`, `cancelskip`, `resetwait`).

Un script est **strict** si, en plus, la séquence complète d'instructions (texte et break inclus) est identique à l'original. Un script strict garantit que les sauts de page et les pauses sont conservés ; un script compatible peut avoir des différences de texte, de son, d'image, d'animation, d'attente ou de sauts de ligne.

Les scripts incompatibles sont ignorés avec une raison indiquant la nature exacte de l'écart (labels manquants/en trop, nombre de pages différent, etc.).

### Chiffres obtenus avec le patch Moon-Trad

- **Avant** (critère structurel strict) : 23 installés, 20 stricts, 182 ignorés.
- **Après** (squelette de flux) : 187 installés, 20 stricts, 18 ignorés.

### Kinds d'instructions qui diffèrent le plus souvent

Agrégation sur les 182 scripts initialement ignorés (critère structurel strict) :

| Kind | Scripts | Pages |
|---|---|---|
| sestop | 180 | 4557 |
| se | 180 | 4580 |
| fg | 30 | 510 |
| stopaction | 28 | 166 |
| clall | 27 | 392 |
| wait | 26 | 190 |
| bg | 25 | 480 |
| animate | 22 | 123 |
| partbg | 22 | 278 |
| waitfor | 20 | 57 |
| chgfg | 19 | 157 |
| trans | 17 | 87 |

`se` et `sestop` représentent la quasi-totalité des écarts : ils correspondent à des sons/effets ajoutés dans la version Steam (voix). Les autres kinds concernent des différences d'image, d'animation ou d'attente. Ces différences ne sont pas de flux et n'affectent pas le déroulement du script.

### Scripts encore ignorés

| Script | Raison |
|---|---|
| 1-0.ks | label en trop : vroum* |
| 1-4.ks | label en trop : page43 |
| 1.5-2.ks | label en trop : tap* |
| 1.5-3.ks | labels en trop : clac*.[l][r], tap |
| 2-2.ks | label en trop : bruits |
| 2-4.ks | labels manquants : page35–page53 ; label en trop : page54 |
| 3-1.ks | labels manquants : page1–page46 ; label en trop : page0 |
| 4-1.ks | labels manquants : page1–page60 ; label en trop : page0 |
| 4-3.ks | labels manquants : page1–page44 ; label en trop : page0 |
| 5a-5.ks | label en trop : allongement* |
| 5a-8.ks | labels manquants : page38–page42 |
| 6-1.ks | labels manquants : page1–page23 ; label en trop : page0 |
| 6-2.ks | label en trop : tap* |
| 8.5.ks | label en trop : page383 |
| c-1.ks | nombre de pages différent (64 vs 63) |
| sp1.ks | labels en trop : snif*, bruit |
| wik_b-1.ks | label en trop : page77 |
| wik_c-2.ks | label en trop : page76 |

## Ressources supplémentaires absentes du manifest

Le CLI compare, pour chaque script installé, les assets référencés par l'original et par la traduction. Les ressources absentes du manifest mais référencées uniquement par la traduction sont listées dans `index.json` sous `extraAssets` (clés `image:nom` ou `audio:nom`).

Avec le patch Moon-Trad : **7451 ressources supplémentaires** référencées et absentes du manifest.

Top 10 des ressources les plus fréquentes (par nombre de scripts) :

| Ressource | Scripts |
|---|---|
| image:ev0105青子あぐら_ソファのみ(曇) | 8 |
| image:im14l青子背中(制服) | 3 |
| image:ev青子汎用05私服a(オブジェ)a1 | 2 |
| image:草十郎制服コート01a(大) | 2 |
| image:草十郎制服コート01b(大) | 2 |
| image:草十郎制服コート02a(遠) | 2 |
| audio:a10_1_1_0000 | 1 |
| audio:a10_1_1_0001 | 1 |
| audio:a10_1_1_0002 | 1 |
| audio:a10_1_1_0003 | 1 |

> **Limite** : ces ressources sont typiquement des assets de la version Steam (voix, images). Le player les tolère comme manquantes ; si elles sont fournies par l'utilisateur, elles seront résolues normalement. Si elles sont absentes, le jeu continuera sans ces assets.

## Utilisation dans le player

1. Ouvrir les **Réglages** (bouton en jeu ou écran titre).
2. Choisir la langue **Français** dans le sélecteur.
3. La langue s'applique au prochain script chargé.

Le japonais est toujours disponible ; les langues traduites apparaissent uniquement si leur `lang/<lang>/index.json` est présent dans les assets.

## Tests

Le test d'intégration `tests/integration/translation.test.ts` vérifie que :

- l'index `lang/fr/index.json` est valide ;
- les scripts listés existent sur disque ;
- chaque script traduit s'exécute sans erreur bloquante via le runtime KAG ;
- l'index expose les ressources supplémentaires sans texte.

Il nécessite les vrais assets locaux (`MAHOYO_ASSETS_DIR` ou `public/assets`).

```bash
npm run test:integration -- tests/integration/translation.test.ts
```

## Dépannage

- **La langue française n'apparaît pas dans le sélecteur** : vérifiez que `lang/fr/index.json` est présent dans les assets et que le serveur web sert bien ce fichier.
- **Un script traduit n'est pas chargé** : consultez le rapport du CLI ; le script a peut-être été ignoré pour incompatibilité.
- **Le jeu plante après avoir changé de langue** : assurez-vous que les fichiers originaux sont toujours présents dans `scenario/` pour le fallback.
