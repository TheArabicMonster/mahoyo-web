/**
 * Source du service worker PWA (#96, cache d'assets versionné #372).
 *
 * Le service worker n'est **pas** un fichier statique : il est généré au build
 * (`tools/pwa-sw.ts`) car il doit précacher les noms hachés des bundles Vite
 * (`/assets/index-<hash>.js|.css`) pour que la coquille fonctionne hors ligne.
 *
 * Stratégies (plan Opus §3.E) :
 * - **coquille** (`PRECACHE`) : cache-first dans `mahoyo-shell-<hash du build>` ;
 * - **navigation** : network-first, repli sur l'`index.html` précaché ;
 * - **assets du jeu** (`/assets/**`, immuables tant que `assetsVersion` ne change
 *   pas) : cache-first dans `mahoyo-assets-<assetsVersion>` — version lue dans
 *   `assets/asset-manifest.json` (`assetsVersion` écrite par le pipeline, #372) ;
 *   les anciens caches `mahoyo-assets-*` sont **purgés à l'activation** du SW,
 *   pas pendant les fetches : plus de vidage/remplissage en boucle ;
 * - **`asset-manifest.json` et `image-dimensions.json`** : stale-while-revalidate
 *   (servis immédiatement depuis le cache, mis à jour en arrière-plan) ;
 * - **trim différé** : le cache d'assets est borné (`MAX_ASSETS_ENTRIES = 2000`)
 *   mais `cache.keys()` n'est appelé qu'un `put` sur `TRIM_EVERY` (25), pas à
 *   chaque écriture ;
 * - cross-origin (polices), non-GET, `Range`, `/api/` : réseau uniquement.
 *
 * Mise à jour : l'ancien cache `mahoyo-shell-*` et les anciens caches
 * `mahoyo-assets-*` sont supprimés à l'activation ; le nouveau worker n'appelle
 * `skipWaiting()` que sur message `{type:"SKIP_WAITING"}` (voir `register.ts`),
 * qui recharge la page une fois.
 */

/** Préfixe des caches de coquille (un par version du build). */
export const SHELL_CACHE_PREFIX = "mahoyo-shell-";
/** Préfixe des caches d'assets (un par `assetsVersion`). */
export const ASSETS_CACHE_PREFIX = "mahoyo-assets-";
/** Cache de métadonnées (version d'assets courante), hors purge d'assets. */
export const META_CACHE = "mahoyo-meta-v1";
/** Clé (URL sentinelle) stockant la version d'assets dans `META_CACHE`. */
export const META_VERSION_KEY = "/__mahoyo-assets-version";
/** Nombre maximal d'entrées du cache d'assets (transitoire avant versionnement complet). */
export const MAX_ASSETS_ENTRIES = 2000;
/** Fréquence (en puts) du trim différé : `cache.keys()` une fois sur N écritures. */
export const TRIM_EVERY = 25;
/** Assets servis en stale-while-revalidate (manifeste et dimensions). */
export const SWR_ASSET_PATHS = ["/assets/asset-manifest.json", "/assets/image-dimensions.json"] as const;
/** Version de repli quand le manifeste n'a pas d'`assetsVersion` exploitable. */
export const DEFAULT_ASSETS_VERSION = "unversioned";

export interface PwaServiceWorkerOptions {
  /** URLs same-origin à précacher (chemins absolus commençant par `/`). */
  precache: readonly string[];
  /** Version du build (hash), utilisée pour nommer/renouveler le cache de coquille. */
  version: string;
}

/** Génère le code source JavaScript du service worker (à écrire dans `dist/sw.js`). */
export function renderServiceWorker(options: PwaServiceWorkerOptions): string {
  const precache = [...options.precache];
  const lines = [
    "/* Service worker Mahoyo Web — généré par tools/pwa-sw.ts, ne pas éditer à la main. */",
    `const VERSION = ${JSON.stringify(options.version)};`,
    `const PRECACHE = ${JSON.stringify(precache, null, 2)};`,
    "const PRECACHE_SET = new Set(PRECACHE);",
    `const SHELL_CACHE_PREFIX = ${JSON.stringify(SHELL_CACHE_PREFIX)};`,
    `const SHELL_CACHE = SHELL_CACHE_PREFIX + VERSION;`,
    `const ASSETS_CACHE_PREFIX = ${JSON.stringify(ASSETS_CACHE_PREFIX)};`,
    `const META_CACHE = ${JSON.stringify(META_CACHE)};`,
    `const META_VERSION_KEY = ${JSON.stringify(META_VERSION_KEY)};`,
    `const MAX_ASSETS_ENTRIES = ${MAX_ASSETS_ENTRIES};`,
    `const TRIM_EVERY = ${TRIM_EVERY};`,
    `const SWR_ASSET_PATHS = new Set(${JSON.stringify([...SWR_ASSET_PATHS])});`,
    `const DEFAULT_ASSETS_VERSION = ${JSON.stringify(DEFAULT_ASSETS_VERSION)};`,
    'const OFFLINE_RESPONSE = "Hors ligne : reconnectez-vous pour charger cette page.";',
    "",
    "let assetsVersionPromise = null;",
    "let assetsPutCount = 0;",
    "",
    "self.addEventListener(\"install\", (event) => {",
    "  // Échoue si la coquille est incomplète : un SW à moitié installé est pire que pas de SW.",
    "  event.waitUntil((async () => {",
    "    const cache = await caches.open(SHELL_CACHE);",
    "    await cache.addAll(PRECACHE);",
    "    // Version d'assets lue FRAÎCHE à chaque installation : un nouveau build relit le manifeste",
    "    // et met à jour la méta, ce qui déclenche la purge des anciens caches à l'activation.",
    "    await readAssetsVersion({ fresh: true });",
    "  })());",
    "});",
    "",
    "self.addEventListener(\"message\", (event) => {",
    "  // Le client déclenche l'activation de la mise à jour quand il est prêt.",
    "  if (event.data && event.data.type === \"SKIP_WAITING\") {",
    "    event.waitUntil(self.skipWaiting());",
    "  }",
    "});",
    "",
    "self.addEventListener(\"activate\", (event) => {",
    "  event.waitUntil((async () => {",
    "    const currentAssets = await assetsCacheName();",
    "    const keys = await caches.keys();",
    "    await Promise.all(",
    "      keys",
    "        .filter((key) =>",
    "          (key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE) ||",
    "          (key.startsWith(ASSETS_CACHE_PREFIX) && key !== currentAssets),",
    "        )",
    "        .map((key) => caches.delete(key)),",
    "    );",
    "    await self.clients.claim();",
    "  })());",
    "});",
    "",
    "self.addEventListener(\"fetch\", (event) => {",
    "  const request = event.request;",
    "  if (request.method !== \"GET\") return;",
    "  const url = new URL(request.url);",
    "  if (url.origin !== self.location.origin) return; // polices/CDN : réseau seul",
    "  if (url.pathname.startsWith(\"/api/\")) return;",
    "  if (request.headers.has(\"range\")) return; // lectures partielles : réseau seul",
    "",
    "  if (request.mode === \"navigate\") {",
    "    respond(event, networkFirstNavigation(request));",
    "    return;",
    "  }",
    "  if (PRECACHE_SET.has(url.pathname)) {",
    "    respond(event, cacheFirst(SHELL_CACHE, request));",
    "    return;",
    "  }",
    "  if (url.pathname.startsWith(\"/assets/\")) {",
    "    respond(event, handleAssetRequest(event, request, url.pathname));",
    "    return;",
    "  }",
    "  // Autres ressources same-origin : réseau seul (repli hors ligne générique).",
    "  respond(event, fetchOrOffline(request));",
    "});",
    "",
    "/**",
    " * Répond à une requête sans jamais laisser la promesse rejeter (sinon le",
    " * navigateur reçoit net::ERR_FAILED au lieu d'une réponse de repli).",
    " */",
    "function respond(event, promise) {",
    "  event.respondWith(",
    "    promise.catch(async (error) => {",
    "      try {",
    "        const clients = await self.clients.matchAll({ type: \"window\" });",
    "        for (const client of clients) {",
    "          client.postMessage({ type: \"MAHOYO_SW_ERROR\", url: event.request.url, message: String(error) });",
    "        }",
    "      } catch (_) {}",
    "      const cache = await caches.open(SHELL_CACHE);",
    "      const cached = await cache.match(event.request, { ignoreVary: true });",
    "      return cached || offlineResponse();",
    "    }),",
    "  );",
    "}",
    "",
    "/**",
    " * Version d'assets courante. `fresh` force une relecture réseau du manifeste (installation) ;",
    " * sinon la méta en cache est utilisée, avec repli réseau si absente.",
    " */",
    "async function readAssetsVersion(options) {",
    "  const fresh = Boolean(options && options.fresh);",
    "  if (!fresh && assetsVersionPromise) return assetsVersionPromise;",
    "  const read = (async () => {",
    "    if (!fresh) {",
    "      try {",
    "        const meta = await caches.open(META_CACHE);",
    "        const cached = await meta.match(META_VERSION_KEY, { ignoreVary: true });",
    "        if (cached) {",
    "          const stored = (await cached.text()).trim();",
    "          if (stored) return stored;",
    "        }",
    "      } catch (_) {}",
    "    }",
    "    try {",
    "      const response = await fetch(\"/assets/asset-manifest.json\", { cache: \"no-store\" });",
    "      if (!response.ok) return DEFAULT_ASSETS_VERSION;",
    "      const manifest = await response.json();",
    "      const version = sanitizeAssetsVersion(manifest.assetsVersion);",
    "      const meta = await caches.open(META_CACHE);",
    "      await meta.put(META_VERSION_KEY, new Response(version));",
    "      return version;",
    "    } catch (_) {",
    "      return DEFAULT_ASSETS_VERSION;",
    "    }",
    "  })();",
    "  if (fresh) return read;",
    "  assetsVersionPromise = read;",
    "  return read;",
    "}",
    "",
    "/** Restreint la version à un jeu de caractères sûr pour un nom de cache. */",
    "function sanitizeAssetsVersion(value) {",
    "  return typeof value === \"string\" && /^[A-Za-z0-9._-]{1,64}$/.test(value)",
    "    ? value",
    "    : DEFAULT_ASSETS_VERSION;",
    "}",
    "",
    "async function assetsCacheName() {",
    "  return ASSETS_CACHE_PREFIX + (await readAssetsVersion());",
    "}",
    "",
    "async function handleAssetRequest(event, request, pathname) {",
    "  const cacheName = await assetsCacheName();",
    "  if (SWR_ASSET_PATHS.has(pathname)) return staleWhileRevalidate(event, cacheName, request);",
    "  return cacheFirstAssets(cacheName, request);",
    "}",
    "",
    "/** Navigation : réseau d'abord (nouvelle version visible), repli sur la coquille précachée. */",
    "async function networkFirstNavigation(request) {",
    "  try {",
    "    return await fetch(request);",
    "  } catch {",
    "    const cache = await caches.open(SHELL_CACHE);",
    "    const cached = await cache.match(\"/index.html\", { ignoreVary: true });",
    "    return cached || offlineResponse();",
    "  }",
    "}",
    "",
    "/** Coquille (fichiers précachés) : cache-first, sans écriture hors précache. */",
    "async function cacheFirst(cacheName, request) {",
    "  const cache = await caches.open(cacheName);",
    "  const cached = await cache.match(request, { ignoreVary: true });",
    "  if (cached) return cached;",
    "  return fetch(request);",
    "}",
    "",
    "/**",
    " * Assets du jeu : cache-first dans le cache versionné. Le trim est **différé**",
    " * (un `cache.keys()` tous les TRIM_EVERY puts) pour ne pas payer un parcours",
    " * complet à chaque écriture quand le cache grossit.",
    " */",
    "async function cacheFirstAssets(cacheName, request) {",
    "  const cache = await caches.open(cacheName);",
    "  const cached = await cache.match(request, { ignoreVary: true });",
    "  if (cached) return cached;",
    "  const response = await fetch(request);",
    "  if (response.status === 200) {",
    "    await cache.put(request, response.clone());",
    "    assetsPutCount += 1;",
    "    if (assetsPutCount % TRIM_EVERY === 0) await trimCache(cache, MAX_ASSETS_ENTRIES);",
    "  }",
    "  return response;",
    "}",
    "",
    "/** Manifeste et dimensions : servis du cache puis revalidés en arrière-plan. */",
    "async function staleWhileRevalidate(event, cacheName, request) {",
    "  const cache = await caches.open(cacheName);",
    "  const cached = await cache.match(request, { ignoreVary: true });",
    "  const revalidation = fetch(request)",
    "    .then(async (response) => {",
    "      if (response.status === 200) await cache.put(request, response.clone());",
    "      return response;",
    "    })",
    "    .catch(() => null);",
    "  if (cached) {",
    "    event.waitUntil(revalidation);",
    "    return cached;",
    "  }",
    "  const fresh = await revalidation;",
    "  return fresh || offlineResponse();",
    "}",
    "",
    "async function trimCache(cache, maxEntries) {",
    "  const keys = await cache.keys();",
    "  for (let index = 0; index < keys.length - maxEntries; index++) {",
    "    await cache.delete(keys[index]);",
    "  }",
    "}",
    "",
    "async function fetchOrOffline(request) {",
    "  try {",
    "    return await fetch(request);",
    "  } catch {",
    "    return offlineResponse();",
    "  }",
    "}",
    "",
    "function offlineResponse() {",
    "  return new Response(OFFLINE_RESPONSE, {",
    "    status: 503,",
    "    headers: { \"Content-Type\": \"text/plain; charset=utf-8\" },",
    "  });",
    "}",
    "",
  ];
  return lines.join("\n");
}
