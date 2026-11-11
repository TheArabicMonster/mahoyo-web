# Banc de mesure des scènes (#361, PERF-02)

Banc reproductible pour établir la **référence avant correction** (#362) des temps de chargement
entre scènes, conformément au plan [`PERF_PLAN_OPUS.md`](PERF_PLAN_OPUS.md). Il mesure le rendu
réel (assets réels locaux ou placeholders lourds synthétiques) sur **`vite preview` uniquement**,
jamais le serveur de développement.

## Commandes

```bash
# Reference locale (assets réels du propriétaire, non commités)
MAHOYO_E2E_ASSETS=/chemin/vers/public npm run perf:scenes

# Profil unique / passe unique (itérations rapides)
npm run perf:scenes -- --profiles desktop --passes cold

# Mode CI : placeholders lourds synthétiques (aucun asset du jeu), script de banc dédié
npm run perf:scenes -- --placeholders-heavy --scenes 6 --profiles desktop,mobile --passes cold,warm
```

| Option | Effet |
|---|---|
| `--assets <dir>` | dossier `publicDir` contenant `assets/` (défaut : `MAHOYO_E2E_ASSETS` ou `public`) |
| `--script <ks>` | script réel à rejouer (défaut `1-2.ks`) |
| `--scenes N` | nombre de changements de scène mesurés (défaut 6) |
| `--profiles desktop,mobile` | profils mesurés (défaut les deux) |
| `--passes cold,warm` | passes cache froid / chaud (défaut les deux) |
| `--placeholders-heavy` | génère des PNG de bruit synthétiques 1024×576 et 2048×1152 + script de banc dédié |
| `--no-build` | réutilise `dist/` existant |

Rapport : `reports/perf-scenes.json` (ignoré par git). Aucun asset ni capture commité.

## Méthode

1. **Build + serveur** : `vite build` (assets réels liés dans `dist/assets` par symlinks pour éviter
   de copier les 7 Go ; en mode placeholders lourds, le `publicDir` synthétique est copié par le
   build), puis `vite preview` sur un port libre. Le service worker est bloqué (`serviceWorkers:
   "block"`) pour que les routes Playwright et le cache HTTP mesuré ne soient pas court-circuités.
2. **Rejeu** : enchaînement forcé sur le script choisi, avancée scriptée des pages (Entrée toutes les
   ~800 ms, immédiate après un changement), profil « mobile » = CDP `CPU throttling ×4` +
   réseau ~10 Mbps (latence 40 ms).
3. **`scene-ready`** : du début de la requête de l'image de fond au rendu peint
   (2 × `requestAnimationFrame`) ; si l'image était déjà chargée (réutilisation) ou préchargée
   (lookahead), mesure déclenchement → paint. Le changement de fond est horodaté précisément dans la
   page par une boucle `requestAnimationFrame`.
4. **Autres métriques** : proportion d'images servies par le lookahead, réutilisation d'image,
   cache HTTP (`transferSize === 0`), blocages > 50 ms (`longtask`) pendant les transitions, INP au
   clic/touche d'avance (`event` timing), tas JS (`Performance.getMetrics` via CDP) et estimation du
   cache décodé (`image-dimensions.json` × 4 octets/pixel).

## Définitions

| Métrique | Définition |
|---|---|
| `sceneReadyP50/P95` | p50/p95 des mesures `scene-ready` de la passe |
| `lookaheadRatio` | part d'images dont la requête a démarré avant le déclenchement de la scène (préchargement) |
| `imageReuseRatio` | part de scènes réutilisant une image déjà affichée |
| `cacheHitRatio` | part de scènes dont la requête d'image a `transferSize === 0` (cache) |
| `longTasksOver50` | blocages > 50 ms pendant les fenêtres de transition |
| `inpMs` | plus longue interaction observée (event timing, `interactionId > 0`) |
| `heapUsedMB` | tas JS après la passe (CDP `Performance.getMetrics`) |
| `decodedCacheMB` | estimation du cache décodé des images chargées (`w×h×4`) |

## Baseline

### Avant correction (#362)

Mesure du 2026-11-11 sur `v1.1` (`1086f7f`, avant le merge de #362), assets réels locaux, script
`1-2.ks`, 6 changements de scène, macOS arm64, Chromium via Playwright :

| Profil | Passe | p50 `scene-ready` | p95 `scene-ready` | lookahead | réutilisation | blocages > 50 ms | INP | tas JS | cache décodé |
|---|---|---|---|---|---|---|---|---|---|
| desktop | froid | **66 ms** | **68 ms** | 0 % | 33 % | 0 | 48 ms | 6 Mo | ~40 Mo |
| desktop | chaud | **58 ms** | **73 ms** | 0 % | 33 % | 0 | 56 ms | 6 Mo | ~40 Mo |
| mobile (CPU ×4, 10 Mbps) | froid | **67 ms** | **1 306 ms** | 17 % | 50 % | 0 | 48 ms | 6 Mo | ~40 Mo |
| mobile (CPU ×4, 10 Mbps) | chaud | **67 ms** | **1 306 ms** | 17 % | 33 % | 0 | 48 ms | 6 Mo | ~38 Mo |

Changements de scène mesurés (desktop, froid) : fond d'ouverture `bg02学校01外観-(小雨)` 66 ms
(1,70 Mo), un premier plan 48 ms (1,18 Mo), `black` 68 ms (17 Ko), `bg02l学校02教室-(雨)` 66 ms
(4,04 Mo), puis deux réutilisations à 66 ms / 59 ms.

Lecture : le **décodage/peinture** domine (~60–70 ms par scène même en cache local, jusqu'à ~1,3 s
en mobile pour une image de 4 Mo sous 10 Mbps), **le lookahead est à 0 %** (aucun préchargement des
fonds), et les blocages > 50 ms sont nuls sur ce segment. C'est la référence « avant #362 ».

### Après correction (#362 / #365, même banc)

Mesure du 2026-11-11 sur `v1.1` (`ded61e0`, fond décodé avant la transition + sonde `?perf=1` #360),
mêmes conditions :

| Profil | Passe | p50 `scene-ready` | p95 `scene-ready` | Évolution p50 vs avant |
|---|---|---|---|---|
| desktop | froid | **49 ms** | 73 ms | −17 ms |
| desktop | chaud | **50 ms** | 64 ms | −8 ms |
| mobile (CPU ×4, 10 Mbps) | froid | 66 ms | 1 329 ms | ≈ (p95 : un fond de 4 Mo sous 10 Mbps) |
| mobile (CPU ×4, 10 Mbps) | chaud | **50 ms** | 1 291 ms | −17 ms |

Le p50 progresse de ~8–17 ms sur desktop et mobile chaud (décodage avant transition) ; le p95 mobile
reste dominé par le transfert/décodage d'un fond de 4 Mo à 10 Mbps (attendu : le correctif évite le
freeze, pas le coût réseau). La sonde `?perf=1` (#360) fournit les mêmes marqueurs à l'exécution ;
ce banc reste la mesure Playwright équivalente, disponible sans instrumentation.

### Mode CI : placeholders lourds

`npm run perf:scenes -- --placeholders-heavy --scenes 6 --profiles desktop,mobile --passes cold,warm`
génère des PNG de **bruit synthétique originaux** (1024×576 et 2048×1152) et un script de banc dédié
(`bench.ks`, 8 fonds) : coût de décodage réaliste, aucun asset sous copyright, reproductible sans
assets locaux.

| Profil | Passe | p50 | p95 | cache décodé |
|---|---|---|---|---|
| desktop | froid | 69 ms | 76 ms | ~36 Mo |
| desktop | chaud | 72 ms | 77 ms | ~34 Mo |
| mobile | froid | 64 ms | 67 ms | ~0 Mo (dimensions non résolues) |
| mobile | chaud | 66 ms | 66 ms | — |

## Limites

- `vite preview` sert les assets avec des en-têtes peu propices au cache HTTP : la passe « chaude »
  mesure surtout le décodage/rendu, pas une économie réseau ; le service worker est volontairement
  désactivé pour la reproductibilité (son cache de 400 entrées est étudié séparément dans le plan).
- La mesure est **locale** (assets réels requis) : hors CI. Le mode placeholders lourds est le banc
  utilisable sans assets, mais ses chiffres ne remplacent pas la référence réelle.
- `scene-ready` dépend de la cadence d'avancée (800 ms) : c'est une mesure de **chargement/rendu**,
  pas de confort de lecture ; INP n'est représentatif que des interactions simulées.
- `image-dimensions.json` peut manquer pour certains assets de placeholders (cache décodé estimé à
  0 Mo) : la métrique est alors partielle, pas fausse.
