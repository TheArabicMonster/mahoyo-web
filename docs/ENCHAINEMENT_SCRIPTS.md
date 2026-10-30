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

## Règle de choix de la suite

`resolveNext` (`src/core/story-chain.ts`) :

1. **toutes les routes libellées : c'est un menu.** Une condition y sert à afficher ou masquer une
   option (fausse = masquée). Deux options ou plus : menu, même si elles mènent au même script ;
   une seule : on l'enchaîne ;
2. sinon, une route conditionnelle vraie l'emporte ; sans condition vraie, on garde les routes sans condition ;
3. une seule suite après dédoublonnage : on l'enchaîne ; plusieurs sans libellé : la première du graphe.

Quand une route et le bloc qui la suit portent chacun une condition, elles sont combinées en ET.

## Résultat sur le corpus de référence

194 blocs dont 161 avec script, 200 scripts dans la table dont 19 avec plusieurs suites,
4 interludes partagés. En suivant la première route depuis `1-0.ks`, l'histoire s'enchaîne
sur **134 scripts jusqu'à `d-9.ks`**, interludes compris.

## Test

`tests/integration/story-play.test.ts` joue cette suite de scripts avec le vrai moteur et
vérifie l'absence d'erreur et de boucle. Il demande les assets locaux
(`MAHOYO_ASSETS_DIR`) et la table ; sinon il est ignoré :

```bash
npm run chain -- <main.gc> "$MAHOYO_ASSETS_DIR"
MAHOYO_ASSETS_DIR=/chemin/assets npx vitest run tests/integration/story-play.test.ts
```

## Limites connues

- **`operate` non repris** : chaque bloc du graphe pose des variables à l'entrée (par
  exemple `chapter=2`, ou des indicateurs de déblocage des bonus). La table ne les
  applique pas ; seuls l'ordre des scripts et les choix sont reproduits.
- **Les conditions** (`room>0`, `Ｚ>0`…) portent sur des variables posées par `operate`, qui n'est
  pas repris : elles valent faux et produisent un avertissement « eval failed ».
- **Menu de chapitres non fait** : l'accès direct à un chapitre (racines `1.5-*`, `8.5`,
  bonus `nz*`, `sp*`) n'est pas couvert ici.
- **Branches `wik_*`** : leurs options sont proposées par un menu, mais le comportement des
  variables qu'elles posent n'a pas été vérifié.
