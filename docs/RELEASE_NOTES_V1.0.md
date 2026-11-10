# Notes de version — Mahoyo Web v1.0.0 (préparatoires, non publiées)

> **Notes préparatoires.** Aucun tag ni release GitHub n'est publié à ce stade : le propriétaire teste le
> jeu lui-même et les bugs éventuels deviennent des issues avant publication. Ce document est prêt pour
> le moment venu (tag `v1.0.0` + release GitHub) et sera ajusté si le test manuel révèle des corrections.

- **Version visée** : `v1.0.0` (tag et release **non publiés**)
- **Date de clôture de la DoD** : 2026-11-09
- **Commit de référence de l'audit** : `2b30586` (PR code « zéro strict » #304)
- **SHA de clôture** : `e974a2a` (merge de la PR #305) ; docs finales régénérées par la PR finale `chore(progress): clôture v1.0 finale` (`Refs #302`)
- **Milestone** : v1.0, 101/101 issues fermées
- **DoD** : [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md), section « DoD — v1.0 » ; écart de l'issue chapeau #274 résolu, clôture #302.

## En bref

Mahoyo Web v1.0 est un **player web** pour *Mahoutsukai no Yoru* (Mahoyo, version PC 2012) qui lit le
corpus narratif complet à partir des fichiers du jeu **possédés par l'utilisateur**, sans redistribuer
aucun asset. L'objectif de la v1.0 — « jeu complet jouable sur desktop » — est atteint sur Chrome/Chromium
et Firefox récents : **221/221 scripts narratifs** lus du prologue à la dernière scène, **0 commande KAG
inconnue à effet visible**.

## Jouer

Le dépôt ne contient aucun asset du jeu. Le parcours complet (extraction `.xp3`, conversion, manifeste,
table d'enchaînement, lancement) est décrit dans le [`README.md`](../README.md#jouer) et le détail du
pipeline dans [`PIPELINE.md`](PIPELINE.md). L'utilisateur doit posséder une copie du jeu ; les fichiers
extraits et convertis restent locaux et ignorés par git.

## Fonctionnalités

- **Moteur KAG3** : lexer, parser, runtime fore/back, conditions, macros, appels, furigana,
  sauvegarde/rollback, tolérance aux commandes inconnues (désormais classées, voir plus bas).
- **Lecture** : enchaînement des chapitres, autosave, skip du texte lu, avance rapide, mode automatique
  avec délais page/ligne réglables.
- **Fenêtre de message** : texte posé sur le cadre du jeu, texte déjà lu atténué, indicateurs de
  ligne/page animés.
- **Persistance** : 15 pages de 8 emplacements, sauvegarde rapide et auto dans IndexedDB (migration
  `localStorage`), export/import JSON, titre de scène, commentaire et verrou par emplacement, historique
  et retour arrière.
- **Interface** : écran titre avec sous-menu Extra (Archive, CG mode, Sound mode), menu système,
  historique, chargement/sauvegarde, configuration au design d'origine (quatre onglets, 14 raccourcis
  modifiables), flowchart interactif (pan, zoom, volet de détails, accessibilité clavier/lecteur d'écran,
  anti-spoiler), routes d'URL, toasts et confirmations.
- **CG mode** : galerie des illustrations vues, visionneuse plein écran et navigation clavier ; vignettes
  calculées à l'exécution depuis les assets de l'utilisateur (aucune miniature commitée).
- **Sound mode** : galerie BGM avec lecture/pause, répétition, aléatoire, volume et progression ; titres
  et compositeurs fournis par l'utilisateur dans le manifeste.
- **Transitions** : rideaux plein écran entre titre, chargement et jeu, sans animation sous
  `prefers-reduced-motion`.
- **Tactile** : menu système par appui long, historique par balayage, barre d'actions rapides sur
  appareil tactile uniquement (cibles de 48 px réels) ; souris et clavier inchangés.
- **Traductions** : japonais d'origine et patch fan français Moon-Trad installable par script ; sélecteur
  de langue dans la configuration.
- **Pipeline d'assets** : extraction `.xp3` par gabarit d'outil externe, conversion `.tlg` → PNG
  (décodeur intégré TLG0.0/TLG5.0) ou WebP, audio OGG, normalisation des `.ks`, manifeste d'assets,
  rapport d'exécution et codes de sortie, audit classé du corpus, table d'enchaînement et graphe de
  scénario.
- **Qualité** : tests unitaires, tests d'intégration (skip propre sans assets), lecture complète en CI sur
  corpus de placeholders, e2e Playwright sur Chromium et Firefox, CI à 3 jobs, contrôle anti-assets,
  garde-fous de génération et registre d'approximations.

## Chiffres clés

| Mesure | Valeur |
|---|---|
| Scripts narratifs lus | **221/221** (0 erreur, 0 maxSteps) |
| Commandes KAG | **125 implémentées**, **5 ignorées volontairement**, **0 inconnue** (baseline vide) |
| Approximations documentées | **14** (registre #296) |
| Tests unitaires | **2181 tests** / 143 fichiers |
| Tests e2e | **159 tests** / 18 fichiers, Chromium + Firefox |
| CI | **3 jobs** : `build-and-test` + matrice `e2e (chromium)` / `e2e (firefox)` |

## Commandes KAG : audit zéro inconnue

- `npm run audit` (vrais assets, 221 scripts) : **0 commande inconnue**, 0 erreur, 0 maxSteps.
- **5 no-ops justifiés**, seuls admis car sans effet visible, audible ou de déroulement, chacun avec
  raison et issue dans `tools/ignored-commands.ts` :
  - `@autocache` (préchargement, performance) ;
  - `@deffont` (seul usage `face=user`, aucun réglage de police utilisateur dans le port) ;
  - `@settracerreturn` (mode debug, script système non chargé) ;
  - `@startchart` (carte de fin de chapitre TYPE-MOON propre au moteur d'origine, aucun écran modélisé) ;
  - `@loadtimeline` (`.tla` non convertis, usage unique dans un script de test non chargé).
- **Mode zéro strict** : le mécanisme de baseline est vide/supprimé, toute commande inconnue fait échouer
  le garde-fou CI (`npm run audit:guard`) ; la section de [`LECTURE_COMPLETE.md`](LECTURE_COMPLETE.md)
  est générée par `npm run audit:doc` et vérifiée par `npm run check:generated`.

## Approximations connues (registre #296)

Quatorze écarts étaient assumés au moment de la clôture v1.0 ; l'**état courant**, dérivé du registre,
est généré dans [`APPROXIMATIONS.md`](APPROXIMATIONS.md) (`npm run approximations:doc`). Chacun est
**visible, figé par un test** (`approx:<id>`) et **suivi** par l'issue
[#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) ; le compteur associé est versionné
(`tools/approximations-baseline.json`) et non croissant silencieusement. Le tableau ci-dessous est la
photographie de la clôture v1.0 — la doc générée fait foi pour les entrées ajoutées depuis.

| Approximation | Écart assumé |
|---|---|
| `message-actions-non-swing` | Actions continues de message autres que « swing » conservées mais non rendues ; seul « swing » est approximé en animation CSS. |
| `xchgbgm-volume` | `@xchgbgm volume=` appliqué comme volume de piste, pas comme volume global BGM scriptable. |
| `playtimeline-test-variant` | `@playtimeline frame=` sans `scene=` (variante de `menutest.ks`) toléré sans effet ; l'usage narratif `scene=` est implémenté. |
| `staffrollsetting-bgcolor` | `@staffrollsetting bgcolor=` conservé mais jamais peint (paramètre mort dans le plugin d'origine). |
| `focusline-canvas` | `@focusline*` rendu par un canvas de lignes radiales approximé ; `page`/`absolute`/`interval`/`time` ignorés. |
| `shake-fullscreen` | `@shake`/`@swing` appliqués à la scène entière, pas au calque visé ; une seule secousse active. |
| `bindbg-not-persisted` | `@bindbg` approximé au moment des panoramiques, non persisté dans les sauvegardes au-delà du drapeau de page. |
| `infg-outfg-fore-page` | `@infg`/`@outfg` posent le calque sur la page affichée sans `@trans` implicite, animation non bloquante. |
| `ruby-proportional` | Ruby réparti proportionnellement au nombre de caractères, pas à la largeur des glyphes. |
| `s-click-wait` | `@s` attend un clic simple au lieu d'une sélection bouton/lien (aucun script narratif chargé ne l'utilise). |
| `action-modules-subset` | Seul `LayerNormalMoveModule` est complet ; autres modules en translation linéaire, `accel` non interpolé, `needlayer` non reproduit. |
| `fallnote-particles` | `@beginfallnote`/`@fallnoteopt`/`@endfallnote` approximés par des particules CSS génériques (images/options non reproduites). |
| `pauseploy-font` | `@pauseploy`/`@resumeploy` masquent/restaurent la bulle ploy, police non reproduite à l'identique. |
| `clock-runtime-vars` | Horloge mémorisée dans l'état runtime (`clockHour`/`clockMinute`) et non dans `f.lastHour`/`f.lastMinute` ; aucun script narratif ne lit ces variables. |

## Écarts et limites connues (v1.1)

- **Ouverture** : fidélité de la pluie et des accélérations [#158](https://github.com/TheArabicMonster/mahoyo-web/issues/158),
  flash blanc et panoramique final [#254](https://github.com/TheArabicMonster/mahoyo-web/issues/254).
- **`@trans`** : `exchange=true` et `backlay` après `@wt` non implémentés [#253](https://github.com/TheArabicMonster/mahoyo-web/issues/253).
- **Horloge** : `@dispclock time=0` pose les aiguilles sur la page back (invisibles) [#297](https://github.com/TheArabicMonster/mahoyo-web/issues/297).
- **Ruby + emoji** : la lecture peut s'attacher au texte suivant au lieu de l'image `[graph]` [#300](https://github.com/TheArabicMonster/mahoyo-web/issues/300).
- **Chapitre choisi dans Extra/Archive** ou « Relire depuis ici » : démarre avec un **état initial vide**
  (variables d'entrée de chapitre non reprises) ; écran de choix fidèle [#213](https://github.com/TheArabicMonster/mahoyo-web/issues/213)
  bloqué par les captures de référence [#187](https://github.com/TheArabicMonster/mahoyo-web/issues/187).
- **Bulles `@ploysay`** (scripts « omake ») : positionnées mais pas dessinées.
- **Assets absents** : le son `bgm101` (générique de fin) manque à l'archive PC 2012 (générique sans
  musique) ; la traduction française référence 43 images de la version Steam absentes de l'archive 2012
  (avertissement unique, aucun substitut).
- **Accessibilité** : flowchart couvert par axe-core et clavier ; anneau de focus Firefox du menu système
  [#257](https://github.com/TheArabicMonster/mahoyo-web/issues/257) et conformité WCAG AA globale
  [#97](https://github.com/TheArabicMonster/mahoyo-web/issues/97) en v1.1.
- **Mobile/tablette** : non validé ; responsive portrait [#210](https://github.com/TheArabicMonster/mahoyo-web/issues/210)
  et accessibilité des écrans système [#211](https://github.com/TheArabicMonster/mahoyo-web/issues/211),
  support mobile [#98](https://github.com/TheArabicMonster/mahoyo-web/issues/98) en v1.1.
- **Autres v1.1** : PWA hors ligne [#96](https://github.com/TheArabicMonster/mahoyo-web/issues/96),
  thème complet [#99](https://github.com/TheArabicMonster/mahoyo-web/issues/99), objectifs de performance
  chiffrés [#100](https://github.com/TheArabicMonster/mahoyo-web/issues/100), test e2e du flowchart
  [#212](https://github.com/TheArabicMonster/mahoyo-web/issues/212), refactor `@if`/`@macro`
  [#80](https://github.com/TheArabicMonster/mahoyo-web/issues/80).

## Plateforme et prérequis

- **Navigateurs** : Chrome/Chromium et Firefox récents, desktop (cibles de la CI). Mobile/tablette : v1.1.
- **Node.js** : 22 (version CI) ; npm.
- **Assets** : copie personnelle du jeu PC 2012 et outils externes d'extraction/conversion (voir
  [`PIPELINE.md`](PIPELINE.md)).

## Vérifications de la clôture (CI verte)

```bash
npm ci
npm run lint
npx tsc --noEmit -p .
npm run test:unit
npm run test:integration     # skip propre sans assets
npm run corpus:full-read && MAHOYO_ASSETS_DIR=/tmp/mahoyo-full-read/assets npm run test:full-read
npm run test:e2e             # Chromium + Firefox, placeholders
npm run check:assets
npm run check:generated      # docs générées (KAG, approximations) + registre
npm run approximations:doc -- --check   # doc des approximations à jour
npm run build
```

## Légal

**Aucun asset original du jeu (images, sons, scripts, polices) n'est stocké ni redistribué dans ce
dépôt.** Le projet est un player + un outillage de conversion ; l'utilisateur fournit ses propres
fichiers, issus d'une copie qu'il possède. `npm run check:assets` échoue si un asset sous copyright est
ajouté au dépôt.

## Voir aussi

- [`README.md`](../README.md) — présentation, parcours utilisateur et commandes.
- [`PROGRESS.md`](PROGRESS.md), [`ROADMAP.md`](ROADMAP.md) — état et suites (v1.1).
- [`LECTURE_COMPLETE.md`](LECTURE_COMPLETE.md) — lecture complète et audit KAG.
- [`APPROXIMATIONS.md`](APPROXIMATIONS.md) — suivi généré des approximations documentées (#296).
- [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md) — critères de la v1.0.
- [`KAG_MAHOYO_SEMANTICS.md`](KAG_MAHOYO_SEMANTICS.md) — sémantique des commandes et registre des approximations.
