# Notes de version — Mahoyo Web v1.1 (brouillon, non publiées)

> **Brouillon de travail.** Aucun tag ni release GitHub n'est publié pour la v1.1. La vague v1.1 est
> **en cours** : 67 issues fermées sur 74 (91 %) ; 7 restent ouvertes, dont plusieurs **bloquées sur des
> enregistrements/captures du propriétaire** (#187, #213, #254, #315, #316, #158) et une tâche de
> validation visuelle automatisée (#347). Ce document sera finalisé quand la milestone sera prête.

- **Version visée** : `v1.1` (aucun tag, aucune release)
- **Date du point d'étape** : 2026-11-10
- **Branche d'intégration** : `v1.1` (commit `aba6b57`, mergée dans `main` = `c4a2afc`, CI 4/4 verte)
- **Milestone** : v1.1, **67/74** issues fermées (91 %) ; 6 restantes + #347
- **v1.0** : 101/101, notes séparées [`RELEASE_NOTES_V1.0.md`](RELEASE_NOTES_V1.0.md), **non publiées**

## En bref

La vague v1.1 « confort, accessibilité et finitions » apporte : **WCAG AA** (audit axe-core 0 violation),
le **focus clavier Firefox**, le **mobile/tactile** (gestes, dock portrait, safe-areas), le **thème et les
animations** avec option de réduction, le **KAG à plat** (`@if`/`@macro`/`@call` fiables) et les
**pistes/transitions unifiées** (`@bgact` multi-keyframes, `@playtimeline` en pistes) avec preuve
d'oracle d'état. Elle ajoute aussi des garde-fous CI (marqueurs de conflit, oracle, docs générées) et les
documents de recette ([`TEST_VISUEL_V1_1.md`](TEST_VISUEL_V1_1.md)) et de captures
([`GUIDE_CAPTURES.md`](GUIDE_CAPTURES.md)).

## Fonctionnalités et correctifs

### Moteur KAG

- **`@if`/`@macro` à plat (#80)** : blocs linéarisés en instructions/labels, `@call` fiable au milieu d'un
  bloc, `@return` au bon endroit (fin des limitations de frames imbriquées).
- **Pistes unifiées (#317)** : `@bgact` applique ses **keyframes multiples** (panoramique/zoom) au lieu de
  la première seulement ; les calques de `@playtimeline` passent par le modèle de pistes `track` ; les
  types legacy `bgMove`/`timelineLayer` sont retirés du runtime (conservés pour compatibilité de rendu).

### Accessibilité

- **WCAG AA (#97)** : audit axe-core (WCAG 2.0/2.1/2.2 A+AA) sur les vues atteignables, **0 violation**
  en Chromium et Firefox (placeholders) ; zoom navigateur autorisé (WCAG 1.4.4) ; sémantique/ARIA,
  `prefers-reduced-motion`, taille de texte réglable.
- **Focus Firefox (#257)** : contour de focus visible pour les focus **programmatiques** via
  `src/ui/focus-modality.ts` (même rendu que Chromium, tokenisé).
- **Écrans système (#211)** : focus visible, rôles ARIA et réduction de mouvement sur les écrans refaits.

### Mobile, responsive, PWA

- **Mobile et tablette tactile (#98)** : tap = avancer, appui long = menu système, balayages (retour
  arrière, historique), défilement du texte en dock portrait sans avancer ; viewports testés 393×851,
  390×844, 360×640, 640×360, safe-areas.
- **Responsive portrait (#210)** : scène en haut, **zone de texte dédiée** sous la scène, reflow des
  écrans système (cibles ≥ 44 px) ; corrections de mise en page (#325/#326/#332).
- **PWA hors-ligne** : correctif du service worker/publicDir (#337), suite e2e PWA en CI.

### Thème, animations, interface

- **Thème et animations (#99)** : tokens de surfaces, focus et mouvement ; animations d'interface ; **option
  de réduction des animations** dans la configuration ; sous-titres décoratifs inchangés.
- **Historique/HUD** : correctifs de fidélité déjà livrés en v1.0 (transitions, CG/Sound, flowchart…).

### Qualité et CI

- **Garde-fou anti-marqueurs de conflit (#342)** : `npm run check:conflict-markers` échoue si un marqueur
  de conflit Git est commité (défaut de processus réel).
- **Oracle d'état (#317)** : `npm run oracle:state` rejoue les scripts et hashe l'état logique — preuve de
  non-régression de la refonte des pistes.
- **CI 4 jobs** : `build-and-test` (lint, anti-assets, build, tests unitaires, intégration, lecture
  complète placeholders), `pwa` (hors-ligne), `e2e (chromium)`, `e2e (firefox)`.
- **Docs générées** : `check:generated` (doc KAG, doc approximations, registry), `audit:guard` zéro strict.

## Preuves

| Preuve | Résultat |
|---|---|
| Oracle d'état (#317) | **0 hash différent** — 251 scripts, 49 436 steps, 23 209 événements `text`, **15 746 = 15 746 scènes** |
| Tests unitaires | **2 382 tests / 164 fichiers** |
| Tests e2e | **254 tests / 26 fichiers** (Chromium + Firefox) |
| Audit WCAG AA (#97) | **0 violation** axe-core (Chromium + Firefox), tags WCAG 2.0/2.1/2.2 A+AA |
| CI | **4/4 jobs verts** sur `main` (`c4a2afc`) |
| Garde-fous | `lint` 0, `tsc` 0, `check:assets` vert, `audit:guard` zéro strict, `check:generated` OK, `build` OK |

## Limites connues (à la date du brouillon)

- **Validation visuelle en attente** : les correctifs **#315** (sprite du professeur) et **#316**
  (transitions) sont mergés mais **non validés** contre l'enregistrement de référence ; la validation est
  suivie par **#347** (automatisée sur assets réels, sans nouvel enregistrement) et par la recette
  [`TEST_VISUEL_V1_1.md`](TEST_VISUEL_V1_1.md). **#254** (flash blanc / panoramique final de l'ouverture)
  reste ouvert, à confirmer sur enregistrement.
- **Écran de choix (#213)** : bloqué par **#187** — les captures du propriétaire ([`GUIDE_CAPTURES.md`](GUIDE_CAPTURES.md),
  scénario 1) sont nécessaires pour spécifier l'apparence, le curseur et l'animation de l'écran de choix.
- **Fidélité de l'ouverture (#158)** : synchro musique/comparaison au jeu d'origine, p3, hors de cette vague.
- **iOS Safari** : l'émulation iPhone/mobile est faite sous **Chromium** (émulation tactile) ; **WebKit
  Safari n'est pas un projet CI** (pas de WebKit installé) — écart documenté, pas une validation Safari réelle.
- **Sound mode non auditable en audit** : en mode placeholders, le Sound mode n'a pas de piste (entrée
  désactivée) ; l'audit WCAG ne peut donc pas l'auditer sans assets utilisateur.
- **Contrastes dépendants des scènes** : le contraste du **texte du jeu** dépend des scènes réelles de
  l'utilisateur ; l'ombre du texte reste le garde-fou. Les contrastes d'**interface** sont couverts par
  l'audit AA.
- **Approximations assumées** : le port conserve des approximations documentées et suivies
  (registre #296, doc générée [`APPROXIMATIONS.md`](APPROXIMATIONS.md)) — elles ne sont pas des régressions
  silencieuses.

## Recette et prochaines étapes

1. **Recette visuelle du propriétaire** : suivre [`TEST_VISUEL_V1_1.md`](TEST_VISUEL_V1_1.md) (texte, sprite,
  fonds, transitions, ouverture, HUD, responsive, accessibilité, PWA, sauvegardes) et signaler les écarts
   `NUMÉRO KO` (captures hors dépôt, jamais commitées).
2. **Captures complémentaires** : suivre [`GUIDE_CAPTURES.md`](GUIDE_CAPTURES.md) — **scénario 1 (écran de
   choix) en priorité** pour débloquer **#213**.
3. Ensuite : validation #315/#316/#254, clôture v1.1, puis finalisation de ces notes (**aucun tag ni release
   avant validation**).

## Voir aussi

- [`PROGRESS.md`](PROGRESS.md) — progression par milestone.
- [`ROADMAP.md`](ROADMAP.md) — état de la vague et reste v1.1.
- [`TEST_VISUEL_V1_1.md`](TEST_VISUEL_V1_1.md) — checklist de recette manuelle.
- [`GUIDE_CAPTURES.md`](GUIDE_CAPTURES.md) — captures à fournir (HUD-17).
- [`RELEASE_NOTES_V1.0.md`](RELEASE_NOTES_V1.0.md) — notes v1.0 (non publiées).
- [`APPROXIMATIONS.md`](APPROXIMATIONS.md) — approximations documentées (#296).
- [`DESIGN.md`](DESIGN.md) — design system, WCAG AA et écarts connus.
