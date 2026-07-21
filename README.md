# Memory Lanes phone and web app

This folder is the installable web app for phones, tablets, and desktop browsers. It is a static site: deploy the folder at the root of an HTTPS website, then connect it to the Memory Lanes Supabase project.

## Configure

1. Copy the values from `config.example.js` into `config.js`.
2. Set `supabaseUrl` to the project's HTTPS URL.
3. Set `publishableKey` to the Supabase **publishable/anon key**.
4. Set `appUrl` to the public HTTPS address where this folder is deployed.
5. Set `allowDemo` to `false` before production deployment.

Never place a Supabase service-role key, database password, or other secret in this folder. Browser code and `config.js` are public. The database row-level security policies and authenticated RPC functions enforce owner and employee permissions.

## Deploy

Deploy every file in this folder together. The host must:

- serve `index.html` for normal page requests;
- use HTTPS (required for installation and the service worker, except on localhost);
- serve `.webmanifest` as `application/manifest+json` when possible;
- avoid permanently caching `config.js`, `index.html`, and `service-worker.js` at the CDN layer.

The manifest currently assumes this folder is deployed at the website root. If it is hosted under a subdirectory, update the manifest `id`, `start_url`, `scope`, and shortcut URLs to that subdirectory before deployment.

## Install on a phone

- Android/Chrome: open the site and choose **Install app** when offered.
- iPhone/Safari: open the site, choose **Share**, then **Add to Home Screen**.

The service worker caches only the public application shell. It deliberately does not cache Supabase, authentication, API, sales, inventory, analytics, or other business responses. Data already visible in an open tab remains readable if the connection drops, but changes and a fresh cloud load require an internet connection.

The icon set includes 192 px and 512 px PNGs for Chromium installation, a non-transparent 512 px maskable icon entry for Android, a 180 px Apple touch icon, and the original SVG as a scalable option. Re-run `icons/generate-icons.ps1` after changing the logo source or colors.

## Verify locally

Run a local static web server from this folder and open its localhost URL. Opening `index.html` directly as a `file:` URL does not exercise installation or offline behavior.

The dependency-free checks can be run from the project folder with:

```text
python -m unittest discover cloud/web/tests
```
