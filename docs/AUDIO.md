# État audio — BGM, voix et sons d'ambiance

> Issue de suivi : **#355** (2026-11-11). Diagnostic sur **assets réels non commités** ; aucun fichier audio du jeu
> n'est stocké dans le dépôt. Ce document décrit l'état constaté, les causes et la procédure pour fournir les
> voix si le propriétaire possède le remaster.

## Résumé

Le propriétaire signale « pas de musique de fond, pas de voix, pas de sons d'ambiance ». Diagnostic du
2026-11-11 : les trois symptômes ont des causes **distinctes**.

| Élément | État | Cause |
|---|---|---|
| **BGM** | ✅ **OK** | 60 pistes 2012 lues ; les 3 réfs casse/extension se résolvent par normalisation (`storageKey`) ; `bgm101` (générique) et `typemoon_ci` réellement absents |
| **Voix** | ❌ **Silencieuses** | les **assets PC 2012 ne contiennent aucune voix** ; le doublage est propre au **remaster 2022/2023** (Switch/PS4/Steam) |
| **Sons d'ambiance** | ⚠️ **Partiels** | les 810 SE 2012 jouent ; les réfs ajoutées par la traduction FR (Steam) sont muettes ; **canal SE unique `se:0`** (un SE coupe le précédent) |

Aucun correctif de code n'est inclus ici : c'est un état documenté (issue **docs #355**). Le correctif de
résolution BGM est suivi par **#354**.

## BGM — OK

- **60 pistes** dans le manifeste audio installé (`bgm/`), 60 entrées `kind: "bgm"`.
- **Lecture vérifiée** dans Chromium headless sur assets réels : `m19.ogg` est `paused: false`, `currentTime`
  avance, `loop: true`, `volume: 0.7`, `readyState: 4`. La boucle et le volume fonctionnent.
- **Références casse/extension** : trois réfs des scripts ne correspondaient pas littéralement au manifeste —
  `M19` (3 occurrences, `8.5.ks`…), `M39` (2 occurrences), `m50.ogg` (2 occurrences, `wik_fin.ks`). La
  normalisation `storageKey` (nom de fichier seul, extension et casse retirées) les résout :
  `M19 → m19 → bgm/m19.ogg`, `M39 → m39`, `m50.ogg → m50`. Suivi : **#354**.
- **`bgm101.ogg`** (générique de fin, `staffroll.ks`) : **réellement absent** de l'archive PC 2012. Le player
  affiche un avertissement unique et joue le générique sans musique (limite déjà documentée dans
  [`BUGS_PROLOGUE.md`](BUGS_PROLOGUE.md), B9).
- **`typemoon_ci`** (timeline de l'ouverture) : absent des assets convertis, même limite (pas de piste).

Vérifications reproductibles (assets locaux non commités, `jq`) :

```bash
# 60 BGM et 810 SE dans le manifeste
jq '.audio | to_entries | map(select(.value.kind=="bgm")) | length' public/assets/asset-manifest.json   # 60
jq '.audio | to_entries | map(select(.value.kind=="se"))  | length' public/assets/asset-manifest.json   # 810
# M19/M39/m50 résolus par la clé normalisée
jq -r '.audio | keys[]' public/assets/asset-manifest.json | grep -E '^(m19|m39|m50)$'
# bgm101 et typemoon_ci absents
jq -r '.audio | keys[]' public/assets/asset-manifest.json | grep -E '^(bgm101|typemoon_ci)$' || echo "absents (attendu)"
```

## Voix — absentes des assets 2012, propres au remaster

### Constat

- Les **assets PC 2012 ne contiennent aucun fichier de voix** : **aucun `.opus`** dans les assets installés
  (`find public/assets -iname '*.opus' | wc -l` → **0**), et les archives 2012 ne fournissent que BGM et SE.
- La version PC 2012 est **non doublée**. Le doublage a été ajouté dans le **remaster** : Wikipédia décrit
  « *An enhanced remastered version with voice acting and updated graphics was released by Aniplex worldwide
  for Nintendo Switch and PlayStation 4 on December 8, 2022, and was released for Windows via Steam on
  December 14, 2023* » — <https://en.wikipedia.org/wiki/Witch_on_the_Holy_Night> (consulté le 2026-11-11).
- La **traduction française Moon-Trad** est basée sur les **scripts Steam** : elle ajoute les réfs de voix du
  remaster. Mesure du diagnostic (lecture complète en français, assets réels) : **7 695 références `@se`
  distinctes**, dont **7 127 absentes** du manifeste (**7 157 occurrences**) ; noms typiques
  `A10_5A_8_0002.opus`, `C80_1_0_0000.opus`, `F70_…opus`.
- Le player **tolère** ces réfs : `reportMissing("audio", …)` affiche **un avertissement par asset** (jamais
  d'exception), l'audio concerné reste muet. Voir `src/core/asset-resolver.ts` (`reportMissing`) et
  `src/renderer/audio-manager.ts`.

> Méthode des chiffres ci-dessus : trace des événements audio pendant la lecture complète en français avec le
> patch installé, clé normalisée (`storageKey`) comparée aux clés du manifeste audio. Un recomptage purement
> **statique** des scripts donne un total différent (branches non exécutées, scripts non chargés) : la trace
> est la référence, et un recomptage dépend de la version du patch Moon-Trad installé.

### Procédure — fournir les voix (si le propriétaire possède le remaster)

1. **Extraire les voix du remaster** (Switch/PS4/Steam — format et outils propres au remaster, non couverts par
   le pipeline actuel) vers un dossier **local hors dépôt**, par exemple `~/mahoyo-voix/`.
2. **Vérifier le nommage** : les scripts FR attendent les noms Steam (`A10_5A_8_0002`, `C80_…`, `F70_…`),
   l'extension d'origine (`.opus`) n'entre pas dans la clé de storage (elle est normalisée).
3. **Convertir en format web** si nécessaire : conteneur **OGG/Opus** (compatible Chromium/Firefox), par exemple
   `ffmpeg -y -i source.opus -c:a libopus -b:a 96k -f ogg sortie.ogg` (le format de sortie doit être forcé,
   comme pour le pipeline). Conserver le **nom de base** de la voix.
4. **Déposer les fichiers hors du dépôt** dans l'arborescence d'assets de l'utilisateur (ex.
   `public/assets/se/`) ou dans un dossier d'entrée du pipeline — **jamais** dans git.
5. **Intégration au manifeste** : le pipeline actuel n'ingère **pas** les `.opus` (voir limites) ; en attendant
   un lot dédié, on peut réintégrer les `.ogg` convertis dans l'arborescence d'entrée (`se/`) et relancer
   `npm run pipeline -- --input … --output ./public/assets …` pour regénérer `asset-manifest.json`.
6. **Vérifier** : plus d'avertissement « Asset introuvable (audio) » pour les voix dans la console, et
   `jq '.audio | length' public/assets/asset-manifest.json` augmente du nombre de voix ajoutées ; jouer une
   scène doublée.

> ⚠️ **Légal** : les fichiers de voix restent la propriété de l'utilisateur, issus du remaster qu'il possède.
> Ils ne doivent **jamais** être commités ; `npm run check:assets` protège le dépôt.

## Sons d'ambiance — natifs OK, réfs Steam muettes, canal unique

- Les **810 SE natifs 2012** sont présents et jouent (fichiers `.wav`/`.ogg` selon conversion).
- Les réfs **ajoutées par la traduction FR** (sons/ambiances de la version Steam, même famille que les voix)
  sont **absentes** : même cause que les voix, muettes avec avertissement unique.
- **Canal SE unique** : le runtime route **tous** les SE sur `se:0` (`src/kag/runtime.ts` : `@se`, `@sestop`,
  `seact`… utilisent `se:0`, seul `allSe` arrête tous les canaux `se:*`). Conséquence : **un nouveau SE coupe le
  précédent** — une ambiance en boucle est interrompue par le moindre effet. Le `AudioManager` sait gérer
  plusieurs canaux `se:*`, mais le runtime n'en crée qu'un.
- **Limite assumée dans ce lot** : pas de correctif ici (pas de canal d'ambiance dédié ni de pistes SE
  parallèles) ; à traiter dans un lot audio dédié. Documenté dans [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Avertissements du player

- Un asset audio absent produit **un seul** `console.warn` `Asset introuvable (audio) : <clé>` par clé
  distincte (déduplication dans le resolver), jamais une exception ; le jeu continue.
- Pour visualiser les manques : ouvrir la console (F12), filtrer `Asset introuvable (audio)` ; le détail des
  réfs absentes est aussi dans `reports/` (audit/lecture complète) et dans
  `.pipeline-work/report.json` (`missingStorages`) quand le pipeline est relancé.
- Les avertissements ne sont pas des erreurs : ils ne doivent pas être confondus avec une panne audio.

## Limites connues et suivi

| Limite | État | Suivi |
|---|---|---|
| Voix absentes des assets 2012 (remaster uniquement) | documenté ; procédure de fourniture ci-dessus | #355 |
| Réfs `@se` Steam ajoutées par la traduction FR | muettes, avertissement unique | #355 |
| `bgm101.ogg` (générique) absent | générique sans musique | B9 / #110 |
| `typemoon_ci` (timeline ouverture) absent | pas de piste | B9 |
| Canal SE unique `se:0` (ambiance coupée) | limite de conception | lot audio à ouvrir |
| Pipeline n'ingère pas `.opus` | conversion manuelle à prévoir | lot audio à ouvrir |
| 3 réfs BGM casse/extension (`M19`, `M39`, `m50.ogg`) | résolues par normalisation | #354 |

## Voir aussi

- [`BUGS_PROLOGUE.md`](BUGS_PROLOGUE.md) — B9 (voix/sons Steam) et le son `bgm101`.
- [`TRADUCTION.md`](TRADUCTION.md) — patch Moon-Trad, scripts Steam et réfs supplémentaires.
- [`PIPELINE.md`](PIPELINE.md) — conversion audio du pipeline (`--audio-cmd`, `.wav`/`.ogg`).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — `audio-manager.ts`, canaux audio et routage `se:0`.
- [`DESIGN.md`](DESIGN.md) §9.16 — Sound mode (galerie BGM).
- `src/core/asset-resolver.ts`, `src/renderer/audio-manager.ts`, `src/kag/runtime.ts` — code concerné.
