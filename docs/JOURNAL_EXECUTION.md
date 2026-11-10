# Journal d'exécution et comparaison alignée par événement (#318)

Outil de diagnostic (pas de production) pour prouver qu'une correction de fidélité est **générale**
et pas seulement valable sur la scène filmée. Il remplace les métriques « par seconde », biaisées
par le rythme de lecture et la langue, par une comparaison **alignée sur le n-ième événement** de
chaque commande.

## Capture

```bash
# assets locaux du jeu (non commités) : MAHOYO_ASSETS_DIR ou public/assets
npm run journal:capture -- 1-0.ks --out /tmp/mahoyo-journal/1-0.json
npm run journal:capture -- 1-0.ks --out /tmp/mahoyo-journal/1-0-skip.json --speed-factor 1.25
```

Le JSON produit contient, pour chaque commande pertinente (`@trans`, `@bg`, `@bgact`,
`@playtimeline`, `@fg`/`@chgfg`/`@partbg`, animations, horloge…) :

```jsonc
{
  "occurrence": 3,              // n-ième @trans de l'exécution (alignement par événement)
  "command": "trans",
  "position": { "scriptName": "1-0.ks", "page": 2, "instruction": 4, "line": 39 },
  "params": { "rule": "crossfade", "time": 2000, "nowait": false },
  "page": "fore",
  "durationMs": 2000,           // durée déclarée par le script
  "speedFactor": 1,
  "effectiveDurationMs": 2000,  // durée effective après facteur de vitesse
  "transition": { "method": "crossfade", "time": 2000 },
  "keyframes": [ /* @bgact/animations normalisés : temps absolu, durée, interp, props */ ],
  "fore": { /* fond + calques après la commande */ },
  "back": { /* fond + calques après la commande */ }
}
```

Aucun texte du jeu n'est journalisé : seuls noms de commandes, paramètres numériques/noms
d'assets, durées et positions figurent dans le fichier.

Le callback `Runtime.onJournal` est `null` par défaut : **aucun surcoût en production** ; l'outil
l'active uniquement pour la capture headless.

## Comparaison alignée

```bash
npm run journal:compare -- /tmp/mahoyo-journal/port.json /tmp/mahoyo-journal/original.json \
  --left-label port --right-label original \
  --out /tmp/mahoyo-journal/compare.json --md /tmp/mahoyo-journal/compare.md
```

Deux formats d'entrée sont acceptés :

1. un journal complet (`{ "entries": [...] }`, sortie de `journal:capture`) ;
2. une **liste d'événements annotés** (relevés sur une vidéo originale) :

```jsonc
[
  { "command": "trans", "occurrence": 1, "durationMs": 1200, "displacement": { "x": 0, "y": 0 } },
  { "command": "bgact", "occurrence": 1, "durationMs": 60000 },
  { "command": "fg", "occurrence": 2, "displacement": { "x": 512, "y": 300 } }
]
```

L'alignement se fait sur `(commande, n-ième occurrence)` : `@trans` n°1 ↔ `@trans` n°1,
`@bgact` n°2 ↔ `@bgact` n°2. Le rapport JSON contient les lignes appariées/orphelines, les
**deltas de durée déclarée et effective**, le **déplacement relatif** des fonds/calques et les
statistiques par commande ; le Markdown est une table lisible (aucun texte du jeu).

## Exploitation (#316/#317)

- **#316** : comparer le journal du port à des annotations de la vidéo originale pour vérifier les
  durées de fondu, les transitions manquantes/supplémentaires et les changements de calque sans
  `@trans`.
- **#317** : comparer les déplacements de fond (`displacement`) et les durées des `@bgact`/
  `@playtimeline` avant/après correction, **par événement** (le flux optique par seconde n'est plus
  utilisé comme métrique de décision).
- Les rapports JSON+MD peuvent être archivés hors dépôt (`/tmp`) ; rien n'est commité avec des
  noms de textes du jeu.
