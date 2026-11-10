/**
 * Source du service worker PWA (issue #96).
 *
 * Le service worker n'est **pas** un fichier statique : il est généré au build
 * (`tools/pwa-sw.ts`) car il doit précacher les noms hachés des bundles Vite
 * (`/assets/index-<hash>.js|.css`) pour que la coquille fonctionne hors ligne
 * dès le premier chargement.
 *
 * Stratégies :
 * - **coquille** (`PRECACHE` : index.html, JS/CSS du build, manifeste, icônes) :
 *   cache-first sur le cache versionné `mahoyo-shell-<version>` ;
 * - **navigation** : network-first, repli sur l'`index.html` précaché (une
 *   nouvelle version déployée est donc vue dès qu'on est en ligne) ;
 * - **assets du jeu** (`/assets/**`, potentiellement plusieurs Go) : cache-first
 *   **borné** (`MAX_RUNTIME_ENTRIES` entrées, éviction des plus anciennes) dans
 *   `mahoyo-runtime-v1` ; ils ne sont jamais précachés ;
 * - **reste du same-origin** : network-first avec repli cache (borné) ;
 * - **cross-origin** (polices Google), requêtes non GET, `Range` et `/api/` :
 *   réseau uniquement.
 *
 * Mise à jour : l'ancien cache `mahoyo-shell-*` est supprimé à l'activation ; le
 * nouveau worker n'appelle `skipWaiting()` que sur message `{type:"SKIP_WAITING"}`
 * envoyé par l'application (voir `register.ts`), qui recharge la page une fois.
 */

/** Préfixe des caches de coquille (un par version du build). */
export const SHELL_CACHE_PREFIX = "mahoyo-shell-";
/** Cache runtime borné des assets du jeu. */
export const RUNTIME_CACHE = "mahoyo-runtime-v1";
/** Nombre maximal d'entrées conservées dans le cache runtime des assets. */
export const MAX_RUNTIME_ENTRIES = 400;

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
    `const RUNTIME_CACHE = ${JSON.stringify(RUNTIME_CACHE)};`,
    `const MAX_RUNTIME_ENTRIES = ${MAX_RUNTIME_ENTRIES};`,
    'const OFFLINE_RESPONSE = "Hors ligne : reconnectez-vous pour charger cette page.";',
    "",
    "self.addEventListener(\"install\", (event) => {",
    "  // Échoue si la coquille est incomplète : un SW à moitié installé est pire que pas de SW.",
    "  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)));",
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
    "    const keys = await caches.keys();",
    "    await Promise.all(",
    "      keys",
    "        .filter((key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE)",
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
    "    respond(event, cacheFirstBounded(RUNTIME_CACHE, request));",
    "    return;",
    "  }",
    "  respond(event, networkFirstFallback(RUNTIME_CACHE, request));",
    "});",
    "",
    "/**",
    " * Répond à une requête sans jamais laisser la promesse rejeter (sinon le",
    " * navigateur reçoit net::ERR_FAILED au lieu d'une réponse de repli). En cas",
    " * d'erreur inattendue, tente le cache global puis sert la page hors ligne.",
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
    "/** Assets du jeu : cache-first borné (éviction des entrées les plus anciennes). */",
    "async function cacheFirstBounded(cacheName, request) {",
    "  const cache = await caches.open(cacheName);",
    "  const cached = await cache.match(request, { ignoreVary: true });",
    "  if (cached) return cached;",
    "  const response = await fetch(request);",
    "  if (response.status === 200) await putBounded(cacheName, request, response);",
    "  return response;",
    "}",
    "",
    "/** Autres ressources same-origin : réseau d'abord, repli cache. */",
    "async function networkFirstFallback(cacheName, request) {",
    "  try {",
    "    const response = await fetch(request);",
    "    if (response.status === 200) await putBounded(cacheName, request, response);",
    "    return response;",
    "  } catch {",
    "    const cache = await caches.open(cacheName);",
    "    const cached = await cache.match(request, { ignoreVary: true });",
    "    return cached || offlineResponse();",
    "  }",
    "}",
    "",
    "async function putBounded(cacheName, request, response) {",
    "  const cache = await caches.open(cacheName);",
    "  await cache.put(request, response.clone());",
    "  const keys = await cache.keys();",
    "  for (let index = 0; index < keys.length - MAX_RUNTIME_ENTRIES; index++) {",
    "    await cache.delete(keys[index]);",
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
