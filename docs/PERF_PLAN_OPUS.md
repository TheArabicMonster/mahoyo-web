# Plan pour réduire la latence entre les scènes de Mahoyo

J'ai d'abord comparé ton état des lieux au code. Quatre points changent les priorités :

| Constat | Où | Conséquence |
|---|---|---|
| Le fond est un `background-image` CSS posé d'un coup. La transition démarre aussitôt, sans attendre que l'image soit chargée et décodée. | `stage-renderer.ts:1461`, `:1298-1300` | **C'est la cause principale.** Le fondu part vers une image qui n'est pas encore décodée : soit un saut d'image, soit un freeze au premier rendu. |
| `preload()` n'est appelé que pour les calques de timeline. Il n'y a rien pour `@bg`, `@image` ou les fonds d'événement (`ev`). Les objets `Image()` créés sont ensuite libérés par le ramasse-miettes. | `player.ts:1127-1131`, `stage-renderer.ts:778` | Quand on attend sur une page de texte, rien n'est préparé pour la suivante. |
| Les images `rule/` (1,5 Go) **ne sont pas utilisées à l'exécution** : la transition `universal` est remplacée par un fondu enchaîné. | `stage-renderer.ts:106` | Ce n'est pas un goulot. Inutile de les convertir maintenant. |
| Le service worker met déjà les `/assets/**` en cache à la demande, mais avec une limite de **400 entrées** et l'éviction des plus anciennes, pour environ 5 400 images. | `src/pwa/sw-source.ts:31` | Le cache se vide et se remplit en boucle. Une scène relue n'est pas garantie « chaude ». |

Il y a aussi un point secondaire. Le manifeste fait 1,03 Mo brut mais **70 Ko en gzip**, et il n'est lu qu'une fois au démarrage. Ce coût est payé au lancement, pas entre les scènes. Ce n'est donc pas ce qui cause le problème signalé.

Le vrai goulot dépend de l'endroit où sont les assets :
- **Assets locaux (`vite preview` ou localhost)** : le réseau est presque gratuit. Le coût vient du **décodage PNG au premier affichage**, environ 10 à 30 ms par fond 1024×576 sur desktop et 50 à 150 ms sur mobile, souvent plus pour les fonds de plus de 1050 px de haut.
- **Assets servis à distance** : chaque fond PNG fait 1 à 3 Mo, donc c'est le transfert qui domine. La réponse est le lookahead (préparer à l'avance les images des pages suivantes) et la conversion WebP.

---

## 1. Mesurer d'abord

### Instrumentation à ajouter au player (désactivée par défaut, activée par `?perf=1`)
- **Marqueurs par changement d'image de scène** (`performance.mark` avec `detail: {url, kind}`) :
  - `mh:img:request` au moment où la commande est appliquée ;
  - `mh:img:fetched` (via Resource Timing : `transferSize === 0` signifie que l'image venait du cache, et `workerStart` montre le passage par le service worker) ;
  - `mh:img:decoded` à la résolution de `img.decode()` ;
  - `mh:img:painted` après deux `requestAnimationFrame`.
- **Métrique clé, `scene-ready`** : de `request` à `painted`. Chaque mesure est classée selon le cas : préchargée ou non, cache chaud ou froid.
- **Blocages** : `PerformanceObserver` sur `long-animation-frame` (Chromium 123+, indique quel script bloque) avec repli sur `longtask`. Compter ceux de plus de 50 ms **pendant les transitions**.
- **INP** : `event` entries sur le clic ou la touche qui fait avancer le texte.
- **Mémoire** : `performance.measureUserAgentSpecificMemory()` (Chromium, page isolée) et, pour le cache décodé, une estimation `w×h×4` octets à partir de `image-dimensions.json` (déjà chargé au démarrage).
- Le tout dans un tampon circulaire exposé en `window.__mhPerf` pour Playwright.

### Banc de test `npm run perf:scenes` (Playwright)
- **En local, avec les vrais assets** : rejouer en mode auto les N premiers changements de scène d'un script réel.
  - Deux profils : desktop sans bridage, et « mobile » avec `CPU throttling 4×` via CDP et un réseau Fast 3G ou 10 Mbps.
  - Deux passes : cache froid (nouveau profil) puis cache chaud.
- **En CI** : les placeholders actuels sont trop légers pour mesurer un décodage. Il faut générer des **PNG lourds synthétiques originaux** (bruit en 1024×576 et 2048×1152) pour reproduire un coût de décodage réaliste sans aucun asset sous copyright.
- **Trace Chromium** (`browser.startTracing`, catégorie `disabled-by-default-devtools.timeline`) pour isoler les tâches `Decode Image`, `Paint` et `Layout`.
- **Toujours mesurer avec `vite preview`, jamais avec le serveur de dev.** Le serveur de dev sert `public/` sans optimisation, ce qui fausse les chiffres.

### Seuils cibles (p95, `scene-ready`)

| Scénario | Desktop | Mobile (CPU 4×) |
|---|---|---|
| Image préchargée par le lookahead, cache chaud | ≤ 16 ms (aucune image perdue) | ≤ 33 ms |
| Premier affichage, asset local, pas de préchargement | ≤ 100 ms | ≤ 250 ms |
| Premier affichage, réseau 10 Mbps, pas de préchargement | ≤ 600 ms (avec indicateur) | ≤ 1 000 ms |
| Proportion d'images servies par le lookahead en lecture normale | ≥ 90 % | ≥ 90 % |
| Blocages de plus de 50 ms pendant une transition | 0 | ≤ 1 |
| INP au clic d'avance | ≤ 100 ms | ≤ 200 ms |
| Cache décodé | ≤ 192 Mo | ≤ 64 Mo |

---

## 2. Quick wins (moins d'une journée)

1. **Attendre l'image avant la transition** (le gain le plus net).
   - Dans `apply()` (bg/ev), appeler `await ensureDecoded(url)` : `new Image()`, puis `src`, puis `decode()`, avec un repli sur `onload` si `decode` rejette.
   - Délai maximal de 1 s, abandon via le `signal` si le joueur clique ou passe en mode skip. En skip, ne rien attendre.
   - C'est **plus fidèle à KAG** que l'existant : KiriKiri charge l'image de façon synchrone avant `trans`. Il n'y a donc aucune entorse à la fidélité.
2. **Lookahead minimal.**
   - Pendant chaque attente de page (`l`/`p`), parcourir environ 40 commandes à venir dans le script courant, en prenant les deux branches de chaque `if`.
   - Y collecter les noms d'images de `bg`, `image`, `ev` et `fg`, puis les précharger pendant les temps morts (`requestIdleCallback`, avec repli `setTimeout`), au plus 2 à la fois.
   - Annuler le préchargement en cas de skip, de chargement de sauvegarde ou de saut dans le flowchart.
3. **Garder une référence aux images préchargées** : une `Map<url, HTMLImageElement>` toute simple. Sans référence, le décodage obtenu par `preload()` est perdu.
4. **`fetchPriority`** : `"high"` pour l'image demandée maintenant, `"low"` pour le lookahead (Chrome 101+, Safari 17.2+, Firefox 132+). Ajouter `decoding="async"` sur les `<img>` de sprites.
   - **Ne pas utiliser `loading="lazy"`.** Toutes les images de la scène sont visibles dans le viewport, donc le chargement différé ne ferait que retarder leur affichage.
5. **Limite du service worker** : passer de 400 entrées à environ 2 000 en attendant le versionnement complet (§3). À vérifier : `trim` appelle `cache.keys()` après chaque `put`, ce qui coûte de plus en plus cher quand le cache grossit. Le lancer en différé.

---

## 3. Phase structurante

**A. Fond rendu par `<img>` en double tampon** (un `refactor` du renderer).
- Deux calques `<img>` : on prépare le suivant, on le décode, puis on fait un fondu d'`opacity` sur des calques composités (`will-change: opacity` seulement pendant la transition).
- Avec `background-image`, `decode()` n'est **pas fiable** : le navigateur peut décoder à nouveau au moment du rendu.
- Le code des fonds transformés utilise déjà un `<img>` (`renderTransformedBg`). Il faut reprendre ses règles de placement (`50%`, `-48px`, #249).

**B. Cache d'images décodées en LRU, plafonné en octets.**
- Clé = URL, valeur = `HTMLImageElement` déjà décodé. Coût estimé à `w×h×4` grâce à `image-dimensions.json`.
- Plafond : 192 Mo sur desktop, 64 Mo sur iOS et quand `navigator.deviceMemory` vaut 4 ou moins.
- Je déconseille un LRU d'`ImageBitmap` ou d'`OffscreenCanvas` : ce n'est utile qu'avec un rendu canvas. En DOM, cela doublerait la mémoire sans rien gagner.

**C. Lookahead complet.**
- Ajouter `runtime.peekAssets(budget)` côté `src/kag/` (à vérifier : il faut que le runtime expose sa position et le programme parsé).
- Traverser les `jump` et `call` internes. En fin de fichier, précharger les premières images du script suivant grâce à `story-chain`.
- Précharger aussi les SE annoncés, avec `audio.preload="auto"`. L'audio passe par `new Audio()` en streaming (`audio-manager.ts:18`), donc aucun gros décodage à craindre.
- Respecter `navigator.connection.saveData`.

**D. Conversion WebP dans le pipeline** (`tools/convert-tlg.ts` / `pipeline.ts`).
- **Par défaut, WebP sans perte** : environ 20 à 35 % de transfert en moins, un décodage du même ordre que le PNG, aucun risque pour la fidélité.
- **WebP avec perte (qualité 90 ou plus), sur option et par catégorie** (bg, ev) seulement, avec un garde-fou automatique de SSIM ≥ 0,99 contre le PNG. Utiliser `sharp_yuv`, car le sous-échantillonnage des couleurs abîme les contours d'anime et les rouges.
- **Pas d'AVIF par défaut** : il se décode 2 à 5 fois plus lentement, alors que le décodage est justement notre goulot.
- Pas de version PNG de repli : WebP est supporté partout (Safari 14+). C'est le manifeste qui donne l'extension réelle.

**E. Service worker versionné.**
- Le pipeline écrit un `assetsVersion` (hash du manifeste). Le cache s'appelle alors `mahoyo-assets-<version>` et les anciens caches sont purgés à l'activation.
- Les assets ne changent pas tant que la version ne change pas : on garde donc le **cache-first**, pas le stale-while-revalidate. Le stale-while-revalidate ne sert que pour `asset-manifest.json` et `image-dimensions.json`.

**F. En-têtes HTTP (hébergement personnel).**
- Avec des URL versionnées : `Cache-Control: public, max-age=31536000, immutable`. Sinon : `max-age=86400, stale-while-revalidate=604800`.
- GitHub Pages impose `max-age=600` et ne permet pas d'en-têtes personnalisés. Là, le service worker est le seul levier.

**Conditionnel : seulement si la mesure le justifie.**
- **Manifeste découpé** (images / audio / scripts) seulement si sa lecture dépasse 50 ms sur mobile. **Pas de découpage par chapitre** : le résolveur fait des recherches globales insensibles à la casse et les sauts traversent les fichiers.
- **Niveaux de résolution (LOD)** : le stage est en 1024 px logiques, et sur un téléphone en DPR 3 il faut déjà plus de pixels que l'original. Réduire les images n'apporte que de la mémoire, au prix d'un flou visible. À réserver à un « mode économie mémoire ».
- **Rejeté : les atlas de sprites.** HTTP/2 rend les requêtes multiples peu coûteuses, un atlas décode des pixels inutiles, et cela complique le résolveur.

---

## 4. Perception : masquer l'attente sans trahir KAG

- **Garder l'image précédente pendant l'attente**, jamais d'écran noir. On commence par l'attente de 1 s décrite en §2.
- **Indicateur discret** : réutiliser `setWaitIndicator()`, qui existe déjà, mais seulement **au-delà de 300 ms**, pour éviter un clignotement.
- **Clics pendant l'attente** : ils sont mis en file d'attente, et non perdus ni appliqués deux fois. En mode skip, on passe directement.
- **Synchronisation audio et image** : si un changement de BGM et un `@bg` sont dans le même bloc, démarrer l'audio au début de la transition, avec 300 ms de décalage au plus. Au-delà, laisser partir l'audio, sinon le rythme du jeu d'origine change.
- **Pas d'écran de chargement entre les scènes.** Un fondu au noir court n'est acceptable que pour un chargement de sauvegarde ou un saut dans le flowchart, et seulement si le cache est froid.

---

## 5. Risques et pièges

- **Mémoire sur iOS** : Safari tue l'onglet sans prévenir au-delà d'environ 1 à 1,5 Go (moins sur les anciens iPhone). Le plafond en octets est obligatoire. Vérifier avec la Memory timeline de Web Inspector.
- **`decode()`** : il peut échouer (`EncodingError`) sur certaines versions de Safari, d'où le repli sur `onload`. Trop de décodages en parallèle saturent le CPU, d'où la limite de 2. Firefox libère les images décodées qui ne sont pas affichées : il faut l'accepter et le mesurer.
- **Cache périmé** : si le pipeline est relancé, les URL restent les mêmes mais le contenu change. Le cache-first sert alors l'ancienne version tant que (E) n'est pas fait. Autre point : `public/sw.js` est une ancienne version, sans limite et avec un nom fixe. À supprimer ou à vérifier qu'elle n'est jamais enregistrée en dev.
- **Tests** :
  - jsdom n'a pas `decode()`, il faut détecter la fonction avant de l'appeler.
  - Les e2e qui lisent `background-image` juste après `apply()` vont casser. Il faut un point d'attente de test `stage.whenReady()` et des snapshots à revoir après (A).
- **PWA** : un cache plus gros consomme du quota (`navigator.storage.estimate()`, `persist()`). L'ITP de Safari peut vider le cache après 7 jours si la PWA n'est pas installée, donc il ne faut pas compter dessus.
- **Fidélité** : le WebP avec perte doit rester sur option, protégé par le SSIM, et vérifié avec le diff visuel (`trace-visual`).

---

## 6. Plan d'exécution (proposition d'issues)

| # | Issue | Critères d'acceptation et preuve attendue | Effort | Gain attendu | Fichiers |
|---|---|---|---|---|---|
| 1 | `feat(perf): instrumentation scene-ready` | Marqueurs, LoAF, `__mhPerf` et INP actifs avec `?perf=1`, sans effet sinon. Preuve : capture d'une trace avec les 4 marqueurs. | 1 j | Base de mesure | `stage-renderer.ts`, nouveau `src/core/perf-probe.ts` |
| 2 | `test(perf): banc perf:scenes` | Rapport p50/p95 par scénario (froid/chaud × desktop/mobile). PNG lourds synthétiques en CI. Preuve : `reports/perf-scenes.json` avec la **référence avant correction**. | 1,5 j | Prouve la cause | `tools/perf-scenes.ts`, `tests/e2e/placeholders.ts` |
| 3 | `fix(renderer): décoder avant la transition` | Plus aucune transition vers une image non décodée. Annulable. Délai maximal de 1 s. Skip non ralenti. Preuve : blocages de plus de 50 ms pendant les transitions = 0. | 0,5-1 j | p95 freeze −60 à −80 % (local) | `stage-renderer.ts` |
| 4 | `feat(player): lookahead de préchargement` | ≥ 90 % des images servies par le lookahead en lecture auto. Annulation sur skip ou chargement. Preuve : compteur du banc. | 1,5-2 j | `scene-ready` ≈ une frame dans la majorité des cas | `src/kag/runtime.ts`, `player.ts`, `story-chain.ts` |
| 5 | `feat(renderer): cache décodé LRU borné` | Plafond respecté (test unitaire). Mémoire stable sur 200 changements de scène. Preuve : courbe mémoire. | 1 j | Relecture sans redécodage | `stage-renderer.ts`, `image-dimensions.ts` |
| 6 | `fix(pwa): cache d'assets versionné` | Le nom du cache dépend d'`assetsVersion`. Purge à l'activation. Plus de vidage en boucle. Preuve : test du service worker et 2ᵉ passage en cache chaud ≥ 95 % de hits. | 0,5-1 j | Le cas « cache chaud » devient fiable | `sw-source.ts`, `tools/manifest.ts`, `tools/pwa-sw.ts` |
| 7 | `refactor(renderer): fond <img> double tampon` | Placement identique (#249). e2e et diff visuel verts. Preuve : captures avant/après. | 2-3 j | Rend 3 et 5 fiables | `stage-renderer.ts` |
| 8 | `feat(tools): conversion WebP` | WebP sans perte par défaut. Avec perte sur option, garde SSIM ≥ 0,99. Manifeste mis à jour. Preuve : rapport de tailles et de SSIM. | 2-3 j | Transfert −25 à −35 % (sans perte), jusqu'à −75 % (avec perte) | `convert-tlg.ts`, `pipeline.ts`, `asset-resolver.ts` |
| 9 | `chore(perf): budgets scene-ready` | Nouveaux plafonds dans `perf-budgets.ts` et le tableau de `PERFORMANCE.md`. | 0,5 j | Évite les régressions | `tools/perf-budgets.ts`, `docs/PERFORMANCE.md` |
| 10 | *(conditionnel)* manifeste découpé, mode économie mémoire avec LOD | Seulement si la mesure (n° 2) le justifie | 1-2 j | Démarrage mobile | `main.ts`, `asset-manifest.ts` |

**Ordre** : 1 et 2 (la référence avant correction est indispensable), puis 3, puis 4 et 5 en parallèle, puis 6. On mesure à nouveau, puis 7, 8 et 9. Le n° 10 seulement si la mesure le demande.

En une journée, les n° 3, 4 (version minimale) et le réglage de `fetchPriority` devraient supprimer l'essentiel de l'inconfort signalé en local. La conversion WebP compte surtout si les assets sont servis à distance.

Les pourcentages de gain sont des **estimations à confirmer** par la référence du n° 2. Je n'ai pas encore fait tourner de mesure sur les vrais assets.

Veux-tu que je crée ces issues sur le Kanban (une issue par tâche, en français, avec priorités p0 à p2) ? Je peux aussi commencer directement par les n° 1 et 2 sur une branche `feat/perf-scene-ready`.
