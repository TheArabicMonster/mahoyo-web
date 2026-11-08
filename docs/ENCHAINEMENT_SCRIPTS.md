# Enchaînement des scripts

Comment le player passe d'un script au suivant (chapitres, interludes, choix).

## Principe

Les scripts narratifs (`1-0.ks`, `2-3.ks`…) se terminent par `@return` : ils ne
désignent pas leur successeur. Dans le jeu d'origine, un plugin (« tracer »)
les appelle l'un après l'autre en suivant un graphe stocké dans `main.gc`.

Le projet reproduit cela en deux temps :

1. **Génération** : un outil lit `main.gc` et écrit `story-chain.json` dans le dossier d'assets.
2. **Lecture** : à la fin d'un script, le player consulte cette table, charge le suivant
   dans le même runtime (variables et calques conservés) et affiche un menu quand la
   suite est un choix.

Sans `story-chain.json`, le player garde l'ancien comportement : retour au titre en fin de script.

## Générer la table

```bash
npm run chain -- <chemin/main.gc> <dossier d'assets>
# exemple
npm run chain -- ~/jeu/extrait/data/others/main.gc public/assets
```

`main.gc` se trouve dans `data.xp3` (dossier `others/`) une fois l'archive extraite.
Le pipeline actuel **ignore** `data/others` (`tools/inventory.ts`) : l'outil se lance donc
à part pour l'instant.

`story-chain.json` dérive des fichiers de l'utilisateur (comme le manifest) et **contient les libellés
de choix du jeu** : il ne doit jamais être commité. Le `.gitignore` l'exclut par son nom, où qu'il soit
généré (`npm run chain` accepte n'importe quel dossier de sortie).

## Format

```json
{
  "version": 1,
  "first": "1-0.ks",
  "next": {
    "1-0.ks": [{ "to": "1-1.ks" }],
    "1-5.ks": [{ "to": "teatime.ks", "then": ["2-1.ks"] }],
    "wik_robby.ks": [
      { "to": "wik_b-1.ks", "choice": "libellé de l'option" },
      { "to": "wik_b-2.ks", "choice": "libellé de l'option" }
    ],
    "wik_b-1-b.ks": [
      { "to": "wik_room.ks", "condition": "room>0" },
      { "to": "wik_noroom.ks" }
    ]
  }
}
```

- `to` : script suivant.
- `then` : scripts joués ensuite, dans l'ordre, avant de reconsulter la table. La file restante est
  enregistrée avec chaque point d'historique et chaque sauvegarde : retour arrière et chargement
  pendant un interlude reprennent au bon endroit. Sert aux
  **interludes partagés** : `teatime.ks` (le goûter) apparaît dans 13 blocs du graphe,
  chacun suivi d'un chapitre différent ; la suite dépend donc du chapitre qui précède.
- `condition` : expression TJS évaluée par le runtime ; une route conditionnelle vraie
  l'emporte sur les routes sans condition.
- `choice` : libellé d'une option proposée au joueur quand plusieurs suites sont possibles.

## Chapitres et écran titre

`story-chain.json` contient aussi `chapters` : une entrée par page du graphe d'origine (une page = un
chapitre), avec le titre de la page et son script d'entrée. L'écran titre l'affiche en grille, sous
« Nouvelle partie », « Continuer » (autosave), « Charger », « Réglages » et « Flowchart ».

- Le script d'entrée d'une page est celui qu'aucun script de la même page ne précède ; les interludes
  partagés (`teatime.ks`) et les blocs sans script ne comptent pas comme prédécesseurs. Le chapitre 2
  commence donc à `2-1.ks`, pas au goûter qui le précède.
- Une page à plusieurs entrées (bonus : `1.5-*`, `7-ex`, `8-ex`, `8.5`, `nz*`, `sp*`) en donne plusieurs : celle
  que précède un interlude est l'entrée de l'histoire et passe en premier, les autres portent le nom de leur script.
- Une page à plus de 5 entrées (la page des scripts `wik_*`) est un graphe d'embranchements, pas un chapitre
  linéaire : seule sa première entrée est gardée.
- Sans `chapters` (table générée avant leur ajout), le jeu se limite à son prologue : relancer `npm run chain`.
- Choisir un chapitre lance son script d'entrée **avec un état initial vide** ; l'enchaînement reprend ensuite
  normalement. Les variables que le jeu d'origine posait en entrant dans un chapitre (`operate`) ne sont pas appliquées.

## Règle de choix de la suite

`resolveNext` (`src/core/story-chain.ts`) :

1. **toutes les routes libellées : c'est un menu.** Une condition y sert à afficher ou masquer une
   option (fausse = masquée). Deux options ou plus : menu, même si elles mènent au même script ;
   une seule : on l'enchaîne ;
2. sinon, une route conditionnelle vraie l'emporte ; sans condition vraie, on garde les routes sans condition ;
3. une seule suite après dédoublonnage : on l'enchaîne ; plusieurs sans libellé : la première du graphe.

Quand une route et le bloc qui la suit portent chacun une condition, elles sont combinées en ET.

## Graphe de scénario (`story-graph.json`)

`npm run chain` écrit aussi, à côté de `story-chain.json`, un **graphe typé** pour le flowchart
(`docs/ANALYSE_HUD_ORIGINAL.md` §7). Même commande, même dossier de sortie :

```bash
npm run chain -- <chemin/main.gc> <dossier d'assets>
```

`story-graph.json` dérive de la table et des fichiers de l'utilisateur ; il **contient les libellés de choix**
et des noms d'images du jeu : il est ignoré par git (`.gitignore`, par son nom) et ne doit jamais être commité.
Les vignettes sont lues dans `<dossier d'assets>/scenario/*.ks` s'il existe (sinon `thumb` est simplement absent).
Les types sont dans `src/core/story-graph.ts`, la construction (pure) dans `tools/story-graph-lib.ts`.

```json
{
  "version": 1,
  "first": "1-0",
  "nodes": [
    { "id": "1-5", "file": "1-5.ks", "kind": "normal", "chapter": "1-0", "arc": "第1章", "thumb": "nom-du-fond" },
    { "id": "teatime", "file": "teatime.ks", "kind": "interlude" }
  ],
  "edges": [
    { "from": "wik_robby", "to": "wik_b-1", "kind": "choice", "choice": "libellé de l'option" },
    { "from": "wik_b-1-b", "to": "wik_room", "kind": "conditional", "condition": "room>0" },
    { "from": "1-5", "to": "teatime", "kind": "normal" },
    { "from": "teatime", "to": "2-1", "kind": "normal" }
  ]
}
```

**Nœuds** (un par script cité par la table, dans l'ordre du graphe d'origine) :

- `id` : nom du script sans `.ks`, en minuscules (clé stable ; les arêtes y renvoient) ; `file` : nom du fichier.
- `kind` (priorité `interlude`, puis `choice`, puis `end`) :
  - `interlude` : script cité par la table mais sans entrée propre dans `next` (la table n'en donne pas aux scripts
    partagés par plusieurs blocs, comme `teatime.ks`) ; un seul nœud, plusieurs arêtes entrantes ;
  - `choice` : toutes les sorties du script sont des options libellées (même règle que `resolveNext`) ;
  - `end` : aucune arête sortante ;
  - `normal` : tout le reste.
- `arc` : titre de la page du graphe d'origine qui porte le script ; `chapter` : `id` du chapitre principal de cette
  page (une entrée de `story-chain.json.chapters`, qui fournit le titre à afficher). Ces deux champs sont **absents**
  d'un script présent sur plusieurs pages (le goûter) ; `chapter` est aussi absent d'une page sans chapitre.
- `thumb` : **nom** (sans extension) du premier `@bg storage=…` du script qui n'est pas un aplat de couleur (`black`,
  `white`, `red`, `gray`). Une clé seulement, jamais l'image. Absent si le script n'en pose pas.

**Arêtes** (`from`/`to` = `id` de nœud, dédoublonnées, ordre déterministe) :

- `kind: "choice"` : option libellée (`choice`), avec sa `condition` d'affichage éventuelle ;
- `kind: "conditional"` : suite prise si `condition` est vraie ;
- `kind: "normal"` : suite inconditionnelle.
- Un `then` de la table est déroulé : `a -> to`, puis `to -> then[0]`, `then[0] -> then[1]`… (arêtes `normal`) ; le
  libellé et la condition restent sur la première. L'interlude `teatime` a donc une arête entrante par chapitre qui le
  précède et une arête sortante par chapitre qui le suit : **le graphe seul ne dit pas quelle sortie va avec quelle
  entrée** (la table, via `then`, le dit).

Le résultat est **déterministe** : il ne dépend que de l'ordre de la table.

## Résultat sur le corpus de référence

194 blocs dont 161 avec script, 200 scripts dans la table dont 19 avec plusieurs suites,
4 interludes partagés. En suivant la première route depuis `1-0.ks`, l'histoire s'enchaîne
sur **134 scripts jusqu'à `d-9.ks`**, interludes compris.

Le graphe de scénario compte **205 nœuds** (les 200 scripts de la table, plus 5 scripts cités sans entrée propre),
**243 arêtes**, dont :

- **24** nœuds à choix et **72** arêtes libellées ;
- **2** arêtes portant une condition ;
- **5** interludes : `teatime.ks`, `wik_l-1.ks`, `wik_n-1.ks`, `wik_n-1-a.ks` et `wik_wxyz.ks` (les 4 scripts partagés
  de `main.gc` en comptent un, `wik_v-2.ks`, que la table ne cite pas, mais pas `wik_l-1`/`wik_n-1`, dont le bloc
  contient un script partagé) ;
- **21** nœuds sans successeur (`end`), dont **9** bonus isolés (`1.5-*`, `7-ex`, `8-ex`, `8.5`, `sp1`, `sp2`, sans
  arête entrante ni sortante) et **1** seul atteignable depuis `1-0.ks` (`d-9.ks`) ; les autres sont des culs-de-sac
  des branches `wik_*` et des bonus `nz*`.

## Test

`tests/integration/story-play.test.ts` joue cette suite de scripts avec le vrai moteur et
vérifie l'absence d'erreur et de boucle. Il demande les assets locaux
(`MAHOYO_ASSETS_DIR`) et la table ; sinon il est ignoré :

```bash
npm run chain -- <main.gc> "$MAHOYO_ASSETS_DIR"
MAHOYO_ASSETS_DIR=/chemin/assets npx vitest run tests/integration/story-play.test.ts
```

Le graphe de scénario est couvert par `tests/unit/tools/story-graph.test.ts` (table et `main.gc` factices originaux :
choix, interlude partagé, arête conditionnelle, fin, déterminisme) et, sur les vrais assets locaux, par
`tests/integration/story-graph.test.ts` (24 scripts à choix, 72 arêtes libellées, 2 conditionnelles ; ignoré sans
`MAHOYO_ASSETS_DIR` ni `story-chain.json`).

## Limites connues

- **`operate` non repris** : chaque bloc du graphe pose des variables à l'entrée (par
  exemple `chapter=2`, ou des indicateurs de déblocage des bonus). La table ne les
  applique pas ; seuls l'ordre des scripts et les choix sont reproduits.
- **Les conditions** (`room>0`, `Ｚ>0`…) portent sur des variables posées par `operate`, qui n'est
  pas repris : elles valent faux et produisent un avertissement « eval failed ».
- **État initial d'un chapitre choisi à l'écran titre** : vide (voir ci-dessus).
- **Branches `wik_*`** : leurs options sont proposées par un menu, mais le comportement des
  variables qu'elles posent n'a pas été vérifié.
