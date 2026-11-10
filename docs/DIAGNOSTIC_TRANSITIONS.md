# Diagnostic des transitions (#316)

> **Statut : diagnostic seul.** Aucun correctif de rendu dans cette PR : les causes mesurées ici
> conditionnent la synchronisation `@trans`/`@bgact` du modèle de pistes de **#317**. Les sorties
> détaillées (JSON/Markdown) sont régénérées avec `npm run diag:transitions` dans `/tmp` : aucun
> asset ni texte du jeu n'est commité.

## Constat du propriétaire (rappel)

Comparaison de deux enregistrements du même extrait (original `real.mov` 128,2 s vs port `ours.mov`
99,1 s, normalisés 1708×958, échantillonnage 2 fps, zone décor hors boîte de texte) :

| | Original | Port |
|---|---|---|
| Transitions détectées | **9** / 128,2 s | **11** / 99,1 s (+59 %/s) |
| Durées des fondus majeurs | **1,0 à 1,5 s** | **0,5 à 1,0 s** (~2× plus court) |
| Cuts supplémentaires | — | t ≈ 47,5 s ; 73,5 s ; 89 s |

Les métriques « par seconde » sont biaisées par le rythme de lecture/langue (#318) : le diagnostic
ci-dessous raisonne **par événement de script** et par **candidat de cut émis par le runtime**.

## Méthode

1. **Outil** `tools/diagnose-transitions.ts` (nouveau) : rejoue un script avec le vrai `Runtime`
   (headless, sans navigateur), pas à pas, et enregistre pour chaque commande la transition résolue
   (événement `scene` émis) et son `time`.
2. **Analyse corpus** (221 scripts narratifs) : comptage statique des commandes qui émettent un
   changement de scène **immédiat** (`method:"none"`) et des `@trans nowait=1`.
3. **Audit du code de rendu** : `applyBgact`, `applyAnimate` (`@fgact`/`@movefg`/`@partbgact`),
   `startTransition`/`finishTransition` (`src/renderer/stage-renderer.ts`), `player.hurry` et
   réglages par défaut.
4. Reproduction ciblée sur `1-0.ks` (prologue), `1-1.ks`, `4-3.ks`, `5b-16.ks`, `3-1.ks`, `6-5.ks`
   (rapports `/tmp/316/transitions*.json|md`).

## Causes identifiées (par ordre d'impact mesuré)

### C1 — Les animations de calque en `page=fore` ré-émettent une **scène immédiate** (cause principale des cuts)

`applyAnimate` (et `applyBgact`) terminent par `emitScene({method:"none"})` dès que la page cible est
`fore` (respectivement `@movefg`/`@movepartbg`, toujours `fore`). Or `startTransition` commence par
`finishTransition()` : **toute transition de fond en cours est terminée instantanément**, puis la
scène est re-rendue en l'état final. Un `@fgact`/`@movefg` pendant ou juste après un `@trans` produit
donc un **cut visible** (et une transition de plus détectée par l'analyse vidéo).

Comptage corpus (221 scripts) :

| Commande | Occurrences | Émet une scène immédiate ? |
|---|---|---|
| `@fgact page=fore` | **1 793** | oui (`animate`) |
| `@movefg` | **645** | oui (`animate`, page forcée `fore`) |
| `@bgact page=fore` | **106** | oui (`bgact`) |
| `@movepartbg` | **57** | oui (`animate`) |
| `@bg page=fore` | 1 (sans `time`) | oui (cut voulu par le script) |
| `@image layer=base` | 4 | oui (`image`) |
| **Total scènes immédiates émises par des animations de calque** | **2 601** | — |

Sur le prologue `1-0.ks` : **7 `@trans`** (dont 6 `nowait=1`, durées 1 200–5 000 ms) et **4 scènes
immédiates** émises par `@movefg` (lignes 99, 114, 125, 126). L'enregistrement du port détecte
**11** changements de scène sur ce script : **7 transitions + 4 cuts `@movefg` = 11**, alors que le
moteur d'origine n'en détecte que **9** (les `@movefg` n'y réinitialisent pas la scène). C'est le
mécanisme le plus direct pour les « cuts supplémentaires » et la troncature des fondus.

Même signal sur d'autres scripts : `1-1` 5 `@trans` / **16 cuts** (tous `animate`), `5b-16` 12 / 24,
`3-1` 14 / 24, `6-5` 6 / 5 (dont 2 `bgact page=fore`), `4-3` 2 / 1 (`bgact page=fore`).

### C2 — `@trans nowait=1` : le fondu continue, mais le prochain événement de scène le coupe

`nowait=1` ne bloque pas le script ; la transition reste asynchrone côté renderer. Toute scène
immédiate émise ensuite (C1) appelle `finishTransition` → **fondu raccourci d'autant**, parfois à
quelques images. Le corpus contient **210 `@trans nowait=1`** sur 1 076 (19,5 %), dont **6 des 7**
`@trans` du prologue (1 200 / 2 000 / 5 000 ms) : les durées **déclarées sont longues**, ce ne sont
pas elles qui expliquent des fondus de 0,5–1,0 s — c'est leur interruption.

### C3 — La durée déclarée est bien transmise au renderer (pas de facteur caché)

Audit de `startTransition` : `const transitionTime = method === "none" ? 0 : transition.time` puis
`transitionTimer = setTimeout(..., time)` et `overlay.style.transition = opacity ${time}ms` :
**la durée appliquée est exactement `time` du script**, sans facteur de vitesse ni arrondi.
`makeTransition` ne retombe sur un fondu court que si `time` est absent/0. Toutes les transitions
non interrompues de `1-0` conservent donc 1 200/2 000/5 000 ms.

Corpus : 1 012 `@trans rule=crossfade`, 64 sans `rule` (crossfade par défaut), **0 `universal`/`rule`** ;
le raccourcissement par `method/rule` est donc exclu. Les durées courtes existent dans le corpus
(médiane 600 ms, 204 à 200 ms, 181 à 600 ms) mais proviennent des `time=` du script.

### C4 — `stopAnimations: true` par défaut contredit la capture d'origine

`DEFAULT_DISPLAY_SETTINGS.stopAnimations = true` (commentaire du code : « la capture d'origine montre
« Non » »). Avec ce réglage, **tout clic pendant un fondu appelle `player.hurry` → `stage.hurry()` →
`finishTransition()`** et coupe la transition. Un enregistrement automatisé qui avance pendant les
fondus (ou un joueur qui clique) produit donc des fondus plus courts et des cuts ; c'est une
divergence de réglage par défaut avec l'original, à confirmer sur l'enregistrement du propriétaire
(vitesse de lecture/auto non documentée dans `ours.mov`).

### C5 — Causes écartées

- `prefers-reduced-motion` : les règles CSS ne concernent que les animations d'interface
  (`src/ui/*.css`, `transitions.ts`) ; aucune règle ne réduit les fondus de scène du stage.
- facteur de skip/`instantEffects` : `instantEffects = false` par défaut, `effectSkipEnabled = true`
  seulement via `@effectskip` et le clic (`stopAnimations`, cf. C4).
- `@wt`/backlay : sémantique déjà corrigée (#253) ; pas de cut supplémentaire observé dans les
  journaux par événement.

## Correctifs proposés (pour #316/#317, non implémentés ici)

1. **Ne plus émettre de scène** pour une animation de calque sur `fore` (`@fgact`, `@movefg`,
   `@partbgact`, `@bgact page=fore`) : émettre seulement l'événement d'animation/calque, le renderer
   met à jour la scène courante **sans** terminer la transition en cours. Une scène ne doit être
   ré-émise que si le fond change (`@bg`/`@trans`).
2. Dans `startTransition`/`finishTransition` : ne terminer une transition que sur **une nouvelle
   transition de scène** ou un skip explicite, jamais sur une mise à jour de calque.
3. Vérifier la sémantique `nowait` dans les TJS : si le moteur laisse le fondu tourner pendant que
   les commandes suivantes s'exécutent, le port doit conserver la transition vivante (piste unique
   #317) au lieu de la couper au prochain événement.
4. Aligner `stopAnimations` sur la capture d'origine (`false`) ou limiter le clic au skip des
   animations d'interface, pas des fondus de scène.
5. Tests proposés : unité runtime — 0 scène immédiate pour `@fgact page=fore`/`@movefg`/`@bgact
   page=fore` ; e2e — opacité du fondu continue pendant/après un `@movefg` (pas de saut) ; e2e clic
   pendant un fondu avec `stopAnimations` false/true ; régression corpus — compter les scènes
   immédiates par script (0 hors `@bg page=fore`/`@image` explicites).

## Impact sur #317

Le modèle unique de pistes (`@bgact` + `@playtimeline`, WAAPI) doit pouvoir **animer un calque
pendant une transition de scène** sans que cela réinitialise la scène : la piste porte
`{target, prop, keyframes, start, duration, easing}` et s'applique à la scène courante ; la
transition de fond reste une piste de composition indépendante. Le correctif C1/C2 est donc un
prérequis fonctionnel direct de #317.

## Reproductibilité

```bash
MAHOYO_ASSETS_DIR=public/assets npm run diag:transitions -- 1-0.ks 1-1.ks 4-3.ks \
  --out /tmp/316/transitions.json --md /tmp/316/transitions.md
```

Le rapport liste chaque `@trans` (ligne, `time`, `rule`, `nowait`, méthode résolue, durée résolue,
interruption éventuelle) et chaque changement de scène immédiat (ligne, commande, paramètres), sans
texte du jeu. Comptages corpus de cette note : scripts `public/assets/scenario/*.ks` locaux (non
commitables), 1 076 `@trans`, 210 `nowait=1`, 2 601 scènes immédiates d'animations de calque.
