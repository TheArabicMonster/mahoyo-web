# Approximations documentées du port

> Ce fichier est **généré** par `npm run approximations:doc` depuis le registre `tools/approximations.ts` (#295) et la baseline `tools/approximations-baseline.json`. Ne pas l'éditer à la main : modifier le registre, puis régénérer. `npm run check:generated` (CI) échoue si le fichier est obsolète.

Une **approximation** est un écart assumé au moteur d'origine, admis par la DoD v1.0 (#274) parce qu'il est visible, testé et suivi. Le registre compte **14 approximations** (compteur cumulé : **14** déviation(s) documentée(s)).

Chaque entrée est rattachée à l'issue de suivi v1.1 [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) et porte quatre éléments obligatoires vérifiés en CI : écart précis, issue v1.1, test figé (marqueur `approx:<id>`) et compteur versionné non croissant.

Baseline versionnée : `tools/approximations-baseline.json` (générée le 2026-11-09).

## Registre

| # | Id | Commande / fonctionnalité | Écart assumé | Issue | Test figé | Compteur |
|---|---|---|---|---|---|---|
| 1 | `action-modules-subset` | Modules d'action (`@action`, `@move*`…) | Seul le module d'action réellement utilisé (LayerNormalMoveModule) est complet : les autres modules sont approximés en translation linéaire et l'accélération `accel` n'est pas interpolée (les keyframes du port sont linéaires) ; `needlayer` (création du calque manquant) n'est pas reproduit. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/actions-runtime.test.ts` | 1 |
| 2 | `bindbg-not-persisted` | `@bindbg` (liaison de fond) | @bindbg est une liaison visuelle approximée au moment des panoramiques (bgMove) ; l'effet n'est pas persisté dans les sauvegardes au-delà du drapeau de page. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/layers-image.test.ts` | 1 |
| 3 | `clock-runtime-vars` | Horloge (`@dispclock`/`@tickclock`) | L'horloge mémorise l'heure dans l'état runtime (clockHour/clockMinute, sauvegardés) et non dans les variables moteur f.lastHour/f.lastMinute ; vérifié : aucun script narratif ne lit ces variables. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/clock-state.test.ts` | 1 |
| 4 | `fallnote-particles` | `@beginfallnote`/`@fallnoteopt`/`@endfallnote` | @beginfallnote/@fallnoteopt/@endfallnote sont approximés par des particules CSS génériques : les images de notes, les options sx/sy/patterns/pastTime et la seconde couche du plugin ne sont pas reproduites ; seuls l'activation, l'arrêt et le taux `rate` (vitesse des particules) sont rendus. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/renderer/actions-renderer.test.ts` | 1 |
| 5 | `focusline-canvas` | `@focusline*` | @focusline* est rendu par un canvas de lignes radiales approximé : `page`, `absolute`, `interval` et `time` sont ignorés, l'overlay couvre la scène et stop/clear ont le même effet net. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/plugin-effects.test.ts` | 1 |
| 6 | `infg-outfg-fore-page` | `@infg`/`@outfg` | @infg/@outfg posent le calque directement sur la page affichée (fore) sans @trans implicite et l'animation n'est pas bloquante, contrairement au plugin d'origine. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/layers-image.test.ts` | 1 |
| 7 | `message-actions-non-swing` | Actions de message autres que `swing` | Les actions continues de message autres que « swing » (chgfont, etc.) sont conservées dans l'état mais non rendues : seule « swing » est approximée en animation CSS par caractère. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/renderer/secondary-commands.test.ts` | 1 |
| 8 | `pauseploy-font` | `@pauseploy`/`@resumeploy` | @pauseploy/@resumeploy masquent et restaurent la bulle ploy, mais la police n'est pas reproduite à l'identique : le moteur force MS PGothic puis la police utilisateur (`deffont`/`resetfont`), le port réinitialise le style de texte sur celui du thème. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/actions-runtime.test.ts` | 1 |
| 9 | `playtimeline-test-variant` | `@playtimeline` variante de test (`frame=` sans `scene=`) | @playtimeline avec frame= sans scene= (variante de test de menutest.ks) est toléré sans effet et sans animation ; l'usage narratif (scene=) reste implémenté. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/playtimeline-variant.test.ts` | 1 |
| 10 | `ruby-proportional` | Ruby (`@ruby`) | La répartition du ruby sur un texte de base explicite est proportionnelle au nombre de caractères, alors que le moteur la calcule sur la largeur des glyphes. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/parser.test.ts` | 1 |
| 11 | `s-click-wait` | `@s` (attente de sélection) | @s attend un clic simple, alors que le moteur attend une sélection de bouton/lien (click-map) ; aucun script narratif chargé par le player n'utilise @s. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/parser.test.ts` | 1 |
| 12 | `shake-fullscreen` | `@shake`/`@swing` | @shake/@swing visent un calque dans le moteur ; le port applique l'oscillation à la scène entière et ignore storage/page/actmode/force. Une seule secousse active à la fois. | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/plugin-effects.test.ts` | 1 |
| 13 | `staffrollsetting-bgcolor` | `@staffrollsetting bgcolor=` | @staffrollsetting bgcolor= est conservé dans l'état mais jamais peint : le plugin d'origine stocke la couleur sans jamais l'utiliser (paramètre mort). | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/runtime.test.ts` | 1 |
| 14 | `xchgbgm-volume` | `@xchgbgm volume=` | @xchgbgm volume= est appliqué comme volume de piste, alors que le moteur règle un volume global BGM scriptable (le port n'a pas de volume global distinct des réglages utilisateur). | [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) | `tests/unit/kag/runtime.test.ts` | 1 |

## Procédure — ajouter une approximation

1. **Écart précis** : décrire le comportement du moteur d'origine et l'approximation retenue (pas « non implémenté »), en au moins 40 caractères.
2. **Issue v1.1** : rattacher une issue de suivi au format `#N` (par défaut le suivi commun #296).
3. **Test figé** : ajouter le marqueur `approx:<id>` dans un test unitaire qui échoue si le comportement approximé change sans mise à jour explicite.
4. **Compteur** : déclarer le nombre de déviations connues ; la baseline versionnée doit être mise à jour explicitement, sans augmentation silencieuse.

```bash
# après modification de tools/approximations.ts
npm run approximations:baseline   # met à jour tools/approximations-baseline.json
npm run approximations:doc        # régénère docs/APPROXIMATIONS.md
npm run approximations:check      # registre + baseline + tests figés
npm run check:generated           # docs générées + registre (CI)
```

La CI refuse : écart trop court, issue mal formée, test introuvable ou sans marqueur, id dupliqué/invalide, compteur supérieur à la baseline, baseline incohérente avec le registre, ou ce document obsolète.

## Retirer ou réduire une approximation

- **Approximation résolue** (le comportement du moteur est reproduit) : retirer l'entrée du registre **et** de la baseline dans la même PR, retirer le marqueur du test figé (ou le test), puis régénérer la doc.
- **Approximation réduite** (moins de déviations) : baisser le compteur et mettre la baseline à jour explicitement (`npm run approximations:baseline`).
- Le compteur ne peut **jamais** augmenter sans justification explicite dans la PR.

## Voir aussi

- [`RELEASE_NOTES_V1.0.md`](RELEASE_NOTES_V1.0.md) — notes de version et liste des approximations à la clôture v1.0.
- [`KAG_MAHOYO_SEMANTICS.md`](KAG_MAHOYO_SEMANTICS.md) — sémantique des commandes KAG et décisions documentées.
- `tools/approximations.ts` (registre), `tools/approximations-baseline.json` (compteurs), `tools/approximations-guard.ts` (garde-fou CI).
- Issues : [#295](https://github.com/TheArabicMonster/mahoyo-web/issues/295) (registre et garde-fou), [#296](https://github.com/TheArabicMonster/mahoyo-web/issues/296) (suivi v1.1).
