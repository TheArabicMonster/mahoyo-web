# Plan perf v2 — réduire encore les temps de chargement (revue Opus 5.5)

> Demande du propriétaire (2026-11-12) : « les temps de chargement sont encore trop longs, redemande à Opus un plan pour améliorer ça. »
> Contexte : plan v1 [`PERF_PLAN_OPUS.md`](PERF_PLAN_OPUS.md) partiellement livré (#360, #361, #362, #367, #368, #372, #373, #374, #375).
> Mesures locales du build courant (Chromium, assets réels, `vite preview`) : chargement initial 422 ms ; 23 images, `scene-ready` p50 50,9 ms / p95 67,1 ms ; cache décodé 71,9 Mo ; transferts de session 7,5 Mo dominés par des **SE WAV** (3,07 Mo, 1,34 Mo…) et `title_background.png` (1,19 Mo).

# Plan perf v2 : chargements encore trop longs

L'écriture de `docs/PERF_PLAN_V2_OPUS.md` a été refusée, donc le plan est ci-dessous. Je n'ai rien commité ni créé comme issue. Les gains chiffrés sont des estimations tant que le propriétaire n'a pas mesuré chez lui.

## 0. Ce que montrent le code et les mesures

En local, le rendu des scènes est déjà presque au minimum possible. Sur les 50,9 ms du p50 `scene-ready`, environ 33 ms viennent des deux `requestAnimationFrame` du marqueur `painted` à 60 Hz. Le décodage ne pèse qu'environ 15 à 20 ms. La plainte vient donc d'ailleurs :

| Cause probable | Indice | Où |
|---|---|---|
| **SE en WAV** | 806 WAV, 596 Mo, jusqu'à 6,8 Mo par fichier. Sans encodeur, le pipeline copie le WAV tel quel. | `tools/plan.ts:134`, `public/assets/se` |
| **Délai de 1 s, puis apparition brute** | Si l'image n'est pas arrivée, `ensureDecoded` rend la main après 1 s et le fondu part vers une image non décodée. On a donc une seconde figée **puis** l'apparition brute. Aucun indicateur ne s'affiche. | `stage-renderer.ts:1367,1398`, `image-decode.ts:91` |
| **Audio téléchargé deux fois** | `seetc02.wav` est transféré deux fois (423 et 325 Ko). Le lookahead fait `new Audio()` avec `preload="auto"`, puis `audio-manager` crée son propre élément. Les requêtes `Range` ne passent pas par le SW. | `player.ts:1570`, `sw-source.ts:115` |
| **Démarrage en série** | manifeste + dimensions, puis `cgProgress.load()`, puis `loadChain`, puis `loadEnvColors`, puis le fond titre PNG de 1,19 Mo. | `src/main.ts:90-121` |

Une correction sur ton constat : **les 60 BGM sont déjà en OGG** (259 Mo). Seuls les SE sont en WAV.

## 1. Mesurer chez le propriétaire

**Où mesurer.** Jamais avec `npm run dev`. Une mesure en `vite preview` local sert de référence sans réseau. La mesure principale se fait **sur l'URL et l'appareil qu'il utilise vraiment**. Si `vite preview` est fluide chez lui et que l'URL distante est lente, la cause est le réseau ou la taille des fichiers.

**Protocole (environ 15 min) :**
1. Noter l'URL, l'appareil, le navigateur et le réseau (avec un speedtest).
2. **Passe froide.** Fenêtre privée, ou DevTools → Application → *Clear site data* en cochant *Unregister SW* et *Cache storage*. Ouvrir `?perf=1`.
3. Chronométrer l'arrivée sur l'écran titre, puis le délai entre « Nouvelle partie » et le premier texte. Lire ensuite 30 pages à rythme normal en notant les pages où il attend.
4. Copier le résumé de la sonde : `copy(JSON.stringify(window.__mhPerf.summary()))`.
5. Copier la navigation et le Resource Timing :
   ```js
   copy(JSON.stringify({nav:performance.getEntriesByType("navigation")[0]?.toJSON(),
     res:performance.getEntriesByType("resource").map(e=>({u:e.name.split("/assets/")[1]??e.name.split("/").pop(),
     t:e.initiatorType,start:Math.round(e.startTime),dur:Math.round(e.duration),
     ttfb:Math.round(e.responseStart-e.requestStart),dl:Math.round(e.responseEnd-e.responseStart),
     sz:e.transferSize,enc:e.encodedBodySize,dec:e.decodedBodySize,sw:e.workerStart>0}))}))
   ```
6. **Passe chaude** : recharger dans le même onglet et refaire les étapes 3 à 5.
7. Sur mobile, passer par `chrome://inspect` ou par Web Inspector de Safari. Si ce n'est pas possible, il faudra le bouton de l'issue V2-01.

**Seuils pour classer la cause :**

| Classe | Seuil |
|---|---|
| **Réseau** | `ttfb` > 200 ms ou `dl` > 300 ms sur un fond, ou `fetched − request` > 60 % du `scene-ready`. Un `transferSize > 0` en passe chaude indique un cache inefficace. `enc == dec` sur le manifeste indique qu'il n'est pas compressé. |
| **Décodage** | `decoded − fetched` > 40 ms en desktop ou > 120 ms en mobile, pour une image de 1024×576. |
| **Rendu** | `painted − decoded` > 50 ms (le minimum est d'environ 33 ms). |
| **JS / parse** | Une frame LoAF > 50 ms pendant une transition, ou `DCL − responseEnd(JS)` > 150 ms en mobile. |
| **Attente perçue** | Le marqueur `mh:transition:wait` est à ajouter. Au-delà de 300 ms, l'attente se voit. À 1000 ms ou plus, on a atteint le délai maximal et l'apparition brute. |

## 2. Audit des correctifs v1

### Décoder avant la transition (#362)
- **Oui, cela crée une attente sur un réseau lent.** Le délai d'1 s est trop court pour qu'un PNG distant arrive, et trop long pour passer inaperçu. Aucun indicateur ne s'affiche : `setWaitIndicator` n'est appelé que par le verrou du player.
- **Bug** : `ensureDecoded` (`image-decode.ts:68`) et `cacheDecodedForDisplay` (`stage-renderer.ts:1351`) mettent l'image en cache **avant** qu'elle soit chargée. Un deuxième appel sur une image en cours de chargement est donc compté comme succès et répond tout de suite. La transition part alors vers une image non décodée, et les compteurs de hits sont faussés.
- Seul le changement de fond attend le décodage (`:1398`). `fg`, `chgfg`, `partbg`, les `ev` en calque et les timelines n'attendent pas.
- Un clic pendant l'attente lance le fondu vers l'image qui n'est pas prête.

### Lookahead (#367)
- `preloadImage` (`player.ts:1540`) télécharge l'image **sans appeler `decode()`**, et la range dans une `Map` séparée du cache LRU. Le transfert est économisé, mais l'image est redécodée au moment où la scène l'affiche.
- `peekAssets` (`runtime.ts:504`) ne voit pas `chgfg`, `partbg`/`bgstorage`, `bgact`, les images de `@playtimeline`, `graph` ni `xchgbgm`. Les fonds transformés sont couverts (même `storage`). Les `rule` ne sont toujours pas utilisées.
- Le lookahead ne se déclenche qu'aux arrêts de texte (`player.ts:677,1016,1029`), avec un budget de 40 instructions. Les diaporamas et les `@wait` minutés ne sont donc pas anticipés. Sur 10 Mbps, une page lue laisse le temps de télécharger seulement 2 à 4 PNG.
- `preload="auto"` télécharge le WAV entier pour **chaque** SE annoncé, y compris dans les branches qui ne seront pas prises.

### Cache LRU (#368)
- Il est efficace pour les images déjà affichées (21 hits).
- Il ne contient pas les images préchargées par le lookahead.
- 71,9 Mo pour 23 images veut dire qu'on a de grosses images (sprites 大, ev). Sur iOS, avec un plafond de 64 Mo, il y aura des évictions dès le prologue.

### SW versionné (#372)
- **Il n'aide en rien au premier chargement.**
- L'audio n'est **jamais** mis en cache par le SW, parce que ses requêtes sont des `Range`.
- `await cache.put()` s'exécute **avant** de renvoyer la réponse (`sw-source.ts:235`) : la page attend l'écriture complète en cache.

### Ce qui coûte encore, par ordre d'importance
1. SE en WAV, téléchargés en double et préchargés même s'ils ne servent pas.
2. Images en PNG de 1 à 3 Mo.
3. Délai fixe d'1 s suivi de l'apparition brute.
4. Démarrage en série et fond titre de 1,19 Mo.
5. Redécodage des images déjà préchargées.
6. 119 Ko de JS gzip chargés d'un bloc.

## 3. Plan par phases

**A. Mesurer**
- **V2-01** : ajouter les marqueurs `mh:boot:*` (manifest, title-painted, first-text), `mh:transition:wait` (durée et issue) et `mh:audio:*`. Ajouter un bouton « Copier le rapport perf » quand `?perf=1` est actif.

**B. Diviser le poids des fichiers** (c'est le plus gros gain à distance)
- **B1 : SE de WAV vers Opus** (`convert-audio.ts`, `plan.ts`, `pipeline.ts`).
  - Encodeur activé par défaut si `ffmpeg` est présent, avec `libopus` à 96 kbps (64 kbps en mono).
  - Gain : environ ×14 (`se13010` passe de 3,07 Mo à environ 210 Ko, l'ensemble des SE de 596 à environ 45 Mo).
  - **Safari** : tester `canPlayType('audio/ogg; codecs=opus')` et prévoir un repli `.m4a` AAC. À vérifier sur son appareil.
  - **On ne réencode pas les BGM** : ce serait une perte sur un fichier déjà compressé, et elles sont lues en flux.
- **B2 : préchargement audio.**
  - `preload="auto"` seulement pour les SE inconditionnels de 300 Ko au plus, `metadata` ou rien sinon.
  - **Réutiliser l'élément préchargé** dans `audio-manager` au lieu d'en créer un nouveau.
  - Variante en P2 : SE courts chargés par `fetch` (donc cachables par le SW) dans une LRU d'`AudioBuffer` de 32 Mo.
- **B3 : appliquer WebP** (le code de #374 existe déjà).
  - Sans perte pour `image/`.
  - Avec perte pour `bg/ev`, en q90 avec `sharp_yuv` et un garde-fou SSIM ≥ 0,99 : environ −70 à −85 %.
  - Fond titre en WebP.
  - **Ne pas convertir `rule/`**, voire ne plus le copier.
- **B4 : compression HTTP.** Vérifier `Content-Encoding`. Si le serveur ne compresse pas, faire générer des `.br`/`.gz` des JSON et `.ks` par le pipeline.

**C. Supprimer l'attente aux transitions**
- **C1 : corriger le cache.**
  - Garder une `Map<url, Promise>` des décodages en cours, et n'entrer dans le LRU qu'après le décodage.
  - Le lookahead passe par `stage.prepare(url, {decode:true})` et la `Map` du player disparaît.
- **C2 : politique d'attente adaptative.**

| Situation | Comportement |
|---|---|
| Image décodée | Fondu immédiat |
| Image téléchargée mais pas décodée | On attend le décodage (moins de 150 ms) |
| Image pas encore arrivée | On garde l'image A, indicateur après 300 ms, attente jusqu'à `T_max` (3 s), et le fondu ne démarre **que quand l'image est prête** |
| Mode skip | Aucune attente : coupure franche dès que l'image est prête |
| Clic pendant l'attente | Coupure franche vers B quand elle est prête, jamais un fondu vers du vide |

  C'est fidèle à KAG : KiriKiri ne lance jamais `trans` avant que l'image soit chargée.
- **C3 (optionnel, P3)** : miniature floue de 32×18 pour les réseaux lents, désactivable. **Je déconseille** de commencer le fondu avec l'image précédente puis de basculer : un fondu de A vers A ne se voit pas, et la bascule casse la courbe du fondu.
- **C4** : appliquer la même politique aux `fg`, `chgfg`, `partbg` et `ev` dont `time > 0`, en attendant toutes les images du bloc avec `Promise.all`.

**D. Précharger par lots de script**
- **D1** : compléter `peekAssets` et traiter les chemins sûrs avant les branches conditionnelles. Lancer aussi le lookahead pendant les `@wait` minutés.
- **D2** : à l'entrée d'un script, `fetch` à priorité basse de tous ses `bg`/`ev` sur le réseau seulement, **sans décoder**, donc sans coût en RAM. Deux téléchargements en parallèle au plus, en pause pendant les transitions.
  - Budget : 25 Mo en Wi-Fi ou 4g, 5 Mo en 3g, 0 si `saveData`. Il faudra ajouter la taille des fichiers au manifeste.
  - Le script suivant commence à se précharger à 80 % du script courant.
  - Préchargement annulé en cas de skip, de chargement de sauvegarde ou de navigation dans le flowchart.

**E. Démarrage**
- **E1** : tout charger dans un seul `Promise.all` dans `main.ts`. `envcolor` est chargé sans être attendu.
- **E2** : `boot.json` d'environ 1 Ko (`assetsVersion` et URLs de l'écran titre). L'écran titre s'affiche avant le manifeste complet, et les boutons s'activent quand le manifeste est prêt.
- **E3** : `image-dimensions.json` chargé en différé, ou fusionné dans le manifeste.
- **E4** : découpage du code avec `import()` pour le flowchart, le mode CG, le mode son, la config, l'écran de sauvegarde et le backlog. Gain de 30 à 50 Ko gzip, donc P2, seulement si la mesure montre plus de 150 ms de parse.
- **E5** : pas de manifeste par chapitre. Si son parse dépasse 50 ms en mobile, passer à un format plus compact.

**F. Hébergement**
- **Première question à poser : où sont servis les assets ?** GitHub Pages est exclu pour des raisons de copyright.
- Sur un serveur perso : `Cache-Control: immutable` sur `/assets/`, `no-cache` sur le manifeste et `boot.json`, brotli, HTTP/2.
- Déconseiller `vite preview` derrière un tunnel.
- **SW** :
  - Répondre avant de mettre en cache (`waitUntil(put)`).
  - Répondre `206` à partir du cache pour les requêtes audio `Range`.
- Sur GitHub Pages (pour la coquille), le SW reste le seul levier.

## 4. Ce qu'il ne faut pas faire

- **Supprimer l'attente de décodage** : on retrouve les apparitions brutes. Il faut la rendre adaptative.
- **Raccourcir les fondus** : c'est une perte de fidélité.
- **Précacher tout le jeu** (environ 4 Go) : quota dépassé, éviction sur iOS, bande passante gaspillée.
- **Décoder à l'avance au-delà du LRU**, ou augmenter le plafond mobile : iOS tue l'onglet sans prévenir.
- **AVIF**, ou **WebP en dessous de q90 ou sans `sharp_yuv`**.
- **Réencoder les BGM par défaut**, ou leur appliquer `decodeAudioData` (environ 85 Mo de RAM pour 4 min).
- **Images basse résolution (LOD) par défaut**, atlas, HTTP/2 push, `loading=lazy`, `ImageBitmap` en DOM.
- **Mesurer en dev**, ou ne mesurer qu'en cache chaud local.
- **Compresser en brotli/gzip** des PNG, WebP ou OGG : ils sont déjà compressés.

## 5. Issues proposées, dans l'ordre

| # | Issue | Critères / preuve | Effort | Gain | Prio |
|---|---|---|---|---|---|
| V2-01 | `feat(perf): marqueurs boot/attente/audio + rapport copiable` | Rapport JSON récupérable sur mobile sans console ; aucun effet sans `?perf=1` | 0,5-1 j | Diagnostic | **p0** |
| V2-02 | `fix(renderer): décodage en cours ≠ hit de cache` | Promesses partagées, tests unitaires ; aucune transition vers une image non décodée dans le banc | 0,5 j | Moins d'apparitions brutes | **p0** |
| V2-03 | `feat(tools): SE WAV → Opus par défaut` | Repli `.m4a`, durées à ±20 ms, nouvelle `assetsVersion` ; SE ≤ 60 Mo au total, `se13010` ≤ 300 Ko, écoute de 10 SE | 1-1,5 j | Audio −90 % | **p0** |
| V2-04 | `fix(player): préchargement audio borné et réutilisé` | Aucune URL audio en double dans le Resource Timing du prologue | 1 j | Octets audio de la session −50 à −70 % | **p0** |
| V2-05 | `chore(assets): appliquer WebP (q90 bg/ev, SSIM ≥ 0,99)` | Rapport taille/SSIM, diff visuel vert ; bg/ev ≤ 30 % du PNG ; p95 froid mobile ≤ 600 ms | 1 j + revue | Images −60 à −80 % | **p1** |
| V2-06 | `feat(renderer): attente adaptative + indicateur (+ sprites/partbg/ev)` | Aucun cas « délai dépassé puis fondu vers du vide » ; e2e du clic pendant l'attente | 1,5-2 j | Plus d'apparition brute | **p1** |
| V2-07 | `refactor(player): lookahead via cache renderer + couverture complète` | Taux de succès du lookahead ≥ 90 % (prologue et `opening.ks`) ; image préchargée affichée en ≤ 1 frame | 1,5 j | Diaporamas au plus rapide possible | **p1** |
| V2-08 | `feat(player): préchargement réseau par script avec budget` | ≥ 90 % des fonds servis depuis le cache après 30 s (mobile 10 Mbps, cache froid) ; RAM inchangée | 1,5-2 j | Plus d'attente réseau | **p1** |
| V2-09 | `perf(boot): parallèle + boot.json + dimensions différées` | `title-painted` −40 % (mobile, cache froid) | 1 j | Écran titre plus rapide | **p1** |
| V2-10 | `fix(pwa): réponse avant cache.put + Range depuis le cache` | En passe chaude, `transferSize == 0` partout, audio compris | 1 j | Reprise de partie | p2 |
| V2-11 | `docs(pipeline): en-têtes d'hébergement + brotli précompressé` | `enc < dec` sur le manifeste | 0,5 j | −50 à −100 ms au démarrage | p2 |
| V2-12 | `perf(build): code-splitting des écrans secondaires` | JS critique ≤ 80 Ko gzip, budget ajouté | 1 j | −50 à −100 ms sur mobile | p2 |
| V2-13 | *(conditionnel)* miniature floue pour réseau lent | Seulement si `wait` p95 dépasse encore 1 s après V2-05 et V2-08 | 1,5 j | Attente masquée | p3 |

**Ordre recommandé** :
1. V2-01 et V2-02.
2. Faire mesurer le propriétaire.
3. V2-03 et V2-04.
4. V2-05.
5. V2-06 et V2-07.
6. V2-08 et V2-09.
7. Les p2.

Si sa mesure montre que l'attente se situe surtout au démarrage, passer V2-09 juste après V2-03.

## 6. Ce qu'il faut demander au propriétaire

1. L'URL utilisée, et où sont hébergés les assets (serveur perso, tunnel, LAN, `vite preview`). L'appareil, le navigateur et sa version, iOS en particulier.
2. Le réseau utilisé, avec un speedtest (débit et ping).
3. Où il attend : au lancement, sur l'écran titre, au premier texte, aux changements de fond ou au démarrage des sons. Et si c'est toujours ou seulement la première fois.
4. Le rapport de la section 1, en passe froide puis chaude, avec les numéros de page.
5. S'il accepte une image floue de moins d'une seconde sur réseau lent (V2-13).
6. S'il a `ffmpeg` et `cwebp`/`sharp` sur la machine qui lance le pipeline.

Si tu autorises l'écriture, j'enregistre ce plan dans `docs/PERF_PLAN_V2_OPUS.md`. Je peux aussi créer les issues V2-01 à V2-13 sur le Kanban.
