/* Memory Lanes caches only the public application shell.
   Business records, authentication responses, and Supabase requests are never cached. */
const CACHE_PREFIX = "memory-lanes-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const SCOPE_URL = new URL(self.registration.scope);

const SHELL_PATHS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./api.js",
  "./analytics.js",
  "./demo-data.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const SHELL_URLS = new Set(SHELL_PATHS.map((path) => new URL(path, SCOPE_URL).href));
const INDEX_URL = new URL("./index.html", SCOPE_URL).href;
const CONFIG_URL = new URL("./config.js", SCOPE_URL).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([...SHELL_URLS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = fallbackUrl || request;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      // Navigation URLs may contain one-time invite/recovery parameters. Store
      // only under the canonical shell URL, never under the requested URL.
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== SCOPE_URL.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, INDEX_URL));
    return;
  }

  const normalizedUrl = new URL(url.pathname, SCOPE_URL.origin).href;
  if (!SHELL_URLS.has(normalizedUrl)) return;

  // Fetch configuration from the network first so a deployment change takes effect
  // immediately, while retaining the last public configuration for shell startup.
  event.respondWith(
    normalizedUrl === CONFIG_URL
      ? networkFirst(request, CONFIG_URL)
      : cacheFirst(request),
  );
});
