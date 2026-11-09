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

## Mise en page du flowchart (`layoutFlowchart`)

`layoutFlowchart(graph, options?)` (`src/core/flow-layout.ts`, types dans `src/core/flow-graph.ts`) est une fonction
**pure** (sans DOM) qui place **tout** le graphe, quelle que soit la progression du joueur : les positions sont stables,
l'anti-spoiler (réglage `flowchartRevealAll`) se joue dans le rendu. `parseStoryGraph` valide le JSON avant usage.

**Sortie** (`FlowLayout`, sérialisable, sans texte du jeu : le libellé et la condition d'une arête restent dans le
graphe, retrouvés par `FlowEdgeLayout.index`) :

- `nodes[]` : `x`, `y`, `width`, `height`, `level`, `groupId`, `section`, `hub`, `ending` ;
- `edges[]` : `points` (polyligne orthogonale de `from` vers `to`, la flèche est au dernier point), `reversed` (arête
  qui remonte, dans un cycle), `external` (entre deux groupes ou vers un interlude partagé) ;
- `groups[]` : un rectangle par page du graphe d'origine (chapitre), avec `chapter` (le titre se lit dans
  `story-chain.json.chapters[].label`, voir `groupTitle`), `arc`, `headerHeight` (place du titre) et `nodeIds` ;
- `sections[]` : `main` (atteignable depuis le premier script) puis `bonus` ;
- `endings[]`, `width`, `height`.

**Principe** : niveaux par plus long chemin, nœuds factices sur les arêtes qui sautent des niveaux, ordre par
barycentres (meilleur ordre en nombre de croisements), abscisses lissées vers la moyenne des voisins. Un parcours en
profondeur retourne les arêtes qui forment un cycle. Les groupes sont empilés de haut en bas dans l'ordre du récit.

**Cas particuliers du graphe réel** :

- **Interlude partagé** (`teatime`, sans chapitre ni arc, 13 entrées et 13 sorties) : un seul nœud (`hub: true`) dans
  une colonne à droite, à la hauteur moyenne de ses voisins ; ses arêtes passent par un couloir vertical entre le
  contenu et cette colonne. Pour ordonner les chapitres, ses entrées et ses sorties sont appariées dans l'ordre du
  graphe (la sortie suit l'entrée la plus proche qui la précède) ; sans cela, `teatime` ferait de toute l'histoire un cycle.
- **Section « Bonus »** : tout nœud non atteignable depuis le premier script (les 9 scripts isolés, les chaînes `nz*`,
  la page `wik_*` de 68 scripts), rangé par page dans ses propres groupes (`bonus:<arc>`), sous la section principale.
- **Fins** : `endings` ne liste que les nœuds sans successeur **atteignables depuis le début** (1 sur le corpus de
  référence : `d-9`). Il n'y a pas de compteur « x/4 » : `endingProgress(layout, fins vues)` renvoie `{ reached, total }`
  sur ces seules fins ; les extrémités de la section Bonus ne se comptent pas.
- **Libellés de choix** : peuvent contenir la séquence littérale « \n » ; `choiceLabelLines` les découpe en lignes.

**Sur le corpus de référence** (205 nœuds, 243 arêtes) : 14 groupes dans la section principale (122 nœuds) et 6 dans
Bonus (83 nœuds), environ 790 × 15 900 unités (une colonne étroite, de haut en bas), calculée en 2 ms. Elle est
couverte par `tests/unit/core/flow-layout.test.ts` (graphes factices originaux : chaîne, choix, fusion, arête longue,
interlude partagé, cycle, sections, performance) et, sur les vrais assets locaux, par
`tests/integration/flow-layout.test.ts` (ignoré sans `MAHOYO_ASSETS_DIR` ; `MAHOYO_STORY_GRAPH` désigne un
`story-graph.json` ailleurs que dans le dossier d'assets).

## Rendu du flowchart (`flowchart-view.ts`)

L'écran (`src/ui/flowchart-view.ts` + `flowchart-view.css`, FLOW-05 / #197) dessine la mise en page de
`layoutFlowchart` sans rien recalculer : groupes (DOM), arêtes (SVG), nœuds (DOM), libellés de choix (SVG au-dessus des
nœuds). Fond `mh-ui-night`, tokens de `tokens.css`, aucune image du jeu. L'écran défile nativement (la colonne mesure
environ 790 × 15 900 unités) et se positionne d'abord sur le nœud courant ; les interactions (pan, zoom, clic sur un nœud,
« Relire depuis ici ») sont décrites plus bas (FLOW-06, #202) ; le clavier par nœud et le lecteur d'écran avancé restent à faire en #206.

**Données** : `Player` charge `story-graph.json` (`AssetResolver.graph()`, `<assets>/story-graph.json`) à la première
ouverture, la vue `flowchart` porte `graph`, `revealAll` (`flowchartRevealAll`), `thumbnail` (clé -> URL via
`AssetResolver.uiImage`, `null` si la clé n'est pas au manifeste). Les titres de groupes viennent de `scripts`
(`story-chain.json.chapters`). Sans graphe (CI, utilisateur sans assets) : message d'état vide (`flowchart.empty`) et
bouton « Retour ».

**États d'un nœud** (`data-state`, jamais la seule couleur) :

| État | Forme | Pastille | Texte accessible |
|---|---|---|---|
| `hidden` (silhouette) | pointillé, vide | aucune | aucun (`aria-hidden`) |
| `unvisited` (mode « tout révéler ») | pointillé, id, vignette atténuée | ○ | « Scène x, non visitée » |
| `visited` | plein, id, vignette | ● | « Scène x, visitée » |
| `finished` | plein | ✓ | « Scène x, terminée » |
| `current` | halo `--mh-cyan-glint`, bord épais, repère « Ici » | repère | « Scène x, position actuelle » + `aria-current="location"` |

Le type se lit sur la forme : choix = losange (bord `--mh-select`), interlude = hexagone, fin = double bord + drapeau ⚑
(« fin atteinte » ou « fin » dans le texte accessible). Les 26 arêtes de l'interlude partagé sont estompées, sauf
parcourues ou survolées (le survol d'un nœud éclaire ses arêtes).

**Anti-spoiler** : sans `revealAll`, une silhouette ne porte ni identifiant (même pas en `data-*`), ni titre, ni
vignette, ni `aria-label`. Le titre d'un chapitre dont aucun script n'est ouvert est remplacé par « ??? ». Un libellé de
choix n'apparaît que sur l'arête empruntée ; la progression n'enregistre que le script cible : quand **plusieurs options
mènent au même script**, aucun libellé n'est affiché (on ne sait pas laquelle fut choisie), sauf en mode « tout révéler ».
Une arête non-choix est dite parcourue quand ses deux extrémités ont été ouvertes (approximation).

**Compteurs** : « Scènes lues x/N » (scripts ouverts / nœuds du graphe) et « Fins atteintes x/y » (`endingProgress` :
seules les fins atteignables depuis le début comptent ; masqué quand y = 0). Pas de « x/4 ». Les isolés et pages annexes
sont dans la section « Bonus ».

### Interactions (`flowchart-viewport.ts`, `flowchart-detail.ts`, FLOW-06 / #202)

La carte `.mh-flow-scroll` garde son **défilement natif** (barres, molette, `PageUp`/`PageDown`, région focalisable nommée) ; le zoom met à
l'échelle un conteneur `.mh-flow-sizer` (taille `contenu × zoom`, centré) qui contient la scène (`transform: scale`). La vue est `{ scale, x, y }`
(`x`/`y` = `scrollLeft`/`scrollTop`). Les calculs sont des fonctions pures (`zoomAround`, `centerOn`, `pinchView`, `panBy`, `keyAction`,
`wheelZoomFactor`), testées sans DOM ; `attachViewport` les branche sur la région.

| Geste | Effet |
|---|---|
| Glisser (souris, doigt, stylet) | Pan, après 5 px de déplacement (en deçà c'est un clic). Le clic qui suit un glissement est ignoré. Le clic droit et la barre de défilement ne déclenchent rien. |
| Molette | Défilement natif (`Maj` + molette : horizontal). |
| `Ctrl` + molette, pincement du pavé tactile | Zoom sous le curseur (un cran de souris = ×1,25). |
| Pincement à deux doigts | Zoom ancré sur le milieu des doigts ; le glissement à deux doigts déplace aussi la carte. |
| Boutons `+` / `−` (ronds, en bas à droite de la carte) | Zoom ×1,25 / ÷1,25 sur le centre, désactivés aux bornes (25 % à 300 %), pourcentage affiché entre les deux. |
| Bouton « Centrer sur ma position » | Centre le nœud courant (défilement animé, instantané sous `prefers-reduced-motion`) ; inactif sans position courante (écran titre). |
| Clavier (région focalisée, focus donné à l'ouverture) | Flèches (96 px, `Maj` ×3), `+` / `-` / `0` (zoom, retour à 100 %), `Début` / `Fin`. `Ctrl`/`Alt`/`Méta` + touche restent au navigateur. |

Le zoom est **mémorisé** pour la session (variable du module) : l'écran rouvert reprend le zoom précédent, puis centre le nœud courant (ou reste en
haut sans position). Les libellés de choix (12 px à 100 %) deviennent lisibles en zoomant : 24 px à l'écran à 200 %.

**Clic sur un nœud** : seul un nœud **ouvert** (visité, terminé ou courant, `data-interactive="true"`) ouvre le **volet de détails** (en haut à
droite de la carte, `Échap` ou × pour le fermer, l'écran ne se ferme qu'à l'`Échap` suivant). Il affiche l'arc, le chapitre, l'état et « Fins
atteintes depuis ici » (x/y, seulement les fins atteignables depuis le début, comme le compteur global ; masqué si y = 0 ; jamais le nom
d'une fin). Une silhouette, un nœud « révélé » non visité (mode « tout révéler ») et le fond n'ouvrent rien ; les silhouettes restent sans
identifiant ni attribut ajouté.

**« Relire depuis ici »** (bouton du volet, présent seulement si l'écran reçoit `confirm` et `replay`) : boîte de confirmation (`UIManager.confirm`,
**Non** par défaut), puis `PlayerCommands.startScript(file)` du nœud. Comme tout démarrage de script, cela remet le chemin de partie à zéro
(`operate` non repris, voir « Limites connues »), marque le script comme visité et **n'efface rien** de la progression globale. Sur Non, Échap
ou entrées bloquées, rien ne démarre.

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
