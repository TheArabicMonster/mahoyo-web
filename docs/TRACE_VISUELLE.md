# Trace visuelle headless (`trace:visual`)

Outil de diagnostic des écarts de rendu entre le player et le jeu d'origine (issue #249).
Il rejoue un script KAG `.ks` avec le vrai moteur (`src/kag/`), sans navigateur, et
journalise pour chaque commande visuelle **ce que le moteur affiche**, afin de relier un
écart constaté (capture, enregistrement) à une commande `script:ligne` précise.

## Utilisation

Les assets locaux du jeu (non commités) sont nécessaires : `MAHOYO_ASSETS_DIR`, à défaut
`public/assets`.

```bash
# Prologue : trace JSON complète + timeline Markdown
npm run trace:visual -- 1-0.ks --md /tmp/timeline-1-0.md

# Une scène classique, avec le détail par commande dans la console
npm run trace:visual -- 1-2.ks --verbose --out /tmp/trace-1-2.json

# Sorties par défaut : /tmp/mahoyo-trace/<script>.json
```

Options :

| Option | Effet |
|---|---|
| `--assets <dir>` | répertoire des assets (défaut : `MAHOYO_ASSETS_DIR` ou `public/assets`) |
| `--out <fichier>` | trace JSON (défaut `/tmp/mahoyo-trace/<script>.json`) |
| `--md <fichier>` | timeline Markdown (commandes → état affiché) |
| `--max-steps <n>` | garde-fou du rejeu (défaut 20 000) |
| `--verbose` | détail de chaque commande dans la console |

Les traces sont volumineuses et citent des noms d'assets du jeu : les garder dans `/tmp`
ou `reports/` (gitignoré). Une timeline versionnable ne contient que des noms de
commandes, d'assets et des positions — voir `docs/PROLOGUE_TIMELINE.md`.

## Ce que la trace contient

Pour chaque commande non textuelle :

- `script:ligne` — la ligne source est retrouvée en injectant des marqueurs `@__line n=`
  avant chaque ligne exécutable (commande no-op ignorée par le moteur, jamais visible) ;
- la commande brute du script, et le storage déclaré ;
- la clé normalisée (`storageKey`) et l'URL résolue dans le manifeste ;
- la page visée (`fore` / `back`, défauts du moteur appliqués) ;
- les évènements émis (`scene`, `animate`, `audio`, `textbox`…) ;
- l'état après la commande : fond (image, position, zoom, rotation) et calques
  (id, storage, position, z-index, opacité, crop `@partbg` — avec la zone source
  réellement visible calculée avec le modèle de rendu actuel) ;
- pour un `@partbg`, la comparaison entre le rect déclaré et la source réellement
  visible (met en évidence un décalage de crop).

La trace JSON reprend les mêmes informations plus le détail des étapes de lecture
(arrêts `click` / `wait` / `waitFor`, longueur du texte — jamais le texte lui-même).

## Relier un écart de capture à une commande

1. repérer l'instant de l'écart dans l'enregistrement de référence, puis la scène du
   script correspondante (page / position de lecture) ;
2. lancer `trace:visual` sur ce script et lire la ligne de la page, ou utiliser `--md` ;
3. comparer l'état affiché de la trace (fond, calques, position, crop) à la référence :
   une image manquante, un z-index, une position ou un crop décalé désignent la commande
   fautive ;
4. pour un écart de rendu pur (DOM), compléter par une capture navigateur sur le player
   réel.

Exemple de chaîne d'investigation (issue #249) : la vidéo de référence de l'ouverture
montre un panoramique de salle en ruine ; la trace de `opening.ks` page 0 montre que le
fond est fourni par `@playtimeline scene=4` (16 fonds, 13 panoramiques, 498 keyframes de
calques), et le panorama de la référence correspond au fond `im01オープニング02b_ピン奥a`
posé en `left=-99 top=-48` puis déplacé — un décalage constant de position verticale
trahit alors les défauts de placement de `@bg` (voir `docs/KAG_MAHOYO_SEMANTICS.md` §2).
