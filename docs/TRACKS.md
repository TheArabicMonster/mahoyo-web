# Pistes d'animation unifiées — socle #317

> **État : socle livré, généralisation à poursuivre.** Ce lot pose le contrat d'événements et les
> premières pistes `@bgact` ; `@playtimeline`, les pistes sprite complètes et les preuves corpus
> (oracle d'état, compteur de scènes, e2e `1-0.ks` réel) restent à faire dans la suite de #317.

## Contrat visé

Modèle unique `{target, prop, keyframes, start, duration, easing}` alimenté par `@bgact` **et**
`@playtimeline`, un couple (cible, propriété) = **un seul propriétaire**, renderer piloté par WAAPI
(`transform`, `currentTime`, `finish()`), temps logique possédé par le runtime.

## Livré dans ce socle

1. **Événement `track`** (`src/kag/events.ts`) : `target` (`bg` ou id sprite), `prop`
   (`transform`/`opacity`), `keyframes` (`time`, `left/top/zoomx/zoomy/rotate/opacity`), `duration`,
   `accel`. Le runtime émet la piste ; le renderer ne fait qu'afficher.
2. **`@bgact`** : n'émet **plus de scène immédiate** ; l'état runtime devient l'**état final** de la
   piste (save/load mi-panoramique = état final), et une piste `bg` multi-keyframes est émise.
3. **Fin des scènes immédiates des animations de calque** : `@fgact`/`@movefg`/`@partbgact` sur la page
   affichée n'émettent plus `scene` (elles ne peuvent plus terminer un fondu en cours). Comptage
   corpus : 1 793 `@fgact page=fore` + 645 `@movefg` + 106 `@bgact page=fore` + 57 `@movepartbg` =
   **2 601 scènes immédiates supprimées**.
4. **`scene.transitionId`** : seul un **nouvel** id déclenche `finishTransition` ; une scène de même id
   est une mise à jour d'état sans cut (réconciliation défensive).
5. **`accel` réel** (`src/renderer/easing-track.ts`) : `t^n` pour `accel>0`, `1-(1-t)^|n|` pour
   `accel<0`, linéaire sinon ; échantillonnage des pistes pour WAAPI (24 échantillons).
   Tests `accelProgress` à t=0, 0.25, 0.5, 1 (accel 2, 3, −2, −3).
6. **Propriétaire unique côté renderer** : une nouvelle piste sur le même couple
   (`cible:propriété`) `commitStyles()` puis `cancel()` l'ancienne ; fin de piste =
   `commitStyles()` + `cancel()` ; `hurry()` met `currentTime` à la fin (WAAPI) avant de figer.
7. **`stopAnimations=false` par défaut** (capture d'origine) : un clic ne coupe plus les fondus
   de scène ; les tests de skip explicite activent le réglage.

## Tests

- `tests/unit/renderer/easing-track.test.ts` (7) : accélérations t^n / 1-(1-t)^|n|, interpolation
  temporelle, échantillonnage 0/.25/.5/1, piste instantanée.
- `tests/unit/kag/runtime-transform.test.ts` : `@bgact` état final + piste `track` (multi-keyframes,
  aucune scène émise), fond/calques conservés.
- `tests/unit/kag/layers-image.test.ts` : `@infg` n'émet plus de scène (animation de calque).
- `tests/unit/ui/player.test.ts` : clic-qui-saute la timeline uniquement avec `stopAnimations=true`.
- Suites complètes : 2 169 tests unitaires, e2e Chromium 76/76 (placeholders), lint/tsc OK.

## Reste à faire (suite de #317)

- Généraliser `track` à `@playtimeline` (calendrier) et aux pistes sprite `transform`/`opacity`
  complètes (le cas `bg` est livré) ; supprimer `bgMove`/`timelineLayer` au profit du modèle unique.
- `page=fore` pendant `@trans nowait` : vérifier dans les macros TJS si l'échange fore/back a lieu à
  la fin de la transition (piège le plus critique) ; sprite présent sur les deux pages.
- Préchargement `img.decode()` avant départ de l'horloge ; skip `currentTime=end` pour toutes les
  pistes ; `@wact`/`@stopaction` sur les pistes ; `prefers-reduced-motion` = durée 0 via
  l'orchestrateur (pas de chemin parallèle) ; save/load/rollback = état final pour toutes les pistes.
- Preuves exigées restantes : oracle d'état (hash à chaque `text`) sur les 221 scripts, compteur de
  `scene` réduit exactement des 2 601 scènes immédiates, e2e `1-0.ks` réel (9 changements, opacité
  monotone pendant `@movefg`), save/load mi-panoramique.
