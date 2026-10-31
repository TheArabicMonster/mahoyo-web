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
- **Pauses [l] vides retirées** : nombre de `[l]` neutralisés à l'installation (voir « Pauses vides »).
- **Ressources absentes du manifest** : ressources supplémentaires référencées par la traduction et absentes du manifest d'assets.

Exemple avec le patch Moon-Trad (dernier run) :

```text
Scripts source : 205
Scripts originaux correspondants : 205
Scripts installés : 204
Scripts stricts : 21
Scripts ignorés : 1
Pauses [l] vides retirées : 21 (dans 13 script(s))
Ressources absentes du manifest mais référencées par la traduction : 9028
```

## Vérification de compatibilité

Pour qu'un script traduit soit installé, il doit être **compatible** avec l'original :

1. Même nombre de pages.
2. Mêmes labels **visés par un saut ou un appel** (`@jump`/`@call target=`), aux mêmes indices de page. Un label en trop, ou un label non visé renommé (la traduction numérote parfois ses pages `page0`, `page1`… au lieu de `page1`, `page2`…), est signalé dans le rapport mais **n'empêche pas l'installation** : il ne peut casser aucun saut.
3. Même squelette de flux : instructions `jump`, `call`, `return`, `conditional`, `macrodef`, ainsi que les commandes `raw` qui pilotent le flux ou les choix (`s`, `link`, `endlink`, `button`, `select`, `waittrig`, `waitclick`, `cancelautomode`, `cancelskip`, `resetwait`).

Un script est **strict** si, en plus, la séquence complète d'instructions (texte et break inclus) est identique à l'original. Un script strict garantit que les sauts de page et les pauses sont conservés ; un script compatible peut avoir des différences de texte, de son, d'image, d'animation, d'attente ou de sauts de ligne.

Les scripts incompatibles sont ignorés avec une raison indiquant la nature exacte de l'écart (label visé par un saut manquant ou déplacé, nombre de pages différent, etc.).

### Chiffres obtenus avec le patch Moon-Trad

- **Avant** (critère structurel strict) : 23 installés, 20 stricts, 182 ignorés.
- **Après** (squelette de flux) : 187 installés, 20 stricts, 18 ignorés.
- **Après** (labels bloquants limités à ceux que vise un saut) : **204 installés, 21 stricts, 1 ignoré**.

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

### Script encore ignoré

| Script | Raison |
|---|---|
| c-1.ks | nombre de pages différent (64 vs 63) : la traduction a une page de plus |

Les 6 scripts écartés par la règle précédente (`2-4`, `3-1`, `4-1`, `4-3`, `5a-8`, `6-1`) ont le même nombre de pages que l'original ; leurs labels `pageN` sont numérotés autrement et aucun saut ne les vise (le seul saut de chacun va vers `*tladata`, présent des deux côtés). Ils sont donc installés.

## Pauses vides (`[l]` sans texte)

La traduction regroupe parfois le texte de plusieurs lignes japonaises sur la première et laisse les suivantes vides, avec leur `[l]` : le joueur devait alors cliquer sur une boîte de texte sans rien lire (issue #141, suite du B8 de `docs/BUGS_PROLOGUE.md`). Le runtime ignore déjà les `[l]` où rien n'est affiché depuis le dernier clic (#136), mais pas ceux qui suivent une image ou une animation.

À l'installation, `neutralizeEmptyPauses` (dans `tools/translation-lib.ts`, jamais dans le runtime) compare, page par page, les pauses `[l]` de l'original et de la traduction :

1. Pour chaque pause, on note si du texte lisible la précède depuis le clic précédent.
2. Les deux suites sont alignées (plus longue sous-suite commune). Une pause **vide** de la traduction sans pause correspondante dans l'original est un clic sans texte en trop.
3. Seul ce `[l]` (ou la ligne `@l`) est retiré. Le texte traduit, les autres commandes et les sauts de ligne ne sont ni modifiés ni lus : le script installé ne diffère de la source que par ces `[l]`.

Les pauses vides que l'original a aussi (attente volontaire) sont conservées. Par prudence, un bloc `@if`/`@macro` ou l'appel d'une macro compte comme du texte possible, et si l'original et la traduction n'ont pas le même nombre de pages au niveau des tokens, rien n'est modifié. Le niveau de compatibilité (strict ou compatible) n'est pas affecté.

Avec le patch Moon-Trad : 21 `[l]` retirés dans 13 scripts. Sur la trace du runtime, les 12 clics sans texte restants (`5a-11`, `5a-12`, `5b-14`, `wik_chap4start`, `wik_f-a`, `wik_g-a`, `wik_q-a`) disparaissent : aucun script français n'a plus de clics sans texte que le japonais.

## Ressources supplémentaires absentes du manifest

Le CLI compare, pour chaque script installé, les assets référencés par l'original et par la traduction. Les ressources absentes du manifest mais référencées uniquement par la traduction sont listées dans `index.json` sous `extraAssets` (clés `image:nom` ou `audio:nom`).

Avec le patch Moon-Trad : **9028 références à des ressources supplémentaires**, absentes du manifest.

Top 10 des ressources les plus fréquentes (par nombre de scripts) :

| Ressource | Scripts |
|---|---|
| image:ev0105青子あぐら_ソファのみ(曇) | 8 |
| image:im14l青子背中(制服) | 3 |
| image:ev青子汎用05私服a(オブジェ)a1 | 2 |
| image:草十郎制服コート01b(大) | 2 |
| image:草十郎制服コート01a(大) | 2 |
| image:草十郎制服コート02a(遠) | 2 |
| audio:f60_1_0_0001 | 1 |
| audio:f70_1_0_0001 | 1 |
| audio:a11_1_0_0000 | 1 |
| audio:f70_1_0_0002 | 1 |

### Mesure des références absentes (japonais et français)

Mesure du 2026-10-31 : lecture complète des 221 scripts narratifs par le runtime (trace jetable hors dépôt, noms d'assets seulement), puis comparaison au manifest avec la même normalisation que le player. Une « référence » est un asset distinct absent du manifest ; les variantes `nom|x` sont regroupées sous leur nom de base.

| Version | Assets distincts absents | Images | Sons | Scripts concernés |
|---|---|---|---|---|
| Japonais (original) | 16 | 15 | 1 | 30 / 221 |
| Français (Moon-Trad) | 9 030 | 60 | 8 970 | 181 (sons), 49 (images) |

Les 16 absents du japonais sont aussi absents en français : la traduction en ajoute **9 014** (8 969 sons, 45 images).

Répartition des absents en français, par type et préfixe de nom (préfixes seulement) :

| Type | Préfixe | Nombre | Remarque |
|---|---|---|---|
| Son | `a10`, `a20`, `a30`, `a40`, `a50` | 6 371 | voix (nommage `xNN_n_n_NNNN`) |
| Son | `b10` à `b90` (et `ba0`) | 2 324 | voix |
| Son | `c20` à `c50`, `d30`, `e20`, `f60`, `g`, `h`, `x` | 275 | voix |
| Image | `青子…` | 23 | sprites et évènements d'Aoko |
| Image | `草十…` | 13 | sprites de Sôjûrô |
| Image | `im04` à `im15`, `ev…`, `bg01`, `有珠…`, `鳶丸…`, `オブ…` | 24 | images d'évènement et sprites divers |

Les sons absents suivent quasiment tous le même nommage de voix (identifiant de personnage et de scène suivi d'un numéro à 4 chiffres), à l'exception d'une BGM aussi absente en japonais : ce sont les voix de la version Steam, absentes du jeu de départ.

### Comportement du player

Le player tolère ces absents sans bruit : le resolver (`src/core/asset-resolver.ts`) émet **un seul `console.warn` par asset** absent du manifest (clé `image:` ou `audio:` dédoublonnée), même si l'asset est résolu à chaque étape, rejoué, ou signalé par le lecteur audio / le préchargement d'images. Les couleurs unies et les noms vides ne produisent aucun avertissement. L'URL de repli par convention reste utilisée au cas où le fichier existerait hors manifest ; le navigateur peut donc journaliser lui-même un 404 pour cette URL, ce que le code ne contrôle pas. Sans manifest (mode convention), aucun avertissement n'est émis.

> **Limite** : ces ressources sont typiquement des assets de la version Steam (voix, images). Le player les tolère comme manquantes ; si elles sont fournies par l'utilisateur, elles seront résolues normalement. Si elles sont absentes, le jeu continuera sans ces assets.

## Installation par défaut

`npm run pipeline` installe la traduction française à la fin de la conversion (téléchargement depuis le dépôt public Moon-Trad vers `<sortie>/lang/fr/`). Un échec réseau n'est qu'un avertissement ; `--no-translation` désactive l'étape. Le texte traduit n'est jamais versionné : il reste un fichier local, comme le jeu.

## Utilisation dans le player

1. Ouvrir les **Réglages** (bouton en jeu ou écran titre).
2. Choisir la langue **Français** dans le sélecteur.
3. La langue s'applique au prochain script chargé.

Le **français est la langue par défaut** : dès qu'une traduction est installée, une première partie démarre en français. Sans traduction installée, le player retombe sur le japonais. Un choix déjà enregistré dans les réglages (par exemple `ja`) est conservé.

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
